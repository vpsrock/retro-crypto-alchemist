// Database operations for dynamic position management
import Database from 'better-sqlite3';
import type { 
    PositionState, 
    OrderFillEvent, 
    ActionAudit, 
    MonitoringState 
} from '@/lib/dynamic-position-schemas';

class DynamicPositionDB {
    private db: Database.Database;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.initializeTables();
    }

    private initializeTables(): void {
        // Position states table
        this.db.exec(`
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
                phase TEXT NOT NULL DEFAULT 'initial',
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
                settle TEXT NOT NULL,
                UNIQUE(contract, api_key)
            )
        `);

        // Order fill events table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS order_fill_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT NOT NULL,
                contract TEXT NOT NULL,
                fill_type TEXT NOT NULL,
                fill_size REAL NOT NULL,
                fill_price REAL NOT NULL,
                fill_time TEXT NOT NULL,
                position_id TEXT NOT NULL,
                processed BOOLEAN DEFAULT FALSE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (position_id) REFERENCES position_states (id)
            )
        `);

        // Action audit log table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS action_audit (
                id TEXT PRIMARY KEY,
                position_id TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT NOT NULL, -- JSON string
                timestamp TEXT NOT NULL,
                success BOOLEAN NOT NULL,
                error TEXT,
                FOREIGN KEY (position_id) REFERENCES position_states (id)
            )
        `);

        // Monitoring state table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS monitoring_state (
                id INTEGER PRIMARY KEY CHECK (id = 1), -- Single row table
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                last_check TEXT NOT NULL,
                active_positions TEXT NOT NULL, -- JSON array
                errors TEXT NOT NULL DEFAULT '[]', -- JSON array
                settings TEXT NOT NULL, -- JSON object
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert default monitoring state if not exists
        this.db.exec(`
            INSERT OR IGNORE INTO monitoring_state (id, is_active, last_check, active_positions, settings)
            VALUES (1, TRUE, datetime('now'), '[]', '{"checkInterval":30000,"maxRetries":3,"breakEvenBuffer":0.0005,"trailingDistance":0.01}')
        `);

        // Create indexes for performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_position_states_contract ON position_states (contract);
            CREATE INDEX IF NOT EXISTS idx_position_states_phase ON position_states (phase);
            CREATE INDEX IF NOT EXISTS idx_order_fill_events_order_id ON order_fill_events (order_id);
            CREATE INDEX IF NOT EXISTS idx_order_fill_events_processed ON order_fill_events (processed);
            CREATE INDEX IF NOT EXISTS idx_action_audit_position_id ON action_audit (position_id);
        `);
    }

    // ===== POSITION STATE OPERATIONS =====

    savePositionState(position: PositionState): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO position_states (
                id, contract, direction, size, entry_price, entry_order_id,
                strategy_type, tp1_size, tp2_size, runner_size,
                tp1_order_id, tp2_order_id, current_sl_order_id,
                phase, remaining_size, realized_pnl,
                original_sl_price, current_sl_price, tp1_price, tp2_price,
                created_at, last_updated, api_key, api_secret, settle
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            position.id,
            position.contract,
            position.direction,
            position.size,
            position.entryPrice,
            position.entryOrderId,
            position.strategyType,
            position.tp1Size,
            position.tp2Size,
            position.runnerSize,
            position.tp1OrderId,
            position.tp2OrderId,
            position.currentSlOrderId,
            position.phase,
            position.remainingSize,
            position.realizedPnl,
            position.originalSlPrice,
            position.currentSlPrice,
            position.tp1Price,
            position.tp2Price,
            position.createdAt,
            position.lastUpdated,
            position.apiKey,
            position.apiSecret,
            position.settle
        );
    }

    getPositionState(positionId: string): PositionState | null {
        const stmt = this.db.prepare(`
            SELECT * FROM position_states WHERE id = ?
        `);
        
        const row = stmt.get(positionId) as any;
        if (!row) return null;

        return {
            id: row.id,
            contract: row.contract,
            direction: row.direction as 'long' | 'short',
            size: row.size,
            entryPrice: row.entry_price,
            entryOrderId: row.entry_order_id,
            strategyType: row.strategy_type as 'single' | 'multi-tp',
            tp1Size: row.tp1_size,
            tp2Size: row.tp2_size,
            runnerSize: row.runner_size,
            tp1OrderId: row.tp1_order_id,
            tp2OrderId: row.tp2_order_id,
            currentSlOrderId: row.current_sl_order_id,
            phase: row.phase as any,
            remainingSize: row.remaining_size,
            realizedPnl: row.realized_pnl,
            originalSlPrice: row.original_sl_price,
            currentSlPrice: row.current_sl_price,
            tp1Price: row.tp1_price,
            tp2Price: row.tp2_price,
            createdAt: row.created_at,
            lastUpdated: row.last_updated,
            apiKey: row.api_key,
            apiSecret: row.api_secret,
            settle: row.settle as 'usdt' | 'btc'
        };
    }

    getAllActivePositions(): PositionState[] {
        const stmt = this.db.prepare(`
            SELECT * FROM position_states 
            WHERE phase NOT IN ('completed', 'stopped_out')
            ORDER BY created_at ASC
        `);
        
        const rows = stmt.all() as any[];
        return rows.map(row => this.getPositionState(row.id)!);
    }

    updatePositionPhase(positionId: string, newPhase: PositionState['phase'], remainingSize?: number): void {
        const updates: string[] = ['phase = ?', 'last_updated = ?'];
        const values: any[] = [newPhase, new Date().toISOString()];

        if (remainingSize !== undefined) {
            updates.push('remaining_size = ?');
            values.push(remainingSize);
        }

        const stmt = this.db.prepare(`
            UPDATE position_states 
            SET ${updates.join(', ')}
            WHERE id = ?
        `);

        values.push(positionId);
        stmt.run(...values);
    }

    updateSlOrder(positionId: string, newSlOrderId: string, newSlPrice: number): void {
        const stmt = this.db.prepare(`
            UPDATE position_states 
            SET current_sl_order_id = ?, current_sl_price = ?, last_updated = ?
            WHERE id = ?
        `);

        stmt.run(newSlOrderId, newSlPrice, new Date().toISOString(), positionId);
    }

    // ===== ORDER FILL EVENTS =====

    recordOrderFill(fillEvent: OrderFillEvent): void {
        const stmt = this.db.prepare(`
            INSERT INTO order_fill_events (
                order_id, contract, fill_type, fill_size, fill_price, 
                fill_time, position_id, processed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
        `);

        stmt.run(
            fillEvent.orderId,
            fillEvent.contract,
            fillEvent.fillType,
            fillEvent.fillSize,
            fillEvent.fillPrice,
            fillEvent.fillTime,
            fillEvent.positionId
        );
    }

    getUnprocessedFills(): OrderFillEvent[] {
        const stmt = this.db.prepare(`
            SELECT * FROM order_fill_events 
            WHERE processed = FALSE 
            ORDER BY fill_time ASC
        `);

        const rows = stmt.all() as any[];
        return rows.map(row => ({
            orderId: row.order_id,
            contract: row.contract,
            fillType: row.fill_type as any,
            fillSize: row.fill_size,
            fillPrice: row.fill_price,
            fillTime: row.fill_time,
            positionId: row.position_id
        }));
    }

    markFillProcessed(orderId: string): void {
        const stmt = this.db.prepare(`
            UPDATE order_fill_events 
            SET processed = TRUE 
            WHERE order_id = ?
        `);

        stmt.run(orderId);
    }

    // ===== ACTION AUDIT =====

    logAction(audit: ActionAudit): void {
        const stmt = this.db.prepare(`
            INSERT INTO action_audit (
                id, position_id, action, details, timestamp, success, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            audit.id,
            audit.positionId,
            audit.action,
            JSON.stringify(audit.details),
            audit.timestamp,
            audit.success,
            audit.error
        );
    }

    getPositionAuditLog(positionId: string): ActionAudit[] {
        const stmt = this.db.prepare(`
            SELECT * FROM action_audit 
            WHERE position_id = ?
            ORDER BY timestamp ASC
        `);

        const rows = stmt.all(positionId) as any[];
        return rows.map(row => ({
            id: row.id,
            positionId: row.position_id,
            action: row.action as any,
            details: JSON.parse(row.details),
            timestamp: row.timestamp,
            success: row.success,
            error: row.error
        }));
    }

    // ===== MONITORING STATE =====

    getMonitoringState(): MonitoringState {
        const stmt = this.db.prepare(`
            SELECT * FROM monitoring_state WHERE id = 1
        `);

        const row = stmt.get() as any;
        return {
            isActive: row.is_active,
            lastCheck: row.last_check,
            activePositions: JSON.parse(row.active_positions),
            errors: JSON.parse(row.errors),
            settings: JSON.parse(row.settings)
        };
    }

    updateMonitoringState(state: Partial<MonitoringState>): void {
        const updates: string[] = ['updated_at = datetime("now")'];
        const values: any[] = [];

        if (state.isActive !== undefined) {
            updates.push('is_active = ?');
            values.push(state.isActive);
        }

        if (state.lastCheck !== undefined) {
            updates.push('last_check = ?');
            values.push(state.lastCheck);
        }

        if (state.activePositions !== undefined) {
            updates.push('active_positions = ?');
            values.push(JSON.stringify(state.activePositions));
        }

        if (state.errors !== undefined) {
            updates.push('errors = ?');
            values.push(JSON.stringify(state.errors));
        }

        if (state.settings !== undefined) {
            updates.push('settings = ?');
            values.push(JSON.stringify(state.settings));
        }

        if (updates.length > 1) { // More than just updated_at
            const stmt = this.db.prepare(`
                UPDATE monitoring_state 
                SET ${updates.join(', ')}
                WHERE id = 1
            `);

            stmt.run(...values);
        }
    }

    // ===== UTILITY METHODS =====

    close(): void {
        this.db.close();
    }

    // Transaction wrapper for atomic operations
    transaction<T>(fn: () => T): T {
        return this.db.transaction(fn)();
    }
}

// Singleton instance
let dbInstance: DynamicPositionDB | null = null;

export function getDynamicPositionDB(): DynamicPositionDB {
    if (!dbInstance) {
        const dbPath = process.env.DYNAMIC_POSITION_DB_PATH || './dynamic-positions.db';
        dbInstance = new DynamicPositionDB(dbPath);
    }
    return dbInstance;
}

export { DynamicPositionDB };
