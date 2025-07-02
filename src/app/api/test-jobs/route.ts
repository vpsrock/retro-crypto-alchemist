import { NextResponse } from 'next/server';
import * as database from '@/services/database';

export async function GET() {
  try {
    // Initialize database first
    await database.initDatabase();
    const jobs = await database.getScheduledJobs();
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
