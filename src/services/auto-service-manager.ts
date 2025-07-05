// Auto-starting service manager - initializes all dynamic position management services
import { getDynamicPositionMonitor } from './dynamic-position-monitor';
import { getTimeManager } from './time-based-position-manager';
import { getAutoInitDB } from './auto-init-database';
import { getDynamicPositionLogger, initializeDynamicPositionLogging } from './dynamic-position-logger';

class AutoServiceManager {
    private static instance: AutoServiceManager | null = null;
    private initialized: boolean = false;
    private services: {
        monitor?: any;
        timeManager?: any;
    } = {};

    public static getInstance(): AutoServiceManager {
        if (!AutoServiceManager.instance) {
            AutoServiceManager.instance = new AutoServiceManager();
        }
        return AutoServiceManager.instance;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            console.log('[SERVICE-MANAGER] Services already initialized');
            return;
        }

        try {
            console.log('[SERVICE-MANAGER] 🚀 Starting auto-initialization of dynamic position management...');

            // 1. Initialize database (auto-creates tables)
            console.log('[SERVICE-MANAGER] Initializing database...');
            getAutoInitDB();

            // 2. Initialize enhanced logging system
            console.log('[SERVICE-MANAGER] Initializing enhanced logging to /tmp/logs...');
            initializeDynamicPositionLogging();

            // 3. Initialize and start monitoring service
            console.log('[SERVICE-MANAGER] Starting dynamic position monitor...');
            this.services.monitor = getDynamicPositionMonitor();
            this.services.monitor.startMonitoring();

            // 4. Initialize and start time-based management
            console.log('[SERVICE-MANAGER] Starting time-based position manager...');
            this.services.timeManager = getTimeManager();
            this.services.timeManager.startCleanupService();

            this.initialized = true;
            console.log('[SERVICE-MANAGER] ✅ All dynamic position management services started successfully!');
            
            // Log initial status
            this.logStatus();

        } catch (error) {
            console.error('[SERVICE-MANAGER] ❌ Failed to initialize services:', error);
            throw error;
        }
    }

    private logStatus(): void {
        try {
            const monitorStatus = this.services.monitor?.getStatus();
            const timeTrackingStatus = this.services.timeManager?.getTimeTrackingStatus();
            
            console.log('[SERVICE-MANAGER] 📊 Service Status:');
            console.log(`  - Dynamic Monitor: ${monitorStatus?.isRunning ? '✅ Running' : '❌ Stopped'} (${monitorStatus?.activePositions || 0} positions)`);
            console.log(`  - Time Manager: ✅ Running (${timeTrackingStatus?.length || 0} tracked positions)`);
            console.log(`  - Database: ✅ Initialized with all tables`);
        } catch (error) {
            console.log('[SERVICE-MANAGER] Status check failed:', error);
        }
    }

    public getStatus(): any {
        return {
            initialized: this.initialized,
            services: {
                monitor: this.services.monitor?.getStatus() || { isRunning: false },
                timeManager: {
                    isRunning: !!this.services.timeManager,
                    trackedPositions: this.services.timeManager?.getTimeTrackingStatus()?.length || 0
                }
            },
            timestamp: new Date().toISOString()
        };
    }

    public async restart(): Promise<void> {
        console.log('[SERVICE-MANAGER] 🔄 Restarting all services...');
        
        try {
            // Stop existing services
            if (this.services.monitor) {
                this.services.monitor.stopMonitoring();
            }
            if (this.services.timeManager) {
                this.services.timeManager.stopCleanupService();
            }

            this.initialized = false;
            
            // Restart
            await this.initialize();
            
        } catch (error) {
            console.error('[SERVICE-MANAGER] ❌ Failed to restart services:', error);
            throw error;
        }
    }
}

// Global initialization function
let globalInitialized = false;

export async function initializeAllDynamicServices(): Promise<void> {
    if (globalInitialized) {
        return;
    }

    try {
        const manager = AutoServiceManager.getInstance();
        await manager.initialize();
        globalInitialized = true;
    } catch (error) {
        console.error('[GLOBAL-INIT] Failed to initialize dynamic services:', error);
        // Don't throw - let the app continue without dynamic management
    }
}

export function getServiceManager(): AutoServiceManager {
    return AutoServiceManager.getInstance();
}

// Auto-initialize when this module is imported (for server-side)
if (typeof window === 'undefined') {
    // Server-side initialization
    setTimeout(() => {
        initializeAllDynamicServices().catch(error => {
            console.error('[AUTO-INIT] Delayed initialization failed:', error);
        });
    }, 2000); // 2-second delay to let the app fully start
}
