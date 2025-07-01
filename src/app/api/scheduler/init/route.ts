import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/services/database';

export async function POST(request: NextRequest) {
  try {
    // Initialize database
    await initDatabase();
    
    // Initialize scheduler service
    const { schedulerService } = await import('../../../../services/scheduler');
    await schedulerService.initialize();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database and scheduler initialized successfully' 
    });
  } catch (error: any) {
    console.error('Initialization failed:', error);
    return NextResponse.json(
      { error: 'Failed to initialize system', details: error.message },
      { status: 500 }
    );
  }
}
