// API endpoint for dynamic position management
import { NextRequest, NextResponse } from 'next/server';
import { getDynamicPositionOrchestrator } from '@/services/dynamic-position-orchestrator';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');
        const positionId = searchParams.get('positionId');

        const orchestrator = getDynamicPositionOrchestrator();

        switch (action) {
            case 'status':
                const status = orchestrator.getSystemStatus();
                return NextResponse.json({ success: true, data: status });

            case 'position':
                const positionDetails = orchestrator.getPositionDetails(positionId || undefined);
                return NextResponse.json({ success: true, data: positionDetails });

            default:
                return NextResponse.json({ 
                    success: false, 
                    error: 'Invalid action. Use: status, position' 
                }, { status: 400 });
        }

    } catch (error: any) {
        console.error('Dynamic position management API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action } = body;

        const orchestrator = getDynamicPositionOrchestrator();

        switch (action) {
            case 'start':
                await orchestrator.start();
                return NextResponse.json({ 
                    success: true, 
                    message: 'Dynamic position management started' 
                });

            case 'stop':
                await orchestrator.stop();
                return NextResponse.json({ 
                    success: true, 
                    message: 'Dynamic position management stopped' 
                });

            case 'emergency_stop':
                await orchestrator.emergencyStop();
                return NextResponse.json({ 
                    success: true, 
                    message: 'Emergency stop executed' 
                });

            default:
                return NextResponse.json({ 
                    success: false, 
                    error: 'Invalid action. Use: start, stop, emergency_stop' 
                }, { status: 400 });
        }

    } catch (error: any) {
        console.error('Dynamic position management API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
}
