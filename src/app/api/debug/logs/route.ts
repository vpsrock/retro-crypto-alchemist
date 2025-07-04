import { NextResponse, NextRequest } from 'next/server';
import { addDebugLog, getDebugLogs, clearDebugLogs } from '@/lib/debug-logger';

export async function GET() {
  return NextResponse.json(getDebugLogs());
}

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();
    if (message) {
      addDebugLog(message);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to add log' }, { status: 400 });
  }
}

export async function DELETE() {
  return NextResponse.json(clearDebugLogs());
}
