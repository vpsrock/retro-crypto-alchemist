// Diagnostic API for database health and position management
import { NextRequest, NextResponse } from 'next/server';
import { checkDatabaseHealth, getDatabaseConnectionStatus, getAutoInitDB } from '@/services/auto-init-database';
import { getDynamicPositionMonitor } from '@/services/dynamic-position-monitor';
import { getTimeManager } from '@/services/time-based-position-manager';

export async function GET(request: NextRequest) {
    try {
        console.log('[DIAGNOSTIC] Running comprehensive system diagnostic...');
        
        const diagnostics: any = {
            timestamp: new Date().toISOString(),
            database: {},
            services: {},
            positions: {},
            system: {}
        };

        // Database diagnostics
        try {
            diagnostics.database = {
                connectionStatus: getDatabaseConnectionStatus(),
                healthCheck: checkDatabaseHealth(),
                tables: []
            };

            // Check if database is accessible
            if (diagnostics.database.connectionStatus === 'connected') {
                const db = getAutoInitDB();
                
                // List all tables
                const tables = db.prepare(`
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name NOT LIKE 'sqlite_%'
                    ORDER BY name
                `).all() as { name: string }[];
                
                diagnostics.database.tables = tables.map(t => t.name);

                // Count records in each relevant table
                const tableCounts: Record<string, number> = {};
                for (const table of ['position_states', 'monitoring_execution_log', 'order_fill_events', 'position_time_tracking']) {
                    try {
                        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
                        tableCounts[table] = count.count;
                    } catch (error) {
                        tableCounts[table] = -1; // Table doesn't exist or error
                    }
                }
                diagnostics.database.recordCounts = tableCounts;
            }
        } catch (error) {
            diagnostics.database.error = error instanceof Error ? error.message : String(error);
        }

        // Service diagnostics
        try {
            // Monitor service
            try {
                const monitor = getDynamicPositionMonitor();
                const monitorStatus = monitor.getStatus();
                diagnostics.services.monitor = {
                    running: monitorStatus.isRunning,
                    activePositions: monitorStatus.activePositions?.length || 0,
                    lastCheck: monitorStatus.lastCheck,
                    config: monitorStatus.config
                };
            } catch (error) {
                diagnostics.services.monitor = { error: error instanceof Error ? error.message : String(error) };
            }

            // Time manager service
            try {
                const timeManager = getTimeManager();
                const timeStatus = timeManager.getTimeTrackingStatus();
                diagnostics.services.timeManager = {
                    running: timeManager.isRunning,
                    trackedPositions: timeStatus.length,
                    activePositions: timeStatus.filter(p => p.status === 'active').length
                };
            } catch (error) {
                diagnostics.services.timeManager = { error: error instanceof Error ? error.message : String(error) };
            }
        } catch (error) {
            diagnostics.services.error = error instanceof Error ? error.message : String(error);
        }

        // Position diagnostics
        try {
            if (diagnostics.database.connectionStatus === 'connected') {
                const db = getAutoInitDB();
                
                // Active positions by phase
                const phaseStats = db.prepare(`
                    SELECT phase, COUNT(*) as count 
                    FROM position_states 
                    GROUP BY phase
                `).all() as { phase: string, count: number }[];
                
                diagnostics.positions.byPhase = phaseStats.reduce((acc: Record<string, number>, stat) => {
                    acc[stat.phase] = stat.count;
                    return acc;
                }, {});

                // Recent activity (last 24 hours)
                const recent = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM monitoring_execution_log 
                    WHERE datetime(timestamp) > datetime('now', '-24 hours')
                `).get() as { count: number };
                
                diagnostics.positions.recentActivity = recent.count;

                // Active monitoring count
                const activePositions = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM position_states 
                    WHERE phase IN ('initial', 'tp1_filled', 'tp2_filled')
                `).get() as { count: number };
                
                diagnostics.positions.activeCount = activePositions.count;
            }
        } catch (error) {
            diagnostics.positions.error = error instanceof Error ? error.message : String(error);
        }

        // System diagnostics
        diagnostics.system = {
            nodeVersion: process.version,
            platform: process.platform,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            env: process.env.NODE_ENV || 'unknown'
        };

        // Overall health score
        let healthScore = 0;
        let maxScore = 0;

        // Database health (40 points)
        maxScore += 40;
        if (diagnostics.database.connectionStatus === 'connected') healthScore += 20;
        if (diagnostics.database.healthCheck) healthScore += 20;

        // Services health (40 points)
        maxScore += 40;
        if (diagnostics.services.monitor && !diagnostics.services.monitor.error) {
            healthScore += 20;
            if (diagnostics.services.monitor.running) healthScore += 5;
        }
        if (diagnostics.services.timeManager && !diagnostics.services.timeManager.error) {
            healthScore += 15;
        }

        // System health (20 points)
        maxScore += 20;
        if (diagnostics.system.uptime > 60) healthScore += 10; // Running for more than 1 minute
        if (diagnostics.system.memoryUsage.heapUsed < diagnostics.system.memoryUsage.heapTotal * 0.8) healthScore += 10; // Memory usage < 80%

        const overallHealth = Math.round((healthScore / maxScore) * 100);

        return NextResponse.json({
            status: 'success',
            overallHealth: `${overallHealth}%`,
            healthScore,
            maxScore,
            diagnostics,
            recommendations: generateRecommendations(diagnostics)
        });

    } catch (error) {
        console.error('[DIAGNOSTIC] Failed to run diagnostics:', error);
        return NextResponse.json({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}

function generateRecommendations(diagnostics: any): string[] {
    const recommendations: string[] = [];

    if (diagnostics.database.connectionStatus !== 'connected') {
        recommendations.push('🚨 CRITICAL: Database connection is not working. Restart the application.');
    }

    if (diagnostics.database.healthCheck === false) {
        recommendations.push('⚠️ Database health check failed. Check database file permissions and disk space.');
    }

    if (diagnostics.services.monitor?.error) {
        recommendations.push('🔧 Position monitoring service has errors. Check logs for details.');
    }

    if (diagnostics.services.monitor?.running === false) {
        recommendations.push('⏸️ Position monitoring is not running. Dynamic position management is disabled.');
    }

    if (diagnostics.services.timeManager?.error) {
        recommendations.push('🔧 Time management service has errors. Positions may not expire properly.');
    }

    if (diagnostics.positions.activeCount > 10) {
        recommendations.push('📊 High number of active positions. Monitor system performance.');
    }

    if (!diagnostics.database.tables?.includes('position_states')) {
        recommendations.push('📋 Required database tables are missing. Run database migration.');
    }

    if (recommendations.length === 0) {
        recommendations.push('✅ All systems operating normally. No action required.');
    }

    return recommendations;
}
