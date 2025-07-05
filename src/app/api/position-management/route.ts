// API endpoints for dynamic position management
import { NextRequest, NextResponse } from 'next/server';
import { getServiceManager } from '@/services/auto-service-manager';
import { getDynamicPositionMonitor } from '@/services/dynamic-position-monitor';
import { getTimeManager } from '@/services/time-based-position-manager';

export async function GET() {
    const monitor = getDynamicPositionMonitor();
    const timeManager = getTimeManager();

    return new Response(JSON.stringify({
        initialized: true, // Assuming if this API is hit, it's initialized
        services: {
            monitor: monitor.getStatus(),
            timeManager: timeManager.getStatus(),
        },
        timestamp: new Date().toISOString(),
    }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function POST(request: NextRequest) {
    try {
        const { action, data } = await request.json();
        const serviceManager = getServiceManager();

        switch (action) {
            case 'restart_services':
                await serviceManager.restart();
                return NextResponse.json({ success: true, message: 'All services restarted' });

            case 'get_status':
                const status = serviceManager.getStatus();
                return NextResponse.json({ success: true, status });

            default:
                return NextResponse.json(
                    { error: 'Unknown action. Available: restart_services, get_status' },
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

// New endpoint for detailed health status
export async function POST(req: Request) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const monitor = getDynamicPositionMonitor();
    const healthStatus = monitor.getHealthStatus();

    return new Response(JSON.stringify(healthStatus), {
        headers: { 'Content-Type': 'application/json' },
        status: healthStatus.lastError ? 503 : 200, // Service Unavailable if error
    });
}
