// Simple in-memory log store for debugging
let debugLogs: string[] = [];

export function addDebugLog(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  debugLogs.push(logEntry);
  
  // Keep only last 100 logs to prevent memory issues
  if (debugLogs.length > 100) {
    debugLogs = debugLogs.slice(-100);
  }
  
  // Also log to console
  console.log(logEntry);
}

export function getDebugLogs() {
  return {
    success: true,
    logs: debugLogs,
    count: debugLogs.length
  };
}

export function clearDebugLogs() {
  debugLogs = [];
  return {
    success: true,
    message: 'Debug logs cleared'
  };
}
