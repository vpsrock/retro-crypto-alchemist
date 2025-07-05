// API endpoints for dynamic position management
import { NextRequest, NextResponse } from 'next/server';
import { getDynamicPositionMonitor } from '@/services/dynamic-position-monitor';
import { getTimeManager } from '@/services/time-based-position-manager';

export async function GET() {
    try {
        const monitor = getDynamicPositionMonitor();
        const timeManager = getTimeManager();
        
        const status = {
            monitoring: monitor.getStatus(),
            timeTracking: timeManager.getTimeTrackingStatus(),
            timestamp: new Date().toISOString()
        };

        return NextResponse.json(status);
    } catch (error) {
        console.error('Error getting position management status:', error);
        return NextResponse.json(
            { error: 'Failed to get status' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const { action, data } = await request.json();
        const monitor = getDynamicPositionMonitor();
        const timeManager = getTimeManager();

        switch (action) {
            case 'start_monitoring':
                monitor.startMonitoring();
                return NextResponse.json({ success: true, message: 'Monitoring started' });

            case 'stop_monitoring':
                monitor.stopMonitoring();
                return NextResponse.json({ success: true, message: 'Monitoring stopped' });

            case 'start_time_management':
                timeManager.startCleanupService();
                return NextResponse.json({ success: true, message: 'Time management started' });

            case 'stop_time_management':
                timeManager.stopCleanupService();
                return NextResponse.json({ success: true, message: 'Time management stopped' });

            case 'extend_position':
                const { positionId, additionalHours } = data;
                const success = timeManager.extendPositionExpiry(positionId, additionalHours);
                return NextResponse.json({ 
                    success, 
                    message: success ? 'Position expiry extended' : 'Failed to extend position'
                });

            case 'cleanup_completed':
                const cleaned = timeManager.cleanupCompletedPositions();
                return NextResponse.json({ 
                    success: true, 
                    message: `Cleaned ${cleaned} completed positions`
                });

            default:
                return NextResponse.json(
                    { error: 'Unknown action' },
                    { status: 400 }
                );
        }
    } catch (error) {
        console.error('Error in position management API:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
