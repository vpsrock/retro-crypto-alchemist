import * as database from './database';
import { discoverContracts, type DiscoverContractsInput } from '../ai/flows/discover-contracts';
import { analyzeTradeRecommendations } from '../ai/flows/analyze-trade-recommendations';
import { cleanupOrphanedOrders } from '../ai/flows/trade-management';

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
    if (this.runningJobs.has(job.id)) {
      console.log(`Job ${job.id} is already running, skipping...`);
      return;
    }

    this.runningJobs.add(job.id);
    console.log(`Executing job ${job.id} (${job.name})...`);

    try {
      const startTime = Date.now();
      
      // Build discovery config for each profile
      const discoveryConfigs: DiscoverContractsInput[] = job.profiles.map(profile => ({
        profiles: [profile as any], // Type assertion since profiles come from database as strings
        settle: job.settle as 'usdt' | 'btc',
        contractsPerProfile: job.contractsPerProfile,
        minVolume: job.minVolume,
        sortBy: 'score' as const
      }));

      // Run discovery for all profiles
      const allDiscoveredContracts: Array<{contract: string, tickerData: any, foundByProfile: string}> = [];
      
      for (const config of discoveryConfigs) {
        try {
          console.log(`Running discovery for profile: ${config.profiles[0]}`);
          const discoveryResults = await discoverContracts(config);
          allDiscoveredContracts.push(...discoveryResults.contracts);
        } catch (error) {
          console.error(`Error in discovery for profile ${config.profiles[0]}:`, error);
        }
      }

      console.log(`Discovery found ${allDiscoveredContracts.length} contracts across all profiles`);

      // Run discovery for all profiles and update job status
      const executionContext: JobExecutionContext = {
        jobId: job.id,
        interval: job.interval,
        profilesConfig: discoveryConfigs,
        tradeSizeUsd: job.tradeSizeUsd,
        leverage: job.leverage,
        threshold: job.threshold
      };

      for (const contractInfo of allDiscoveredContracts) {
        try {
          await this.analyzeAndTrade(contractInfo, executionContext);
        } catch (error) {
          console.error(`Error analyzing contract ${contractInfo.contract}:`, error);
        }
      }

      if (allDiscoveredContracts.length === 0) {
        console.log(`No contracts discovered for job ${job.id}`);
        await database.updateJobLastRun(job.id);
        return;
      }

      // Update job run time
      await database.updateJobLastRun(job.id);

      console.log(`Job ${job.id} completed successfully.`);

    } catch (error) {
      console.error(`Error executing job ${job.id}:`, error);
      await database.updateJobLastRun(job.id);
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private async analyzeAndTrade(
    contractInfo: {contract: string, tickerData: any, foundByProfile: string}, 
    context: JobExecutionContext
  ): Promise<void> {
    try {
      console.log(`Analyzing contract ${contractInfo.contract} found by ${contractInfo.foundByProfile}`);

      // Find the appropriate discovery config for this contract's profile
      const profileConfig = context.profilesConfig.find(config => 
        config.profiles.includes(contractInfo.foundByProfile as any)
      );

      if (!profileConfig) {
        console.error(`No profile config found for ${contractInfo.foundByProfile}`);
        return;
      }

      // Prepare analysis input
      const analysisInput = {
        settle: profileConfig.settle,
        contract: contractInfo.contract,
        interval: context.interval, // Use interval from context
        modelConfig: {
          id: 'default',
          name: 'Default Model',
          provider: 'openai' as const,
          modelId: 'gpt-4',
          modelType: 'standard' as const,
          enabled: true
        },
        promptTemplate: 'Analyze this futures contract for trading opportunities',
        tickerData: contractInfo.tickerData
      };

      const analysisResult = await analyzeTradeRecommendations(analysisInput);

      if (!analysisResult) {
        console.log(`No analysis result for ${contractInfo.contract}`);
        return;
      }

      console.log(`Analysis for ${contractInfo.contract}: confidence=${analysisResult.confidence_score}, action=${analysisResult.trade_call}`);

      // Check if confidence meets threshold for auto-trading
      if (analysisResult.confidence_score >= context.threshold) {
        await this.executeAutoTrade(contractInfo, analysisResult, context);
      } else {
        console.log(`Confidence ${analysisResult.confidence_score} below threshold ${context.threshold} for ${contractInfo.contract}`);
      }

    } catch (error) {
      console.error(`Error analyzing contract ${contractInfo.contract}:`, error);
    }
  }

  private async executeAutoTrade(
    contractInfo: {contract: string, tickerData: any, foundByProfile: string},
    analysisResult: any,
    context: JobExecutionContext
  ): Promise<void> {
    try {
      console.log(`Executing auto-trade for ${contractInfo.contract} with confidence ${analysisResult.confidence_score}`);
      
      // Create position entry
      const position: Omit<database.TradePosition, 'id'> = {
        jobId: context.jobId,
        contract: contractInfo.contract,
        foundByProfile: contractInfo.foundByProfile,
        tradeCall: analysisResult.trade_call.toLowerCase(),
        entryPrice: analysisResult.current_price,
        currentPrice: analysisResult.current_price,
        size: context.tradeSizeUsd / analysisResult.current_price, // Convert USD to contract size
        leverage: context.leverage,
        tradeSizeUsd: context.tradeSizeUsd,
        confidenceScore: Math.round(analysisResult.confidence_score),
        status: 'opening',
        openedAt: Date.now(),
        unrealizedPnl: 0,
        lastUpdated: Date.now()
      };

      const positionId = await database.createTradePosition(position);
      console.log(`Created position ${positionId} for ${contractInfo.contract}`);

      // In a real implementation, you would place the actual order here
      // For now, we'll simulate the trade completion
      setTimeout(async () => {
        try {
          // Position is auto-set to 'open' status when created
          console.log(`Position ${positionId} opened successfully`);
        } catch (error) {
          console.error(`Error updating position status for ${positionId}:`, error);
        }
      }, 2000);

    } catch (error) {
      console.error(`Error executing auto-trade for ${contractInfo.contract}:`, error);
      throw error;
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
      console.log('Running orphan order cleanup...');
      
      // Get API keys from localStorage equivalent (we'll need to store them in database or config)
      // For now, we'll skip if no API keys are available
      // TODO: Store API keys in database for server-side access
      
      const cleanupInput = {
        settle: 'usdt' as const,
        apiKey: process.env.GATE_IO_API_KEY || '',
        apiSecret: process.env.GATE_IO_SECRET || ''
      };
      
      if (!cleanupInput.apiKey || !cleanupInput.apiSecret) {
        console.log('Skipping orphan order cleanup - Gate.io API keys not available');
        return;
      }
      
      const result = await cleanupOrphanedOrders(cleanupInput);
      
      if (result.cancelled_orders && result.cancelled_orders.length > 0) {
        console.log(`Cleaned up ${result.cancelled_orders.length} orphan orders:`, 
          result.cancelled_orders.map(o => o.id));
      } else {
        console.log('No orphan orders found to cleanup');
      }
      
    } catch (error) {
      console.error('Error during orphan order cleanup:', error);
    }
  }
}

// Singleton instance
export const schedulerService = new SchedulerService();
