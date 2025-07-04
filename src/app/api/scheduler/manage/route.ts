import { NextRequest, NextResponse } from 'next/server';
import schedulerService from '@/services/scheduler';

export async function POST(request: NextRequest) {
  try {
    const { action, jobId } = await request.json();
    
    if (action === 'start') {
      await schedulerService.activateJob(jobId);
      return NextResponse.json({ success: true, message: 'Job activated' });
    } else if (action === 'stop') {
      await schedulerService.deactivateJob(jobId);
      return NextResponse.json({ success: true, message: 'Job deactivated' });
    } else {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error managing job:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
