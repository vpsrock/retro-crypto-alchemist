// Auto-initializing database service for dynamic position management
import Database from 'better-sqlite3';
import path from 'path';

export class AutoInitializingDatabase {
    private static instance: Database.Database | null = null;
    private static initialized: boolean = false;

    public static getInstance(): Database.Database {
        if (!AutoInitializingDatabase.instance) {
            const dbPath = path.join(process.cwd(), 'trades.db');
            AutoInitializingDatabase.instance = new Database(dbPath);
            
            if (!AutoInitializingDatabase.initialized) {
                AutoInitializingDatabase.initializeTables();
                AutoInitializingDatabase.initialized = true;
            }
        }
        return AutoInitializingDatabase.instance;
    }

    private static initializeTables(): void {
        const db = AutoInitializingDatabase.instance!;
        
        console.log('[AUTO-DB] Initializing dynamic position management tables...');
        
        try {
            // Create all required tables
            db.exec(`
                -- Position state tracking
                CREATE TABLE IF NOT EXISTS position_states (
                    id TEXT PRIMARY KEY,
                    contract TEXT NOT NULL,
                    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
                    size REAL NOT NULL,
                    entry_price REAL NOT NULL,
                    entry_order_id TEXT NOT NULL,
                    strategy_type TEXT NOT NULL CHECK (strategy_type IN ('single', 'multi-tp')),
                    tp1_size REAL,
                    tp2_size REAL,
                    runner_size REAL,
                    tp1_order_id TEXT,
                    tp2_order_id TEXT,
                    current_sl_order_id TEXT NOT NULL,
                    phase TEXT NOT NULL CHECK (phase IN ('initial', 'tp1_filled', 'tp2_filled', 'completed', 'stopped_out')),
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
                    settle TEXT NOT NULL CHECK (settle IN ('usdt', 'btc'))
                );

                -- Order fill event tracking
                CREATE TABLE IF NOT EXISTS order_fill_events (
                    id TEXT PRIMARY KEY,
                    order_id TEXT NOT NULL,
                    contract TEXT NOT NULL,
                    fill_type TEXT NOT NULL CHECK (fill_type IN ('tp1', 'tp2', 'sl', 'manual')),
                    fill_size REAL NOT NULL,
                    fill_price REAL NOT NULL,
                    fill_time TEXT NOT NULL,
                    position_id TEXT NOT NULL,
                    FOREIGN KEY (position_id) REFERENCES position_states(id)
                );

                -- SL update history
                CREATE TABLE IF NOT EXISTS sl_update_history (
                    id TEXT PRIMARY KEY,
                    position_id TEXT NOT NULL,
                    old_sl_order_id TEXT,
                    new_sl_order_id TEXT NOT NULL,
                    old_sl_price REAL,
                    new_sl_price REAL NOT NULL,
                    update_reason TEXT NOT NULL CHECK (update_reason IN ('break_even', 'trailing', 'manual', 'emergency')),
                    update_time TEXT NOT NULL,
                    success INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    FOREIGN KEY (position_id) REFERENCES position_states(id)
                );

                -- Action audit log
                CREATE TABLE IF NOT EXISTS action_audit_log (
                    id TEXT PRIMARY KEY,
                    position_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    details TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    success INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    FOREIGN KEY (position_id) REFERENCES position_states(id)
                );

                -- Monitoring execution log
                CREATE TABLE IF NOT EXISTS monitoring_execution_log (
                    id TEXT PRIMARY KEY,
                    position_id TEXT NOT NULL,
                    execution_type TEXT NOT NULL,
                    details TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    processing_time_ms INTEGER,
                    success INTEGER NOT NULL,
                    error_message TEXT
                );

                -- Time-based position tracking
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

                -- Time cleanup log
                CREATE TABLE IF NOT EXISTS time_cleanup_log (
                    id TEXT PRIMARY KEY,
                    position_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    success INTEGER NOT NULL,
                    details TEXT,
                    error TEXT
                );

                -- Monitoring state
                CREATE TABLE IF NOT EXISTS monitoring_state (
                    id TEXT PRIMARY KEY DEFAULT 'main',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    last_check TEXT,
                    active_positions TEXT NOT NULL DEFAULT '[]',
                    errors TEXT NOT NULL DEFAULT '[]',
                    settings TEXT NOT NULL DEFAULT '{
                        "checkInterval": 30000,
                        "maxRetries": 3,
                        "breakEvenBuffer": 0.0005,
                        "trailingDistance": 0.01,
                        "enabled": true
                    }'
                );

                -- Initialize monitoring state if not exists
                INSERT OR IGNORE INTO monitoring_state (id, is_active, settings) 
                VALUES ('main', 1, '{
                    "checkInterval": 30000,
                    "maxRetries": 3,
                    "breakEvenBuffer": 0.0005,
                    "trailingDistance": 0.01,
                    "enabled": true
                }');

                -- Create indexes for performance
                CREATE INDEX IF NOT EXISTS idx_position_states_phase ON position_states(phase);
                CREATE INDEX IF NOT EXISTS idx_position_states_contract ON position_states(contract);
                CREATE INDEX IF NOT EXISTS idx_order_fill_events_position ON order_fill_events(position_id);
                CREATE INDEX IF NOT EXISTS idx_monitoring_log_timestamp ON monitoring_execution_log(timestamp);
                CREATE INDEX IF NOT EXISTS idx_time_tracking_status ON position_time_tracking(status);
            `);

            console.log('[AUTO-DB] ✅ All dynamic position management tables initialized successfully');
            
        } catch (error) {
            console.error('[AUTO-DB] ❌ Failed to initialize tables:', error);
            throw error;
        }
    }

    public static close(): void {
        if (AutoInitializingDatabase.instance) {
            AutoInitializingDatabase.instance.close();
            AutoInitializingDatabase.instance = null;
            AutoInitializingDatabase.initialized = false;
        }
    }
}

// Convenience function for getting database instance
export function getAutoInitDB(): Database.Database {
    return AutoInitializingDatabase.getInstance();
}
