// This is a server-side file.
'use server';

/**
 * @fileOverview Manages trade execution, including placing, listing, and canceling orders.
 *
 * - placeTradeStrategy: Places an entry order with associated TP/SL.
 * - listOpenOrders: Lists all open price-triggered orders.
 * - cancelOrder: Cancels a specific price-triggered order.
 * - listOpenPositions: Lists all open positions.
 * - cleanupOrphanedOrders: Cancels TP/SL orders for positions that are no longer open.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { 
    placeFuturesOrder, 
    placePriceTriggeredOrder, 
    listPriceTriggeredOrders, 
    cancelPriceTriggeredOrder,
    getContract,
    updateLeverage,
    listPositions,
} from '@/services/gateio';
import { getTimeManager } from '@/services/time-based-position-manager';
import { getAutoInitDB } from '@/services/auto-init-database';
import { 
    PlaceTradeStrategyInputSchema, 
    PlaceTradeStrategyOutputSchema, 
    ListOpenOrdersInputSchema,
    ListOpenOrdersOutputSchema,
    CancelOrderInputSchema,
    CancelOrderOutputSchema,
    ListOpenPositionsInputSchema,
    ListOpenPositionsOutputSchema,
    CleanupOrphanedOrdersOutputSchema,
    PlaceTradeStrategyMultiTpInputSchema,
    PlaceTradeStrategyMultiTpOutputSchema,
    MultiTpOrderSizesSchema,
    MultiTpPriceLevelsSchema,
} from '@/lib/schemas';

import type { 
    PlaceTradeStrategyInput, 
    PlaceTradeStrategyOutput, 
    ListOpenOrdersInput,
    ListOpenOrdersOutput,
    CancelOrderInput,
    CancelOrderOutput,
    ListOpenPositionsInput,
    ListOpenPositionsOutput,
    CleanupOrphanedOrdersOutput,
    PlaceTradeStrategyMultiTpInput,
    PlaceTradeStrategyMultiTpOutput,
    MultiTpOrderSizes,
    MultiTpPriceLevels,
} from '@/lib/schemas';

export type { PlaceTradeStrategyInput, PlaceTradeStrategyOutput, ListOpenOrdersInput, ListOpenOrdersOutput, CancelOrderInput, CancelOrderOutput, ListOpenPositionsInput, ListOpenPositionsOutput, CleanupOrphanedOrdersOutput };


// Wrapper Functions
export async function placeTradeStrategy(input: PlaceTradeStrategyInput): Promise<PlaceTradeStrategyOutput> {
    return placeTradeStrategyFlow(input);
}

export async function listOpenOrders(input: ListOpenOrdersInput): Promise<ListOpenOrdersOutput> {
    return listOpenOrdersFlow(input);
}

export async function cancelOrder(input: CancelOrderInput): Promise<CancelOrderOutput> {
    return cancelOrderFlow(input);
}

export async function listOpenPositions(input: ListOpenPositionsInput): Promise<ListOpenPositionsOutput> {
    return listOpenPositionsFlow(input);
}

export async function cleanupOrphanedOrders(input: ListOpenOrdersInput): Promise<CleanupOrphanedOrdersOutput> {
    return cleanupOrphanedOrdersFlow(input);
}


// Flow Definitions

const placeTradeStrategyFlow = ai.defineFlow(
  {
    name: 'placeTradeStrategyFlow',
    inputSchema: PlaceTradeStrategyInputSchema,
    outputSchema: PlaceTradeStrategyOutputSchema,
  },
  async (input) => {
    const { tradeDetails, tradeSizeUsd, leverage, apiKey, apiSecret, settle } = input;
    const { market, take_profit, stop_loss, trade_call } = tradeDetails;

    // Check for existing positions before placing a new one.
    const existingPositions = await listPositions(settle, apiKey, apiSecret);
    const openPosition = existingPositions.find((p: any) => p.contract === market && p.size !== 0);
    if (openPosition) {
        throw new Error(`An open position already exists for ${market}. Cannot place a new trade.`);
    }
    
    // 1. Fetch contract specification to get multiplier and tick size
    const contractSpec = await getContract(settle, market);
    if (!contractSpec) {
        throw new Error(`Could not fetch contract specifications for ${market}. The API returned a null or empty response.`);
    }

    const lastPrice = parseFloat(contractSpec.last_price);
    const multiplier = parseFloat(contractSpec.quanto_multiplier);
    // Gate.io API is inconsistent: use tick_size, fallback to order_price_round
    const tickSize = contractSpec.tick_size || contractSpec.order_price_round;

    if (!lastPrice || !multiplier) {
        const receivedData = JSON.stringify(contractSpec, null, 2);
        throw new Error(`Could not fetch last_price or quanto_multiplier for ${market}. Received data:\n${receivedData}`);
    }
    if (!tickSize) {
        const receivedData = JSON.stringify(contractSpec, null, 2);
        throw new Error(`Could not fetch 'tick_size' or 'order_price_round' for ${market}. The contract specification was received, but both fields are missing. Received data:\n${receivedData}`);
    }

    // 2. Calculate order size in contracts based on target USD value
    const contractsToTrade = Math.max(1, Math.floor(tradeSizeUsd / (lastPrice * multiplier)));
    
    // 3. Set Leverage for the contract
    await updateLeverage(settle, market, String(leverage), apiKey, apiSecret);
    
    // 4. Format TP/SL prices according to the contract's tick size
    const decimalPlaces = tickSize.includes('.') ? tickSize.split('.')[1].length : 0;
    if (!take_profit || !stop_loss) {
        throw new Error(`Invalid trade details: take_profit (${take_profit}) or stop_loss (${stop_loss}) is missing or zero.`);
    }

    const formattedTakeProfit = take_profit.toFixed(decimalPlaces);
    const formattedStopLoss = stop_loss.toFixed(decimalPlaces);

    const isLong = trade_call === 'long';
    const entryOrderSize = isLong ? contractsToTrade : -contractsToTrade;

    // 5. Place Initial Market Order to Enter Position
    const marketOrderPayload = {
        contract: market,
        size: entryOrderSize,
        price: "0", // Market order
        tif: "ioc", // Immediate or Cancel
        text: "t-a-retro-crypto-alchemist",
    };
    const entryOrderResult = await placeFuturesOrder(settle, marketOrderPayload, apiKey, apiSecret);

    // 6. Place Take-Profit Order
    const tpPayload = {
      initial: {
        contract: market,
        price: "0", // Market price for closure
        tif: "ioc",
        reduce_only: true,
        auto_size: isLong ? "close_long" : "close_short",
      },
      trigger: {
        strategy_type: 0,
        price_type: 0, // Using last price for trigger
        price: formattedTakeProfit,
        rule: isLong ? 1 : 2, // >= for long TP, <= for short TP
      },
    };
    const takeProfitOrderResult = await placePriceTriggeredOrder(settle, tpPayload, apiKey, apiSecret);

    // 7. Place Stop-Loss Order
    const slPayload = {
      initial: {
        contract: market,
        price: "0",
        tif: "ioc",
        reduce_only: true,
        auto_size: isLong ? "close_long" : "close_short",
      },
      trigger: {
        strategy_type: 0,
        price_type: 0,
        price: formattedStopLoss,
        rule: isLong ? 2 : 1, // <= for long SL, >= for short SL
      },
    };
    const stopLossOrderResult = await placePriceTriggeredOrder(settle, slPayload, apiKey, apiSecret);

    return {
        entry_order_id: entryOrderResult.id,
        take_profit_order_id: takeProfitOrderResult.id,
        stop_loss_order_id: stopLossOrderResult.id,
        message: `Successfully placed entry (${contractsToTrade} contracts), TP, and SL orders for ${market}.`
    };
  }
);


const listOpenOrdersFlow = ai.defineFlow(
  {
    name: 'listOpenOrdersFlow',
    inputSchema: ListOpenOrdersInputSchema,
    outputSchema: ListOpenOrdersOutputSchema,
  },
  async ({ settle, apiKey, apiSecret }) => {
    const orders = await listPriceTriggeredOrders(settle, 'open', apiKey, apiSecret);
    return orders;
  }
);


const cancelOrderFlow = ai.defineFlow(
  {
    name: 'cancelOrderFlow',
    inputSchema: CancelOrderInputSchema,
    outputSchema: CancelOrderOutputSchema,
  },
  async ({ settle, orderId, apiKey, apiSecret }) => {
    const result = await cancelPriceTriggeredOrder(settle, orderId, apiKey, apiSecret);
    return result;
  }
);

const listOpenPositionsFlow = ai.defineFlow(
    {
        name: 'listOpenPositionsFlow',
        inputSchema: ListOpenPositionsInputSchema,
        outputSchema: ListOpenPositionsOutputSchema,
    },
    async ({settle, apiKey, apiSecret}) => {
        const positions = await listPositions(settle, apiKey, apiSecret);
        return positions;
    }
);

const cleanupOrphanedOrdersFlow = ai.defineFlow(
    {
        name: 'cleanupOrphanedOrdersFlow',
        inputSchema: ListOpenOrdersInputSchema,
        outputSchema: CleanupOrphanedOrdersOutputSchema,
    },
    async ({ settle, apiKey, apiSecret }) => {
        const openPositions = await listPositions(settle, apiKey, apiSecret);
        const openTriggerOrders = await listPriceTriggeredOrders(settle, 'open', apiKey, apiSecret);

        const activePositionContracts = new Set(
            openPositions
                .filter((p: any) => p.size !== 0)
                .map((p: any) => p.contract.trim())
        );
        
        const openOrderContractsForLog = openTriggerOrders.map((o: any) => o.initial?.contract?.trim() || 'UNKNOWN');

        const orphanedOrders = openTriggerOrders.filter((order: any) => {
            const contract = order.initial?.contract?.trim();
            if (!contract) return false;
            return !activePositionContracts.has(contract);
        });

        const orphanedContractsFoundForLog = orphanedOrders.map((o: any) => o.initial?.contract?.trim() || 'UNKNOWN');

        const cancelled_orders: { id: string; contract: string }[] = [];
        const cancellation_failures: { id?: string; contract?: string; error: string }[] = [];

        for (const order of orphanedOrders) {
            const contract = order.initial?.contract;
            const orderId = order.id;

            if (orderId && contract) {
                try {
                    await cancelPriceTriggeredOrder(settle, orderId, apiKey, apiSecret);
                    cancelled_orders.push({ id: orderId, contract: contract });
                } catch (e: any) {
                    const errorMsg = e.message || String(e);
                    console.error(`Failed to cancel orphaned order ${orderId} for ${contract}: ${errorMsg}`);
                    cancellation_failures.push({ id: orderId, contract: contract, error: errorMsg });
                }
            } else {
                cancellation_failures.push({ 
                    id: orderId, 
                    contract: contract, 
                    error: "Orphaned order was missing a valid ID or contract name." 
                });
            }
        }
        
        return {
            cancelled_orders,
            cancellation_failures,
            message: `Cancelled ${cancelled_orders.length} of ${orphanedOrders.length} identified orphaned TP/SL order(s).`,
            active_position_contracts: Array.from(activePositionContracts) as string[],
            open_order_contracts: openOrderContractsForLog as string[],
            orphaned_contracts_found: orphanedContractsFoundForLog as string[],
        };
    }
);

// ====== MULTI-TP ENHANCED TRADE EXECUTION SYSTEM ======

/**
 * Calculate order sizes for multi-TP strategy
 * 50% for TP1, 30% for TP2, ~20% for runner
 */
function calculateMultiTpSizes(totalContracts: number) {
    const tp1Size = Math.floor(totalContracts * 0.5);  // 50%
    const tp2Size = Math.floor(totalContracts * 0.3);  // 30%
    const runnerSize = totalContracts - tp1Size - tp2Size; // Remaining ~20%
    
    return {
        totalContracts,
        tp1Size,
        tp2Size, 
        runnerSize
    };
}

/**
 * Calculate price levels for multi-TP strategy
 * TP1: 1.5%, TP2: 2.5%, SL: AI's recommendation
 */
function calculateMultiTpPrices(entryPrice: number, direction: 'long' | 'short', aiStopLoss: number) {
    const multiplier = direction === 'long' ? 1 : -1;
    
    return {
        entryPrice,
        tp1Price: entryPrice * (1 + (0.015 * multiplier)), // 1.5%
        tp2Price: entryPrice * (1 + (0.025 * multiplier)), // 2.5%
        slPrice: aiStopLoss // Use AI's recommendation for initial SL
    };
}

/**
 * Enhanced trade execution with multi-TP strategy
 * Backward compatible - can fall back to single TP if multi-TP fails
 */
export const placeTradeStrategyMultiTp = ai.defineFlow(
    {
        name: 'placeTradeStrategyMultiTp',
        inputSchema: PlaceTradeStrategyMultiTpInputSchema,
        outputSchema: PlaceTradeStrategyMultiTpOutputSchema,
    },
    async (input) => {
        const { tradeDetails, tradeSizeUsd, leverage, apiKey, apiSecret, settle, strategyType } = input;
        const { market, take_profit, stop_loss, trade_call } = tradeDetails;

        console.log(`[MULTI-TP] Starting ${strategyType} trade execution for ${market}`);

        // Check for existing positions before placing a new one
        const existingPositions = await listPositions(settle, apiKey, apiSecret);
        const openPosition = existingPositions.find((p: any) => p.contract === market && p.size !== 0);
        if (openPosition) {
            throw new Error(`An open position already exists for ${market}. Cannot place a new trade.`);
        }
        
        // 1. Fetch contract specification to get multiplier and tick size
        const contractSpec = await getContract(settle, market);
        if (!contractSpec) {
            throw new Error(`Could not fetch contract specifications for ${market}. The API returned a null or empty response.`);
        }

        const lastPrice = parseFloat(contractSpec.last_price);
        const multiplier = parseFloat(contractSpec.quanto_multiplier);
        const tickSize = contractSpec.tick_size || contractSpec.order_price_round;

        if (!lastPrice || !multiplier) {
            const receivedData = JSON.stringify(contractSpec, null, 2);
            throw new Error(`Could not fetch last_price or quanto_multiplier for ${market}. Received data:\n${receivedData}`);
        }
        if (!tickSize) {
            const receivedData = JSON.stringify(contractSpec, null, 2);
            throw new Error(`Could not fetch 'tick_size' or 'order_price_round' for ${market}. The contract specification was received, but both fields are missing. Received data:\n${receivedData}`);
        }

        // 2. Calculate order size in contracts based on target USD value
        const totalContracts = Math.max(1, Math.floor(tradeSizeUsd / (lastPrice * multiplier)));
        
        // 3. Set Leverage for the contract
        await updateLeverage(settle, market, String(leverage), apiKey, apiSecret);
        
        // 4. Calculate price levels and order sizes based on strategy type
        const decimalPlaces = tickSize.includes('.') ? tickSize.split('.')[1].length : 0;
        if (!take_profit || !stop_loss) {
            throw new Error(`Invalid trade details: take_profit (${take_profit}) or stop_loss (${stop_loss}) is missing or zero.`);
        }

        const isLong = trade_call === 'long';
        const entryOrderSize = isLong ? totalContracts : -totalContracts;

        // Decide strategy type (fallback to single if multi-TP not suitable)
        let actualStrategyType = strategyType;
        if (strategyType === 'multi-tp' && totalContracts < 5) {
            console.log(`[MULTI-TP] Position too small (${totalContracts} contracts), falling back to single TP`);
            actualStrategyType = 'single';
        }

        // 5. Place Initial Market Order to Enter Position
        const marketOrderPayload = {
            contract: market,
            size: entryOrderSize,
            price: "0", // Market order
            tif: "ioc", // Immediate or Cancel
            text: "t-retro-crypto-alchemist-v2",
        };
        
        console.log(`[MULTI-TP] Placing entry order for ${market}: ${entryOrderSize} contracts`);
        const entryOrderResult = await placeFuturesOrder(settle, marketOrderPayload, apiKey, apiSecret);

        if (actualStrategyType === 'single') {
            // Fall back to original single TP/SL logic
            console.log(`[MULTI-TP] Using single TP strategy for ${market}`);
            
            const formattedTakeProfit = take_profit.toFixed(decimalPlaces);
            const formattedStopLoss = stop_loss.toFixed(decimalPlaces);

            // Single Take-Profit Order
            const tpPayload = {
                initial: {
                    contract: market,
                    price: "0",
                    tif: "ioc", // Required for market price execution
                    reduce_only: true,
                    auto_size: isLong ? "close_long" : "close_short",
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedTakeProfit,
                    rule: isLong ? 1 : 2,
                    expiration: 86400 // 1 day (minimum allowed by Gate.io API)
                },
                order_type: isLong ? "plan-close-long-position" : "plan-close-short-position"
            };

            // Single Stop-Loss Order
            const slPayload = {
                initial: {
                    contract: market,
                    price: "0",
                    tif: "ioc", // Required for market price execution
                    reduce_only: true,
                    auto_size: isLong ? "close_long" : "close_short",
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedStopLoss,
                    rule: isLong ? 2 : 1,
                    expiration: 86400 // 1 day (minimum allowed by Gate.io API)
                },
                order_type: isLong ? "plan-close-long-position" : "plan-close-short-position"
            };

            const conditionalOrders = [tpPayload, slPayload];
            console.log(`[SINGLE-TP] Placing TP and SL orders sequentially`);
            
            try {
                const tpOrderResult = await placePriceTriggeredOrder(settle, tpPayload, apiKey, apiSecret);
                console.log(`[SINGLE-TP] TP order placed successfully: ${tpOrderResult.id}`);
                
                const slOrderResult = await placePriceTriggeredOrder(settle, slPayload, apiKey, apiSecret);
                console.log(`[SINGLE-TP] SL order placed successfully: ${slOrderResult.id}`);

                return {
                    entry_order_id: entryOrderResult.id,
                    take_profit_order_id: tpOrderResult.id,
                    stop_loss_order_id: slOrderResult.id,
                    message: `Single TP/SL strategy executed successfully for ${market}. Entry: ${entryOrderResult.id}, TP: ${tpOrderResult.id}, SL: ${slOrderResult.id}`,
                    strategyType: 'single' as const
                };
                
            } catch (conditionalOrderError: any) {
                console.error(`[SINGLE-TP] Conditional order placement failed:`, conditionalOrderError);
                
                // Try to place at least a basic SL for protection
                try {
                    const emergencySlResult = await placePriceTriggeredOrder(settle, slPayload, apiKey, apiSecret);
                    console.log(`[SINGLE-TP] Emergency SL placed: ${emergencySlResult.id}`);
                    
                    return {
                        entry_order_id: entryOrderResult.id,
                        stop_loss_order_id: emergencySlResult.id,
                        message: `Single TP strategy partially failed, only SL placed for protection. Entry: ${entryOrderResult.id}, SL: ${emergencySlResult.id}`,
                        strategyType: 'single' as const
                    };
                } catch (emergencyError: any) {
                    throw new Error(`CRITICAL: Single TP/SL orders failed. Position ${market} is UNPROTECTED! Error: ${conditionalOrderError.message}`);
                }
            }
        } else {
            // Multi-TP strategy
            console.log(`[MULTI-TP] Using multi-TP strategy for ${market} with ${totalContracts} contracts`);
            
            const orderSizes = calculateMultiTpSizes(totalContracts);
            const priceLevels = calculateMultiTpPrices(lastPrice, trade_call, stop_loss);
            
            console.log(`[MULTI-TP] Order sizes for ${market}:`, orderSizes);
            console.log(`[MULTI-TP] Price levels for ${market}:`, priceLevels);

            // Format prices according to contract tick size
            const formattedTp1 = priceLevels.tp1Price.toFixed(decimalPlaces);
            const formattedTp2 = priceLevels.tp2Price.toFixed(decimalPlaces);
            const formattedSl = priceLevels.slPrice.toFixed(decimalPlaces);

            // TP1 Order Payload
            const tp1Payload = {
                initial: {
                    contract: market,
                    size: isLong ? -orderSizes.tp1Size : orderSizes.tp1Size,
                    price: "0",
                    tif: "ioc", // Required for market price execution
                    reduce_only: true
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedTp1,
                    rule: isLong ? 1 : 2,
                    expiration: 86400 // 1 day (minimum allowed by Gate.io API)
                },
                order_type: isLong ? "plan-close-long-position" : "plan-close-short-position"
            };

            // TP2 Order Payload
            const tp2Payload = {
                initial: {
                    contract: market,
                    size: isLong ? -orderSizes.tp2Size : orderSizes.tp2Size,
                    price: "0",
                    tif: "ioc", // Required for market price execution
                    reduce_only: true
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedTp2,
                    rule: isLong ? 1 : 2,
                    expiration: 86400 // 1 day (minimum allowed by Gate.io API)
                },
                order_type: isLong ? "plan-close-long-position" : "plan-close-short-position"
            };

            // SL Order Payload
            const slPayload = {
                initial: {
                    contract: market,
                    size: 0, // Will close any remaining position
                    price: "0",
                    tif: "ioc", // Required for market price execution with auto_size
                    reduce_only: true,
                    auto_size: isLong ? "close_long" : "close_short"
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedSl,
                    rule: isLong ? 2 : 1,
                    expiration: 86400 // 1 day (minimum allowed by Gate.io API)
                },
                order_type: isLong ? "plan-close-long-position" : "plan-close-short-position"
            };

            const conditionalOrders = [tp1Payload, tp2Payload, slPayload];
            console.log(`[MULTI-TP] Placing ${conditionalOrders.length} conditional orders sequentially for ${market}`);
            
            // Place orders with error handling and rollback capability
            const placedOrders: any[] = [];
            
            try {
                // TP1 Order
                console.log(`[MULTI-TP] Placing TP1 order: ${orderSizes.tp1Size} contracts at ${formattedTp1}`);
                const tp1OrderResult = await placePriceTriggeredOrder(settle, tp1Payload, apiKey, apiSecret);
                placedOrders.push(tp1OrderResult);
                
                // TP2 Order
                console.log(`[MULTI-TP] Placing TP2 order: ${orderSizes.tp2Size} contracts at ${formattedTp2}`);
                const tp2OrderResult = await placePriceTriggeredOrder(settle, tp2Payload, apiKey, apiSecret);
                placedOrders.push(tp2OrderResult);
                
                // SL Order
                console.log(`[MULTI-TP] Placing SL order: full remaining position at ${formattedSl}`);
                const slOrderResult = await placePriceTriggeredOrder(settle, slPayload, apiKey, apiSecret);
                placedOrders.push(slOrderResult);
                
                // Save position state to database for dynamic management with error handling
                const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                try {
                    savePositionState(
                        positionId,
                        market,
                        trade_call as 'long' | 'short',
                        totalContracts,
                        lastPrice,
                        entryOrderResult.id.toString(),
                        'multi-tp',
                        tp1OrderResult.id.toString(),
                        tp2OrderResult.id.toString(),
                        slOrderResult.id.toString(),
                        orderSizes,
                        priceLevels,
                        apiKey,
                        apiSecret,
                        settle
                    );
                    
                    // Register position for time-based tracking only if database save succeeded
                    const timeManager = getTimeManager();
                    timeManager.registerPosition(positionId, market);
                    
                    console.log(`[MULTI-TP] ✅ Position state and time tracking registered successfully`);
                    
                } catch (dbError) {
                    console.error(`[MULTI-TP] ⚠️ Database save failed, but orders are placed and protected:`, dbError);
                    // Don't throw error here - orders are already placed and position is protected
                    // Just log the issue for monitoring
                }
                
                return {
                    entry_order_id: entryOrderResult.id,
                    tp1_order_id: tp1OrderResult.id,
                    tp2_order_id: tp2OrderResult.id,
                    stop_loss_order_id: slOrderResult.id,
                    position_id: positionId,
                    message: `Multi-TP strategy executed successfully for ${market}. Entry: ${entryOrderResult.id}, TP1: ${tp1OrderResult.id}, TP2: ${tp2OrderResult.id}, SL: ${slOrderResult.id}`,
                    strategyType: 'multi-tp' as const,
                    orderSizes,
                    targetPrices: priceLevels
                };
                
            } catch (conditionalOrderError: any) {
                // Rollback: Cancel any successfully placed conditional orders
                console.error(`[MULTI-TP] Conditional order placement failed, attempting rollback for ${placedOrders.length} orders`);
                
                for (const order of placedOrders) {
                    try {
                        await cancelPriceTriggeredOrder(settle, order.id, apiKey, apiSecret);
                        console.log(`[MULTI-TP] Rollback: Cancelled order ${order.id}`);
                    } catch (rollbackError) {
                        console.error(`[MULTI-TP] Rollback failed for order ${order.id}:`, rollbackError);
                    }
                }
                
                // CRITICAL: Position protection fallback - place basic SL at minimum
                console.error(`[MULTI-TP] CRITICAL: Position ${market} opened but conditional orders failed. Attempting emergency SL placement.`);
                
                try {
                    // Emergency SL order using AI's stop loss
                    const emergencySlPayload = {
                        initial: {
                            contract: market,
                            price: "0",
                            tif: "ioc",
                            reduce_only: true,
                            auto_size: isLong ? "close_long" : "close_short",
                        },
                        trigger: {
                            strategy_type: 0,
                            price_type: 0,
                            price: formattedSl,
                            rule: isLong ? 2 : 1,
                            expiration: 86400
                        },
                        order_type: isLong ? "plan-close-long-position" : "plan-close-short-position"
                    };
                    
                    const emergencySlResult = await placePriceTriggeredOrder(settle, emergencySlPayload, apiKey, apiSecret);
                    console.log(`[MULTI-TP] Emergency SL placed successfully: ${emergencySlResult.id}`);
                    
                    throw new Error(`Multi-TP conditional orders failed: ${conditionalOrderError.message || conditionalOrderError.toString()}. Rolled back ${placedOrders.length} orders. Emergency SL placed: ${emergencySlResult.id}.`);
                    
                } catch (emergencySlError: any) {
                    console.error(`[MULTI-TP] CRITICAL: Emergency SL placement also failed:`, emergencySlError);
                    throw new Error(`CRITICAL: Multi-TP conditional orders failed AND emergency SL failed. Position ${market} is UNPROTECTED! Original error: ${conditionalOrderError.message}. Emergency SL error: ${emergencySlError.message}. Rolled back ${placedOrders.length} orders.`);
                }
            }
        }
    }
);

/**
 * IMPORTANT: Gate.io API expiration requirements for triggered orders:
 * - Must be integer multiple of 86400 (1 day in seconds)  
 * - Must be in range [86400, 86400*30] (1-30 days)
 * - 86400 = 1 day (minimum allowed)
 * - We use 1 day expiration for all TP/SL orders
 */

// ===== DYNAMIC POSITION MANAGEMENT INTEGRATION =====

/**
 * Database helper for dynamic position management
 */
function getDynamicPositionDB(): any {
    return getAutoInitDB();
}

/**
 * Save position state for dynamic management with robust error handling
 */
function savePositionState(
    positionId: string,
    contract: string,
    direction: 'long' | 'short',
    size: number,
    entryPrice: number,
    entryOrderId: string,
    strategyType: 'single' | 'multi-tp',
    tp1OrderId: string,
    tp2OrderId: string | undefined,
    slOrderId: string,
    orderSizes: any,
    priceLevels: any,
    apiKey: string,
    apiSecret: string,
    settle: 'usdt' | 'btc'
): void {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new Error(`[DYNAMIC-DB] apiKey is missing or empty for position ${positionId} (${contract})`);
    }
    if (!apiSecret || typeof apiSecret !== 'string' || !apiSecret.trim()) {
        throw new Error(`[DYNAMIC-DB] apiSecret is missing or empty for position ${positionId} (${contract})`);
    }
    try {
        const db = getDynamicPositionDB();
        // Use transaction for atomic operation
        const saveTransaction = db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO position_states (
                    id, contract, direction, size, entry_price, entry_order_id,
                    strategy_type, tp1_size, tp2_size, runner_size,
                    tp1_order_id, tp2_order_id, current_sl_order_id,
                    phase, remaining_size, realized_pnl,
                    original_sl_price, current_sl_price, tp1_price, tp2_price,
                    created_at, last_updated, api_key, api_secret, settle
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const now = new Date().toISOString();
            return stmt.run(
                positionId,
                contract,
                direction,
                size,
                entryPrice,
                entryOrderId,
                strategyType,
                orderSizes.tp1Size || null,
                orderSizes.tp2Size || null,
                orderSizes.runnerSize || null,
                tp1OrderId,
                tp2OrderId || null,
                slOrderId,
                'initial',
                size,
                0,
                priceLevels.slPrice,
                priceLevels.slPrice,
                priceLevels.tp1Price || null,
                priceLevels.tp2Price || null,
                now,
                now,
                apiKey,
                apiSecret,
                settle
            );
        });
        const result = saveTransaction();
        if (result.changes > 0) {
            console.log(`[DYNAMIC-DB] ✅ Saved position state for ${contract} (${positionId})`);
        } else {
            throw new Error(`Failed to insert position state - no rows affected`);
        }
    } catch (error) {
        console.error(`[DYNAMIC-DB] ❌ Failed to save position state for ${contract}:`, error);
        throw new Error(`Database save failed for position ${positionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // ✅ Using shared connection - never close it
}
