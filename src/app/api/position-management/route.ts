// API endpoints for dynamic position management
import { NextRequest, NextResponse } from 'next/server';
import { getServiceManager } from '@/services/auto-service-manager';

export async function GET() {
    try {
        const serviceManager = getServiceManager();
        const status = serviceManager.getStatus();

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
