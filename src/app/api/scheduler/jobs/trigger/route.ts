import { NextRequest } from 'next/server';
import { schedulerService } from '@/services/scheduler';
import * as database from '@/services/database';

export async function GET() {
  return Response.json({ 
    message: 'Trigger endpoint is working',
    method: 'GET',
    availableMethods: ['POST']
  });
}

export async function POST(request: NextRequest) {
  try {
    console.log('Trigger endpoint called');
    
    // Initialize database first
    await database.initDatabase();
    
    const body = await request.json();
    const { jobId } = body;
    
    console.log('Received job trigger request:', { jobId });
    
    if (!jobId) {
      return Response.json({ success: false, error: 'Job ID is required' }, { status: 400 });
    }

    // Get the job from database
    const jobs = await database.getScheduledJobs();
    const job = jobs.find(j => j.id === jobId);
    
    if (!job) {
      return Response.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (!job.isActive) {
      return Response.json({ success: false, error: 'Job is not active' }, { status: 400 });
    }

    console.log(`Manually triggering job: ${job.name} (${jobId})`);
    
    // Execute the job immediately
    await schedulerService.executeJobNow(jobId);
    
    return Response.json({ 
      success: true, 
      message: `Job ${job.name} executed immediately`,
      jobId: jobId
    });
  } catch (error) {
    console.error('Failed to trigger job:', error);
    return Response.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
