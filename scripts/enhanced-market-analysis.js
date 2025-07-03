#!/usr/bin/env node

/**
 * Enhanced Market Analysis Script
 * Fetches and analyzes high-impact market data for Gate.io futures contracts
 * 
 * APIs Integrated:
 * 1. Liquidation History (Tier 1 - Impact: 10/10)
 * 2. Funding Rate History (Tier 1 - Impact: 9/10)
 * 3. Trading History (Tier 2 - Impact: 8/10)
 * 4. Premium Index K-Line (Tier 2 - Impact: 7/10)
 */

const https = require('https');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  BASE_URL: 'https://api.gateio.ws',
  API_PREFIX: '/api/v4',
  SETTLE: 'usdt',
  CONTRACT: process.argv[2] || 'AVAAI_USDT',
  LOOKBACK_HOURS: 24,
  LIQUIDATION_LOOKBACK_HOURS: 1, // API limitation: max 1 hour window
  FUNDING_HISTORY_LIMIT: 50,
  TRADES_LIMIT: 200,
  PREMIUM_INTERVAL: '1h',
  PREMIUM_LIMIT: 24,
  LARGE_TRADE_THRESHOLD_USD: 100000, // Trades above this are considered "large"
  LIQUIDATION_CLUSTER_THRESHOLD: 2, // Min liquidations at same price to form cluster
};

// Utility Functions
function makeApiCall(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    const url = `${CONFIG.BASE_URL}${CONFIG.API_PREFIX}${endpoint}${queryString ? '?' + queryString : ''}`;
    
    console.log(`🌐 Fetching: ${endpoint}${queryString ? '?' + queryString : ''}`);
    
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200) {
            resolve(parsed);
          } else {
            reject(new Error(`API Error: ${res.statusCode} - ${JSON.stringify(parsed)}`));
          }
        } catch (error) {
          reject(new Error(`Parse Error: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

function calculateTimestamps() {
  const now = Math.floor(Date.now() / 1000);
  const liquidationFrom = now - (CONFIG.LIQUIDATION_LOOKBACK_HOURS * 3600);
  const tradingFrom = now - (CONFIG.LOOKBACK_HOURS * 3600);
  return { now, liquidationFrom, tradingFrom };
}

// 1. LIQUIDATION ANALYSIS
async function fetchLiquidationData() {
  console.log('\n📊 === LIQUIDATION ANALYSIS ===');
  
  const { liquidationFrom, now } = calculateTimestamps();
  
  try {
    const liquidations = await makeApiCall(`/futures/${CONFIG.SETTLE}/liq_orders`, {
      contract: CONFIG.CONTRACT,
      from: liquidationFrom,
      to: now,
      limit: 1000
    });

    console.log(`\n🔍 Raw Liquidation Data (${liquidations.length} records):`);
    console.log(JSON.stringify(liquidations.slice(0, 5), null, 2)); // Show first 5 for verification

    return analyzeLiquidations(liquidations);
  } catch (error) {
    console.error('❌ Liquidation fetch failed:', error.message);
    return null;
  }
}

function analyzeLiquidations(liquidations) {
  if (!liquidations || liquidations.length === 0) {
    return {
      totalLiquidations: 0,
      liquidationVolume: 0,
      avgLiquidationSize: 0,
      liquidationClusters: [],
      liquidationMomentum: 'none',
      liquidationPressure: 'none',
      recentLiquidationRate: 0
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
  let momentum = 'stable';
  if (recentCount > previousCount * 1.5) momentum = 'increasing';
  else if (recentCount < previousCount * 0.5) momentum = 'decreasing';

  // Liquidation pressure (long vs short)
  const longLiqs = liquidations.filter(liq => liq.size < 0); // Negative size = long liquidation
  const shortLiqs = liquidations.filter(liq => liq.size > 0); // Positive size = short liquidation
  const longVolume = longLiqs.reduce((sum, liq) => sum + Math.abs(liq.size), 0);
  const shortVolume = shortLiqs.reduce((sum, liq) => sum + Math.abs(liq.size), 0);

  let pressure = 'balanced';
  if (longVolume > shortVolume * 2) pressure = 'long_squeeze';
  else if (shortVolume > longVolume * 2) pressure = 'short_squeeze';

  // Liquidation clusters (price levels with multiple liquidations)
  const priceGroups = {};
  liquidations.forEach(liq => {
    const priceLevel = Math.round(parseFloat(liq.order_price) * 100) / 100; // Round to 2 decimals
    if (!priceGroups[priceLevel]) {
      priceGroups[priceLevel] = { price: priceLevel, count: 0, volume: 0, liquidations: [] };
    }
    priceGroups[priceLevel].count++;
    priceGroups[priceLevel].volume += Math.abs(liq.size);
    priceGroups[priceLevel].liquidations.push(liq);
  });

  const clusters = Object.values(priceGroups)
    .filter(group => group.count >= CONFIG.LIQUIDATION_CLUSTER_THRESHOLD)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10); // Top 10 clusters

  const analysis = {
    totalLiquidations,
    liquidationVolume: totalVolume,
    avgLiquidationSize: avgSize,
    recentLiquidationRate: recentCount / Math.max(previousCount, 1), // Ratio vs previous hour
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

  console.log('\n📈 Liquidation Analysis Results:');
  console.log(`Total Liquidations: ${totalLiquidations}`);
  console.log(`Total Volume: ${totalVolume.toLocaleString()}`);
  console.log(`Average Size: ${avgSize.toFixed(2)}`);
  console.log(`Momentum: ${momentum}`);
  console.log(`Pressure: ${pressure}`);
  console.log(`Long/Short Ratio: ${(longVolume / (shortVolume || 1)).toFixed(2)}`);
  console.log(`Recent Rate: ${analysis.recentLiquidationRate.toFixed(2)}x previous hour`);
  console.log(`Top Clusters: ${clusters.length} found`);
  
  if (clusters.length > 0) {
    console.log('\n🎯 Top Liquidation Clusters:');
    clusters.slice(0, 3).forEach((cluster, i) => {
      console.log(`${i + 1}. $${cluster.price} - ${cluster.count} liquidations, ${cluster.volume.toLocaleString()} volume`);
    });
  }

  return analysis;
}

// 2. FUNDING RATE ANALYSIS
async function fetchFundingRateData() {
  console.log('\n💰 === FUNDING RATE ANALYSIS ===');
  
  try {
    const fundingHistory = await makeApiCall(`/futures/${CONFIG.SETTLE}/funding_rate`, {
      contract: CONFIG.CONTRACT,
      limit: CONFIG.FUNDING_HISTORY_LIMIT
    });

    console.log(`\n🔍 Raw Funding Rate Data (${fundingHistory.length} records):`);
    console.log(JSON.stringify(fundingHistory.slice(0, 5), null, 2));

    return analyzeFundingRates(fundingHistory);
  } catch (error) {
    console.error('❌ Funding rate fetch failed:', error.message);
    return null;
  }
}

function analyzeFundingRates(fundingHistory) {
  if (!fundingHistory || fundingHistory.length === 0) {
    return {
      currentRate: 0,
      avgRate24h: 0,
      rateVolatility: 0,
      extremeRateScore: 0,
      sentimentSignal: 'neutral',
      rateTrend: 'stable'
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
  let sentimentSignal = 'neutral';
  if (currentRate > 0.005) sentimentSignal = 'very_bullish'; // >0.5%
  else if (currentRate > 0.001) sentimentSignal = 'bullish'; // >0.1%
  else if (currentRate < -0.005) sentimentSignal = 'very_bearish'; // <-0.5%
  else if (currentRate < -0.001) sentimentSignal = 'bearish'; // <-0.1%
  
  // Rate trend (comparing recent vs older rates)
  const recentRates = rates.slice(0, Math.min(8, rates.length)); // Last 8 periods
  const olderRates = rates.slice(8, Math.min(16, rates.length)); // Previous 8 periods
  
  const recentAvg = recentRates.reduce((sum, rate) => sum + rate, 0) / recentRates.length;
  const olderAvg = olderRates.length > 0 ? 
    olderRates.reduce((sum, rate) => sum + rate, 0) / olderRates.length : recentAvg;
  
  let rateTrend = 'stable';
  if (recentAvg > olderAvg * 1.2) rateTrend = 'increasing';
  else if (recentAvg < olderAvg * 0.8) rateTrend = 'decreasing';
  
  // Mean reversion potential
  const meanReversionScore = Math.abs(currentRate - avgRate) / (volatility || 0.0001);
  
  const analysis = {
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

  console.log('\n📈 Funding Rate Analysis Results:');
  console.log(`Current Rate: ${(currentRate * 100).toFixed(4)}%`);
  console.log(`24h Average: ${(avgRate * 100).toFixed(4)}%`);
  console.log(`Volatility: ${(volatility * 100).toFixed(4)}%`);
  console.log(`Extreme Score: ${analysis.extremeRateScore}/100`);
  console.log(`Sentiment: ${sentimentSignal}`);
  console.log(`Trend: ${rateTrend}`);
  console.log(`Mean Reversion Score: ${analysis.meanReversionScore}`);

  return analysis;
}

// 3. TRADING HISTORY ANALYSIS
async function fetchTradingHistory() {
  console.log('\n📈 === TRADING HISTORY ANALYSIS ===');
  
  const { tradingFrom, now } = calculateTimestamps();
  
  try {
    const trades = await makeApiCall(`/futures/${CONFIG.SETTLE}/trades`, {
      contract: CONFIG.CONTRACT,
      from: tradingFrom,
      to: now,
      limit: CONFIG.TRADES_LIMIT
    });

    console.log(`\n🔍 Raw Trading Data (${trades.length} records):`);
    console.log(JSON.stringify(trades.slice(0, 3), null, 2));

    return analyzeTradingHistory(trades);
  } catch (error) {
    console.error('❌ Trading history fetch failed:', error.message);
    return null;
  }
}

function analyzeTradingHistory(trades) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      totalVolume: 0,
      avgTradeSize: 0,
      largeTrades: [],
      buyPressure: 0.5,
      volumeProfile: [],
      institutionalActivity: 0
    };
  }

  const totalTrades = trades.length;
  let totalVolume = 0;
  let buyVolume = 0;
  let sellVolume = 0;
  const largeTrades = [];
  const priceVolumeMap = {};

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
    if (value >= CONFIG.LARGE_TRADE_THRESHOLD_USD) {
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

  const analysis = {
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
      tradeFrequency: trades.length / (CONFIG.LOOKBACK_HOURS || 1)
    }
  };

  console.log('\n📈 Trading History Analysis Results:');
  console.log(`Total Trades: ${totalTrades.toLocaleString()}`);
  console.log(`Total Volume: ${totalVolume.toLocaleString()}`);
  console.log(`Average Trade Size: ${avgTradeSize.toFixed(2)}`);
  console.log(`Buy Pressure: ${(buyPressure * 100).toFixed(1)}%`);
  console.log(`Large Trades: ${largeTrades.length} (${institutionalActivity.toFixed(2)}% of all trades)`);
  console.log(`Large Buy/Sell Ratio: ${(largeBuyVolume / (largeSellVolume || 1)).toFixed(2)}`);

  return analysis;
}

// 4. PREMIUM INDEX ANALYSIS
async function fetchPremiumIndex() {
  console.log('\n💎 === PREMIUM INDEX ANALYSIS ===');
  
  try {
    const premiumData = await makeApiCall(`/futures/${CONFIG.SETTLE}/premium_index`, {
      contract: CONFIG.CONTRACT,
      interval: CONFIG.PREMIUM_INTERVAL,
      limit: CONFIG.PREMIUM_LIMIT
    });

    console.log(`\n🔍 Raw Premium Index Data (${premiumData.length} records):`);
    console.log(JSON.stringify(premiumData.slice(0, 3), null, 2));

    return analyzePremiumIndex(premiumData);
  } catch (error) {
    console.error('❌ Premium index fetch failed:', error.message);
    return null;
  }
}

function analyzePremiumIndex(premiumData) {
  if (!premiumData || premiumData.length === 0) {
    return {
      currentPremium: 0,
      avgPremium24h: 0,
      premiumVolatility: 0,
      premiumTrend: 'stable',
      marketStress: 0,
      arbitrageSignal: false
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
  
  let premiumTrend = 'stable';
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

  const analysis = {
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

  console.log('\n📈 Premium Index Analysis Results:');
  console.log(`Current Premium: ${(currentPremium * 100).toFixed(4)}%`);
  console.log(`24h Average: ${(avgPremium * 100).toFixed(4)}%`);
  console.log(`Volatility: ${(volatility * 100).toFixed(4)}%`);
  console.log(`Trend: ${premiumTrend}`);
  console.log(`Market Stress: ${analysis.marketStress}/100`);
  console.log(`Arbitrage Signal: ${arbitrageSignal ? 'YES' : 'NO'}`);
  console.log(`Basis Momentum: ${analysis.basisMomentum} bps`);

  return analysis;
}

// COMPREHENSIVE ANALYSIS COMPILATION
function compileEnhancedAnalysis(liquidationAnalysis, fundingAnalysis, tradingAnalysis, premiumAnalysis) {
  console.log('\n🎯 === ENHANCED MARKET ANALYSIS COMPILATION ===');
  
  const enhancedMetrics = {
    // Liquidation insights
    liquidationRisk: liquidationAnalysis?.extremeRateScore || 0,
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

  console.log('\n🎯 Enhanced Analysis Summary:');
  console.log(`Overall Sentiment: ${enhancedMetrics.overallSentiment}`);
  console.log(`Risk Level: ${enhancedMetrics.riskLevel}/100`);
  console.log(`Signal Strength: ${enhancedMetrics.signalStrength}/100`);
  console.log(`Liquidation Risk: ${enhancedMetrics.liquidationRisk}/100`);
  console.log(`Funding Extremity: ${enhancedMetrics.fundingExtremity}/100`);
  console.log(`Institutional Activity: ${enhancedMetrics.institutionalActivity}%`);
  
  return {
    contract: CONFIG.CONTRACT,
    timestamp: new Date().toISOString(),
    rawData: {
      liquidations: liquidationAnalysis,
      funding: fundingAnalysis,
      trading: tradingAnalysis,
      premium: premiumAnalysis
    },
    enhancedMetrics,
    aiPromptData: generateAIPromptData(enhancedMetrics, liquidationAnalysis, fundingAnalysis, tradingAnalysis, premiumAnalysis)
  };
}

function calculateOverallSentiment(funding, liquidation, trading) {
  let bullishScore = 0;
  let bearishScore = 0;
  
  // Funding sentiment
  if (funding?.sentimentSignal?.includes('bullish')) bullishScore += 2;
  if (funding?.sentimentSignal?.includes('bearish')) bearishScore += 2;
  
  // Liquidation pressure
  if (liquidation?.liquidationPressure === 'short_squeeze') bullishScore += 2;
  if (liquidation?.liquidationPressure === 'long_squeeze') bearishScore += 2;
  
  // Trading pressure
  if (trading?.buyPressure > 0.6) bullishScore += 1;
  if (trading?.buyPressure < 0.4) bearishScore += 1;
  
  if (bullishScore > bearishScore) return 'bullish';
  if (bearishScore > bullishScore) return 'bearish';
  return 'neutral';
}

function calculateRiskLevel(liquidation, premium, funding) {
  let riskScore = 0;
  
  // Liquidation risk
  if (liquidation?.liquidationMomentum === 'increasing') riskScore += 30;
  if (liquidation?.totalLiquidations > 100) riskScore += 20;
  
  // Premium stress
  riskScore += (premium?.marketStress || 0) * 0.3;
  
  // Funding extremity
  riskScore += (funding?.extremeRateScore || 0) * 0.2;
  
  return Math.min(100, Math.round(riskScore));
}

function calculateSignalStrength(liquidation, funding, trading, premium) {
  let strength = 0;
  
  // Multiple confirming signals increase strength
  if (liquidation?.liquidationMomentum !== 'stable') strength += 25;
  if (funding?.extremeRateScore > 50) strength += 25;
  if (trading?.institutionalActivity > 5) strength += 20;
  if (premium?.arbitrageSignal) strength += 15;
  if (trading?.buyPressure > 0.7 || trading?.buyPressure < 0.3) strength += 15;
  
  return Math.min(100, Math.round(strength));
}

function generateAIPromptData(enhanced, liquidation, funding, trading, premium) {
  return {
    // Market microstructure data for AI
    liquidation_momentum: enhanced.liquidationMomentum,
    liquidation_clusters: enhanced.keyLiquidationLevels,
    funding_sentiment: enhanced.sentimentSignal,
    funding_extremity: enhanced.fundingExtremity,
    institutional_flow: enhanced.institutionalActivity,
    buy_pressure: Math.round(enhanced.buyPressure * 100),
    market_stress: enhanced.premiumStress,
    overall_sentiment: enhanced.overallSentiment,
    risk_level: enhanced.riskLevel,
    signal_strength: enhanced.signalStrength,
    
    // Detailed metrics
    liquidation_rate_1h: liquidation?.recentLiquidationRate || 0,
    funding_rate_current: funding?.currentRatePercent || '0',
    large_trades_count: trading?.largeTradeStats?.count || 0,
    premium_basis: premium?.currentPremiumPercent || '0',
    
    // Action signals
    arbitrage_opportunity: enhanced.arbitrageOpportunity,
    mean_reversion_signal: funding?.meanReversionScore > 2,
    liquidation_support_levels: enhanced.keyLiquidationLevels.slice(0, 3),
    
    // Risk indicators
    cascade_risk: liquidation?.liquidationMomentum === 'increasing' && liquidation?.recentLiquidationRate > 2,
    funding_reset_potential: funding?.extremeRateScore > 70,
    whale_activity: trading?.institutionalActivity > 10
  };
}

// MAIN EXECUTION
async function main() {
  console.log(`🚀 Starting Enhanced Market Analysis for ${CONFIG.CONTRACT}`);
  console.log(`📅 Analysis Period: ${CONFIG.LOOKBACK_HOURS}h lookback`);
  console.log(`⏰ Timestamp: ${new Date().toISOString()}\n`);

  try {
    // Fetch all data in parallel for efficiency
    const [liquidationData, fundingData, tradingData, premiumData] = await Promise.all([
      fetchLiquidationData(),
      fetchFundingRateData(),
      fetchTradingHistory(),
      fetchPremiumIndex()
    ]);

    // Compile comprehensive analysis
    const fullAnalysis = compileEnhancedAnalysis(liquidationData, fundingData, tradingData, premiumData);

    // Output results
    console.log('\n' + '='.repeat(80));
    console.log('📋 FINAL ANALYSIS OUTPUT');
    console.log('='.repeat(80));
    console.log(JSON.stringify(fullAnalysis, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('🤖 AI PROMPT DATA (Ready for Integration)');
    console.log('='.repeat(80));
    console.log(JSON.stringify(fullAnalysis.aiPromptData, null, 2));

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Command line usage
if (require.main === module) {
  console.log('Enhanced Market Analysis Script v1.0');
  console.log('Usage: node enhanced-market-analysis.js [CONTRACT]');
  console.log(`Example: node enhanced-market-analysis.js AVAAI_USDT\n`);
  
  main();
}

module.exports = {
  main,
  CONFIG,
  fetchLiquidationData,
  fetchFundingRateData,
  fetchTradingHistory,
  fetchPremiumIndex,
  compileEnhancedAnalysis
};
