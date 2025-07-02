import { NextRequest, NextResponse } from 'next/server';
import { createScheduledJob, getScheduledJobs, toggleJobStatus, initDatabase } from '@/services/database';
import { schedulerSchema } from '@/lib/schemas';

export async function GET() {
  try {
    // Ensure database is initialized
    await initDatabase();
    const jobs = await getScheduledJobs();
    return NextResponse.json({ jobs });
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
    return NextResponse.json({ success: true, message: `Job ${isActive ? 'activated' : 'deactivated'} successfully` });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to update job status', details: error.message },
      { status: 500 }
    );
  }
}
