import { NextResponse } from 'next/server';
import { addDebugLog } from '@/lib/debug-logger';

export async function POST() {
  try {
    addDebugLog('Test debug log entry');
    return NextResponse.json({ success: true, message: 'Debug log added' });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to add debug log' }, { status: 500 });
  }
}
