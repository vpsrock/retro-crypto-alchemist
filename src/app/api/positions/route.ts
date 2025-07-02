import { NextResponse } from 'next/server';
import * as database from '@/services/database';

export async function GET() {
  try {
    // Initialize database first
    await database.initDatabase();
    
    const openPositions = await database.getOpenPositions();
    const closedPositions = await database.getClosedPositions();
    const stats = await database.getSchedulerStats();
    
    return NextResponse.json({ 
      openPositions,
      closedPositions: closedPositions.slice(0, 20), // Last 20 closed positions
      stats
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
