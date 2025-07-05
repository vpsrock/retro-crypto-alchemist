// Master Orchestrator for Dynamic Position Management
import { getOrderFillDetector } from '@/services/order-fill-detector';
import { getDynamicSlManager } from '@/services/dynamic-sl-manager';
import { getDynamicPositionDB } from '@/services/dynamic-position-db';

class DynamicPositionOrchestrator {
    private fillDetector = getOrderFillDetector();
    private slManager = getDynamicSlManager();
    private db = getDynamicPositionDB();
    
    private isRunning = false;
    private orchestratorId = '';

    constructor() {
        console.log('[ORCHESTRATOR] Dynamic Position Orchestrator initialized');
    }

    /**
     * Start the complete dynamic position management system
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log('[ORCHESTRATOR] Already running, skipping start');
            return;
        }

        this.isRunning = true;
        this.orchestratorId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Starting dynamic position management system`);

        try {
            // Start fill detection monitoring
            await this.fillDetector.startMonitoring();
            console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Fill detector started`);

            // Start the processing loop
            this.processingLoop();
            console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Processing loop started`);

            console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Dynamic position management system is now active`);

        } catch (error: any) {
            console.error(`[ORCHESTRATOR] [${this.orchestratorId}] Failed to start:`, error);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Stop the dynamic position management system
     */
    async stop(): Promise<void> {
        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Stopping dynamic position management system`);
        
        this.isRunning = false;
        
        // Stop fill detection
        await this.fillDetector.stopMonitoring();
        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Fill detector stopped`);

        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Dynamic position management system stopped`);
    }

    /**
     * Main processing loop - handles the coordination between fill detection and SL management
     */
    private async processingLoop(): Promise<void> {
        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Processing loop started`);

        while (this.isRunning) {
            const cycleStartTime = Date.now();
            const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            try {
                console.log(`[ORCHESTRATOR] [${this.orchestratorId}] [${cycleId}] Starting processing cycle`);

                // Process any unprocessed fill events
                await this.slManager.processFillEvents();

                // Cleanup completed positions
                await this.cleanupCompletedPositions();

                const cycleDuration = Date.now() - cycleStartTime;
                console.log(`[ORCHESTRATOR] [${this.orchestratorId}] [${cycleId}] Processing cycle completed in ${cycleDuration}ms`);

            } catch (error: any) {
                console.error(`[ORCHESTRATOR] [${this.orchestratorId}] [${cycleId}] Error in processing cycle:`, error);
                
                // Log error but continue processing
                this.logSystemError('processing_cycle_error', error.message);
            }

            // Wait before next cycle (shorter interval than fill detection)
            await this.sleep(10000); // 10 seconds
        }

        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Processing loop stopped`);
    }

    /**
     * Cleanup positions that are completed or stopped out
     */
    private async cleanupCompletedPositions(): Promise<void> {
        try {
            const activePositions = this.db.getAllActivePositions();
            const completedCount = activePositions.filter(p => 
                p.phase === 'completed' || p.phase === 'stopped_out'
            ).length;

            if (completedCount > 0) {
                console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Found ${completedCount} completed positions for cleanup`);
                
                // Here we could implement cleanup logic like:
                // - Archiving old positions
                // - Cleaning up orphaned orders
                // - Generating performance reports
                // For now, we just log them
            }

        } catch (error: any) {
            console.error(`[ORCHESTRATOR] [${this.orchestratorId}] Error during cleanup:`, error);
        }
    }

    /**
     * Get comprehensive system status
     */
    getSystemStatus(): {
        orchestrator: { isRunning: boolean; orchestratorId: string };
        fillDetector: { isRunning: boolean; currentCheckId: string };
        slManager: { isProcessing: boolean };
        database: {
            activePositions: number;
            unprocessedFills: number;
            monitoringState: any;
        };
    } {
        const activePositions = this.db.getAllActivePositions();
        const unprocessedFills = this.db.getUnprocessedFills();
        const monitoringState = this.db.getMonitoringState();

        return {
            orchestrator: {
                isRunning: this.isRunning,
                orchestratorId: this.orchestratorId
            },
            fillDetector: this.fillDetector.getStatus(),
            slManager: this.slManager.getStatus(),
            database: {
                activePositions: activePositions.length,
                unprocessedFills: unprocessedFills.length,
                monitoringState
            }
        };
    }

    /**
     * Get position details for debugging
     */
    getPositionDetails(positionId?: string): any {
        if (positionId) {
            const position = this.db.getPositionState(positionId);
            if (position) {
                const auditLog = this.db.getPositionAuditLog(positionId);
                return {
                    position,
                    auditLog
                };
            }
            return null;
        } else {
            return {
                activePositions: this.db.getAllActivePositions(),
                unprocessedFills: this.db.getUnprocessedFills()
            };
        }
    }

    /**
     * Emergency stop - force stop all operations
     */
    async emergencyStop(): Promise<void> {
        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] EMERGENCY STOP TRIGGERED`);
        
        this.isRunning = false;
        
        try {
            await this.fillDetector.stopMonitoring();
        } catch (error) {
            console.error(`[ORCHESTRATOR] Emergency stop error:`, error);
        }

        // Update monitoring state to inactive
        this.db.updateMonitoringState({
            isActive: false,
            lastCheck: new Date().toISOString()
        });

        console.log(`[ORCHESTRATOR] [${this.orchestratorId}] Emergency stop completed`);
    }

    /**
     * Log system-level errors
     */
    private logSystemError(action: string, error: string): void {
        const monitoringState = this.db.getMonitoringState();
        const errors = [...monitoringState.errors, {
            positionId: 'orchestrator',
            error: `${action}: ${error}`,
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
}

// Singleton instance
let orchestratorInstance: DynamicPositionOrchestrator | null = null;

export function getDynamicPositionOrchestrator(): DynamicPositionOrchestrator {
    if (!orchestratorInstance) {
        orchestratorInstance = new DynamicPositionOrchestrator();
    }
    return orchestratorInstance;
}

export { DynamicPositionOrchestrator };
