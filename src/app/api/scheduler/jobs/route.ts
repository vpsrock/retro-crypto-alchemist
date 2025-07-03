import { NextRequest, NextResponse } from 'next/server';
import { createScheduledJob, getScheduledJobs, toggleJobStatus, initDatabase } from '@/services/database';
import { schedulerSchema } from '@/lib/schemas';
import schedulerService from '@/services/scheduler';

export async function GET() {
  try {
    // Ensure database is initialized
    await initDatabase();
    const jobs = await getScheduledJobs();
    
    // Get live status for each job from scheduler
    const jobsWithStatus = await Promise.all(
      jobs.map(async (job) => {
        const status = await schedulerService.getJobStatus(job.id);
        return { ...job, ...status };
      })
    );
    
    return NextResponse.json({ jobs: jobsWithStatus });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch scheduled jobs', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Ensure database is initialized
    await initDatabase();
    
    const body = await request.json();
    console.log('Received job creation request:', body);
    
    const validatedData = schedulerSchema.parse(body);
    console.log('Validated data:', validatedData);
    
    const jobId = await createScheduledJob(validatedData);
    console.log('Created job with ID:', jobId);
    
    // Immediately sync the new job with the scheduler
    try {
      await schedulerService.syncJobFromDatabase(jobId);
      console.log('Job synchronized with scheduler:', jobId);
    } catch (syncError) {
      console.warn('Failed to sync new job with scheduler:', syncError);
      // Don't fail the entire request if sync fails
    }
    
    return NextResponse.json({ success: true, jobId, message: 'Scheduled job created successfully' });
  } catch (error: any) {
    console.error('Job creation error:', error);
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Invalid job data', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to create scheduled job', details: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { jobId, isActive } = await request.json();
    
    if (!jobId || typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request data. jobId and isActive are required.' },
        { status: 400 }
      );
    }
    
    await toggleJobStatus(jobId, isActive);
    
    // Immediately sync the job status change with the scheduler
    try {
      await schedulerService.syncJobFromDatabase(jobId);
      console.log(`Job ${jobId} status updated and synchronized with scheduler`);
    } catch (syncError) {
      console.warn('Failed to sync job status change with scheduler:', syncError);
      // Don't fail the entire request if sync fails
    }
    
    return NextResponse.json({ success: true, message: `Job ${isActive ? 'activated' : 'deactivated'} successfully` });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to update job status', details: error.message },
      { status: 500 }
    );
  }
}
