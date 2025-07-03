import { NextRequest, NextResponse } from 'next/server';
import { getScheduledJobs, deleteScheduledJob, initDatabase } from '@/services/database';
import schedulerService from '@/services/scheduler';

// DELETE /api/scheduler/jobs/[jobId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    await initDatabase();
    
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }
    
    // Check if job exists
    const jobs = await getScheduledJobs();
    const job = jobs.find(j => j.id === jobId);
    
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }
    
    console.log(`Deleting job: ${job.name} (${jobId})`);
    
    // First unschedule the job from the scheduler if it's running
    try {
      await schedulerService.unscheduleJob(jobId);
      console.log(`Job ${jobId} unscheduled from scheduler`);
    } catch (syncError) {
      console.warn('Failed to unschedule job before deletion:', syncError);
    }
    
    // Delete the job from database
    await deleteScheduledJob(jobId);
    console.log(`Job ${jobId} deleted from database`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Job "${job.name}" deleted successfully`,
      deletedJobId: jobId 
    });
  } catch (error: any) {
    console.error('Job deletion error:', error);
    return NextResponse.json(
      { error: 'Failed to delete job', details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/scheduler/jobs/[jobId] - Get single job details
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    await initDatabase();
    
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }
    
    // Get job from database
    const jobs = await getScheduledJobs();
    const job = jobs.find(j => j.id === jobId);
    
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }
    
    // Get live status from scheduler
    const status = await schedulerService.getJobStatus(jobId);
    const jobWithStatus = { ...job, ...status };
    
    return NextResponse.json({ job: jobWithStatus });
  } catch (error: any) {
    console.error('Get job error:', error);
    return NextResponse.json(
      { error: 'Failed to get job', details: error.message },
      { status: 500 }
    );
  }
}
