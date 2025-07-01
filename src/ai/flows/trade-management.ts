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
