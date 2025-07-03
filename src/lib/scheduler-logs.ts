import fs from 'fs';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'tmp', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export interface SchedulerLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS';
  category: 'SCHEDULER' | 'DATABASE' | 'DISCOVERY' | 'ANALYSIS' | 'TRADING' | 'API' | 'CLEANUP';
  jobId?: string;
  contract?: string;
  message: string;
  data?: any;
  error?: any;
}

class SchedulerLogger {
  private logFile: string;
  private currentJobId?: string;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(logsDir, `scheduler-${timestamp}.log`);
    this.log('INFO', 'SCHEDULER', 'Scheduler logging initialized', { logFile: this.logFile });
  }

  setCurrentJob(jobId: string) {
    this.currentJobId = jobId;
    this.log('INFO', 'SCHEDULER', `Starting job execution: ${jobId}`, { jobId });
  }

  clearCurrentJob() {
    if (this.currentJobId) {
      this.log('INFO', 'SCHEDULER', `Completed job execution: ${this.currentJobId}`, { jobId: this.currentJobId });
    }
    this.currentJobId = undefined;
  }

  log(level: SchedulerLogEntry['level'], category: SchedulerLogEntry['category'], message: string, data?: any, error?: any) {
    const entry: SchedulerLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      jobId: this.currentJobId,
      message,
      data,
      error: error ? this.serializeError(error) : undefined
    };

    // Write to file
    const logLine = this.formatLogEntry(entry);
    fs.appendFileSync(this.logFile, logLine + '\n');

    // Also log to console with colors
    this.logToConsole(entry);
  }

  // Specific logging methods for different scenarios
  jobStart(jobId: string, jobName: string, config: any) {
    this.setCurrentJob(jobId);
    this.log('INFO', 'SCHEDULER', `Job started: ${jobName}`, { 
      jobId, 
      jobName, 
      config: {
        settle: config.settle,
        interval: config.interval,
        scheduleInterval: config.scheduleInterval,
        threshold: config.threshold,
        concurrency: config.concurrency,
        profiles: config.profiles
      }
    });
  }

  jobComplete(jobId: string, duration: number, summary: any) {
    this.log('SUCCESS', 'SCHEDULER', `Job completed successfully`, { 
      jobId, 
      duration: `${duration}ms`,
      summary 
    });
    this.clearCurrentJob();
  }

  jobError(jobId: string, error: any, duration?: number) {
    this.log('ERROR', 'SCHEDULER', `Job failed`, { 
      jobId, 
      duration: duration ? `${duration}ms` : undefined 
    }, error);
    this.clearCurrentJob();
  }

  discovery(contracts: string[], profilesUsed: string[]) {
    this.log('INFO', 'DISCOVERY', `Contract discovery completed`, {
      contractsFound: contracts.length,
      contracts: contracts.slice(0, 10), // Log first 10 contracts
      profilesUsed,
      totalContracts: contracts.length
    });
  }

  analysisStart(contract: string, profile: string, tickerData?: any) {
    this.log('INFO', 'ANALYSIS', `Starting analysis for ${contract}`, {
      contract,
      foundByProfile: profile,
      currentPrice: tickerData?.last,
      volume24h: tickerData?.base_volume
    });
  }

  analysisComplete(contract: string, result: any) {
    const logData: any = {
      contract,
      confidence: result.confidence_score,
      tradeCall: result.trade_call,
      currentPrice: result.current_price,
      takeProfit: result.take_profit,
      stopLoss: result.stop_loss,
      summary: result.summary?.substring(0, 200) + (result.summary?.length > 200 ? '...' : '')
    };

    // Log detailed AI request information if available
    if (result.requestDetails) {
      logData.aiRequest = {
        modelName: result.requestDetails.modelName,
        modelId: result.requestDetails.modelId,
        provider: result.requestDetails.provider,
        modelType: result.requestDetails.modelType,
        promptLength: result.requestDetails.promptLength,
        promptPreview: result.requestDetails.promptPreview
      };
    }

    // Log prompt and response details if available
    if (result.prompt) {
      logData.fullPromptLength = result.prompt.length;
      logData.promptPreview = result.prompt.substring(0, 300) + (result.prompt.length > 300 ? '...' : '');
    }
    
    if (result.rawResponse) {
      logData.responseLength = result.rawResponse.length;
      logData.responsePreview = result.rawResponse.substring(0, 300) + (result.rawResponse.length > 300 ? '...' : '');
    }

    this.log('SUCCESS', 'ANALYSIS', `Analysis completed for ${contract}`, logData);
  }

  analysisError(contract: string, error: any) {
    this.log('ERROR', 'ANALYSIS', `Analysis failed for ${contract}`, { contract }, error);
  }

  aiRequest(contract: string, prompt: string, modelConfig: any) {
    this.log('DEBUG', 'API', `AI request sent for ${contract}`, {
      contract,
      model: modelConfig.name,
      provider: modelConfig.provider,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 200) + '...'
    });
  }

  aiResponse(contract: string, rawResponse: string, parsedResult: any, duration: number) {
    this.log('SUCCESS', 'API', `AI response received for ${contract}`, {
      contract,
      responseLength: rawResponse.length,
      responsePreview: rawResponse.substring(0, 200) + '...',
      parsedResult: {
        confidence: parsedResult.confidence_score,
        tradeCall: parsedResult.trade_call
      },
      duration: `${duration}ms`
    });
  }

  aiError(contract: string, error: any, duration?: number) {
    this.log('ERROR', 'API', `AI request failed for ${contract}`, {
      contract,
      duration: duration ? `${duration}ms` : undefined
    }, error);
  }

  tradeDecision(contract: string, confidence: number, threshold: number, decision: 'EXECUTE' | 'SKIP') {
    this.log('INFO', 'TRADING', `Trade decision for ${contract}: ${decision}`, {
      contract,
      confidence,
      threshold,
      decision,
      reason: decision === 'EXECUTE' ? 'Confidence above threshold' : 'Confidence below threshold'
    });
  }

  tradeStart(contract: string, tradeDetails: any) {
    this.log('INFO', 'TRADING', `Starting trade execution for ${contract}`, {
      contract,
      tradeCall: tradeDetails.trade_call,
      size: tradeDetails.tradeSizeUsd,
      leverage: tradeDetails.leverage,
      entryPrice: tradeDetails.current_price,
      takeProfit: tradeDetails.take_profit,
      stopLoss: tradeDetails.stop_loss
    });
  }

  tradeSuccess(contract: string, result: any, positionId: string) {
    this.log('SUCCESS', 'TRADING', `Trade executed successfully for ${contract}`, {
      contract,
      positionId,
      entryOrderId: result.entry_order_id,
      takeProfitOrderId: result.take_profit_order_id,
      stopLossOrderId: result.stop_loss_order_id,
      message: result.message
    });
  }

  tradeError(contract: string, error: any, positionId?: string) {
    this.log('ERROR', 'TRADING', `Trade execution failed for ${contract}`, {
      contract,
      positionId
    }, error);
  }

  apiCall(endpoint: string, method: string, params: any) {
    this.log('DEBUG', 'API', `API call: ${method} ${endpoint}`, {
      endpoint,
      method,
      params: this.sanitizeApiParams(params)
    });
  }

  apiResponse(endpoint: string, response: any, duration: number) {
    this.log('DEBUG', 'API', `API response: ${endpoint}`, {
      endpoint,
      status: response.status || 'success',
      duration: `${duration}ms`,
      dataLength: JSON.stringify(response).length
    });
  }

  cleanup(result: any) {
    this.log('INFO', 'CLEANUP', 'Orphan order cleanup completed', {
      cancelledOrders: result.cancelled_orders?.length || 0,
      failures: result.cancellation_failures?.length || 0,
      message: result.message
    });
  }

  private formatLogEntry(entry: SchedulerLogEntry): string {
    const parts = [
      entry.timestamp,
      `[${entry.level}]`,
      `[${entry.category}]`,
      entry.jobId ? `[${entry.jobId}]` : '',
      entry.contract ? `[${entry.contract}]` : '',
      entry.message
    ].filter(Boolean);

    let line = parts.join(' ');
    
    if (entry.data) {
      line += ` | DATA: ${JSON.stringify(entry.data, null, 0)}`;
    }
    
    if (entry.error) {
      line += ` | ERROR: ${JSON.stringify(entry.error, null, 0)}`;
    }

    return line;
  }

  private logToConsole(entry: SchedulerLogEntry) {
    const colors = {
      INFO: '\x1b[36m',    // Cyan
      WARN: '\x1b[33m',    // Yellow
      ERROR: '\x1b[31m',   // Red
      DEBUG: '\x1b[35m',   // Magenta
      SUCCESS: '\x1b[32m'  // Green
    };
    
    const reset = '\x1b[0m';
    const color = colors[entry.level] || '';
    
    const prefix = `${color}[SCHEDULER-LOG] ${entry.level}${reset}`;
    const message = `${prefix} ${entry.category}${entry.contract ? ` ${entry.contract}` : ''}: ${entry.message}`;
    
    console.log(message);
  }

  private serializeError(error: any): any {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    return error;
  }

  private sanitizeApiParams(params: any): any {
    if (!params) return params;
    
    const sanitized = { ...params };
    
    // Remove sensitive data from logs
    if (sanitized.apiKey) sanitized.apiKey = '***HIDDEN***';
    if (sanitized.apiSecret) sanitized.apiSecret = '***HIDDEN***';
    if (sanitized.key) sanitized.key = '***HIDDEN***';
    if (sanitized.secret) sanitized.secret = '***HIDDEN***';
    
    return sanitized;
  }

  getCurrentLogFile(): string {
    return this.logFile;
  }
}

// Export singleton instance
export const schedulerLogger = new SchedulerLogger();
