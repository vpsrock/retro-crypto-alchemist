import * as database from './database';
import { discoverContracts, type DiscoverContractsInput } from '../ai/flows/discover-contracts';
import { analyzeTradeRecommendations, analyzeTradeRecommendationsWithLogger } from '../ai/flows/analyze-trade-recommendations';
import { cleanupOrphanedOrders, placeTradeStrategy } from '../ai/flows/trade-management';
import { schedulerLogger } from '../lib/scheduler-logs';
import { listPositions, listPriceTriggeredOrders, closePosition } from './gateio';

// Re-export types from database
export type { ScheduledJob, TradePosition, SchedulerStats } from './database';

interface JobExecutionContext {
  jobId: string;
  interval: string;
  profilesConfig: DiscoverContractsInput[];
  tradeSizeUsd: number;
  leverage: number;
  threshold: number;
  enhancedAnalysisEnabled: boolean;
}

class SchedulerService {
  private static instance: SchedulerService | null = null;
  private runningJobs: Set<string> = new Set();
  private jobIntervals: Map<string, NodeJS.Timeout> = new Map();
  private positionMonitorInterval?: NodeJS.Timeout;
  private orphanCleanupInterval?: NodeJS.Timeout;
  private dbSyncInterval?: NodeJS.Timeout;
  private isInitialized = false;

  // Private constructor for singleton pattern
  private constructor() {}

  public static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

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
    
    // Start database synchronization
    this.startDatabaseSync();
    
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

    // Also run immediately if it's the first time, overdue, or just activated
    const shouldRunNow = !job.lastRun || 
      (job.nextRun && now >= job.nextRun) ||
      (!job.nextRun && job.lastRun); // Handle reactivated jobs that have run before
    
    if (shouldRunNow) {
      console.log(`Running job ${job.id} immediately as it is new, overdue, or just activated...`);
      // Use setImmediate to run after the current event loop cycle completes
      setImmediate(() => this.executeJob(job));
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
    // Re-fetch job from DB to ensure it's still active
    const currentJob = await database.getScheduledJobById(job.id);

    if (!currentJob || !currentJob.isActive) {
      schedulerLogger.log('INFO', 'SCHEDULER', `Job ${job.id} is no longer active, unscheduling`, { jobId: job.id });
      console.log(`Job ${job.id} (${job.name}) is no longer active. Unscheduling...`);
      await this.unscheduleJob(job.id);
      return;
    }
    
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

      // OPTIMIZATION: Exclude contracts with open positions to reduce AI token costs and avoid redundant trades
      let filteredContracts = allDiscoveredContracts;
      try {
        schedulerLogger.log('INFO', 'ANALYSIS', 'Fetching open positions from Gate.io API to exclude contracts', { 
          jobId: job.id,
          totalDiscovered: allDiscoveredContracts.length 
        });

        // Get API keys for fetching positions
        const apiKeys = await this.getApiKeysFromDatabase();
        if (!await this.validateApiKeys(apiKeys.gateIoKey, apiKeys.gateIoSecret)) {
          schedulerLogger.log('WARN', 'ANALYSIS', 'Skipping position filtering: Invalid Gate.io API keys', { jobId: job.id });
          console.warn('Skipping position filtering: Invalid Gate.io API keys.');
        } else {
          // Fetch open positions from Gate.io for both USDT and BTC settle markets
          const [usdtPositions, btcPositions] = await Promise.all([
            listPositions('usdt', apiKeys.gateIoKey, apiKeys.gateIoSecret).catch(e => {
              schedulerLogger.log('ERROR', 'ANALYSIS', 'Failed to fetch USDT positions from Gate.io', { jobId: job.id }, e);
              console.error('Failed to fetch USDT positions from Gate.io:', e);
              return []; // Return empty array on error to not fail the whole job
            }),
            listPositions('btc', apiKeys.gateIoKey, apiKeys.gateIoSecret).catch(e => {
              schedulerLogger.log('ERROR', 'ANALYSIS', 'Failed to fetch BTC positions from Gate.io', { jobId: job.id }, e);
              console.error('Failed to fetch BTC positions from Gate.io:', e);
              return []; // Return empty array on error
            })
          ]);

          const allOpenPositions = [...(usdtPositions || []), ...(btcPositions || [])];
          const openContracts = new Set(allOpenPositions.map(pos => pos.contract));

          schedulerLogger.log('INFO', 'ANALYSIS', `Found ${allOpenPositions.length} open positions on Gate.io`, {
            openContracts: Array.from(openContracts),
          });

          const contractsToExclude = allDiscoveredContracts.filter(c => openContracts.has(c.contract));
          filteredContracts = allDiscoveredContracts.filter(c => !openContracts.has(c.contract));

          if (contractsToExclude.length > 0) {
            schedulerLogger.log('INFO', 'ANALYSIS', `Excluded ${contractsToExclude.length} contracts with open positions`, {
              excludedContracts: contractsToExclude.map(c => c.contract),
              remainingContracts: filteredContracts.length,
              tokensSaved: `~${contractsToExclude.length * 4000} tokens (estimated)`
            });
            
            console.log(`Excluded ${contractsToExclude.length} contracts with open positions: [${contractsToExclude.map(c => c.contract).join(', ')}]`);
            console.log(`Remaining ${filteredContracts.length} contracts for analysis (saved ~${contractsToExclude.length * 4000} AI tokens)`);
          } else {
            schedulerLogger.log('INFO', 'ANALYSIS', 'No contracts excluded - no open positions found for discovered contracts');
            console.log('No contracts excluded - no open positions match discovered contracts');
          }
        }
      } catch (filterError) {
        // Log error but don't fail the entire job - proceed with all discovered contracts
        schedulerLogger.log('ERROR', 'ANALYSIS', 'Failed to fetch open positions for filtering, proceeding with all contracts', {
          jobId: job.id,
          totalContracts: allDiscoveredContracts.length
        }, filterError);
        
        console.error('Error fetching open positions for filtering (proceeding with all contracts):', filterError);
        filteredContracts = allDiscoveredContracts; // Fallback to all contracts
      }

      if (filteredContracts.length === 0) {
        console.log(`All discovered contracts have open positions - no contracts to analyze for job ${job.id}`);
        schedulerLogger.log('INFO', 'ANALYSIS', 'All discovered contracts have open positions - skipping analysis', { jobId: job.id });
        await database.updateJobLastRun(job.id);
        const duration = Date.now() - startTime;
        schedulerLogger.jobComplete(job.id, duration, { contractsFound: allDiscoveredContracts.length, contractsFiltered: allDiscoveredContracts.length, tradesExecuted: 0 });
        return;
      }

      // Run analysis with concurrency (parallel processing like manual)
      const executionContext: JobExecutionContext = {
        jobId: job.id,
        interval: job.interval,
        profilesConfig: [discoveryConfig],
        tradeSizeUsd: job.tradeSizeUsd,
        leverage: job.leverage,
        threshold: job.threshold,
        enhancedAnalysisEnabled: job.enhancedAnalysisEnabled || false
      };

      const tradesExecuted = await this.processContractsWithConcurrency(filteredContracts, executionContext, job.concurrency || 10);

      // Update job run time
      await database.updateJobLastRun(job.id);
      
      // Update next run time
      const nextRun = Date.now() + this.parseInterval(job.scheduleInterval);
      await database.updateJobNextRun(job.id, nextRun);

      const duration = Date.now() - startTime;
      schedulerLogger.jobComplete(job.id, duration, { 
        contractsFound: allDiscoveredContracts.length, 
        contractsAnalyzed: filteredContracts.length,
        contractsExcluded: allDiscoveredContracts.length - filteredContracts.length,
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
        tickerData: contractInfo.tickerData,
        enhancedAnalysisEnabled: context.enhancedAnalysisEnabled || false
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

  /**
   * Synchronize a specific job from database - handles creation, activation, deactivation, deletion
   */
  async syncJobFromDatabase(jobId: string): Promise<void> {
    try {
      schedulerLogger.log('INFO', 'SCHEDULER', `Syncing job ${jobId} from database`);
      
      const job = await database.getScheduledJobById(jobId);
      
      if (!job) {
        // Job was deleted - unschedule it
        schedulerLogger.log('INFO', 'SCHEDULER', `Job ${jobId} not found in database, unscheduling`);
        await this.unscheduleJob(jobId);
        return;
      }
      
      const isCurrentlyScheduled = this.jobIntervals.has(jobId);
      
      if (job.isActive && !isCurrentlyScheduled) {
        // Job is active but not scheduled - schedule it
        schedulerLogger.log('INFO', 'SCHEDULER', `Job ${jobId} is active but not scheduled, scheduling now`);
        await this.scheduleJob(job);
      } else if (!job.isActive && isCurrentlyScheduled) {
        // Job is inactive but scheduled - unschedule it
        schedulerLogger.log('INFO', 'SCHEDULER', `Job ${jobId} is inactive but scheduled, unscheduling now`);
        await this.unscheduleJob(jobId);
      } else if (job.isActive && isCurrentlyScheduled) {
        // Job is active and scheduled - check if it needs rescheduling (schedule interval might have changed)
        schedulerLogger.log('DEBUG', 'SCHEDULER', `Job ${jobId} is active and scheduled, checking for updates`);
        // For simplicity, we'll reschedule it to pick up any configuration changes
        await this.unscheduleJob(jobId);
        await this.scheduleJob(job);
      }
      
      schedulerLogger.log('SUCCESS', 'SCHEDULER', `Job ${jobId} synchronized successfully`);
    } catch (error) {
      schedulerLogger.log('ERROR', 'SCHEDULER', `Failed to sync job ${jobId}`, { jobId }, error);
      console.error(`Error syncing job ${jobId}:`, error);
    }
  }

  /**
   * Periodic database synchronization to catch any missed changes
   */
  private startDatabaseSync(): void {
    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
    }
    
    schedulerLogger.log('INFO', 'SCHEDULER', 'Starting periodic database synchronization (every 60 seconds)');
    console.log('Starting periodic database synchronization...');
    
    // Sync with database every 60 seconds to catch any missed changes
    this.dbSyncInterval = setInterval(async () => {
      await this.syncAllJobsFromDatabase();
    }, 60000);

    // Also run after 10 seconds on startup
    setTimeout(() => this.syncAllJobsFromDatabase(), 10000);
  }

  /**
   * Sync all jobs from database
   */
  private async syncAllJobsFromDatabase(): Promise<void> {
    try {
      schedulerLogger.log('DEBUG', 'SCHEDULER', 'Running periodic database sync');
      
      const dbJobs = await database.getScheduledJobs();
      const scheduledJobIds = new Set(this.jobIntervals.keys());
      const dbJobIds = new Set(dbJobs.map(j => j.id));
      
      // Check for new or updated jobs
      for (const job of dbJobs) {
        if (job.isActive && !scheduledJobIds.has(job.id)) {
          schedulerLogger.log('INFO', 'SCHEDULER', `Found new active job during sync: ${job.id}`, { jobId: job.id });
          await this.scheduleJob(job);
        } else if (!job.isActive && scheduledJobIds.has(job.id)) {
          schedulerLogger.log('INFO', 'SCHEDULER', `Found deactivated job during sync: ${job.id}`, { jobId: job.id });
          await this.unscheduleJob(job.id);
        }
      }
      
      // Check for deleted jobs
      for (const scheduledJobId of scheduledJobIds) {
        if (!dbJobIds.has(scheduledJobId)) {
          schedulerLogger.log('INFO', 'SCHEDULER', `Found deleted job during sync: ${scheduledJobId}`, { jobId: scheduledJobId });
          await this.unscheduleJob(scheduledJobId);
        }
      }
      
      schedulerLogger.log('DEBUG', 'SCHEDULER', 'Periodic database sync completed', {
        totalDbJobs: dbJobs.length,
        activeDbJobs: dbJobs.filter(j => j.isActive).length,
        scheduledJobs: scheduledJobIds.size
      });
    } catch (error) {
      schedulerLogger.log('ERROR', 'SCHEDULER', 'Database sync failed', {}, error);
      console.error('Database sync error:', error);
    }
  }

  /**
   * Force immediate execution of a job (for manual triggers)
   */
  async executeJobNow(jobId: string): Promise<void> {
    const jobs = await database.getScheduledJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    if (!job.isActive) {
      throw new Error('Job is not active');
    }
    
    schedulerLogger.log('INFO', 'SCHEDULER', `Manual execution triggered for job ${jobId}`);
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

  /**
   * Start orphan order cleanup and position safety service
   */
  private startOrphanOrderCleanup(): void {
    if (this.orphanCleanupInterval) {
      clearInterval(this.orphanCleanupInterval);
    }
    
    console.log('Starting orphan order cleanup and position safety service...');
    schedulerLogger.log('INFO', 'SCHEDULER', 'Starting orphan order cleanup and position safety service (every 10 minutes)');
    
    // Clean up orphan orders every 10 minutes
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanOrders();
    }, 10 * 60 * 1000);

    // Also run after 30 seconds on startup
    setTimeout(() => this.cleanupOrphanOrders(), 30000);
  }

  /**
   * Execute orphan order cleanup and position safety check
   */
  private async cleanupOrphanOrders(): Promise<void> {
    try {
      schedulerLogger.log('INFO', 'CLEANUP', 'Starting orphan order cleanup and position safety check');
      console.log('Running orphan order cleanup and position safety check...');
      
      // Get API keys directly from database (no env var fallback)
      const apiKeys = await this.getApiKeysFromDatabase();
      
      if (!await this.validateApiKeys(apiKeys.gateIoKey, apiKeys.gateIoSecret)) {
        console.log('Skipping cleanup - Valid Gate.io API keys not available');
        schedulerLogger.log('WARN', 'CLEANUP', 'Skipping cleanup - API keys not available');
        return;
      }
      
      const cleanupInput = {
        settle: 'usdt' as const,
        apiKey: apiKeys.gateIoKey,
        apiSecret: apiKeys.gateIoSecret
      };
      
      // 1. Run regular orphan order cleanup
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
      
      // 2. Run position safety check
      await this.performPositionSafetyCheck(apiKeys.gateIoKey, apiKeys.gateIoSecret);
      
    } catch (error) {
      console.error('Error during cleanup and safety check:', error);
      schedulerLogger.log('ERROR', 'CLEANUP', 'Cleanup and safety check failed', {}, error);
    }
  }

  /**
   * Check position safety - ensure each open position has exactly 2 conditional orders (TP/SL)
   * If not, close the position to be safe
   */
  private async performPositionSafetyCheck(apiKey: string, apiSecret: string): Promise<void> {
    try {
      console.log('Starting position safety check...');
      schedulerLogger.log('INFO', 'CLEANUP', 'Starting position safety check');
      
      // Check both USDT and BTC markets
      const markets = ['usdt', 'btc'] as const;
      let totalPositions = 0;
      let totalUnsafePositions = 0;
      let totalClosedPositions = 0;
      
      for (const settle of markets) {
        try {
          console.log(`Checking ${settle.toUpperCase()} positions...`);
          
          // Fetch open positions
          const positions = await listPositions(settle, apiKey, apiSecret);
          const openPositions = positions.filter((pos: any) => parseFloat(pos.size) !== 0);
          
          if (openPositions.length === 0) {
            console.log(`No open ${settle.toUpperCase()} positions found`);
            continue;
          }
          
          console.log(`Found ${openPositions.length} open ${settle.toUpperCase()} positions`);
          totalPositions += openPositions.length;
          
          // Fetch open conditional orders
          const conditionalOrders = await listPriceTriggeredOrders(settle, 'open', apiKey, apiSecret);
          
          console.log(`Found ${conditionalOrders.length} open ${settle.toUpperCase()} conditional orders`);
          
          // Group conditional orders by contract
          const ordersByContract: { [contract: string]: any[] } = {};
          conditionalOrders.forEach((order: any) => {
            const contract = order.initial?.contract?.trim();
            if (contract) {
              if (!ordersByContract[contract]) {
                ordersByContract[contract] = [];
              }
              ordersByContract[contract].push(order);
            }
          });
          
          // Check each position for safety
          const unsafePositions = [];
          
          for (const position of openPositions) {
            const contract = position.contract;
            const orders = ordersByContract[contract] || [];
            
            console.log(`Checking ${contract}: position size=${position.size}, conditional orders=${orders.length}`);
            
            if (orders.length !== 2) {
              console.log(`⚠️  UNSAFE POSITION: ${contract} has ${orders.length}/2 conditional orders`);
              unsafePositions.push({
                contract,
                position,
                orderCount: orders.length,
                settle
              });
            } else {
              console.log(`✅ Safe: ${contract} has proper TP/SL orders`);
            }
          }
          
          totalUnsafePositions += unsafePositions.length;
          
          // Close unsafe positions
          if (unsafePositions.length > 0) {
            console.log(`\n🚨 Found ${unsafePositions.length} UNSAFE ${settle.toUpperCase()} positions! Closing them for safety...`);
            schedulerLogger.log('WARN', 'CLEANUP', `Found ${unsafePositions.length} unsafe ${settle} positions`, {
              unsafePositions: unsafePositions.map(p => ({
                contract: p.contract,
                size: p.position.size,
                orderCount: p.orderCount
              }))
            });
            
            for (const unsafe of unsafePositions) {
              try {
                const size = Math.abs(parseFloat(unsafe.position.size));
                const isLong = parseFloat(unsafe.position.size) > 0;
                
                console.log(`Closing ${unsafe.contract}: size=${size}, isLong=${isLong}`);
                schedulerLogger.log('INFO', 'CLEANUP', `Closing unsafe position ${unsafe.contract}`, {
                  contract: unsafe.contract,
                  size: unsafe.position.size,
                  orderCount: unsafe.orderCount,
                  settle: unsafe.settle
                });
                
                const closeResult = await closePosition(
                  unsafe.settle,
                  unsafe.contract,
                  size.toString(),
                  isLong,
                  apiKey,
                  apiSecret
                );
                
                console.log(`✅ Successfully closed ${unsafe.contract}:`, closeResult);
                totalClosedPositions++;
                
                schedulerLogger.log('INFO', 'CLEANUP', `Successfully closed unsafe position ${unsafe.contract}`, {
                  result: closeResult
                });
                
              } catch (closeError: any) {
                console.error(`❌ Failed to close ${unsafe.contract}:`, closeError.message);
                schedulerLogger.log('ERROR', 'CLEANUP', `Failed to close unsafe position ${unsafe.contract}`, {
                  error: closeError.message
                });
              }
            }
          } else {
            console.log(`✅ All ${settle.toUpperCase()} positions are safe`);
          }
          
        } catch (marketError: any) {
          console.error(`Error checking ${settle} positions:`, marketError.message);
          schedulerLogger.log('ERROR', 'CLEANUP', `Error checking ${settle} positions`, {
            error: marketError.message
          });
        }
      }
      
      // Summary
      console.log(`\n=== Position Safety Check Summary ===`);
      console.log(`Total positions checked: ${totalPositions}`);
      console.log(`Unsafe positions found: ${totalUnsafePositions}`);
      console.log(`Positions closed: ${totalClosedPositions}`);
      
      if (totalUnsafePositions === 0) {
        console.log(`✅ All positions are safe!`);
      } else if (totalClosedPositions === totalUnsafePositions) {
        console.log(`✅ All unsafe positions were successfully closed!`);
      } else {
        console.log(`⚠️  Some positions could not be closed - check logs for details`);
      }
      
      schedulerLogger.log('INFO', 'CLEANUP', 'Position safety check completed', {
        totalPositions,
        unsafePositions: totalUnsafePositions,
        closedPositions: totalClosedPositions
      });
      
    } catch (error: any) {
      console.error('Error during position safety check:', error);
      schedulerLogger.log('ERROR', 'CLEANUP', 'Position safety check failed', {}, error);
    }
  }

  /**
   * Graceful shutdown of the scheduler service
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down scheduler service...');
    schedulerLogger.log('INFO', 'SCHEDULER', 'Scheduler service shutdown initiated');
    
    // Clear all job intervals
    for (const [jobId, interval] of this.jobIntervals) {
      clearInterval(interval);
      schedulerLogger.log('INFO', 'SCHEDULER', `Cleared interval for job ${jobId}`);
    }
    this.jobIntervals.clear();

    // Clear position monitoring
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
      schedulerLogger.log('INFO', 'SCHEDULER', 'Stopped position monitoring');
    }

    // Clear orphan order cleanup
    if (this.orphanCleanupInterval) {
      clearInterval(this.orphanCleanupInterval);
      schedulerLogger.log('INFO', 'SCHEDULER', 'Stopped orphan order cleanup');
    }

    // Clear database sync
    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
      schedulerLogger.log('INFO', 'SCHEDULER', 'Stopped database synchronization');
    }

    this.isInitialized = false;
    schedulerLogger.log('INFO', 'SCHEDULER', 'Scheduler service shut down successfully');
    console.log('Scheduler service shut down');
  }
}

// Singleton instance
export const schedulerService = SchedulerService.getInstance();
export default schedulerService;
