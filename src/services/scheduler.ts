import * as database from './database';
import { discoverContracts, type DiscoverContractsInput } from '../ai/flows/discover-contracts';
import { analyzeTradeRecommendations, analyzeTradeRecommendationsWithLogger } from '../ai/flows/analyze-trade-recommendations';
import { cleanupOrphanedOrders, placeTradeStrategy } from '../ai/flows/trade-management';
import { schedulerLogger } from '../../tmp/scheduler-logs';

// Re-export types from database
export type { ScheduledJob, TradePosition, SchedulerStats } from './database';

interface JobExecutionContext {
  jobId: string;
  interval: string;
  profilesConfig: DiscoverContractsInput[];
  tradeSizeUsd: number;
  leverage: number;
  threshold: number;
}

class SchedulerService {
  private runningJobs: Set<string> = new Set();
  private jobIntervals: Map<string, NodeJS.Timeout> = new Map();
  private positionMonitorInterval?: NodeJS.Timeout;
  private orphanCleanupInterval?: NodeJS.Timeout;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log('Initializing scheduler service...');
    await database.initDatabase();
    
    // Start position monitoring (every 2 minutes)
    this.startPositionMonitoring();
    
    // Start orphan order cleanup (every 10 minutes)
    this.startOrphanOrderCleanup();
    
    // Load and restart active jobs
    await this.loadAndStartActiveJobs();
    
    this.isInitialized = true;
    console.log('Scheduler service initialized successfully');
  }

  private async loadAndStartActiveJobs(): Promise<void> {
    try {
      const allJobs = await database.getScheduledJobs();
      const activeJobs = allJobs.filter(job => job.isActive);
      console.log(`Loading ${activeJobs.length} active jobs...`);
      
      for (const job of activeJobs) {
        await this.scheduleJob(job);
      }
    } catch (error) {
      console.error('Error loading active jobs:', error);
    }
  }

  async scheduleJob(job: database.ScheduledJob): Promise<void> {
    // Clear existing interval if job is already scheduled
    if (this.jobIntervals.has(job.id)) {
      clearInterval(this.jobIntervals.get(job.id)!);
      this.jobIntervals.delete(job.id);
    }

    if (!job.isActive) {
      console.log(`Job ${job.id} (${job.name}) is inactive, skipping schedule`);
      return;
    }

    // Parse interval (e.g., '5m', '1h', '24h')
    const intervalMs = this.parseInterval(job.scheduleInterval);
    console.log(`Scheduling job ${job.id} (${job.name}) to run every ${job.scheduleInterval}`);

    // Calculate next run time
    const now = Date.now();
    const nextRun = now + intervalMs;
    
    // Update next run time in database (simulate this for now)
    // await database.updateJobLastRun(job.id);
    console.log(`Next run time updated for job ${job.id}: ${new Date(nextRun).toISOString()}`);

    // Schedule the job
    const interval = setInterval(async () => {
      await this.executeJob(job);
    }, intervalMs);

    this.jobIntervals.set(job.id, interval);

    // Also run immediately if it's the first time or overdue
    const shouldRunNow = !job.lastRun || 
      (job.nextRun && now >= job.nextRun);
    
    if (shouldRunNow) {
      console.log(`Running job ${job.id} immediately...`);
      setTimeout(() => this.executeJob(job), 1000); // Small delay to avoid blocking
    }
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([mh])$/);
    if (!match) {
      console.warn(`Invalid interval format: ${interval}, defaulting to 1h`);
      return 60 * 60 * 1000; // 1 hour
    }
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    if (unit === 'm') {
      return value * 60 * 1000; // minutes to milliseconds
    } else if (unit === 'h') {
      return value * 60 * 60 * 1000; // hours to milliseconds
    }
    
    return 60 * 60 * 1000; // Default to 1 hour
  }

  async unscheduleJob(jobId: string): Promise<void> {
    if (this.jobIntervals.has(jobId)) {
      clearInterval(this.jobIntervals.get(jobId)!);
      this.jobIntervals.delete(jobId);
      console.log(`Unscheduled job ${jobId}`);
    }
  }

  private async executeJob(job: database.ScheduledJob): Promise<void> {
    const startTime = Date.now();
    
    if (this.runningJobs.has(job.id)) {
      schedulerLogger.log('WARN', 'SCHEDULER', `Job ${job.id} is already running, skipping`, { jobId: job.id });
      console.log(`Job ${job.id} is already running, skipping...`);
      return;
    }

    this.runningJobs.add(job.id);
    
    try {
      schedulerLogger.jobStart(job.id, job.name, job);
      console.log(`Executing job ${job.id} (${job.name})...`);
      
      // Use single discovery call with all profiles (like manual discovery)
      const discoveryConfig: DiscoverContractsInput = {
        profiles: job.profiles as any,
        settle: job.settle as 'usdt' | 'btc',
        contractsPerProfile: job.contractsPerProfile,
        minVolume: job.minVolume,
        sortBy: (job.sortBy || 'score') as 'score' | 'volume' | 'change'
      };

      schedulerLogger.log('INFO', 'DISCOVERY', 'Starting contract discovery', { 
        config: discoveryConfig,
        profileCount: job.profiles.length 
      });

      console.log(`Running discovery for profiles: ${job.profiles.join(', ')}`);
      const discoveryResults = await discoverContracts(discoveryConfig);
      const allDiscoveredContracts = discoveryResults.contracts;

      schedulerLogger.discovery(allDiscoveredContracts.map(c => c.contract), job.profiles);
      console.log(`Discovery found ${allDiscoveredContracts.length} contracts across all profiles`);

      if (allDiscoveredContracts.length === 0) {
        console.log(`No contracts discovered for job ${job.id}`);
        schedulerLogger.log('WARN', 'DISCOVERY', 'No contracts discovered', { jobId: job.id });
        await database.updateJobLastRun(job.id);
        const duration = Date.now() - startTime;
        schedulerLogger.jobComplete(job.id, duration, { contractsFound: 0, tradesExecuted: 0 });
        return;
      }

      // Run analysis with concurrency (parallel processing like manual)
      const executionContext: JobExecutionContext = {
        jobId: job.id,
        interval: job.interval,
        profilesConfig: [discoveryConfig],
        tradeSizeUsd: job.tradeSizeUsd,
        leverage: job.leverage,
        threshold: job.threshold
      };

      const tradesExecuted = await this.processContractsWithConcurrency(allDiscoveredContracts, executionContext, job.concurrency || 10);

      // Update job run time
      await database.updateJobLastRun(job.id);
      
      // Update next run time
      const nextRun = Date.now() + this.parseInterval(job.scheduleInterval);
      await database.updateJobNextRun(job.id, nextRun);

      const duration = Date.now() - startTime;
      schedulerLogger.jobComplete(job.id, duration, { 
        contractsFound: allDiscoveredContracts.length, 
        tradesExecuted 
      });

      console.log(`Job ${job.id} completed successfully.`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Error executing job ${job.id}:`, error);
      schedulerLogger.jobError(job.id, error, duration);
      await database.updateJobLastRun(job.id);
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private async processContractsWithConcurrency(
    contracts: Array<{contract: string, tickerData: any, foundByProfile: string}>,
    context: JobExecutionContext,
    concurrency: number
  ): Promise<number> {
    schedulerLogger.log('INFO', 'ANALYSIS', `Starting parallel analysis of ${contracts.length} contracts`, {
      totalContracts: contracts.length,
      concurrency,
      contracts: contracts.map(c => c.contract)
    });
    
    console.log(`Starting parallel analysis of ${contracts.length} contracts with concurrency=${concurrency}`);
    
    let tradesExecuted = 0;
    
    // Process contracts in parallel batches (like manual discovery)
    for (let i = 0; i < contracts.length; i += concurrency) {
      const batch = contracts.slice(i, i + concurrency);
      const batchNumber = Math.floor(i / concurrency) + 1;
      
      schedulerLogger.log('INFO', 'ANALYSIS', `Processing batch ${batchNumber}`, {
        batchNumber,
        batchSize: batch.length,
        contracts: batch.map(c => c.contract)
      });
      
      console.log(`Processing batch ${batchNumber} with ${batch.length} contracts: [${batch.map(c => c.contract).join(', ')}]`);
      
      // Create parallel promises for the batch
      const promises = batch.map(async (contractInfo) => {
        try {
          const traded = await this.analyzeAndTrade(contractInfo, context);
          return traded ? 1 : 0;
        } catch (error) {
          console.error(`Error analyzing contract ${contractInfo.contract}:`, error);
          schedulerLogger.analysisError(contractInfo.contract, error);
          return 0;
        }
      });
      
      // Wait for all contracts in this batch to complete
      const batchResults = await Promise.all(promises);
      const batchTrades = batchResults.reduce((sum: number, result: number) => sum + result, 0);
      tradesExecuted += batchTrades;
      
      schedulerLogger.log('INFO', 'ANALYSIS', `Completed batch ${batchNumber}`, {
        batchNumber,
        tradesInBatch: batchTrades
      });
      
      console.log(`Completed batch ${batchNumber}`);
    }
    
    schedulerLogger.log('SUCCESS', 'ANALYSIS', `Completed parallel analysis of all ${contracts.length} contracts`, {
      totalContracts: contracts.length,
      totalTrades: tradesExecuted
    });
    
    console.log(`Completed parallel analysis of all ${contracts.length} contracts`);
    return tradesExecuted;
  }

  private async analyzeAndTrade(
    contractInfo: {contract: string, tickerData: any, foundByProfile: string}, 
    context: JobExecutionContext
  ): Promise<boolean> {
    try {
      schedulerLogger.analysisStart(contractInfo.contract, contractInfo.foundByProfile, contractInfo.tickerData);
      console.log(`Analyzing contract ${contractInfo.contract} found by ${contractInfo.foundByProfile}`);

      // Find the appropriate discovery config for this contract's profile
      const profileConfig = context.profilesConfig.find(config => 
        config.profiles.includes(contractInfo.foundByProfile as any)
      );

      if (!profileConfig) {
        const errorMsg = `No profile config found for ${contractInfo.foundByProfile}`;
        console.error(errorMsg);
        schedulerLogger.log('ERROR', 'ANALYSIS', errorMsg, { 
          contract: contractInfo.contract,
          foundByProfile: contractInfo.foundByProfile 
        });
        return false;
      }

      // Get current prompt and model configuration from database
      let promptTemplate = 'Analyze this futures contract for trading opportunities';
      let modelConfig = {
        id: 'default',
        name: 'Default Model',
        provider: 'openai' as const,
        modelId: 'gpt-4o-mini',
        modelType: 'reasoning' as const,
        enabled: true
      };

      try {
        const promptResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/settings/active-prompt`);
        
        if (promptResponse.ok) {
          const promptData = await promptResponse.json();
          if (promptData.success) {
            promptTemplate = promptData.prompt;
            modelConfig = promptData.modelConfig;
            console.log(`Using prompt: ${promptData.promptName} with model: ${modelConfig.name}`);
            schedulerLogger.log('DEBUG', 'API', `Loaded AI configuration for ${contractInfo.contract}`, {
              contract: contractInfo.contract,
              promptName: promptData.promptName,
              modelName: modelConfig.name,
              provider: modelConfig.provider
            });
          }
        } else {
          console.warn('Failed to get active prompt from database, using fallback');
          schedulerLogger.log('WARN', 'API', 'Failed to get active prompt, using fallback', { contract: contractInfo.contract });
        }
      } catch (fetchError) {
        console.warn('Error fetching prompt from database, using fallback:', fetchError);
        schedulerLogger.log('WARN', 'API', 'Error fetching prompt from database', { contract: contractInfo.contract }, fetchError);
      }

      // Replace [TIMEFRAME] placeholder in the prompt
      const finalPrompt = promptTemplate.replace(/\*\*\[TIMEFRAME\]\*\*/g, `**${context.interval}**`);

      // Get API keys from database (including OpenAI key)
      let openaiApiKey = '';
      try {
        const apiKeys = await database.getApiKeys();
        openaiApiKey = apiKeys.openaiApiKey || '';
        if (!openaiApiKey) {
          console.warn(`No OpenAI API key found for ${contractInfo.contract}`);
          schedulerLogger.log('WARN', 'ANALYSIS', `OpenAI API key missing`, { contract: contractInfo.contract });
        }
      } catch (error) {
        console.error('Error loading API keys for analysis:', error);
        schedulerLogger.log('ERROR', 'ANALYSIS', `Failed to load API keys`, { contract: contractInfo.contract }, error);
      }

      // Prepare analysis input
      const analysisInput = {
        settle: profileConfig.settle,
        contract: contractInfo.contract,
        interval: context.interval, // Use interval from context
        modelConfig,
        promptTemplate: finalPrompt, // Use the modified prompt
        openaiApiKey, // Add the OpenAI API key
        tickerData: contractInfo.tickerData
      };

      schedulerLogger.log('DEBUG', 'ANALYSIS', `Starting AI analysis for ${contractInfo.contract}`, {
        contract: contractInfo.contract,
        modelName: modelConfig.name,
        modelId: modelConfig.modelId,
        provider: modelConfig.provider,
        currentPrice: contractInfo.tickerData?.last
      });

      const analysisResult = await analyzeTradeRecommendationsWithLogger(analysisInput, schedulerLogger);

      if (!analysisResult) {
        console.log(`No analysis result for ${contractInfo.contract}`);
        schedulerLogger.log('WARN', 'ANALYSIS', `No analysis result received`, { contract: contractInfo.contract });
        return false;
      }

      schedulerLogger.analysisComplete(contractInfo.contract, analysisResult);
      console.log(`Analysis for ${contractInfo.contract}: confidence=${analysisResult.confidence_score}, action=${analysisResult.trade_call}`);

      // Check if confidence meets threshold for auto-trading
      if (analysisResult.confidence_score >= context.threshold) {
        schedulerLogger.tradeDecision(contractInfo.contract, analysisResult.confidence_score, context.threshold, 'EXECUTE');
        const traded = await this.executeAutoTrade(contractInfo, analysisResult, context);
        return traded;
      } else {
        schedulerLogger.tradeDecision(contractInfo.contract, analysisResult.confidence_score, context.threshold, 'SKIP');
        console.log(`Confidence ${analysisResult.confidence_score} below threshold ${context.threshold} for ${contractInfo.contract}`);
        return false;
      }

    } catch (error) {
      console.error(`Error analyzing contract ${contractInfo.contract}:`, error);
      schedulerLogger.analysisError(contractInfo.contract, error);
      return false;
    }
  }

  private async executeAutoTrade(
    contractInfo: {contract: string, tickerData: any, foundByProfile: string},
    analysisResult: any,
    context: JobExecutionContext
  ): Promise<boolean> {
    try {
      schedulerLogger.tradeStart(contractInfo.contract, {
        trade_call: analysisResult.trade_call,
        tradeSizeUsd: context.tradeSizeUsd,
        leverage: context.leverage,
        current_price: analysisResult.current_price,
        take_profit: analysisResult.take_profit,
        stop_loss: analysisResult.stop_loss
      });
      
      console.log(`Executing auto-trade for ${contractInfo.contract} with confidence ${analysisResult.confidence_score}`);
      
      // Get API keys for trading
      const apiKeys = await this.getApiKeysFromDatabase();
      
      if (!await this.validateApiKeys(apiKeys.gateIoKey, apiKeys.gateIoSecret)) {
        console.error('Cannot execute trade - Valid Gate.io API keys not available');
        schedulerLogger.log('ERROR', 'TRADING', 'Invalid API keys - cannot execute trade', { 
          contract: contractInfo.contract 
        });
        return false;
      }
      
      // Create trade details in the format expected by placeTradeStrategy
      const tradeDetails = {
        ...analysisResult,
        found_by_profile: contractInfo.foundByProfile,
        final_decision: 'TRADE',
        tradeSizeUsd: context.tradeSizeUsd,
        leverage: context.leverage,
      };
      
      // Create position entry first
      const position: Omit<database.TradePosition, 'id'> = {
        jobId: context.jobId,
        contract: contractInfo.contract,
        foundByProfile: contractInfo.foundByProfile,
        tradeCall: analysisResult.trade_call.toLowerCase(),
        entryPrice: analysisResult.current_price,
        currentPrice: analysisResult.current_price,
        size: context.tradeSizeUsd / analysisResult.current_price,
        leverage: context.leverage,
        tradeSizeUsd: context.tradeSizeUsd,
        confidenceScore: Math.round(analysisResult.confidence_score),
        status: 'opening',
        openedAt: Date.now(),
        unrealizedPnl: 0,
        lastUpdated: Date.now()
      };

      const positionId = await database.createTradePosition(position);
      schedulerLogger.log('INFO', 'DATABASE', `Created position record`, { 
        contract: contractInfo.contract,
        positionId,
        tradeCall: position.tradeCall,
        size: position.size
      });
      
      console.log(`Created position ${positionId} for ${contractInfo.contract}`);

      try {
        // Execute real trade using the same logic as manual trading
        const tradeInput = {
          settle: context.profilesConfig[0].settle,
          tradeDetails,
          tradeSizeUsd: context.tradeSizeUsd,
          leverage: context.leverage,
          apiKey: apiKeys.gateIoKey,
          apiSecret: apiKeys.gateIoSecret,
        };

        schedulerLogger.apiCall('/trade', 'POST', {
          settle: tradeInput.settle,
          contract: contractInfo.contract,
          tradeSizeUsd: tradeInput.tradeSizeUsd,
          leverage: tradeInput.leverage
        });

        console.log(`Placing real trade for ${contractInfo.contract}...`);
        const tradeResult = await placeTradeStrategy(tradeInput);
        
        // Update position with order IDs
        await database.updatePositionOrders(positionId, {
          entryOrderId: tradeResult.entry_order_id,
          takeProfitOrderId: tradeResult.take_profit_order_id,
          stopLossOrderId: tradeResult.stop_loss_order_id,
          status: 'open'
        });
        
        schedulerLogger.tradeSuccess(contractInfo.contract, tradeResult, positionId);
        console.log(`Successfully executed trade for ${contractInfo.contract}: ${tradeResult.message}`);
        
        return true;
        
      } catch (tradeError) {
        console.error(`Failed to execute trade for ${contractInfo.contract}:`, tradeError);
        schedulerLogger.tradeError(contractInfo.contract, tradeError, positionId);
        
        // Update position status to failed
        await database.updatePositionStatus(positionId, 'failed');
        return false;
      }

    } catch (error) {
      console.error(`Error executing auto-trade for ${contractInfo.contract}:`, error);
      schedulerLogger.tradeError(contractInfo.contract, error);
      return false;
    }
  }

  private startPositionMonitoring(): void {
    console.log('Starting position monitoring...');
    
    // Monitor positions every 2 minutes
    this.positionMonitorInterval = setInterval(async () => {
      await this.monitorPositions();
    }, 2 * 60 * 1000);

    // Also run immediately
    setTimeout(() => this.monitorPositions(), 5000);
  }

  private async monitorPositions(): Promise<void> {
    try {
      const openPositions = await database.getOpenPositions();
      console.log(`Monitoring ${openPositions.length} open positions...`);

      for (const position of openPositions) {
        try {
          await this.updatePositionPnL(position);
        } catch (error) {
          console.error(`Error updating position ${position.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error monitoring positions:', error);
    }
  }

  private async updatePositionPnL(position: database.TradePosition): Promise<void> {
    try {
      // Get current market price
      const currentPrice = await this.getCurrentPrice(position.contract);
      
      // Calculate P&L
      let unrealizedPnl: number;
      if (position.tradeCall === 'long') {
        unrealizedPnl = (currentPrice - position.entryPrice) * position.size * position.leverage;
      } else {
        unrealizedPnl = (position.entryPrice - currentPrice) * position.size * position.leverage;
      }

      // Update position with current price and P&L
      await database.updatePositionPrice(position.id, currentPrice, unrealizedPnl);

      // Simple profit-taking/stop-loss logic (close position if P&L > 20% or < -10%)
      const pnlPercentage = (unrealizedPnl / position.tradeSizeUsd) * 100;
      
      if (pnlPercentage >= 20 || pnlPercentage <= -10) {
        console.log(`Auto-closing position ${position.id} (${position.contract}) with P&L ${pnlPercentage.toFixed(2)}%`);
        await this.closePosition(position.id, currentPrice, unrealizedPnl);
      }

    } catch (error) {
      console.error(`Error updating P&L for position ${position.id}:`, error);
    }
  }

  private async getCurrentPrice(contract: string): Promise<number> {
    try {
      // For simulation, we'll add some random price movement
      // In a real implementation, you would fetch from Gate.io API
      const basePrice = 100; // Placeholder
      const volatility = 0.02; // 2% volatility
      const randomChange = (Math.random() - 0.5) * 2 * volatility;
      return basePrice * (1 + randomChange);
    } catch (error) {
      console.error(`Error getting current price for ${contract}:`, error);
      return 100; // Fallback price
    }
  }

  private async closePosition(positionId: string, closePrice: number, finalPnL: number): Promise<void> {
    try {
      await database.closePosition(positionId, finalPnL);
      console.log(`Closed position ${positionId} with final P&L: $${finalPnL.toFixed(2)}`);
    } catch (error) {
      console.error(`Error closing position ${positionId}:`, error);
    }
  }

  async activateJob(jobId: string): Promise<void> {
    try {
      await database.toggleJobStatus(jobId, true);
      const allJobs = await database.getScheduledJobs();
      const job = allJobs.find(j => j.id === jobId);
      if (job) {
        await this.scheduleJob(job);
        console.log(`Activated job ${jobId}`);
      }
    } catch (error) {
      console.error(`Error activating job ${jobId}:`, error);
      throw error;
    }
  }

  async deactivateJob(jobId: string): Promise<void> {
    try {
      await database.toggleJobStatus(jobId, false);
      await this.unscheduleJob(jobId);
      console.log(`Deactivated job ${jobId}`);
    } catch (error) {
      console.error(`Error deactivating job ${jobId}:`, error);
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<{ isRunning: boolean; isScheduled: boolean }> {
    return {
      isRunning: this.runningJobs.has(jobId),
      isScheduled: this.jobIntervals.has(jobId)
    };
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down scheduler service...');
    
    // Clear all job intervals
    for (const [jobId, interval] of this.jobIntervals) {
      clearInterval(interval);
    }
    this.jobIntervals.clear();

    // Clear position monitoring
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
    }

    // Clear orphan order cleanup
    if (this.orphanCleanupInterval) {
      clearInterval(this.orphanCleanupInterval);
    }

    // Clear orphan order cleanup
    if (this.orphanCleanupInterval) {
      clearInterval(this.orphanCleanupInterval);
    }

    this.isInitialized = false;
    console.log('Scheduler service shut down');
  }

  private startOrphanOrderCleanup(): void {
    console.log('Starting orphan order cleanup service...');
    
    // Clean up orphan orders every 10 minutes
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanOrders();
    }, 10 * 60 * 1000);

    // Also run after 30 seconds on startup
    setTimeout(() => this.cleanupOrphanOrders(), 30000);
  }

  private async cleanupOrphanOrders(): Promise<void> {
    try {
      schedulerLogger.log('INFO', 'CLEANUP', 'Starting orphan order cleanup');
      console.log('Running orphan order cleanup...');
      
      // Get API keys directly from database (no env var fallback)
      const apiKeys = await this.getApiKeysFromDatabase();
      
      if (!await this.validateApiKeys(apiKeys.gateIoKey, apiKeys.gateIoSecret)) {
        console.log('Skipping orphan order cleanup - Valid Gate.io API keys not available');
        schedulerLogger.log('WARN', 'CLEANUP', 'Skipping cleanup - API keys not available');
        return;
      }
      
      const cleanupInput = {
        settle: 'usdt' as const,
        apiKey: apiKeys.gateIoKey,
        apiSecret: apiKeys.gateIoSecret
      };
      
      schedulerLogger.apiCall('/cleanup-orphaned-orders', 'POST', {
        settle: cleanupInput.settle
      });
      
      console.log('Starting orphan order cleanup with validated API keys...');
      const result = await cleanupOrphanedOrders(cleanupInput);
      
      schedulerLogger.cleanup(result);
      
      if (result.cancelled_orders && result.cancelled_orders.length > 0) {
        console.log(`Cleaned up ${result.cancelled_orders.length} orphan orders:`, 
          result.cancelled_orders.map(o => `${o.contract}(${o.id})`));
      } else {
        console.log('No orphan orders found to cleanup');
      }
      
      if (result.cancellation_failures && result.cancellation_failures.length > 0) {
        console.warn('Some orders failed to cancel:', result.cancellation_failures);
      }
      
    } catch (error) {
      console.error('Error during orphan order cleanup:', error);
      schedulerLogger.log('ERROR', 'CLEANUP', 'Orphan order cleanup failed', {}, error);
    }
  }

  async executeJobNow(jobId: string): Promise<void> {
    const jobs = await database.getScheduledJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    if (!job.isActive) {
      throw new Error('Job is not active');
    }
    await this.executeJob(job);
  }

  private async getApiKeysFromDatabase(): Promise<{ gateIoKey: string; gateIoSecret: string }> {
    try {
      // Use direct database call instead of HTTP fetch to avoid server-side fetch issues
      const apiKeys = await database.getApiKeys();
      
      if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) {
        console.warn('API keys not found in database');
        return { gateIoKey: '', gateIoSecret: '' };
      }
      
      // Validate that keys are not placeholder values
      if (apiKeys.gateIoKey.includes('your_gate_io') || apiKeys.gateIoSecret.includes('your_gate_io')) {
        console.warn('API keys appear to be placeholder values');
        return { gateIoKey: '', gateIoSecret: '' };
      }
      
      return {
        gateIoKey: apiKeys.gateIoKey,
        gateIoSecret: apiKeys.gateIoSecret
      };
    } catch (error) {
      console.error('Error retrieving API keys from database:', error);
      return { gateIoKey: '', gateIoSecret: '' };
    }
  }

  private async validateApiKeys(apiKey: string, apiSecret: string): Promise<boolean> {
    if (!apiKey || !apiSecret) return false;
    if (apiKey.length < 10 || apiSecret.length < 10) return false;
    if (apiKey.includes('your_gate_io') || apiSecret.includes('your_gate_io')) return false;
    return true;
  }
}

// Singleton instance
export const schedulerService = new SchedulerService();
