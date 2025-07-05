// Dynamic position monitoring service - real-time order fill detection and SL management
// This is the heart of the dynamic position management system

import { getAutoInitDB } from './auto-init-database';
import { listPriceTriggeredOrders, listPositions, cancelPriceTriggeredOrder, placePriceTriggeredOrder, getContract } from '@/services/gateio';
import { getTimeManager } from './time-based-position-manager';
import { getDynamicPositionLogger } from './dynamic-position-logger';
import type { PositionState, OrderFillEvent, ActionAudit } from '@/lib/dynamic-position-schemas';

interface MonitoringConfig {
    checkInterval: number; // milliseconds
    maxRetries: number;
    breakEvenBuffer: number; // percentage (0.0005 = 0.05%)
    trailingDistance: number; // percentage (0.01 = 1%)
    enabled: boolean;
}

export class DynamicPositionMonitor {
    private db: any; // Will be initialized from auto-init service
    private config: MonitoringConfig;
    private isRunning: boolean = false;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private lastOrderStates: Map<string, any> = new Map();
    private processingLock: Set<string> = new Set(); // Prevent concurrent processing
    private logger: any; // Dynamic position logger
    private lastSuccessfulCycleTimestamp: string | null = null;
    private lastError: { timestamp: string; message: string } | null = null;

    constructor() {
        // Initialize database through auto-init service
        this.db = getAutoInitDB();
        this.logger = getDynamicPositionLogger();
        
        // Load config from database or use defaults
        this.config = this.loadConfig();
    }

    private loadConfig(): MonitoringConfig {
        try {
            const saved = this.db?.prepare(`
                SELECT settings FROM monitoring_state WHERE id = 'main'
            `).get() as any;
            
            if (saved?.settings) {
                const settings = JSON.parse(saved.settings);
                return {
                    checkInterval: settings.checkInterval || 30000,
                    maxRetries: settings.maxRetries || 3,
                    breakEvenBuffer: settings.breakEvenBuffer || 0.0005,
                    trailingDistance: settings.trailingDistance || 0.01,
                    enabled: settings.enabled !== false
                };
            }
        } catch (error) {
            console.log('[MONITOR] Using default config, DB not ready yet');
        }

        return {
            checkInterval: 30000, // 30 seconds
            maxRetries: 3,
            breakEvenBuffer: 0.0005, // 0.05%
            trailingDistance: 0.01, // 1%
            enabled: true
        };
    }

    /**
     * Start the monitoring service
     */
    public startMonitoring(): void {
        try {
            console.log(`[MONITOR] 🔧 startMonitoring() called`);
            
            if (this.isRunning) {
                console.log('[MONITOR] Already running');
                return;
            }

            if (!this.config.enabled) {
                console.log('[MONITOR] Monitoring disabled in config');
                return;
            }

            console.log(`[MONITOR] 🚀 STARTING dynamic position monitoring (${this.config.checkInterval / 1000}s interval)`);
            
            this.isRunning = true;
            
            // Update monitoring state first with error handling
            console.log('[MONITOR] 🔧 Updating monitoring state...');
            try {
                this.updateMonitoringState(true);
                console.log('[MONITOR] ✅ Monitoring state updated successfully');
            } catch (stateError) {
                console.error('[MONITOR] ❌ Failed to update monitoring state:', stateError);
                // Continue anyway - don't let this stop monitoring
            }
            
            // Immediate check with error handling
            console.log('[MONITOR] 🔥 Triggering immediate monitoring cycle...');
            this.performMonitoringCycle().catch(error => {
                console.error('[MONITOR] ❌ Initial monitoring cycle failed:', error);
            });
            
            // Schedule regular monitoring
            console.log('[MONITOR] 📅 Scheduling monitoring cycles...');
            this.monitoringInterval = setInterval(() => {
                this.performMonitoringCycle().catch(error => {
                    console.error('[MONITOR] ❌ Scheduled monitoring cycle failed:', error);
                });
            }, this.config.checkInterval);

            console.log('[MONITOR] ✅ Dynamic position monitoring started successfully');
            
        } catch (error) {
            console.error('[MONITOR] 🚨 CRITICAL ERROR in startMonitoring():', error);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Stop the monitoring service
     */
    public stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.isRunning = false;
        this.updateMonitoringState(false);
        console.log('[MONITOR] Monitoring stopped');
    }

    /**
     * Main monitoring cycle
     */
    private async performMonitoringCycle(): Promise<void> {
        const startTime = Date.now();
        
        try {
            console.log('[MONITOR] 🔄 Starting monitoring cycle...');
            this.logger?.logInfo('[MONITOR] 🔄 Starting monitoring cycle...');
            
            // Get all active positions from database
            const activePositions = this.getActivePositions();
            console.log(`[MONITOR] 📊 Found ${activePositions.length} active positions in database`);
            this.logger?.logInfo(`[MONITOR] 📊 Found ${activePositions.length} active positions in database`);
            
            if (activePositions.length === 0) {
                console.log('[MONITOR] 💤 No active positions to monitor');
                this.logger?.logInfo('[MONITOR] 💤 No active positions to monitor');
                const duration = Date.now() - startTime;
                console.log(`[MONITOR] ✅ Cycle completed in ${duration}ms (no positions)`);
                this.logger?.logInfo(`[MONITOR] ✅ Cycle completed in ${duration}ms (no positions)`);
                this.lastSuccessfulCycleTimestamp = new Date().toISOString();
                return;
            }

            // First, reconcile positions with exchange to clean up stale data
            console.log('[MONITOR] 🔍 Starting position reconciliation...');
            this.logger?.logInfo('[MONITOR] 🔍 Starting position reconciliation...');
            await this.reconcilePositions(activePositions);

            // Get updated active positions after reconciliation
            const reconciledPositions = this.getActivePositions();
            console.log(`[MONITOR] 🧹 After reconciliation: ${reconciledPositions.length} truly active positions`);
            this.logger?.logInfo(`[MONITOR] 🧹 After reconciliation: ${reconciledPositions.length} truly active positions`);

            if (reconciledPositions.length === 0) {
                console.log('[MONITOR] 💤 No positions remain after reconciliation');
                this.logger?.logInfo('[MONITOR] 💤 No positions remain after reconciliation');
                const duration = Date.now() - startTime;
                console.log(`[MONITOR] ✅ Cycle completed in ${duration}ms (all reconciled)`);
                this.logger?.logInfo(`[MONITOR] ✅ Cycle completed in ${duration}ms (all reconciled)`);
                this.lastSuccessfulCycleTimestamp = new Date().toISOString();
                return;
            }

            // Group by API credentials to batch requests
            const positionGroups = this.groupPositionsByCredentials(reconciledPositions);
            console.log(`[MONITOR] 👥 Grouped into ${positionGroups.length} credential groups`);
            this.logger?.logInfo(`[MONITOR] 👥 Grouped into ${positionGroups.length} credential groups`);
            
            for (const group of positionGroups) {
                console.log(`[MONITOR] 🔧 Processing group with ${group.positions.length} positions...`);
                this.logger?.logInfo(`[MONITOR] 🔧 Processing group with ${group.positions.length} positions...`);
                await this.monitorPositionGroup(group);
            }

            const duration = Date.now() - startTime;
            console.log(`[MONITOR] ✅ Cycle completed successfully in ${duration}ms`);
            this.logger?.logInfo(`[MONITOR] ✅ Cycle completed successfully in ${duration}ms`);

            // Update health status on success
            this.lastSuccessfulCycleTimestamp = new Date().toISOString();
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[MONITOR] ❌ Error in monitoring cycle (${duration}ms):`, error);
            this.logger?.logError(`[MONITOR] ❌ Error in monitoring cycle (${duration}ms)`, { error: String(error) });
            
            // Update health status with error
            this.lastError = {
                timestamp: new Date().toISOString(),
                message: error instanceof Error ? error.message : String(error)
            };
            
            this.logExecution('system', 'monitoring_cycle_error', {
                error: error instanceof Error ? error.message : String(error),
                duration
            }, duration, false, String(error));
        }
    }

    /**
     * Reconcile database positions with actual exchange positions
     * Mark positions as completed if they no longer exist on exchange
     */
    private async reconcilePositions(dbPositions: PositionState[]): Promise<void> {
        try {
            // Group positions by credentials for efficient API calls
            const positionGroups = this.groupPositionsByCredentials(dbPositions);
            
            for (const group of positionGroups) {
                await this.reconcilePositionGroup(group);
            }
        } catch (error) {
            console.error('[MONITOR] Error during position reconciliation:', error);
            // Don't throw - allow monitoring to continue even if reconciliation fails
        }
    }

    /**
     * Reconcile a group of positions with same credentials
     */
    private async reconcilePositionGroup(group: { credentials: any, positions: PositionState[] }): Promise<void> {
        try {
            const { credentials, positions } = group;
            
            // Get actual POSITIONS from exchange (not orders)
            const exchangePositions = await listPositions(
                (positions[0] as any).settle,
                credentials.apiKey,
                credentials.apiSecret
            );

            // Create a set of contracts that have active positions on exchange
            const activeContracts = new Set(
                exchangePositions
                    .filter((pos: any) => pos.size && Math.abs(parseFloat(pos.size)) > 0)
                    .map((pos: any) => pos.contract)
            );

            console.log(`[MONITOR] 🔍 Exchange has active positions for: ${Array.from(activeContracts).join(', ')}`);

            // Check each position in our database and mark stale ones as completed
            let staleCleaned = 0;
            for (const position of positions) {
                const contract = (position as any).contract;
                const id = (position as any).id;
                if (!activeContracts.has(contract)) {
                    // Position no longer exists on exchange - mark as completed
                    this.markPositionCompleted(position, 'position_closed_on_exchange');
                    console.log(`[MONITOR] 🧹 Marked stale position ${contract} (${id}) as completed - position closed on exchange`);
                    this.logger?.logInfo(`[MONITOR] 🧹 Marked stale position ${contract} (${id}) as completed - position closed on exchange`);
                    staleCleaned++;
                }
            }
            
            if (staleCleaned > 0) {
                console.log(`[MONITOR] 🧹 Cleaned up ${staleCleaned} stale positions from database`);
                this.logger?.logInfo(`[MONITOR] 🧹 Cleaned up ${staleCleaned} stale positions from database`);
            }
        } catch (error) {
            console.error(`[MONITOR] Error reconciling position group:`, error);
            // Log but don't throw - allow other groups to be processed
        }
    }

    /**
     * Mark a position as completed in the database
     */
    private markPositionCompleted(position: PositionState, reason: string): void {
        try {
            const id = (position as any).id;
            const contract = (position as any).contract;
            const phase = (position as any).phase;
            
            this.db.prepare(`
                UPDATE position_states 
                SET phase = 'completed',
                    last_updated = ?
                WHERE id = ?
            `).run(new Date().toISOString(), id);

            // Log the cleanup action
            this.logExecution(id, 'position_auto_completed', {
                contract: contract,
                reason: reason,
                originalPhase: phase
            }, 0, true);

        } catch (error) {
            const id = (position as any).id;
            console.error(`[MONITOR] Failed to mark position ${id} as completed:`, error);
        }
    }

    /**
     * Monitor a group of positions with same API credentials
     */
    private async monitorPositionGroup(group: { credentials: any, positions: PositionState[] }): Promise<void> {
        const { credentials, positions } = group;
        try {
            const settle = (positions[0] as any)?.settle;
            console.log(`[MONITOR] Checking ${positions.length} positions for ${settle} settle`);

            // Get current order states from Gate.io
            const currentOrders = await listPriceTriggeredOrders(
                settle,
                'open',
                credentials.apiKey,
                credentials.apiSecret
            );

            // Process each position
            for (const position of positions) {
                const id = (position as any).id;
                const contract = (position as any).contract;
                
                if (this.processingLock.has(id)) {
                    console.log(`[MONITOR] Skipping ${contract} - already processing`);
                    continue;
                }

                await this.checkPositionForFills(position, currentOrders, credentials);
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const apiKeySnippet = credentials.apiKey ? `${credentials.apiKey.substring(0, 4)}...` : 'N/A';
            const settle = (positions[0] as any)?.settle;
            const errorContext = {
                apiKeySnippet,
                settle: settle,
                positionCount: positions.length,
                error: errorMessage,
            };

            // Log to file and DB
            this.logExecution(
                'system_group_error',
                'monitor_group_api_error',
                errorContext,
                0,
                false,
                `API call failed for group ${apiKeySnippet}`
            );
            
            console.error(`[MONITOR] CRITICAL: Error monitoring position group with key ${apiKeySnippet}. Skipping ${positions.length} positions. Error:`, error);

            // Update health status
            this.lastError = {
                timestamp: new Date().toISOString(),
                message: `API call failed for group ${apiKeySnippet}. Error: ${errorMessage}`
            };
        }
    }

    /**
     * Check individual position for order fills
     */
    private async checkPositionForFills(
        position: PositionState, 
        currentOrders: any[], 
        credentials: { apiKey: string, apiSecret: string }
    ): Promise<void> {
        const contract = (position as any).contract;
        const id = (position as any).id;
        const phase = (position as any).phase;
        
        const positionKey = `${contract}_${id}`;
        this.processingLock.add(id);

        try {
            console.log(`[MONITOR] Checking ${contract} (${phase})`);

            // Get orders related to this position
            const positionOrders = currentOrders.filter(order => 
                order.initial?.contract === contract
            );

            // Get previous state for comparison
            const previousState = this.lastOrderStates.get(positionKey);
            
            // Check for fills by comparing order states
            const fillEvents = this.detectOrderFills(position, positionOrders, previousState);
            
            // Process any detected fills
            for (const fillEvent of fillEvents) {
                await this.processFillEvent(position, fillEvent, credentials);
            }

            // Update stored state
            this.lastOrderStates.set(positionKey, {
                timestamp: new Date().toISOString(),
                orders: positionOrders.map(o => ({
                    id: o.id,
                    status: o.status,
                    contract: o.initial?.contract,
                    triggerPrice: o.trigger?.price
                }))
            });

        } catch (error) {
            console.error(`[MONITOR] Error checking ${contract}:`, error);
            this.logExecution(id, 'position_check_error', {
                contract: contract,
                error: error instanceof Error ? error.message : String(error)
            }, 0, false, String(error));
        } finally {
            this.processingLock.delete(id);
        }
    }

    /**
     * Detect order fills by comparing current vs previous states
     */
    private detectOrderFills(
        position: PositionState, 
        currentOrders: any[], 
        previousState: any
    ): OrderFillEvent[] {
        const fills: OrderFillEvent[] = [];

        if (!previousState) {
            // First time seeing this position - no fills to detect
            return fills;
        }

        const previousOrders = new Map(previousState.orders.map((o: any) => [o.id, o]));
        const currentOrderIds = new Set(currentOrders.map(o => o.id));

        // Check for orders that disappeared (likely filled)
        for (const [orderId, prevOrder] of previousOrders) {
            if (!currentOrderIds.has(orderId)) {
                // Order is gone - likely filled
                const fillType = this.determineFillType(String(orderId), position);
                if (fillType) {
                    const prevOrderTyped = prevOrder as any;
                    fills.push({
                        orderId: String(orderId),
                        contract: position.contract,
                        fillType,
                        fillSize: this.estimateFillSize(fillType, position),
                        fillPrice: parseFloat(prevOrderTyped.triggerPrice || '0'),
                        fillTime: new Date().toISOString(),
                        positionId: position.id
                    });
                }
            }
        }

        return fills;
    }

    /**
     * Determine what type of fill occurred based on order ID
     */
    private determineFillType(orderId: string, position: PositionState): 'tp1' | 'tp2' | 'sl' | null {
        // Access database columns using snake_case (as returned by SQLite)
        const tp1OrderId = (position as any).tp1_order_id;
        const tp2OrderId = (position as any).tp2_order_id;
        const currentSlOrderId = (position as any).current_sl_order_id;
        
        if (orderId === tp1OrderId) return 'tp1';
        if (orderId === tp2OrderId) return 'tp2';
        if (orderId === currentSlOrderId) return 'sl';
        return null;
    }

    /**
     * Estimate fill size based on fill type
     */
    private estimateFillSize(fillType: 'tp1' | 'tp2' | 'sl', position: PositionState): number {
        // Access database columns using snake_case (as returned by SQLite)
        const tp1Size = (position as any).tp1_size;
        const tp2Size = (position as any).tp2_size;
        const remainingSize = (position as any).remaining_size;
        
        switch (fillType) {
            case 'tp1': return tp1Size || 0;
            case 'tp2': return tp2Size || 0;
            case 'sl': return remainingSize;
            default: return 0;
        }
    }

    /**
     * Process a detected fill event
     */
    private async processFillEvent(
        position: PositionState,
        fillEvent: OrderFillEvent,
        credentials: { apiKey: string, apiSecret: string }
    ): Promise<void> {
        const startTime = Date.now();
        
        try {
            console.log(`[MONITOR] 🎯 ${fillEvent.fillType.toUpperCase()} FILL detected for ${position.contract}: ${fillEvent.fillSize} contracts at ${fillEvent.fillPrice}`);

            // Save fill event to database
            this.saveFillEvent(fillEvent);

            // Update position state based on fill type
            await this.updatePositionAfterFill(position, fillEvent, credentials);

            const duration = Date.now() - startTime;
            this.logExecution(position.id, 'fill_processed', {
                fillType: fillEvent.fillType,
                fillSize: fillEvent.fillSize,
                fillPrice: fillEvent.fillPrice,
                contract: position.contract
            }, duration, true);

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[MONITOR] Error processing fill for ${position.contract}:`, error);
            this.logExecution(position.id, 'fill_processing_error', {
                fillType: fillEvent.fillType,
                contract: position.contract,
                error: error instanceof Error ? error.message : String(error)
            }, duration, false, String(error));
        }
    }

    /**
     * Update position state after a fill
     */
    private async updatePositionAfterFill(
        position: PositionState,
        fillEvent: OrderFillEvent,
        credentials: { apiKey: string, apiSecret: string }
    ): Promise<void> {
        switch (fillEvent.fillType) {
            case 'tp1':
                await this.handleTp1Fill(position, fillEvent, credentials);
                break;
            case 'tp2':
                await this.handleTp2Fill(position, fillEvent, credentials);
                break;
            case 'sl':
                await this.handleSlFill(position, fillEvent);
                break;
        }
    }

    /**
     * Handle TP1 fill - move SL to break-even
     */
    private async handleTp1Fill(
        position: PositionState,
        fillEvent: OrderFillEvent,
        credentials: { apiKey: string, apiSecret: string }
    ): Promise<void> {
        const contract = (position as any).contract;
        console.log(`[MONITOR] 📈 TP1 filled for ${contract} - moving SL to break-even`);

        // Calculate break-even price with buffer
        const breakEvenPrice = this.calculateBreakEvenPrice(position);
        
        // Update SL to break-even
        await this.updateStopLoss(position, breakEvenPrice, 'break_even', credentials);
        
        // Update position state - use snake_case access
        const remainingSize = (position as any).remaining_size;
        const newRemainingSize = remainingSize - fillEvent.fillSize;
        const realizedPnl = this.calculateRealizedPnl(position, fillEvent);

        this.db.prepare(`
            UPDATE position_states 
            SET phase = 'tp1_filled',
                remaining_size = ?,
                realized_pnl = realized_pnl + ?,
                last_updated = ?
            WHERE id = ?
        `).run(newRemainingSize, realizedPnl, new Date().toISOString(), (position as any).id);

        console.log(`[MONITOR] ✅ TP1 processed: ${fillEvent.fillSize} contracts closed, ${newRemainingSize} remaining, SL moved to break-even`);
    }

    /**
     * Handle TP2 fill - implement trailing SL
     */
    private async handleTp2Fill(
        position: PositionState,
        fillEvent: OrderFillEvent,
        credentials: { apiKey: string, apiSecret: string }
    ): Promise<void> {
        const contract = (position as any).contract;
        console.log(`[MONITOR] 🚀 TP2 filled for ${contract} - implementing trailing SL`);

        // Update position state first - use snake_case access
        const remainingSize = (position as any).remaining_size;
        const newRemainingSize = remainingSize - fillEvent.fillSize;
        const realizedPnl = this.calculateRealizedPnl(position, fillEvent);

        this.db.prepare(`
            UPDATE position_states 
            SET phase = 'tp2_filled',
                remaining_size = ?,
                realized_pnl = realized_pnl + ?,
                last_updated = ?
            WHERE id = ?
        `).run(newRemainingSize, realizedPnl, new Date().toISOString(), (position as any).id);

        // TODO: Implement trailing SL logic here
        // For now, just log that TP2 was filled
        console.log(`[MONITOR] ✅ TP2 processed: ${fillEvent.fillSize} contracts closed, ${newRemainingSize} remaining, trailing SL ready`);
    }

    /**
     * Handle SL fill - position stopped out
     */
    private async handleSlFill(
        position: PositionState,
        fillEvent: OrderFillEvent
    ): Promise<void> {
        const contract = (position as any).contract;
        console.log(`[MONITOR] 🛑 SL filled for ${contract} - position stopped out`);

        const realizedPnl = this.calculateRealizedPnl(position, fillEvent);

        this.db.prepare(`
            UPDATE position_states 
            SET phase = 'stopped_out',
                remaining_size = 0,
                realized_pnl = realized_pnl + ?,
                last_updated = ?
            WHERE id = ?
        `).run(realizedPnl, new Date().toISOString(), (position as any).id);

        console.log(`[MONITOR] ✅ SL processed: Position fully closed with ${realizedPnl > 0 ? 'profit' : 'loss'}`);
    }

    /**
     * Calculate break-even price with buffer
     */
    private calculateBreakEvenPrice(position: PositionState): number {
        // Access database columns using snake_case (as returned by SQLite)
        const entryPrice = (position as any).entry_price;
        const direction = (position as any).direction;
        
        const buffer = entryPrice * this.config.breakEvenBuffer;
        return direction === 'long' 
            ? entryPrice + buffer
            : entryPrice - buffer;
    }

    /**
     * Calculate realized PnL for a fill
     */
    private calculateRealizedPnl(position: PositionState, fillEvent: OrderFillEvent): number {
        // Access database columns using snake_case (as returned by SQLite)
        const entryPrice = (position as any).entry_price;
        const direction = (position as any).direction;
        
        const priceDiff = fillEvent.fillPrice - entryPrice;
        const multiplier = direction === 'long' ? 1 : -1;
        return priceDiff * multiplier * fillEvent.fillSize;
    }

    /**
     * Update stop loss order
     */
    private async updateStopLoss(
        position: PositionState,
        newSlPrice: number,
        reason: 'break_even' | 'trailing' | 'manual',
        credentials: { apiKey: string, apiSecret: string }
    ): Promise<void> {
        try {
            // Access database columns using snake_case (as returned by SQLite)
            const settle = (position as any).settle;
            const contract = (position as any).contract;
            const direction = (position as any).direction;
            const currentSlOrderId = (position as any).current_sl_order_id;
            
            // Get contract specification for formatting
            const contractSpec = await getContract(settle, contract);
            const tickSize = contractSpec.tick_size || contractSpec.order_price_round;
            const decimalPlaces = tickSize.includes('.') ? tickSize.split('.')[1].length : 0;
            const formattedPrice = newSlPrice.toFixed(decimalPlaces);

            // Cancel old SL order
            try {
                await cancelPriceTriggeredOrder(
                    settle,
                    currentSlOrderId,
                    credentials.apiKey,
                    credentials.apiSecret
                );
                console.log(`[MONITOR] Cancelled old SL order ${currentSlOrderId}`);
            } catch (cancelError) {
                console.warn(`[MONITOR] Failed to cancel old SL order:`, cancelError);
            }

            // Place new SL order
            const newSlPayload = {
                initial: {
                    contract: contract,
                    price: "0",
                    tif: "ioc",
                    reduce_only: true,
                    auto_size: direction === 'long' ? "close_long" : "close_short",
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedPrice,
                    rule: direction === 'long' ? 2 : 1,
                    expiration: 86400
                },
                order_type: direction === 'long' ? "plan-close-long-position" : "plan-close-short-position"
            };

            const newSlResult = await placePriceTriggeredOrder(
                settle,
                newSlPayload,
                credentials.apiKey,
                credentials.apiSecret
            );

            // Update position state with new SL order ID
            this.db.prepare(`
                UPDATE position_states 
                SET current_sl_order_id = ?,
                    current_sl_price = ?,
                    last_updated = ?
                WHERE id = ?
            `).run(newSlResult.id, newSlPrice, new Date().toISOString(), (position as any).id);

            console.log(`[MONITOR] ✅ Updated SL to ${formattedPrice} (${reason}), new order ID: ${newSlResult.id}`);

        } catch (error) {
            console.error(`[MONITOR] Failed to update SL for ${(position as any).contract}:`, error);
            throw error;
        }
    }

    // ... Additional utility methods ...

    private getActivePositions(): PositionState[] {
        return this.db.prepare(`
            SELECT * FROM position_states 
            WHERE phase IN ('initial', 'tp1_filled', 'tp2_filled')
            ORDER BY created_at ASC
        `).all() as PositionState[];
    }

    private groupPositionsByCredentials(positions: PositionState[]): { credentials: any, positions: PositionState[] }[] {
        const groups = new Map<string, PositionState[]>();
        for (const position of positions) {
            // Access database columns using snake_case (as returned by SQLite)
            const apiKey = (position as any).api_key;
            const apiSecret = (position as any).api_secret;
            
            // Defensive: skip positions with missing/empty credentials
            if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim() ||
                !apiSecret || typeof apiSecret !== 'string' || !apiSecret.trim()) {
                // Log warning once per position
                console.warn(`[MONITOR] Skipping position ${position.id} (${position.contract}) due to missing API credentials.`);
                continue;
            }
            const key = `${position.settle}_${apiKey}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(position);
        }
        return Array.from(groups.entries()).map(([key, positions]) => ({
            credentials: {
                apiKey: (positions[0] as any).api_key,
                apiSecret: (positions[0] as any).api_secret
            },
            positions
        }));
    }

    private saveFillEvent(fillEvent: OrderFillEvent): void {
        // Use enhanced logger that logs to both database and file
        this.logger.logOrderFill(
            fillEvent.orderId,
            fillEvent.contract,
            fillEvent.fillType,
            fillEvent.fillSize,
            fillEvent.fillPrice,
            fillEvent.positionId
        );
    }

    private logExecution(
        positionId: string,
        executionType: string,
        details: any,
        processingTime: number,
        success: boolean,
        error?: string
    ): void {
        // Use enhanced logger that logs to both database and file
        this.logger.logMonitoringExecution(
            positionId,
            executionType,
            details,
            processingTime,
            success,
            error
        );
    }

    private updateMonitoringState(isActive: boolean): void {
        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO monitoring_state 
                (id, is_active, last_check, settings)
                VALUES ('main', ?, ?, ?)
            `).run(
                isActive ? 1 : 0,
                new Date().toISOString(),
                JSON.stringify(this.config)
            );
        } catch (error) {
            console.error('[MONITOR] Failed to update monitoring state in database:', error);
            // Don't throw - allow monitoring to continue even if state update fails
        }
    }

    /**
     * Get monitoring status
     */
    public getStatus(): any {
        return {
            isRunning: this.isRunning,
            config: this.config,
            activePositions: this.getActivePositions().length,
            processingLock: Array.from(this.processingLock),
            lastStates: this.lastOrderStates.size
        };
    }

    /**
     * Get detailed health status
     */
    public getHealthStatus(): any {
        return {
            isRunning: this.isRunning,
            lastSuccessfulCycleTimestamp: this.lastSuccessfulCycleTimestamp,
            lastError: this.lastError,
            activePositions: this.getActivePositions().length,
            config: this.config,
        };
    }
}

// Singleton instance
let monitor: DynamicPositionMonitor | null = null;

export function getDynamicPositionMonitor(): DynamicPositionMonitor {
    if (!monitor) {
        monitor = new DynamicPositionMonitor();
    }
    return monitor;
}

export function initializeDynamicPositionMonitoring(): void {
    const monitor = getDynamicPositionMonitor();
    monitor.startMonitoring();
    console.log('[MONITOR] Dynamic position monitoring initialized');
}
