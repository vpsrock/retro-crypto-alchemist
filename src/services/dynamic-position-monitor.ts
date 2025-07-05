// Dynamic position monitoring service - real-time order fill detection and SL management
// This is the heart of the dynamic position management system

import Database from 'better-sqlite3';
import path from 'path';
import { listPriceTriggeredOrders, listPositions, cancelPriceTriggeredOrder, placePriceTriggeredOrder, getContract } from '@/services/gateio';
import { getTimeManager } from './time-based-position-manager';
import type { PositionState, OrderFillEvent, ActionAudit } from '@/lib/dynamic-position-schemas';

interface MonitoringConfig {
    checkInterval: number; // milliseconds
    maxRetries: number;
    breakEvenBuffer: number; // percentage (0.0005 = 0.05%)
    trailingDistance: number; // percentage (0.01 = 1%)
    enabled: boolean;
}

export class DynamicPositionMonitor {
    private db: Database.Database;
    private config: MonitoringConfig;
    private isRunning: boolean = false;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private lastOrderStates: Map<string, any> = new Map();
    private processingLock: Set<string> = new Set(); // Prevent concurrent processing

    constructor() {
        const dbPath = path.join(process.cwd(), 'trades.db');
        this.db = new Database(dbPath);
        
        // Load config from database or use defaults
        this.config = this.loadConfig();
        this.initializeDatabase();
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

    private initializeDatabase(): void {
        // Ensure all required tables exist
        this.db.exec(`
            -- Already created in other services, but ensure they exist
            CREATE TABLE IF NOT EXISTS position_states (
                id TEXT PRIMARY KEY,
                contract TEXT NOT NULL,
                direction TEXT NOT NULL,
                size REAL NOT NULL,
                entry_price REAL NOT NULL,
                entry_order_id TEXT NOT NULL,
                strategy_type TEXT NOT NULL,
                tp1_size REAL,
                tp2_size REAL,
                runner_size REAL,
                tp1_order_id TEXT,
                tp2_order_id TEXT,
                current_sl_order_id TEXT NOT NULL,
                phase TEXT NOT NULL,
                remaining_size REAL NOT NULL,
                realized_pnl REAL DEFAULT 0,
                original_sl_price REAL NOT NULL,
                current_sl_price REAL NOT NULL,
                tp1_price REAL,
                tp2_price REAL,
                created_at TEXT NOT NULL,
                last_updated TEXT NOT NULL,
                api_key TEXT NOT NULL,
                api_secret TEXT NOT NULL,
                settle TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS monitoring_execution_log (
                id TEXT PRIMARY KEY,
                position_id TEXT NOT NULL,
                execution_type TEXT NOT NULL, -- 'fill_detected', 'sl_updated', 'error'
                details TEXT NOT NULL, -- JSON
                timestamp TEXT NOT NULL,
                processing_time_ms INTEGER,
                success INTEGER NOT NULL,
                error_message TEXT
            );
        `);
    }

    /**
     * Start the monitoring service
     */
    public startMonitoring(): void {
        if (this.isRunning) {
            console.log('[MONITOR] Already running');
            return;
        }

        if (!this.config.enabled) {
            console.log('[MONITOR] Monitoring disabled in config');
            return;
        }

        this.isRunning = true;
        console.log(`[MONITOR] Starting dynamic position monitoring (${this.config.checkInterval / 1000}s interval)`);
        
        // Immediate check
        this.performMonitoringCycle();
        
        // Schedule regular monitoring
        this.monitoringInterval = setInterval(() => {
            this.performMonitoringCycle();
        }, this.config.checkInterval);

        // Update monitoring state
        this.updateMonitoringState(true);
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
            console.log('[MONITOR] Starting monitoring cycle...');
            
            // Get all active positions
            const activePositions = this.getActivePositions();
            console.log(`[MONITOR] Found ${activePositions.length} active positions`);

            // Group by API credentials to batch requests
            const positionGroups = this.groupPositionsByCredentials(activePositions);
            
            for (const group of positionGroups) {
                await this.monitorPositionGroup(group);
            }

            const duration = Date.now() - startTime;
            console.log(`[MONITOR] Cycle completed in ${duration}ms`);
            
        } catch (error) {
            console.error('[MONITOR] Error in monitoring cycle:', error);
            this.logExecution('system', 'monitoring_cycle_error', {
                error: error instanceof Error ? error.message : String(error)
            }, Date.now() - startTime, false, String(error));
        }
    }

    /**
     * Monitor a group of positions with same API credentials
     */
    private async monitorPositionGroup(group: { credentials: any, positions: PositionState[] }): Promise<void> {
        try {
            const { credentials, positions } = group;
            console.log(`[MONITOR] Checking ${positions.length} positions for ${positions[0]?.settle} settle`);

            // Get current order states from Gate.io
            const currentOrders = await listPriceTriggeredOrders(
                positions[0].settle,
                'open',
                credentials.apiKey,
                credentials.apiSecret
            );

            // Process each position
            for (const position of positions) {
                if (this.processingLock.has(position.id)) {
                    console.log(`[MONITOR] Skipping ${position.contract} - already processing`);
                    continue;
                }

                await this.checkPositionForFills(position, currentOrders, credentials);
            }

        } catch (error) {
            console.error('[MONITOR] Error monitoring position group:', error);
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
        const positionKey = `${position.contract}_${position.id}`;
        this.processingLock.add(position.id);

        try {
            console.log(`[MONITOR] Checking ${position.contract} (${position.phase})`);

            // Get orders related to this position
            const positionOrders = currentOrders.filter(order => 
                order.initial?.contract === position.contract
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
            console.error(`[MONITOR] Error checking ${position.contract}:`, error);
            this.logExecution(position.id, 'position_check_error', {
                contract: position.contract,
                error: error instanceof Error ? error.message : String(error)
            }, 0, false, String(error));
        } finally {
            this.processingLock.delete(position.id);
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
        if (orderId === position.tp1OrderId) return 'tp1';
        if (orderId === position.tp2OrderId) return 'tp2';
        if (orderId === position.currentSlOrderId) return 'sl';
        return null;
    }

    /**
     * Estimate fill size based on fill type
     */
    private estimateFillSize(fillType: 'tp1' | 'tp2' | 'sl', position: PositionState): number {
        switch (fillType) {
            case 'tp1': return position.tp1Size || 0;
            case 'tp2': return position.tp2Size || 0;
            case 'sl': return position.remainingSize;
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
        console.log(`[MONITOR] 📈 TP1 filled for ${position.contract} - moving SL to break-even`);

        // Calculate break-even price with buffer
        const breakEvenPrice = this.calculateBreakEvenPrice(position);
        
        // Update SL to break-even
        await this.updateStopLoss(position, breakEvenPrice, 'break_even', credentials);
        
        // Update position state
        const newRemainingSize = position.remainingSize - fillEvent.fillSize;
        const realizedPnl = this.calculateRealizedPnl(position, fillEvent);

        this.db.prepare(`
            UPDATE position_states 
            SET phase = 'tp1_filled',
                remaining_size = ?,
                realized_pnl = realized_pnl + ?,
                last_updated = ?
            WHERE id = ?
        `).run(newRemainingSize, realizedPnl, new Date().toISOString(), position.id);

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
        console.log(`[MONITOR] 🚀 TP2 filled for ${position.contract} - implementing trailing SL`);

        // Update position state first
        const newRemainingSize = position.remainingSize - fillEvent.fillSize;
        const realizedPnl = this.calculateRealizedPnl(position, fillEvent);

        this.db.prepare(`
            UPDATE position_states 
            SET phase = 'tp2_filled',
                remaining_size = ?,
                realized_pnl = realized_pnl + ?,
                last_updated = ?
            WHERE id = ?
        `).run(newRemainingSize, realizedPnl, new Date().toISOString(), position.id);

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
        console.log(`[MONITOR] 🛑 SL filled for ${position.contract} - position stopped out`);

        const realizedPnl = this.calculateRealizedPnl(position, fillEvent);

        this.db.prepare(`
            UPDATE position_states 
            SET phase = 'stopped_out',
                remaining_size = 0,
                realized_pnl = realized_pnl + ?,
                last_updated = ?
            WHERE id = ?
        `).run(realizedPnl, new Date().toISOString(), position.id);

        console.log(`[MONITOR] ✅ SL processed: Position fully closed with ${realizedPnl > 0 ? 'profit' : 'loss'}`);
    }

    /**
     * Calculate break-even price with buffer
     */
    private calculateBreakEvenPrice(position: PositionState): number {
        const buffer = position.entryPrice * this.config.breakEvenBuffer;
        return position.direction === 'long' 
            ? position.entryPrice + buffer
            : position.entryPrice - buffer;
    }

    /**
     * Calculate realized PnL for a fill
     */
    private calculateRealizedPnl(position: PositionState, fillEvent: OrderFillEvent): number {
        const priceDiff = fillEvent.fillPrice - position.entryPrice;
        const multiplier = position.direction === 'long' ? 1 : -1;
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
            // Get contract specification for formatting
            const contractSpec = await getContract(position.settle, position.contract);
            const tickSize = contractSpec.tick_size || contractSpec.order_price_round;
            const decimalPlaces = tickSize.includes('.') ? tickSize.split('.')[1].length : 0;
            const formattedPrice = newSlPrice.toFixed(decimalPlaces);

            // Cancel old SL order
            try {
                await cancelPriceTriggeredOrder(
                    position.settle,
                    position.currentSlOrderId,
                    credentials.apiKey,
                    credentials.apiSecret
                );
                console.log(`[MONITOR] Cancelled old SL order ${position.currentSlOrderId}`);
            } catch (cancelError) {
                console.warn(`[MONITOR] Failed to cancel old SL order:`, cancelError);
            }

            // Place new SL order
            const newSlPayload = {
                initial: {
                    contract: position.contract,
                    price: "0",
                    tif: "ioc",
                    reduce_only: true,
                    auto_size: position.direction === 'long' ? "close_long" : "close_short",
                },
                trigger: {
                    strategy_type: 0,
                    price_type: 0,
                    price: formattedPrice,
                    rule: position.direction === 'long' ? 2 : 1,
                    expiration: 86400
                },
                order_type: position.direction === 'long' ? "plan-close-long-position" : "plan-close-short-position"
            };

            const newSlResult = await placePriceTriggeredOrder(
                position.settle,
                newSlPayload,
                credentials.apiKey,
                credentials.apiSecret
            );

            // Update position state with new SL
            this.db.prepare(`
                UPDATE position_states 
                SET current_sl_order_id = ?,
                    current_sl_price = ?,
                    last_updated = ?
                WHERE id = ?
            `).run(newSlResult.id, newSlPrice, new Date().toISOString(), position.id);

            console.log(`[MONITOR] ✅ Updated SL for ${position.contract}: ${position.currentSlPrice} → ${newSlPrice} (${reason})`);

        } catch (error) {
            console.error(`[MONITOR] Failed to update SL for ${position.contract}:`, error);
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
            const key = `${position.settle}_${position.apiKey}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(position);
        }

        return Array.from(groups.entries()).map(([key, positions]) => ({
            credentials: {
                apiKey: positions[0].apiKey,
                apiSecret: positions[0].apiSecret
            },
            positions
        }));
    }

    private saveFillEvent(fillEvent: OrderFillEvent): void {
        this.db.prepare(`
            INSERT INTO order_fill_events 
            (id, order_id, contract, fill_type, fill_size, fill_price, fill_time, position_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            `fill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            fillEvent.orderId,
            fillEvent.contract,
            fillEvent.fillType,
            fillEvent.fillSize,
            fillEvent.fillPrice,
            fillEvent.fillTime,
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
        const id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.db.prepare(`
            INSERT INTO monitoring_execution_log 
            (id, position_id, execution_type, details, timestamp, processing_time_ms, success, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            positionId,
            executionType,
            JSON.stringify(details),
            new Date().toISOString(),
            processingTime,
            success ? 1 : 0,
            error || null
        );
    }

    private updateMonitoringState(isActive: boolean): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO monitoring_state 
            (id, is_active, last_check, settings)
            VALUES ('main', ?, ?, ?)
        `).run(
            isActive ? 1 : 0,
            new Date().toISOString(),
            JSON.stringify(this.config)
        );
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
