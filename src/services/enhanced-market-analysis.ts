// This is a server-side file.
'use server';

/**
 * Enhanced Market Analysis Service
 * Provides advanced market microstructure analysis for Gate.io futures contracts
 * 
 * Integrates 4 high-impact APIs:
 * 1. Liquidation History (Tier 1 - Impact: 10/10)
 * 2. Funding Rate History (Tier 1 - Impact: 9/10) 
 * 3. Trading History (Tier 2 - Impact: 8/10)
 * 4. Premium Index K-Line (Tier 2 - Impact: 7/10)
 */

const host = "https://api.gateio.ws";
const prefix = "/api/v4";

// Configuration for enhanced analysis
const ENHANCED_CONFIG = {
  LOOKBACK_HOURS: 24,
  LIQUIDATION_LOOKBACK_HOURS: 1, // API limitation: max 1 hour window
  FUNDING_HISTORY_LIMIT: 50,
  TRADES_LIMIT: 200,
  PREMIUM_INTERVAL: '1h',
  PREMIUM_LIMIT: 24,
  LARGE_TRADE_THRESHOLD_USD: 100000, // Trades above this are considered "large"
  LIQUIDATION_CLUSTER_THRESHOLD: 2, // Min liquidations at same price to form cluster
};

// Types for enhanced analysis
export interface LiquidationAnalysis {
  totalLiquidations: number;
  liquidationVolume: number;
  avgLiquidationSize: number;
  recentLiquidationRate: number;
  liquidationMomentum: 'increasing' | 'decreasing' | 'stable' | 'none';
  liquidationPressure: 'long_squeeze' | 'short_squeeze' | 'balanced' | 'none';
  longLiquidationVolume: number;
  shortLiquidationVolume: number;
  liquidationClusters: Array<{
    price: number;
    count: number;
    volume: number;
    liquidations: any[];
  }>;
  recentVsPreviousHour: {
    recent: { count: number; volume: number };
    previous: { count: number; volume: number };
  };
}

export interface FundingAnalysis {
  currentRate: number;
  currentRatePercent: string;
  avgRate24h: number;
  rateVolatility: number;
  extremeRateScore: number;
  sentimentSignal: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish';
  rateTrend: 'increasing' | 'decreasing' | 'stable';
  meanReversionScore: number;
  rateHistory: {
    recent: number[];
    older: number[];
    recentAvg: number;
    olderAvg: number;
  };
}

export interface TradingAnalysis {
  totalTrades: number;
  totalVolume: number;
  avgTradeSize: number;
  buyPressure: number;
  buyVolume: number;
  sellVolume: number;
  largeTrades: Array<{
    id: number;
    value: number;
    type: 'buy' | 'sell';
    [key: string]: any;
  }>;
  largeTradeStats: {
    count: number;
    buyCount: number;
    sellCount: number;
    buyVolume: number;
    sellVolume: number;
    avgSize: number;
  };
  institutionalActivity: number;
  volumeProfile: Array<{
    price: number;
    volume: number;
    trades: number;
  }>;
  marketMicrostructure: {
    avgTimeBetweenTrades: number;
    tradeFrequency: number;
  };
}

export interface PremiumAnalysis {
  currentPremium: number;
  currentPremiumPercent: string;
  avgPremium24h: number;
  premiumVolatility: number;
  premiumTrend: 'increasing' | 'decreasing' | 'stable';
  marketStress: number;
  arbitrageSignal: boolean;
  basisMomentum: number;
  premiumStats: {
    max: number;
    min: number;
    range: number;
    recent: number[];
    older: number[];
  };
}

export interface EnhancedMetrics {
  liquidationRisk: number;
  liquidationMomentum: string;
  keyLiquidationLevels: number[];
  sentimentSignal: string;
  fundingExtremity: number;
  meanReversionPotential: number;
  institutionalActivity: number;
  buyPressure: number;
  marketLiquidity: number;
  premiumStress: number;
  arbitrageOpportunity: boolean;
  basisTrend: string;
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  riskLevel: number;
  signalStrength: number;
}

export interface AIPromptData {
  liquidation_momentum: string;
  liquidation_clusters: number[];
  liquidation_pressure: string;
  liquidation_rate_1h: number;
  key_liquidation_levels: number[];
  funding_sentiment: string;
  funding_extremity: number;
  funding_trend: string;
  institutional_activity: number;
  buy_pressure_ratio: number;
  market_stress_level: number;
  premium_volatility: number;
  arbitrage_opportunity: boolean;
  mean_reversion_potential: number;
  overall_sentiment: string;
  risk_score: number;
  signal_strength: number;
  cascade_risk_present: boolean;
}

export interface EnhancedAnalysisResult {
  contract: string;
  timestamp: string;
  rawData: {
    liquidations: LiquidationAnalysis | null;
    funding: FundingAnalysis | null;
    trading: TradingAnalysis | null;
    premium: PremiumAnalysis | null;
  };
  enhancedMetrics: EnhancedMetrics;
  aiPromptData: AIPromptData;
}

// Utility function to make API calls
async function makeApiCall(endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const queryString = Object.keys(params)
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  
  const url = `${host}${prefix}${endpoint}${queryString ? '?' + queryString : ''}`;
  
  console.log(`[ENHANCED-ANALYSIS] Fetching: ${endpoint}${queryString ? '?' + queryString : ''}`);
  
  try {
    const response = await fetch(url, { 
      headers: { 'Accept': 'application/json' },
      cache: 'no-store' // Ensure fresh data
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`[ENHANCED-ANALYSIS] API call failed for ${endpoint}:`, error);
    throw error;
  }
}

// Calculate timestamps for different lookback periods
function calculateTimestamps() {
  const now = Math.floor(Date.now() / 1000);
  const liquidationFrom = now - (ENHANCED_CONFIG.LIQUIDATION_LOOKBACK_HOURS * 3600);
  const tradingFrom = now - (ENHANCED_CONFIG.LOOKBACK_HOURS * 3600);
  return { now, liquidationFrom, tradingFrom };
}

// 1. LIQUIDATION ANALYSIS
export async function fetchLiquidationAnalysis(
  settle: string, 
  contract: string,
  schedulerLogger?: any
): Promise<LiquidationAnalysis | null> {
  console.log(`[ENHANCED-ANALYSIS] Starting liquidation analysis for ${contract}`);
  
  const { liquidationFrom, now } = calculateTimestamps();
  
  try {
    const liquidations = await makeApiCall(`/futures/${settle}/liq_orders`, {
      contract,
      from: liquidationFrom,
      to: now,
      limit: 1000
    });

    if (schedulerLogger) {
      schedulerLogger.log('DEBUG', 'LIQUIDATION_FETCH', `Fetched ${liquidations?.length || 0} liquidations for ${contract}`);
    }

    return analyzeLiquidations(liquidations);
  } catch (error: any) {
    console.error(`[ENHANCED-ANALYSIS] Liquidation fetch failed for ${contract}:`, error);
    if (schedulerLogger) {
      schedulerLogger.log('ERROR', 'LIQUIDATION_ERROR', `Failed to fetch liquidations for ${contract}: ${error?.message || 'Unknown error'}`);
    }
    return null;
  }
}

function analyzeLiquidations(liquidations: any[]): LiquidationAnalysis {
  if (!liquidations || liquidations.length === 0) {
    return {
      totalLiquidations: 0,
      liquidationVolume: 0,
      avgLiquidationSize: 0,
      liquidationClusters: [],
      liquidationMomentum: 'none',
      liquidationPressure: 'none',
      recentLiquidationRate: 0,
      longLiquidationVolume: 0,
      shortLiquidationVolume: 0,
      recentVsPreviousHour: {
        recent: { count: 0, volume: 0 },
        previous: { count: 0, volume: 0 }
      }
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 3600;
  const twoHoursAgo = now - 7200;

  // Basic metrics
  const totalLiquidations = liquidations.length;
  const totalVolume = liquidations.reduce((sum, liq) => sum + Math.abs(liq.size), 0);
  const avgSize = totalVolume / totalLiquidations;

  // Recent vs previous hour comparison
  const recentLiqs = liquidations.filter(liq => liq.time >= oneHourAgo);
  const previousHourLiqs = liquidations.filter(liq => liq.time >= twoHoursAgo && liq.time < oneHourAgo);
  
  const recentCount = recentLiqs.length;
  const previousCount = previousHourLiqs.length;
  const recentVolume = recentLiqs.reduce((sum, liq) => sum + Math.abs(liq.size), 0);
  const previousVolume = previousHourLiqs.reduce((sum, liq) => sum + Math.abs(liq.size), 0);

  // Liquidation momentum
  let momentum: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentCount > previousCount * 1.5) momentum = 'increasing';
  else if (recentCount < previousCount * 0.5) momentum = 'decreasing';

  // Liquidation pressure (long vs short)
  const longLiqs = liquidations.filter(liq => liq.size < 0); // Negative size = long liquidation
  const shortLiqs = liquidations.filter(liq => liq.size > 0); // Positive size = short liquidation
  const longVolume = longLiqs.reduce((sum, liq) => sum + Math.abs(liq.size), 0);
  const shortVolume = shortLiqs.reduce((sum, liq) => sum + Math.abs(liq.size), 0);

  let pressure: 'long_squeeze' | 'short_squeeze' | 'balanced' = 'balanced';
  if (longVolume > shortVolume * 2) pressure = 'long_squeeze';
  else if (shortVolume > longVolume * 2) pressure = 'short_squeeze';

  // Liquidation clusters (price levels with multiple liquidations)
  const priceGroups: Record<number, any> = {};
  liquidations.forEach(liq => {
    const priceLevel = Math.round(parseFloat(liq.order_price) * 100) / 100;
    if (!priceGroups[priceLevel]) {
      priceGroups[priceLevel] = { price: priceLevel, count: 0, volume: 0, liquidations: [] };
    }
    priceGroups[priceLevel].count++;
    priceGroups[priceLevel].volume += Math.abs(liq.size);
    priceGroups[priceLevel].liquidations.push(liq);
  });

  const clusters = Object.values(priceGroups)
    .filter(group => group.count >= ENHANCED_CONFIG.LIQUIDATION_CLUSTER_THRESHOLD)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  return {
    totalLiquidations,
    liquidationVolume: totalVolume,
    avgLiquidationSize: avgSize,
    recentLiquidationRate: recentCount / Math.max(previousCount, 1),
    liquidationMomentum: momentum,
    liquidationPressure: pressure,
    longLiquidationVolume: longVolume,
    shortLiquidationVolume: shortVolume,
    liquidationClusters: clusters,
    recentVsPreviousHour: {
      recent: { count: recentCount, volume: recentVolume },
      previous: { count: previousCount, volume: previousVolume }
    }
  };
}

// 2. FUNDING RATE ANALYSIS
export async function fetchFundingAnalysis(
  settle: string, 
  contract: string,
  schedulerLogger?: any
): Promise<FundingAnalysis | null> {
  console.log(`[ENHANCED-ANALYSIS] Starting funding rate analysis for ${contract}`);
  
  try {
    const fundingHistory = await makeApiCall(`/futures/${settle}/funding_rate`, {
      contract,
      limit: ENHANCED_CONFIG.FUNDING_HISTORY_LIMIT
    });

    if (schedulerLogger) {
      schedulerLogger.log('DEBUG', 'FUNDING_FETCH', `Fetched ${fundingHistory?.length || 0} funding rates for ${contract}`);
    }

    return analyzeFundingRates(fundingHistory);
  } catch (error: any) {
    console.error(`[ENHANCED-ANALYSIS] Funding rate fetch failed for ${contract}:`, error);
    if (schedulerLogger) {
      schedulerLogger.log('ERROR', 'FUNDING_ERROR', `Failed to fetch funding rates for ${contract}: ${error?.message || 'Unknown error'}`);
    }
    return null;
  }
}

function analyzeFundingRates(fundingHistory: any[]): FundingAnalysis {
  if (!fundingHistory || fundingHistory.length === 0) {
    return {
      currentRate: 0,
      currentRatePercent: '0.0000',
      avgRate24h: 0,
      rateVolatility: 0,
      extremeRateScore: 0,
      sentimentSignal: 'neutral',
      rateTrend: 'stable',
      meanReversionScore: 0,
      rateHistory: {
        recent: [],
        older: [],
        recentAvg: 0,
        olderAvg: 0
      }
    };
  }

  const rates = fundingHistory.map(f => parseFloat(f.r)).filter(r => !isNaN(r));
  const currentRate = rates[0] || 0;
  
  // Calculate statistics
  const avgRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  const variance = rates.reduce((sum, rate) => sum + Math.pow(rate - avgRate, 2), 0) / rates.length;
  const volatility = Math.sqrt(variance);
  
  // Extreme rate scoring (0-100)
  const extremeThreshold = 0.01; // 1% funding rate considered extreme
  const extremeRateScore = Math.min(100, (Math.abs(currentRate) / extremeThreshold) * 100);
  
  // Sentiment analysis
  let sentimentSignal: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish' = 'neutral';
  if (currentRate > 0.005) sentimentSignal = 'very_bullish'; // >0.5%
  else if (currentRate > 0.001) sentimentSignal = 'bullish'; // >0.1%
  else if (currentRate < -0.005) sentimentSignal = 'very_bearish'; // <-0.5%
  else if (currentRate < -0.001) sentimentSignal = 'bearish'; // <-0.1%
  
  // Rate trend (comparing recent vs older rates)
  const recentRates = rates.slice(0, Math.min(8, rates.length));
  const olderRates = rates.slice(8, Math.min(16, rates.length));
  
  const recentAvg = recentRates.reduce((sum, rate) => sum + rate, 0) / recentRates.length;
  const olderAvg = olderRates.length > 0 ? 
    olderRates.reduce((sum, rate) => sum + rate, 0) / olderRates.length : recentAvg;
  
  let rateTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentAvg > olderAvg * 1.2) rateTrend = 'increasing';
  else if (recentAvg < olderAvg * 0.8) rateTrend = 'decreasing';
  
  // Mean reversion potential
  const meanReversionScore = Math.abs(currentRate - avgRate) / (volatility || 0.0001);
  
  return {
    currentRate,
    currentRatePercent: (currentRate * 100).toFixed(4),
    avgRate24h: avgRate,
    rateVolatility: volatility,
    extremeRateScore: Math.round(extremeRateScore),
    sentimentSignal,
    rateTrend,
    meanReversionScore: Math.round(meanReversionScore * 100) / 100,
    rateHistory: {
      recent: recentRates,
      older: olderRates,
      recentAvg,
      olderAvg
    }
  };
}

// 3. TRADING HISTORY ANALYSIS
export async function fetchTradingAnalysis(
  settle: string, 
  contract: string,
  schedulerLogger?: any
): Promise<TradingAnalysis | null> {
  console.log(`[ENHANCED-ANALYSIS] Starting trading history analysis for ${contract}`);
  
  const { tradingFrom, now } = calculateTimestamps();
  
  try {
    const trades = await makeApiCall(`/futures/${settle}/trades`, {
      contract,
      from: tradingFrom,
      to: now,
      limit: ENHANCED_CONFIG.TRADES_LIMIT
    });

    if (schedulerLogger) {
      schedulerLogger.log('DEBUG', 'TRADING_FETCH', `Fetched ${trades?.length || 0} trades for ${contract}`);
    }

    return analyzeTradingHistory(trades);
  } catch (error: any) {
    console.error(`[ENHANCED-ANALYSIS] Trading history fetch failed for ${contract}:`, error);
    if (schedulerLogger) {
      schedulerLogger.log('ERROR', 'TRADING_ERROR', `Failed to fetch trading history for ${contract}: ${error?.message || 'Unknown error'}`);
    }
    return null;
  }
}

function analyzeTradingHistory(trades: any[]): TradingAnalysis {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      totalVolume: 0,
      avgTradeSize: 0,
      largeTrades: [],
      buyPressure: 0.5,
      buyVolume: 0,
      sellVolume: 0,
      volumeProfile: [],
      institutionalActivity: 0,
      largeTradeStats: {
        count: 0,
        buyCount: 0,
        sellCount: 0,
        buyVolume: 0,
        sellVolume: 0,
        avgSize: 0
      },
      marketMicrostructure: {
        avgTimeBetweenTrades: 0,
        tradeFrequency: 0
      }
    };
  }

  const totalTrades = trades.length;
  let totalVolume = 0;
  let buyVolume = 0;
  let sellVolume = 0;
  const largeTrades: any[] = [];
  const priceVolumeMap: Record<number, any> = {};

  trades.forEach(trade => {
    const size = Math.abs(trade.size);
    const price = parseFloat(trade.price);
    const value = size * price;
    
    totalVolume += size;
    
    // Determine buy/sell based on size sign (Gate.io convention)
    if (trade.size > 0) {
      buyVolume += size;
    } else {
      sellVolume += size;
    }
    
    // Identify large trades
    if (value >= ENHANCED_CONFIG.LARGE_TRADE_THRESHOLD_USD) {
      largeTrades.push({
        ...trade,
        value,
        type: trade.size > 0 ? 'buy' : 'sell'
      });
    }
    
    // Volume profile construction
    const priceLevel = Math.round(price * 100) / 100;
    if (!priceVolumeMap[priceLevel]) {
      priceVolumeMap[priceLevel] = { price: priceLevel, volume: 0, trades: 0 };
    }
    priceVolumeMap[priceLevel].volume += size;
    priceVolumeMap[priceLevel].trades++;
  });

  const avgTradeSize = totalVolume / totalTrades;
  const buyPressure = buyVolume / (buyVolume + sellVolume);
  
  // Volume profile (top 20 price levels by volume)
  const volumeProfile = Object.values(priceVolumeMap)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 20);
  
  // Institutional activity score (based on large trades frequency)
  const institutionalActivity = (largeTrades.length / totalTrades) * 100;
  
  // Large trades analysis
  const largeBuyTrades = largeTrades.filter(t => t.type === 'buy');
  const largeSellTrades = largeTrades.filter(t => t.type === 'sell');
  const largeBuyVolume = largeBuyTrades.reduce((sum, t) => sum + t.value, 0);
  const largeSellVolume = largeSellTrades.reduce((sum, t) => sum + t.value, 0);

  return {
    totalTrades,
    totalVolume,
    avgTradeSize,
    buyPressure,
    buyVolume,
    sellVolume,
    largeTrades: largeTrades.sort((a, b) => b.value - a.value).slice(0, 10), // Top 10 by value
    largeTradeStats: {
      count: largeTrades.length,
      buyCount: largeBuyTrades.length,
      sellCount: largeSellTrades.length,
      buyVolume: largeBuyVolume,
      sellVolume: largeSellVolume,
      avgSize: largeTrades.reduce((sum, t) => sum + t.value, 0) / largeTrades.length || 0
    },
    institutionalActivity: Math.round(institutionalActivity * 100) / 100,
    volumeProfile: volumeProfile.slice(0, 10), // Top 10 for display
    marketMicrostructure: {
      avgTimeBetweenTrades: trades.length > 1 ? 
        (trades[0].create_time - trades[trades.length - 1].create_time) / trades.length : 0,
      tradeFrequency: trades.length / (ENHANCED_CONFIG.LOOKBACK_HOURS || 1)
    }
  };
}

// 4. PREMIUM INDEX ANALYSIS
export async function fetchPremiumAnalysis(
  settle: string, 
  contract: string,
  schedulerLogger?: any
): Promise<PremiumAnalysis | null> {
  console.log(`[ENHANCED-ANALYSIS] Starting premium index analysis for ${contract}`);
  
  try {
    const premiumData = await makeApiCall(`/futures/${settle}/premium_index`, {
      contract,
      interval: ENHANCED_CONFIG.PREMIUM_INTERVAL,
      limit: ENHANCED_CONFIG.PREMIUM_LIMIT
    });

    if (schedulerLogger) {
      schedulerLogger.log('DEBUG', 'PREMIUM_FETCH', `Fetched ${premiumData?.length || 0} premium data points for ${contract}`);
    }

    return analyzePremiumIndex(premiumData);
  } catch (error: any) {
    console.error(`[ENHANCED-ANALYSIS] Premium index fetch failed for ${contract}:`, error);
    if (schedulerLogger) {
      schedulerLogger.log('ERROR', 'PREMIUM_ERROR', `Failed to fetch premium index for ${contract}: ${error?.message || 'Unknown error'}`);
    }
    return null;
  }
}

function analyzePremiumIndex(premiumData: any[]): PremiumAnalysis {
  if (!premiumData || premiumData.length === 0) {
    return {
      currentPremium: 0,
      currentPremiumPercent: '0.0000',
      avgPremium24h: 0,
      premiumVolatility: 0,
      premiumTrend: 'stable',
      marketStress: 0,
      arbitrageSignal: false,
      basisMomentum: 0,
      premiumStats: {
        max: 0,
        min: 0,
        range: 0,
        recent: [],
        older: []
      }
    };
  }

  const premiums = premiumData.map(p => parseFloat(p.c)).filter(p => !isNaN(p));
  const currentPremium = premiums[0] || 0;
  
  // Basic statistics
  const avgPremium = premiums.reduce((sum, p) => sum + p, 0) / premiums.length;
  const variance = premiums.reduce((sum, p) => sum + Math.pow(p - avgPremium, 2), 0) / premiums.length;
  const volatility = Math.sqrt(variance);
  
  // Premium trend analysis
  const recentPremiums = premiums.slice(0, Math.min(6, premiums.length)); // Last 6 hours
  const olderPremiums = premiums.slice(6, Math.min(12, premiums.length)); // Previous 6 hours
  
  const recentAvg = recentPremiums.reduce((sum, p) => sum + p, 0) / recentPremiums.length;
  const olderAvg = olderPremiums.length > 0 ? 
    olderPremiums.reduce((sum, p) => sum + p, 0) / olderPremiums.length : recentAvg;
  
  let premiumTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentAvg > olderAvg * 1.1) premiumTrend = 'increasing';
  else if (recentAvg < olderAvg * 0.9) premiumTrend = 'decreasing';
  
  // Market stress indicator (based on premium extremes)
  const maxPremium = Math.max(...premiums);
  const minPremium = Math.min(...premiums);
  const premiumRange = maxPremium - minPremium;
  const marketStress = Math.min(100, (Math.abs(currentPremium) / (premiumRange || 0.001)) * 100);
  
  // Arbitrage opportunity detection
  const arbitrageThreshold = 0.001; // 0.1% premium threshold
  const arbitrageSignal = Math.abs(currentPremium) > arbitrageThreshold;
  
  // Basis momentum
  const basisMomentum = premiums.length > 1 ? 
    (currentPremium - premiums[premiums.length - 1]) / Math.abs(premiums[premiums.length - 1] || 0.001) : 0;

  return {
    currentPremium,
    currentPremiumPercent: (currentPremium * 100).toFixed(4),
    avgPremium24h: avgPremium,
    premiumVolatility: volatility,
    premiumTrend,
    marketStress: Math.round(marketStress),
    arbitrageSignal,
    basisMomentum: Math.round(basisMomentum * 10000) / 100, // In basis points
    premiumStats: {
      max: maxPremium,
      min: minPremium,
      range: premiumRange,
      recent: recentPremiums,
      older: olderPremiums
    }
  };
}

// COMPREHENSIVE ANALYSIS COMPILATION
function compileEnhancedAnalysis(
  liquidationAnalysis: LiquidationAnalysis | null,
  fundingAnalysis: FundingAnalysis | null,
  tradingAnalysis: TradingAnalysis | null,
  premiumAnalysis: PremiumAnalysis | null
): { enhancedMetrics: EnhancedMetrics; aiPromptData: AIPromptData } {
  
  const enhancedMetrics: EnhancedMetrics = {
    // Liquidation insights
    liquidationRisk: liquidationAnalysis?.totalLiquidations || 0, // Changed from extremeRateScore
    liquidationMomentum: liquidationAnalysis?.liquidationMomentum || 'stable',
    keyLiquidationLevels: liquidationAnalysis?.liquidationClusters?.slice(0, 5).map(c => c.price) || [],
    
    // Funding rate insights
    sentimentSignal: fundingAnalysis?.sentimentSignal || 'neutral',
    fundingExtremity: fundingAnalysis?.extremeRateScore || 0,
    meanReversionPotential: fundingAnalysis?.meanReversionScore || 0,
    
    // Trading microstructure
    institutionalActivity: tradingAnalysis?.institutionalActivity || 0,
    buyPressure: tradingAnalysis?.buyPressure || 0.5,
    marketLiquidity: tradingAnalysis?.totalVolume || 0,
    
    // Market stress
    premiumStress: premiumAnalysis?.marketStress || 0,
    arbitrageOpportunity: premiumAnalysis?.arbitrageSignal || false,
    basisTrend: premiumAnalysis?.premiumTrend || 'stable',
    
    // Composite scores
    overallSentiment: calculateOverallSentiment(fundingAnalysis, liquidationAnalysis, tradingAnalysis),
    riskLevel: calculateRiskLevel(liquidationAnalysis, premiumAnalysis, fundingAnalysis),
    signalStrength: calculateSignalStrength(liquidationAnalysis, fundingAnalysis, tradingAnalysis, premiumAnalysis)
  };

  const aiPromptData: AIPromptData = {
    // Market microstructure - cleaned and standardized
    liquidation_momentum: enhancedMetrics.liquidationMomentum,
    liquidation_clusters: enhancedMetrics.keyLiquidationLevels,
    liquidation_pressure: liquidationAnalysis?.liquidationPressure || 'none',
    liquidation_rate_1h: liquidationAnalysis?.recentLiquidationRate || 0,
    key_liquidation_levels: enhancedMetrics.keyLiquidationLevels.slice(0, 3),
    
    // Funding analysis - simplified
    funding_sentiment: enhancedMetrics.sentimentSignal,
    funding_extremity: enhancedMetrics.fundingExtremity,
    funding_trend: fundingAnalysis?.rateTrend || 'stable',
    
    // Trading flows - clear metrics
    institutional_activity: enhancedMetrics.institutionalActivity,
    buy_pressure_ratio: Math.round(enhancedMetrics.buyPressure * 100),
    
    // Market stress - consolidated
    market_stress_level: Math.round(enhancedMetrics.premiumStress),
    premium_volatility: Math.round((premiumAnalysis?.premiumVolatility || 0) * 100),
    
    // Opportunity signals - boolean flags
    arbitrage_opportunity: enhancedMetrics.arbitrageOpportunity,
    mean_reversion_potential: enhancedMetrics.meanReversionPotential,
    
    // Summary metrics - AI-ready
    overall_sentiment: enhancedMetrics.overallSentiment,
    risk_score: enhancedMetrics.riskLevel,
    signal_strength: enhancedMetrics.signalStrength,
    cascade_risk_present: liquidationAnalysis?.liquidationMomentum === 'increasing' && (liquidationAnalysis?.recentLiquidationRate || 0) > 2
  };

  return { enhancedMetrics, aiPromptData };
}

// Helper functions for composite calculations
function calculateOverallSentiment(
  funding: FundingAnalysis | null, 
  liquidation: LiquidationAnalysis | null, 
  trading: TradingAnalysis | null
): 'bullish' | 'bearish' | 'neutral' {
  let bullishScore = 0;
  let bearishScore = 0;
  
  // Funding sentiment
  if (funding?.sentimentSignal?.includes('bullish')) bullishScore += 2;
  if (funding?.sentimentSignal?.includes('bearish')) bearishScore += 2;
  
  // Liquidation pressure
  if (liquidation?.liquidationPressure === 'short_squeeze') bullishScore += 2;
  if (liquidation?.liquidationPressure === 'long_squeeze') bearishScore += 2;
  
  // Trading pressure
  if ((trading?.buyPressure || 0) > 0.6) bullishScore += 1;
  if ((trading?.buyPressure || 0) < 0.4) bearishScore += 1;
  
  if (bullishScore > bearishScore) return 'bullish';
  if (bearishScore > bullishScore) return 'bearish';
  return 'neutral';
}

function calculateRiskLevel(
  liquidation: LiquidationAnalysis | null, 
  premium: PremiumAnalysis | null, 
  funding: FundingAnalysis | null
): number {
  let riskScore = 0;
  
  // Liquidation risk
  if (liquidation?.liquidationMomentum === 'increasing') riskScore += 30;
  if ((liquidation?.totalLiquidations || 0) > 100) riskScore += 20;
  
  // Premium stress
  riskScore += (premium?.marketStress || 0) * 0.3;
  
  // Funding extremity
  riskScore += (funding?.extremeRateScore || 0) * 0.2;
  
  return Math.min(100, Math.round(riskScore));
}

function calculateSignalStrength(
  liquidation: LiquidationAnalysis | null, 
  funding: FundingAnalysis | null, 
  trading: TradingAnalysis | null, 
  premium: PremiumAnalysis | null
): number {
  let strength = 0;
  
  // Multiple confirming signals increase strength
  if (liquidation?.liquidationMomentum !== 'stable') strength += 25;
  if ((funding?.extremeRateScore || 0) > 50) strength += 25;
  if ((trading?.institutionalActivity || 0) > 5) strength += 20;
  if (premium?.arbitrageSignal) strength += 15;
  if ((trading?.buyPressure || 0) > 0.7 || (trading?.buyPressure || 0) < 0.3) strength += 15;
  
  return Math.min(100, Math.round(strength));
}

// MAIN ENHANCED ANALYSIS FUNCTION
export async function getEnhancedMarketAnalysis(
  settle: string,
  contract: string,
  schedulerLogger?: any
): Promise<EnhancedAnalysisResult> {
  console.log(`[ENHANCED-ANALYSIS] Starting comprehensive analysis for ${contract}`);
  
  if (schedulerLogger) {
    schedulerLogger.log('INFO', 'ENHANCED_ANALYSIS_START', `Starting enhanced analysis for ${contract}`);
  }

  try {
    // Fetch all data in parallel for efficiency
    const [liquidationData, fundingData, tradingData, premiumData] = await Promise.all([
      fetchLiquidationAnalysis(settle, contract, schedulerLogger),
      fetchFundingAnalysis(settle, contract, schedulerLogger),
      fetchTradingAnalysis(settle, contract, schedulerLogger),
      fetchPremiumAnalysis(settle, contract, schedulerLogger)
    ]);

    // Compile comprehensive analysis
    const { enhancedMetrics, aiPromptData } = compileEnhancedAnalysis(
      liquidationData, 
      fundingData, 
      tradingData, 
      premiumData
    );

    const result: EnhancedAnalysisResult = {
      contract,
      timestamp: new Date().toISOString(),
      rawData: {
        liquidations: liquidationData,
        funding: fundingData,
        trading: tradingData,
        premium: premiumData
      },
      enhancedMetrics,
      aiPromptData
    };

    console.log(`[ENHANCED-ANALYSIS] Completed analysis for ${contract}`);
    
    if (schedulerLogger) {
      schedulerLogger.log('INFO', 'ENHANCED_ANALYSIS_SUCCESS', `Enhanced analysis completed for ${contract}`, {
        contract,
        overallSentiment: enhancedMetrics.overallSentiment,
        riskLevel: enhancedMetrics.riskLevel,
        signalStrength: enhancedMetrics.signalStrength,
        institutionalActivity: enhancedMetrics.institutionalActivity,
        liquidationMomentum: enhancedMetrics.liquidationMomentum
      });
    }

    return result;

  } catch (error: any) {
    console.error(`[ENHANCED-ANALYSIS] Analysis failed for ${contract}:`, error);
    
    if (schedulerLogger) {
      schedulerLogger.log('ERROR', 'ENHANCED_ANALYSIS_ERROR', `Enhanced analysis failed for ${contract}: ${error?.message || 'Unknown error'}`);
    }
    
    // Return basic structure with null data on error
    return {
      contract,
      timestamp: new Date().toISOString(),
      rawData: {
        liquidations: null,
        funding: null,
        trading: null,
        premium: null
      },
      enhancedMetrics: {
        liquidationRisk: 0,
        liquidationMomentum: 'stable',
        keyLiquidationLevels: [],
        sentimentSignal: 'neutral',
        fundingExtremity: 0,
        meanReversionPotential: 0,
        institutionalActivity: 0,
        buyPressure: 0.5,
        marketLiquidity: 0,
        premiumStress: 0,
        arbitrageOpportunity: false,
        basisTrend: 'stable',
        overallSentiment: 'neutral',
        riskLevel: 0,
        signalStrength: 0
      },
      aiPromptData: {
        liquidation_momentum: 'stable',
        liquidation_clusters: [],
        liquidation_pressure: 'none',
        liquidation_rate_1h: 0,
        key_liquidation_levels: [],
        funding_sentiment: 'neutral',
        funding_extremity: 0,
        funding_trend: 'stable',
        institutional_activity: 0,
        buy_pressure_ratio: 50,
        market_stress_level: 0,
        premium_volatility: 0,
        arbitrage_opportunity: false,
        mean_reversion_potential: 0,
        overall_sentiment: 'neutral',
        risk_score: 0,
        signal_strength: 0,
        cascade_risk_present: false
      }
    };
  }
}
