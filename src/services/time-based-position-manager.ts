// Time-based position management service
// Handles automatic position cleanup and time limits

import Database from 'better-sqlite3';
import path from 'path';
import { cancelPriceTriggeredOrder, listPositions, listPriceTriggeredOrders } from '@/services/gateio';
import type { PositionState, ActionAudit } from '@/lib/dynamic-position-schemas';

interface TimeBasedConfig {
    maxPositionAgeHours: number;
    cleanupIntervalMinutes: number;
    forceCloseBeforeExpiry: boolean;
    warningBeforeExpiryMinutes: number;
}

export class TimeBasedPositionManager {
    private db: Database.Database;
    private config: TimeBasedConfig;
    private isRunning: boolean = false;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(config: TimeBasedConfig = {
        maxPositionAgeHours: 4,
        cleanupIntervalMinutes: 15,
        forceCloseBeforeExpiry: true,
        warningBeforeExpiryMinutes: 30
    }) {
        const dbPath = path.join(process.cwd(), 'trades.db');
        this.db = new Database(dbPath);
        this.config = config;
        this.initializeDatabase();
    }

    private initializeDatabase() {
        // Ensure tables exist
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS position_time_tracking (
                position_id TEXT PRIMARY KEY,
                contract TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                warning_sent INTEGER DEFAULT 0,
                force_close_attempted INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active' CHECK (status IN ('active', 'warned', 'expired', 'force_closed')),
                FOREIGN KEY (position_id) REFERENCES position_states(id)
            );

            CREATE TABLE IF NOT EXISTS time_cleanup_log (
                id TEXT PRIMARY KEY,
                position_id TEXT NOT NULL,
                action TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                success INTEGER NOT NULL,
                details TEXT, -- JSON
                error TEXT
            );
        `);
    }

    /**
     * Register a new position for time-based tracking
     */
    public registerPosition(positionId: string, contract: string): void {
        const now = new Date();
        const expiryTime = new Date(now.getTime() + (this.config.maxPositionAgeHours * 60 * 60 * 1000));
        
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO position_time_tracking 
            (position_id, contract, created_at, expires_at, status)
            VALUES (?, ?, ?, ?, 'active')
        `);
        
        stmt.run(positionId, contract, now.toISOString(), expiryTime.toISOString());
        
        console.log(`[TIME-MANAGER] Registered position ${positionId} (${contract}) with ${this.config.maxPositionAgeHours}h expiry`);
        
        this.logAction(positionId, 'position_registered', true, {
            contract,
            expiryTime: expiryTime.toISOString(),
            maxAgeHours: this.config.maxPositionAgeHours
        });
    }

    /**
     * Start the time-based cleanup service
     */
    public startCleanupService(): void {
        if (this.isRunning) {
            console.log('[TIME-MANAGER] Cleanup service already running');
            return;
        }

        this.isRunning = true;
        console.log(`[TIME-MANAGER] Starting cleanup service (interval: ${this.config.cleanupIntervalMinutes} minutes)`);
        
        // Run immediate check
        this.performCleanupCheck();
        
        // Schedule regular checks
        this.cleanupInterval = setInterval(() => {
            this.performCleanupCheck();
        }, this.config.cleanupIntervalMinutes * 60 * 1000);
    }

    /**
     * Stop the cleanup service
     */
    public stopCleanupService(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.isRunning = false;
        console.log('[TIME-MANAGER] Cleanup service stopped');
    }

    /**
     * Perform cleanup check for all tracked positions
     */
    private async performCleanupCheck(): Promise<void> {
        try {
            console.log('[TIME-MANAGER] Starting cleanup check...');
            
            const activePositions = this.db.prepare(`
                SELECT * FROM position_time_tracking 
                WHERE status IN ('active', 'warned')
                ORDER BY expires_at ASC
            `).all() as any[];

            console.log(`[TIME-MANAGER] Found ${activePositions.length} active positions to check`);

            for (const position of activePositions) {
                await this.checkPositionExpiry(position);
            }

            console.log('[TIME-MANAGER] Cleanup check completed');
            
        } catch (error) {
            console.error('[TIME-MANAGER] Error during cleanup check:', error);
        }
    }

    /**
     * Check individual position for expiry
     */
    private async checkPositionExpiry(position: any): Promise<void> {
        const now = new Date();
        const expiryTime = new Date(position.expires_at);
        const warningTime = new Date(expiryTime.getTime() - (this.config.warningBeforeExpiryMinutes * 60 * 1000));
        
        const timeToExpiry = expiryTime.getTime() - now.getTime();
        const minutesToExpiry = Math.floor(timeToExpiry / (1000 * 60));

        console.log(`[TIME-MANAGER] Checking ${position.contract} - ${minutesToExpiry} minutes to expiry`);

        // Position has expired
        if (now >= expiryTime) {
            await this.handleExpiredPosition(position);
        }
        // Warning time reached
        else if (now >= warningTime && position.warning_sent === 0) {
            await this.sendExpiryWarning(position, minutesToExpiry);
        }
        // Very close to expiry - force close
        else if (this.config.forceCloseBeforeExpiry && minutesToExpiry <= 5 && position.force_close_attempted === 0) {
            await this.forceClosePosition(position);
        }
    }

    /**
     * Send expiry warning
     */
    private async sendExpiryWarning(position: any, minutesToExpiry: number): Promise<void> {
        console.log(`[TIME-MANAGER] ⚠️  WARNING: Position ${position.contract} expires in ${minutesToExpiry} minutes`);
        
        // Update warning status
        this.db.prepare(`
            UPDATE position_time_tracking 
            SET warning_sent = 1, status = 'warned'
            WHERE position_id = ?
        `).run(position.position_id);

        this.logAction(position.position_id, 'expiry_warning_sent', true, {
            contract: position.contract,
            minutesToExpiry,
            expiryTime: position.expires_at
        });
    }

    /**
     * Force close position before expiry
     */
    private async forceClosePosition(position: any): Promise<void> {
        try {
            console.log(`[TIME-MANAGER] 🚨 FORCE CLOSING position ${position.contract} before expiry`);

            // Get position details from position_states
            const positionState = this.db.prepare(`
                SELECT * FROM position_states WHERE id = ?
            `).get(position.position_id) as any;

            if (!positionState) {
                throw new Error(`Position state not found for ${position.position_id}`);
            }

            // Cancel all conditional orders for this position
            const ordersToCancel = [
                positionState.tp1_order_id,
                positionState.tp2_order_id,
                positionState.current_sl_order_id
            ].filter(Boolean);

            let cancelledOrders = 0;
            for (const orderId of ordersToCancel) {
                try {
                    await cancelPriceTriggeredOrder(
                        positionState.settle,
                        orderId,
                        positionState.api_key,
                        positionState.api_secret
                    );
                    cancelledOrders++;
                    console.log(`[TIME-MANAGER] Cancelled order ${orderId}`);
                } catch (cancelError) {
                    console.error(`[TIME-MANAGER] Failed to cancel order ${orderId}:`, cancelError);
                }
            }

            // Update tracking status
            this.db.prepare(`
                UPDATE position_time_tracking 
                SET force_close_attempted = 1, status = 'force_closed'
                WHERE position_id = ?
            `).run(position.position_id);

            // Update position state
            this.db.prepare(`
                UPDATE position_states 
                SET phase = 'completed', last_updated = ?
                WHERE id = ?
            `).run(new Date().toISOString(), position.position_id);

            this.logAction(position.position_id, 'force_close_executed', true, {
                contract: position.contract,
                cancelledOrders,
                totalOrders: ordersToCancel.length,
                reason: 'time_expiry_approaching'
            });

            console.log(`[TIME-MANAGER] ✅ Successfully force closed ${position.contract} (cancelled ${cancelledOrders}/${ordersToCancel.length} orders)`);

        } catch (error) {
            console.error(`[TIME-MANAGER] ❌ Failed to force close ${position.contract}:`, error);
            
            this.logAction(position.position_id, 'force_close_failed', false, {
                contract: position.contract,
                error: error instanceof Error ? error.message : String(error)
            }, error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Handle expired position
     */
    private async handleExpiredPosition(position: any): Promise<void> {
        console.log(`[TIME-MANAGER] 🕐 Position ${position.contract} has EXPIRED - cleaning up`);
        
        // Mark as expired
        this.db.prepare(`
            UPDATE position_time_tracking 
            SET status = 'expired'
            WHERE position_id = ?
        `).run(position.position_id);

        // If not already force closed, attempt cleanup
        if (position.force_close_attempted === 0) {
            await this.forceClosePosition(position);
        }

        this.logAction(position.position_id, 'position_expired', true, {
            contract: position.contract,
            actualExpiryTime: new Date().toISOString(),
            scheduledExpiryTime: position.expires_at
        });
    }

    /**
     * Get time tracking status for all positions
     */
    public getTimeTrackingStatus(): any[] {
        return this.db.prepare(`
            SELECT 
                ptt.*,
                ps.contract,
                ps.direction,
                ps.size,
                ps.phase,
                CAST((julianday(ptt.expires_at) - julianday('now')) * 24 * 60 AS INTEGER) as minutes_to_expiry
            FROM position_time_tracking ptt
            LEFT JOIN position_states ps ON ptt.position_id = ps.id
            WHERE ptt.status IN ('active', 'warned')
            ORDER BY ptt.expires_at ASC
        `).all();
    }

    /**
     * Manually extend position expiry
     */
    public extendPositionExpiry(positionId: string, additionalHours: number): boolean {
        try {
            const position = this.db.prepare(`
                SELECT * FROM position_time_tracking WHERE position_id = ?
            `).get(positionId) as any;

            if (!position) {
                throw new Error(`Position ${positionId} not found in time tracking`);
            }

            const currentExpiry = new Date(position.expires_at);
            const newExpiry = new Date(currentExpiry.getTime() + (additionalHours * 60 * 60 * 1000));

            this.db.prepare(`
                UPDATE position_time_tracking 
                SET expires_at = ?, warning_sent = 0, status = 'active'
                WHERE position_id = ?
            `).run(newExpiry.toISOString(), positionId);

            this.logAction(positionId, 'expiry_extended', true, {
                previousExpiry: position.expires_at,
                newExpiry: newExpiry.toISOString(),
                additionalHours
            });

            console.log(`[TIME-MANAGER] Extended ${position.contract} expiry by ${additionalHours} hours`);
            return true;

        } catch (error) {
            console.error(`[TIME-MANAGER] Failed to extend position expiry:`, error);
            return false;
        }
    }

    /**
     * Log action to audit trail
     */
    private logAction(positionId: string, action: string, success: boolean, details: any, error?: string): void {
        const id = `time_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.db.prepare(`
            INSERT INTO time_cleanup_log 
            (id, position_id, action, timestamp, success, details, error)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            positionId,
            action,
            new Date().toISOString(),
            success ? 1 : 0,
            JSON.stringify(details),
            error || null
        );
    }

    /**
     * Get cleanup logs for analysis
     */
    public getCleanupLogs(positionId?: string): any[] {
        const query = positionId 
            ? `SELECT * FROM time_cleanup_log WHERE position_id = ? ORDER BY timestamp DESC LIMIT 50`
            : `SELECT * FROM time_cleanup_log ORDER BY timestamp DESC LIMIT 100`;
        
        const stmt = positionId 
            ? this.db.prepare(query)
            : this.db.prepare(query);
        
        return positionId ? stmt.all(positionId) : stmt.all();
    }

    /**
     * Cleanup completed/expired positions from tracking
     */
    public cleanupCompletedPositions(): number {
        const result = this.db.prepare(`
            DELETE FROM position_time_tracking 
            WHERE status IN ('expired', 'force_closed')
            AND datetime(expires_at) < datetime('now', '-24 hours')
        `).run();

        console.log(`[TIME-MANAGER] Cleaned up ${result.changes} old position tracking records`);
        return result.changes;
    }
}

// Singleton instance
let timeManager: TimeBasedPositionManager | null = null;

export function getTimeManager(): TimeBasedPositionManager {
    if (!timeManager) {
        timeManager = new TimeBasedPositionManager();
    }
    return timeManager;
}

export function initializeTimeBasedManagement(config?: Partial<TimeBasedConfig>): void {
    const manager = getTimeManager();
    manager.startCleanupService();
    console.log('[TIME-MANAGER] Time-based position management initialized');
}
