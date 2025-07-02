import { NextRequest, NextResponse } from 'next/server';
import * as database from '@/services/database';

export async function PATCH(request: NextRequest) {
  try {
    await database.initDatabase();
    
    const { jobId, scheduleInterval } = await request.json();
    
    if (!jobId || !scheduleInterval) {
      return NextResponse.json({ 
        success: false, 
        error: 'Job ID and schedule interval are required' 
      }, { status: 400 });
    }

    // Validate schedule interval format
    const validIntervals = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '24h'];
    if (!validIntervals.includes(scheduleInterval)) {
      return NextResponse.json({ 
        success: false, 
        error: `Invalid schedule interval. Valid options: ${validIntervals.join(', ')}` 
      }, { status: 400 });
    }

    // Check if job exists
    const jobs = await database.getScheduledJobs();
    const job = jobs.find(j => j.id === jobId);
    
    if (!job) {
      return NextResponse.json({ 
        success: false, 
        error: 'Job not found' 
      }, { status: 404 });
    }

    // Update the schedule interval
    await database.updateJobScheduleInterval(jobId, scheduleInterval);

    return NextResponse.json({ 
      success: true, 
      message: `Job schedule interval updated to ${scheduleInterval}`,
      jobId: jobId
    });
  } catch (error) {
    console.error('Failed to update job schedule:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
