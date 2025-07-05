// Enhanced logging service for dynamic position management
// Logs to both database and /tmp/logs files (cross-platform)

import fs from 'fs';
import path from 'path';
import { getAutoInitDB } from './auto-init-database';

class DynamicPositionLogger {
    private logDir: string;
    private currentLogFile: string;

    constructor() {
        // Cross-platform log directory
        if (process.platform === 'win32') {
            this.logDir = 'C:\\tmp\\logs';
        } else {
            // Ubuntu/Linux server
            this.logDir = '/tmp/logs';
        }
        this.ensureLogDirectory();
        this.currentLogFile = this.getCurrentLogFile();
    }

    private ensureLogDirectory(): void {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (error) {
            console.error('[LOGGER] Failed to create log directory:', error);
        }
    }

    private getCurrentLogFile(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return path.join(this.logDir, `dynamic-positions-${timestamp}.log`);
    }

    private formatLogEntry(
        level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
        component: string,
        message: string,
        data?: any
    ): string {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` | DATA: ${JSON.stringify(data)}` : '';
        return `${timestamp} [${level}] [${component}] ${message}${dataStr}\n`;
    }

    private writeToFile(logEntry: string): void {
        try {
            fs.appendFileSync(this.currentLogFile, logEntry);
        } catch (error) {
            console.error('[LOGGER] Failed to write to log file:', error);
        }
    }

    /**
     * Log monitoring execution events
     */
    public logMonitoringExecution(
        positionId: string,
        executionType: string,
        details: any,
        processingTime: number,
        success: boolean,
        error?: string
    ): void {
        // Database logging
        try {
            const db = getAutoInitDB();
            const id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            db.prepare(`
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
        } catch (dbError) {
            console.error('[LOGGER] Database logging failed:', dbError);
        }

        // File logging
        const level = success ? 'INFO' : 'ERROR';
        const component = 'MONITOR';
        const message = `${executionType} for ${positionId} (${processingTime}ms)${error ? ` - ERROR: ${error}` : ''}`;
        
        this.writeToFile(this.formatLogEntry(level, component, message, details));
        
        // Console logging
        if (success) {
            console.log(`[MONITOR] ${message}`);
        } else {
            console.error(`[MONITOR] ${message}`);
        }
    }

    /**
     * Log order fill events
     */
    public logOrderFill(
        orderId: string,
        contract: string,
        fillType: 'tp1' | 'tp2' | 'sl' | 'manual',
        fillSize: number,
        fillPrice: number,
        positionId: string
    ): void {
        const fillEvent = {
            orderId,
            contract,
            fillType,
            fillSize,
            fillPrice,
            fillTime: new Date().toISOString(),
            positionId
        };

        // Database logging
        try {
            const db = getAutoInitDB();
            const id = `fill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            db.prepare(`
                INSERT INTO order_fill_events 
                (id, order_id, contract, fill_type, fill_size, fill_price, fill_time, position_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                orderId,
                contract,
                fillType,
                fillSize,
                fillPrice,
                fillEvent.fillTime,
                positionId
            );
        } catch (dbError) {
            console.error('[LOGGER] Database logging failed:', dbError);
        }

        // File logging
        const message = `🎯 ${fillType.toUpperCase()} FILL detected for ${contract}: ${fillSize} contracts at ${fillPrice}`;
        this.writeToFile(this.formatLogEntry('INFO', 'FILL-EVENT', message, fillEvent));
        
        // Console logging
        console.log(`[MONITOR] ${message}`);
    }

    /**
     * Log time management actions
     */
    public logTimeManagement(
        positionId: string,
        action: string,
        success: boolean,
        details: any,
        error?: string
    ): void {
        // Database logging
        try {
            const db = getAutoInitDB();
            const id = `time_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            db.prepare(`
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
        } catch (dbError) {
            console.error('[LOGGER] Database logging failed:', dbError);
        }

        // File logging
        const level = success ? 'INFO' : 'ERROR';
        const component = 'TIME-MANAGER';
        const message = `${action} for ${positionId}${error ? ` - ERROR: ${error}` : ''}`;
        
        this.writeToFile(this.formatLogEntry(level, component, message, details));
        
        // Console logging
        if (success) {
            console.log(`[TIME-MANAGER] ${message}`);
        } else {
            console.error(`[TIME-MANAGER] ${message}`);
        }
    }

    /**
     * Log SL updates
     */
    public logSlUpdate(
        positionId: string,
        oldSlOrderId: string | undefined,
        newSlOrderId: string,
        oldSlPrice: number | undefined,
        newSlPrice: number,
        reason: 'break_even' | 'trailing' | 'manual' | 'emergency',
        success: boolean,
        error?: string
    ): void {
        const updateData = {
            positionId,
            oldSlOrderId,
            newSlOrderId,
            oldSlPrice,
            newSlPrice,
            reason,
            updateTime: new Date().toISOString()
        };

        // Database logging
        try {
            const db = getAutoInitDB();
            const id = `sl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            db.prepare(`
                INSERT INTO sl_update_history 
                (id, position_id, old_sl_order_id, new_sl_order_id, old_sl_price, new_sl_price, update_reason, update_time, success, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                positionId,
                oldSlOrderId || null,
                newSlOrderId,
                oldSlPrice || null,
                newSlPrice,
                reason,
                updateData.updateTime,
                success ? 1 : 0,
                error || null
            );
        } catch (dbError) {
            console.error('[LOGGER] Database logging failed:', dbError);
        }

        // File logging
        const level = success ? 'INFO' : 'ERROR';
        const component = 'SL-UPDATE';
        const priceChange = oldSlPrice ? `${oldSlPrice} → ${newSlPrice}` : `set to ${newSlPrice}`;
        const message = `SL updated for ${positionId}: ${priceChange} (${reason})${error ? ` - ERROR: ${error}` : ''}`;
        
        this.writeToFile(this.formatLogEntry(level, component, message, updateData));
        
        // Console logging
        if (success) {
            console.log(`[MONITOR] ✅ ${message}`);
        } else {
            console.error(`[MONITOR] ❌ ${message}`);
        }
    }

    /**
     * Log position state changes
     */
    public logPositionStateChange(
        positionId: string,
        contract: string,
        oldPhase: string,
        newPhase: string,
        remainingSize: number,
        realizedPnl: number
    ): void {
        const stateData = {
            positionId,
            contract,
            oldPhase,
            newPhase,
            remainingSize,
            realizedPnl,
            timestamp: new Date().toISOString()
        };

        // File logging
        const message = `Position ${contract} phase change: ${oldPhase} → ${newPhase} (remaining: ${remainingSize}, PnL: ${realizedPnl})`;
        this.writeToFile(this.formatLogEntry('INFO', 'POSITION-STATE', message, stateData));
        
        // Console logging
        console.log(`[MONITOR] 📊 ${message}`);
    }

    /**
     * Log service status changes
     */
    public logServiceStatus(
        service: 'monitor' | 'time-manager' | 'database',
        action: 'started' | 'stopped' | 'error' | 'initialized',
        details?: any
    ): void {
        const component = service.toUpperCase();
        const message = `Service ${action}`;
        const level = action === 'error' ? 'ERROR' : 'INFO';
        
        this.writeToFile(this.formatLogEntry(level, component, message, details));
        
        // Console logging
        const emoji = action === 'started' ? '🚀' : action === 'stopped' ? '⏹️' : action === 'error' ? '❌' : '✅';
        console.log(`[${component}] ${emoji} ${message}`);
    }

    /**
     * General info logging
     */
    public logInfo(message: string, data?: any): void {
        this.writeToFile(this.formatLogEntry('INFO', 'MONITOR', message, data));
        console.log(message);
    }

    /**
     * General error logging
     */
    public logError(message: string, data?: any): void {
        this.writeToFile(this.formatLogEntry('ERROR', 'MONITOR', message, data));
        console.error(message);
    }

    /**
     * Get current log directory path
     */
    public getCurrentLogDirectory(): string {
        return this.logDir;
    }

    /**
     * Get current log file path
     */
    public getCurrentLogFilePath(): string {
        return this.currentLogFile;
    }

    /**
     * Rotate log file (create new one)
     */
    public rotateLogFile(): void {
        this.currentLogFile = this.getCurrentLogFile();
        this.logServiceStatus('monitor', 'initialized', { newLogFile: this.currentLogFile });
    }
}

// Singleton instance
let logger: DynamicPositionLogger | null = null;

export function getDynamicPositionLogger(): DynamicPositionLogger {
    if (!logger) {
        logger = new DynamicPositionLogger();
    }
    return logger;
}

export function initializeDynamicPositionLogging(): void {
    const logger = getDynamicPositionLogger();
    logger.logServiceStatus('monitor', 'initialized', {
        logFile: logger.getCurrentLogFilePath(),
        logDirectory: logger.getCurrentLogDirectory()
    });
}
