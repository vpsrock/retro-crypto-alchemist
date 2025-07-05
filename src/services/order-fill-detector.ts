// Order Fill Detection Service - Bulletproof implementation
import { getDynamicPositionDB } from '@/services/dynamic-position-db';
import { listPriceTriggeredOrders } from '@/services/gateio';
import type { PositionState, OrderFillEvent, ActionAudit } from '@/lib/dynamic-position-schemas';

class OrderFillDetector {
    private db = getDynamicPositionDB();
    private isRunning = false;
    private currentCheckId = '';

    constructor() {
        console.log('[FILL-DETECTOR] Order Fill Detector initialized');
    }

    /**
     * Start monitoring for order fills
     * Safe to call multiple times - will not create duplicate monitors
     */
    async startMonitoring(): Promise<void> {
        if (this.isRunning) {
            console.log('[FILL-DETECTOR] Monitoring already running, skipping start');
            return;
        }

        this.isRunning = true;
        const monitoringState = this.db.getMonitoringState();
        
        console.log(`[FILL-DETECTOR] Starting monitoring with ${monitoringState.settings.checkInterval}ms interval`);
        
        // Update monitoring state
        this.db.updateMonitoringState({
            isActive: true,
            lastCheck: new Date().toISOString()
        });

        // Start monitoring loop
        this.monitoringLoop();
    }

    /**
     * Stop monitoring
     */
    async stopMonitoring(): Promise<void> {
        console.log('[FILL-DETECTOR] Stopping monitoring');
        this.isRunning = false;
        
        this.db.updateMonitoringState({
            isActive: false,
            lastCheck: new Date().toISOString()
        });
    }

    /**
     * Main monitoring loop - checks for order fills periodically
     */
    private async monitoringLoop(): Promise<void> {
        while (this.isRunning) {
            const checkStartTime = Date.now();
            this.currentCheckId = `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Starting fill detection cycle`);

            try {
                await this.performFillDetection();
                
                const checkDuration = Date.now() - checkStartTime;
                console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Fill detection completed in ${checkDuration}ms`);
                
                // Update last check time
                this.db.updateMonitoringState({
                    lastCheck: new Date().toISOString()
                });

            } catch (error: any) {
                console.error(`[FILL-DETECTOR] [${this.currentCheckId}] Error during fill detection:`, error);
                
                // Log error but don't stop monitoring
                this.logCriticalError('fill_detection_error', error.message);
            }

            // Wait for next check interval
            const monitoringState = this.db.getMonitoringState();
            await this.sleep(monitoringState.settings.checkInterval);
        }

        console.log('[FILL-DETECTOR] Monitoring loop stopped');
    }

    /**
     * Perform fill detection for all active positions
     */
    private async performFillDetection(): Promise<void> {
        const activePositions = this.db.getAllActivePositions();
        
        console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Checking ${activePositions.length} active positions`);

        if (activePositions.length === 0) {
            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] No active positions to monitor`);
            return;
        }

        // Group positions by API credentials to minimize API calls
        const positionGroups = this.groupPositionsByCredentials(activePositions);

        for (const group of positionGroups) {
            await this.checkPositionGroup(group);
        }
    }

    /**
     * Group positions by API credentials to optimize API calls
     */
    private groupPositionsByCredentials(positions: PositionState[]): PositionState[][] {
        const groups = new Map<string, PositionState[]>();

        for (const position of positions) {
            const key = `${position.apiKey}:${position.settle}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(position);
        }

        return Array.from(groups.values());
    }

    /**
     * Check a group of positions with same API credentials
     */
    private async checkPositionGroup(positions: PositionState[]): Promise<void> {
        if (positions.length === 0) return;

        const firstPosition = positions[0];
        const { apiKey, apiSecret, settle } = firstPosition;

        try {
            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Fetching orders for ${positions.length} positions on ${settle}`);

            // Fetch all open orders for these credentials
            const openOrders = await listPriceTriggeredOrders(settle, 'open', apiKey, apiSecret);
            
            // Fetch finished orders for comparison (to detect fills)
            const finishedOrders = await listPriceTriggeredOrders(settle, 'finished', apiKey, apiSecret);

            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Found ${openOrders.length} open, ${finishedOrders.length} finished orders`);

            // Check each position for fills
            for (const position of positions) {
                await this.checkPositionForFills(position, openOrders, finishedOrders);
            }

        } catch (error: any) {
            console.error(`[FILL-DETECTOR] [${this.currentCheckId}] Error checking position group:`, error);
            
            // Log error for each position in the group
            for (const position of positions) {
                this.logPositionError(position.id, 'api_fetch_error', error.message);
            }
        }
    }

    /**
     * Check a single position for order fills
     */
    private async checkPositionForFills(
        position: PositionState, 
        openOrders: any[], 
        finishedOrders: any[]
    ): Promise<void> {
        console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Checking position ${position.id} (${position.contract})`);

        // Build map of position's order IDs
        const positionOrderIds = new Set<string>();
        if (position.tp1OrderId) positionOrderIds.add(position.tp1OrderId);
        if (position.tp2OrderId) positionOrderIds.add(position.tp2OrderId);
        if (position.currentSlOrderId) positionOrderIds.add(position.currentSlOrderId);

        // Check for finished orders that belong to this position
        const positionFinishedOrders = finishedOrders.filter(order => 
            positionOrderIds.has(order.id.toString())
        );

        if (positionFinishedOrders.length === 0) {
            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] No fills detected for position ${position.id}`);
            return;
        }

        console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Found ${positionFinishedOrders.length} filled orders for position ${position.id}`);

        // Process each filled order
        for (const filledOrder of positionFinishedOrders) {
            await this.processFillEvent(position, filledOrder);
        }
    }

    /**
     * Process a detected fill event
     */
    private async processFillEvent(position: PositionState, filledOrder: any): Promise<void> {
        const orderId = filledOrder.id.toString();
        const fillTime = new Date(filledOrder.finish_time * 1000).toISOString();
        
        console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Processing fill for order ${orderId} on position ${position.id}`);

        // Determine fill type
        let fillType: OrderFillEvent['fillType'] = 'manual';
        let fillSize = 0;

        if (orderId === position.tp1OrderId) {
            fillType = 'tp1';
            fillSize = position.tp1Size || 0;
        } else if (orderId === position.tp2OrderId) {
            fillType = 'tp2';
            fillSize = position.tp2Size || 0;
        } else if (orderId === position.currentSlOrderId) {
            fillType = 'sl';
            fillSize = position.remainingSize; // SL closes remaining position
        }

        // Check if we've already processed this fill
        const existingFills = this.db.getUnprocessedFills().filter(f => f.orderId === orderId);
        if (existingFills.length > 0) {
            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Fill for order ${orderId} already recorded, skipping`);
            return;
        }

        // Create fill event
        const fillEvent: OrderFillEvent = {
            orderId,
            contract: position.contract,
            fillType,
            fillSize,
            fillPrice: parseFloat(filledOrder.trigger?.price || '0'),
            fillTime,
            positionId: position.id
        };

        // Record fill event in database
        try {
            this.db.transaction(() => {
                this.db.recordOrderFill(fillEvent);
                
                // Log the event
                this.logPositionAction(position.id, `${fillType}_filled`, {
                    orderId,
                    fillSize,
                    fillPrice: fillEvent.fillPrice,
                    fillTime
                });
            });

            console.log(`[FILL-DETECTOR] [${this.currentCheckId}] Fill event recorded: ${fillType} order ${orderId} filled ${fillSize} contracts`);

        } catch (error: any) {
            console.error(`[FILL-DETECTOR] [${this.currentCheckId}] Error recording fill event:`, error);
            this.logPositionError(position.id, 'fill_recording_error', error.message);
        }
    }

    /**
     * Log position-specific action
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
     * Log position-specific error
     */
    private logPositionError(positionId: string, action: string, error: string): void {
        const audit: ActionAudit = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            positionId,
            action: 'error_occurred' as any,
            details: { action, error },
            timestamp: new Date().toISOString(),
            success: false,
            error
        };

        this.db.logAction(audit);
    }

    /**
     * Log critical system error
     */
    private logCriticalError(action: string, error: string): void {
        const monitoringState = this.db.getMonitoringState();
        const errors = [...monitoringState.errors, {
            positionId: 'system',
            error,
            timestamp: new Date().toISOString(),
            severity: 'error' as const
        }];

        // Keep only last 100 errors
        if (errors.length > 100) {
            errors.splice(0, errors.length - 100);
        }

        this.db.updateMonitoringState({ errors });
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current monitoring status
     */
    getStatus(): { isRunning: boolean; currentCheckId: string } {
        return {
            isRunning: this.isRunning,
            currentCheckId: this.currentCheckId
        };
    }
}

// Singleton instance
let fillDetectorInstance: OrderFillDetector | null = null;

export function getOrderFillDetector(): OrderFillDetector {
    if (!fillDetectorInstance) {
        fillDetectorInstance = new OrderFillDetector();
    }
    return fillDetectorInstance;
}

export { OrderFillDetector };
