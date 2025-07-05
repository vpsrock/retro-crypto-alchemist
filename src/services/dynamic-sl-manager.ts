// Dynamic Stop Loss Manager - Bulletproof implementation
import { getDynamicPositionDB } from '@/services/dynamic-position-db';
import { placePriceTriggeredOrder, cancelPriceTriggeredOrder, getContract } from '@/services/gateio';
import type { PositionState, SlUpdateRequest, ActionAudit, OrderFillEvent } from '@/lib/dynamic-position-schemas';

class DynamicSlManager {
    private db = getDynamicPositionDB();
    private isProcessing = false;

    constructor() {
        console.log('[SL-MANAGER] Dynamic SL Manager initialized');
    }

    /**
     * Process unprocessed fill events and update SL accordingly
     */
    async processFillEvents(): Promise<void> {
        if (this.isProcessing) {
            console.log('[SL-MANAGER] Already processing fills, skipping');
            return;
        }

        this.isProcessing = true;
        const processId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            console.log(`[SL-MANAGER] [${processId}] Starting fill event processing`);

            const unprocessedFills = this.db.getUnprocessedFills();
            console.log(`[SL-MANAGER] [${processId}] Found ${unprocessedFills.length} unprocessed fills`);

            if (unprocessedFills.length === 0) {
                return;
            }

            // Process fills in order (oldest first)
            for (const fill of unprocessedFills) {
                await this.processSingleFillEvent(fill, processId);
            }

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Error processing fill events:`, error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process a single fill event
     */
    private async processSingleFillEvent(fill: OrderFillEvent, processId: string): Promise<void> {
        console.log(`[SL-MANAGER] [${processId}] Processing ${fill.fillType} fill for position ${fill.positionId}`);

        try {
            // Get current position state
            const position = this.db.getPositionState(fill.positionId);
            if (!position) {
                console.error(`[SL-MANAGER] [${processId}] Position ${fill.positionId} not found`);
                this.db.markFillProcessed(fill.orderId);
                return;
            }

            // Process based on fill type
            let processed = false;

            switch (fill.fillType) {
                case 'tp1':
                    processed = await this.processTP1Fill(position, fill, processId);
                    break;
                case 'tp2':
                    processed = await this.processTP2Fill(position, fill, processId);
                    break;
                case 'sl':
                    processed = await this.processSLFill(position, fill, processId);
                    break;
                case 'manual':
                    processed = await this.processManualFill(position, fill, processId);
                    break;
                default:
                    console.warn(`[SL-MANAGER] [${processId}] Unknown fill type: ${fill.fillType}`);
                    processed = true; // Mark as processed to avoid infinite loop
            }

            if (processed) {
                this.db.markFillProcessed(fill.orderId);
                console.log(`[SL-MANAGER] [${processId}] Fill ${fill.orderId} marked as processed`);
            }

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Error processing fill ${fill.orderId}:`, error);
            
            // Log error but mark as processed to avoid infinite retry
            this.logPositionError(fill.positionId, 'fill_processing_error', error.message);
            this.db.markFillProcessed(fill.orderId);
        }
    }

    /**
     * Process TP1 fill - Move SL to break-even
     */
    private async processTP1Fill(position: PositionState, fill: OrderFillEvent, processId: string): Promise<boolean> {
        console.log(`[SL-MANAGER] [${processId}] Processing TP1 fill for ${position.contract}`);

        if (position.phase !== 'initial') {
            console.log(`[SL-MANAGER] [${processId}] Position ${position.id} not in initial phase (${position.phase}), skipping TP1 processing`);
            return true;
        }

        try {
            // Calculate new position size after TP1
            const newRemainingSize = position.remainingSize - fill.fillSize;
            
            // Calculate break-even price (entry price + small buffer)
            const monitoringState = this.db.getMonitoringState();
            const buffer = monitoringState.settings.breakEvenBuffer;
            
            const breakEvenPrice = position.direction === 'long' 
                ? position.entryPrice * (1 + buffer)
                : position.entryPrice * (1 - buffer);

            // Update SL to break-even
            const slUpdateRequest: SlUpdateRequest = {
                positionId: position.id,
                newSlPrice: breakEvenPrice,
                reason: 'break_even',
                oldSlOrderId: position.currentSlOrderId,
                contractSpec: await this.getContractSpec(position)
            };

            const newSlOrderId = await this.updateStopLoss(slUpdateRequest, processId);

            // Update position state in database
            this.db.transaction(() => {
                this.db.updatePositionPhase(position.id, 'tp1_filled', newRemainingSize);
                this.db.updateSlOrder(position.id, newSlOrderId, breakEvenPrice);
                
                // Log the action
                this.logPositionAction(position.id, 'sl_updated_break_even', {
                    fillType: 'tp1',
                    fillSize: fill.fillSize,
                    newRemainingSize,
                    oldSlPrice: position.currentSlPrice,
                    newSlPrice: breakEvenPrice,
                    oldSlOrderId: position.currentSlOrderId,
                    newSlOrderId
                });
            });

            console.log(`[SL-MANAGER] [${processId}] TP1 processed: SL moved to break-even (${breakEvenPrice}), remaining size: ${newRemainingSize}`);
            return true;

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Error processing TP1 fill:`, error);
            this.logPositionError(position.id, 'tp1_processing_error', error.message);
            return false;
        }
    }

    /**
     * Process TP2 fill - Implement trailing SL
     */
    private async processTP2Fill(position: PositionState, fill: OrderFillEvent, processId: string): Promise<boolean> {
        console.log(`[SL-MANAGER] [${processId}] Processing TP2 fill for ${position.contract}`);

        if (position.phase !== 'tp1_filled') {
            console.log(`[SL-MANAGER] [${processId}] Position ${position.id} not in tp1_filled phase (${position.phase}), skipping TP2 processing`);
            return true;
        }

        try {
            // Calculate new position size after TP2
            const newRemainingSize = position.remainingSize - fill.fillSize;
            
            // Calculate trailing SL price
            const monitoringState = this.db.getMonitoringState();
            const trailingDistance = monitoringState.settings.trailingDistance;
            
            // For trailing SL, we want to be more aggressive to lock in profits
            const trailingSLPrice = position.direction === 'long'
                ? fill.fillPrice * (1 - trailingDistance) // Trail below TP2 price for long
                : fill.fillPrice * (1 + trailingDistance); // Trail above TP2 price for short

            // Update SL to trailing level
            const slUpdateRequest: SlUpdateRequest = {
                positionId: position.id,
                newSlPrice: trailingSLPrice,
                reason: 'trailing',
                oldSlOrderId: position.currentSlOrderId,
                contractSpec: await this.getContractSpec(position)
            };

            const newSlOrderId = await this.updateStopLoss(slUpdateRequest, processId);

            // Update position state in database
            this.db.transaction(() => {
                this.db.updatePositionPhase(position.id, 'tp2_filled', newRemainingSize);
                this.db.updateSlOrder(position.id, newSlOrderId, trailingSLPrice);
                
                // Log the action
                this.logPositionAction(position.id, 'sl_updated_trailing', {
                    fillType: 'tp2',
                    fillSize: fill.fillSize,
                    newRemainingSize,
                    oldSlPrice: position.currentSlPrice,
                    newSlPrice: trailingSLPrice,
                    oldSlOrderId: position.currentSlOrderId,
                    newSlOrderId
                });
            });

            console.log(`[SL-MANAGER] [${processId}] TP2 processed: SL set to trailing (${trailingSLPrice}), remaining size: ${newRemainingSize}`);
            return true;

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Error processing TP2 fill:`, error);
            this.logPositionError(position.id, 'tp2_processing_error', error.message);
            return false;
        }
    }

    /**
     * Process SL fill - Position stopped out
     */
    private async processSLFill(position: PositionState, fill: OrderFillEvent, processId: string): Promise<boolean> {
        console.log(`[SL-MANAGER] [${processId}] Processing SL fill for ${position.contract} - position stopped out`);

        try {
            // Update position to stopped out
            this.db.transaction(() => {
                this.db.updatePositionPhase(position.id, 'stopped_out', 0);
                
                // Log the action
                this.logPositionAction(position.id, 'position_stopped_out', {
                    fillType: 'sl',
                    fillSize: fill.fillSize,
                    fillPrice: fill.fillPrice,
                    finalRemainingSize: 0
                });
            });

            console.log(`[SL-MANAGER] [${processId}] Position ${position.id} marked as stopped out`);
            return true;

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Error processing SL fill:`, error);
            this.logPositionError(position.id, 'sl_processing_error', error.message);
            return false;
        }
    }

    /**
     * Process manual fill - Position manually closed
     */
    private async processManualFill(position: PositionState, fill: OrderFillEvent, processId: string): Promise<boolean> {
        console.log(`[SL-MANAGER] [${processId}] Processing manual fill for ${position.contract}`);

        try {
            // Calculate new remaining size
            const newRemainingSize = Math.max(0, position.remainingSize - fill.fillSize);
            
            if (newRemainingSize === 0) {
                // Position completely closed
                this.db.transaction(() => {
                    this.db.updatePositionPhase(position.id, 'completed', 0);
                    
                    // Log the action
                    this.logPositionAction(position.id, 'position_completed', {
                        fillType: 'manual',
                        fillSize: fill.fillSize,
                        fillPrice: fill.fillPrice,
                        reason: 'manual_close'
                    });
                });

                console.log(`[SL-MANAGER] [${processId}] Position ${position.id} manually closed`);
            } else {
                // Partial manual close - update remaining size
                this.db.transaction(() => {
                    this.db.updatePositionPhase(position.id, position.phase, newRemainingSize);
                    
                    // Log the action
                    this.logPositionAction(position.id, 'manual_filled', {
                        fillType: 'manual',
                        fillSize: fill.fillSize,
                        fillPrice: fill.fillPrice,
                        newRemainingSize
                    });
                });

                console.log(`[SL-MANAGER] [${processId}] Position ${position.id} partially closed: ${newRemainingSize} remaining`);
            }

            return true;

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Error processing manual fill:`, error);
            this.logPositionError(position.id, 'manual_processing_error', error.message);
            return false;
        }
    }

    /**
     * Update stop loss order atomically
     */
    private async updateStopLoss(request: SlUpdateRequest, processId: string): Promise<string> {
        const position = this.db.getPositionState(request.positionId);
        if (!position) {
            throw new Error(`Position ${request.positionId} not found`);
        }

        console.log(`[SL-MANAGER] [${processId}] Updating SL for ${position.contract}: ${position.currentSlPrice} -> ${request.newSlPrice}`);

        // Format the new SL price according to contract tick size
        const formattedSlPrice = request.newSlPrice.toFixed(request.contractSpec.decimalPlaces);
        
        // Create new SL order payload
        const slPayload = {
            initial: {
                contract: position.contract,
                size: 0, // Auto-size to close remaining position
                price: "0",
                tif: "ioc",
                reduce_only: true,
                auto_size: position.direction === 'long' ? "close_long" : "close_short",
            },
            trigger: {
                strategy_type: 0,
                price_type: 0,
                price: formattedSlPrice,
                rule: position.direction === 'long' ? 2 : 1, // <= for long SL, >= for short SL
                expiration: 86400 // 1 day
            },
            order_type: position.direction === 'long' ? "plan-close-long-position" : "plan-close-short-position"
        };

        try {
            // Step 1: Place new SL order
            console.log(`[SL-MANAGER] [${processId}] Placing new SL order at ${formattedSlPrice}`);
            const newSlResult = await placePriceTriggeredOrder(position.settle, slPayload, position.apiKey, position.apiSecret);
            const newSlOrderId = newSlResult.id.toString();

            console.log(`[SL-MANAGER] [${processId}] New SL order placed: ${newSlOrderId}`);

            // Step 2: Cancel old SL order
            if (request.oldSlOrderId) {
                try {
                    console.log(`[SL-MANAGER] [${processId}] Cancelling old SL order: ${request.oldSlOrderId}`);
                    await cancelPriceTriggeredOrder(position.settle, request.oldSlOrderId, position.apiKey, position.apiSecret);
                    console.log(`[SL-MANAGER] [${processId}] Old SL order cancelled: ${request.oldSlOrderId}`);
                } catch (cancelError: any) {
                    console.warn(`[SL-MANAGER] [${processId}] Failed to cancel old SL order ${request.oldSlOrderId}:`, cancelError);
                    // Continue anyway - new SL is placed
                }
            }

            return newSlOrderId;

        } catch (error: any) {
            console.error(`[SL-MANAGER] [${processId}] Failed to update SL order:`, error);
            throw new Error(`SL update failed: ${error.message}`);
        }
    }

    /**
     * Get contract specifications
     */
    private async getContractSpec(position: PositionState): Promise<SlUpdateRequest['contractSpec']> {
        const contractSpec = await getContract(position.settle, position.contract);
        if (!contractSpec) {
            throw new Error(`Could not fetch contract specifications for ${position.contract}`);
        }

        const tickSize = contractSpec.tick_size || contractSpec.order_price_round;
        if (!tickSize) {
            throw new Error(`Could not determine tick size for ${position.contract}`);
        }

        const decimalPlaces = tickSize.includes('.') ? tickSize.split('.')[1].length : 0;

        return {
            tickSize,
            decimalPlaces
        };
    }

    /**
     * Log position action
     */
    private logPositionAction(positionId: string, action: ActionAudit['action'], details: any): void {
        const audit: ActionAudit = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            positionId,
            action,
            details,
            timestamp: new Date().toISOString(),
            success: true
        };

        this.db.logAction(audit);
    }

    /**
     * Log position error
     */
    private logPositionError(positionId: string, action: string, error: string): void {
        const audit: ActionAudit = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            positionId,
            action: 'error_occurred',
            details: { action, error },
            timestamp: new Date().toISOString(),
            success: false,
            error
        };

        this.db.logAction(audit);
    }

    /**
     * Get processing status
     */
    getStatus(): { isProcessing: boolean } {
        return { isProcessing: this.isProcessing };
    }
}

// Singleton instance
let slManagerInstance: DynamicSlManager | null = null;

export function getDynamicSlManager(): DynamicSlManager {
    if (!slManagerInstance) {
        slManagerInstance = new DynamicSlManager();
    }
    return slManagerInstance;
}

export { DynamicSlManager };
