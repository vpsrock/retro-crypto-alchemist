import { NextRequest, NextResponse } from 'next/server';
import { getOpenPositions, getClosedPositions, getSchedulerStats } from '@/services/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'open', 'closed', or 'stats'
    
    switch (type) {
      case 'open':
        const openPositions = await getOpenPositions();
        return NextResponse.json({ positions: openPositions });
        
      case 'closed':
        const closedPositions = await getClosedPositions();
        return NextResponse.json({ positions: closedPositions });
        
      case 'stats':
        const stats = await getSchedulerStats();
        return NextResponse.json({ stats });
        
      default:
        return NextResponse.json(
          { error: 'Invalid type parameter. Use: open, closed, or stats' },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: error.message },
      { status: 500 }
    );
  }
}
