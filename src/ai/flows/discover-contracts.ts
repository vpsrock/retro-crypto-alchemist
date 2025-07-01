'use server';
/**
 * @fileOverview A flow to discover promising crypto futures contracts from Gate.io.
 *
 * - discoverContracts - Finds top contracts based on volume and volatility.
 * - DiscoverContractsInput - Input for the discovery function.
 * - DiscoverContractsOutput - Output for the discovery function.
 */

import {ai} from '@/ai/genkit';
import { 
    DiscoverContractsInputSchema,
    DiscoverContractsOutputSchema
} from '@/lib/schemas';
import type {
    DiscoverContractsInput,
    DiscoverContractsOutput
} from '@/lib/schemas';

export type { DiscoverContractsInput, DiscoverContractsOutput };

async function fetchAllGateioTickers(settle: 'usdt' | 'btc'): Promise<any[]> {
    const baseUrl = "https://api.gateio.ws/api/v4";
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
    try {
        const tickersUrl = `${baseUrl}/futures/${settle}/tickers`;
        const tickerRes = await fetch(tickersUrl, {headers, next: { revalidate: 30 }}); // Cache for 30 seconds - fresh data for volatile markets
        if (!tickerRes.ok) {
            const errorBody = await tickerRes.text();
            throw new Error(`Gate.io API error for tickers: ${tickerRes.status} - ${errorBody}`);
        }
        return await tickerRes.json();
    } catch (error: any) {
        console.error(`Failed to fetch tickers: ${error.message}`);
        throw new Error(`Failed to fetch tickers: ${error.message}`);
    }
}

export async function discoverContracts(input: DiscoverContractsInput): Promise<{contracts: {contract: string, tickerData: any, foundByProfile: string}[], log: string}> {
  const logLines: string[] = [];
  const startTime = new Date();
  
  const tickers = await fetchAllGateioTickers(input.settle);
  const fetchTime = new Date();
  logLines.push(`1. Fetched ${tickers.length} tickers from Gate.io for '${input.settle}' settlement at ${fetchTime.toLocaleTimeString()} (cache: max 30s old).`);

  if (!tickers || tickers.length === 0) {
    throw new Error('API returned no tickers. The Gate.io API might be temporarily unavailable or there are no contracts for the selected currency.');
  }
  
  logLines.push(`2. Processing ${input.profiles.length} selected profile(s): ${input.profiles.join(', ')}`);
  
  // Run discovery for each profile and collect results
  const allProfileResults: {contract: string, tickerData: any, foundByProfile: string}[] = [];
  const profileResultsMap = new Map<string, {contract: string, tickerData: any, foundByProfile: string}>();
  
  for (const profile of input.profiles) {
    logLines.push(`\n--- Processing Profile: ${profile} ---`);
    
    // Apply profile-specific filtering and scoring
    const profileResults = applyProfileFiltering(tickers, { ...input, profile }, logLines);
    const scoredContracts = profileResults.contracts;
    
    logLines.push(`Profile '${profile}': Processed ${profileResults.processedCount} tickers, kept ${scoredContracts.length} contracts.`);

    if (scoredContracts.length === 0) {
      logLines.push(`Profile '${profile}': No contracts found - skipping.`);
      continue;
    }

    // Sort contracts for this profile
    scoredContracts.sort((a, b) => {
      switch (input.sortBy) {
          case 'volume':
              return b.volume - a.volume;
          case 'change':
              return Math.abs(b.change) - Math.abs(a.change);
          case 'score':
          default:
              return b.score - a.score;
      }
    });
    
    // Take top contracts for this profile
    const topProfileContracts = scoredContracts.slice(0, input.contractsPerProfile);
    const contractNamesForLog = topProfileContracts.map(c => c.contract);
    logLines.push(`Profile '${profile}': Selected top ${topProfileContracts.length} contracts: ${contractNamesForLog.join(', ')}`);
    
    // Add to results, avoiding duplicates (prioritize first profile that found it)
    for (const contract of topProfileContracts) {
      if (!profileResultsMap.has(contract.contract)) {
        const result = { 
          contract: contract.contract, 
          tickerData: contract.tickerData, 
          foundByProfile: profile 
        };
        profileResultsMap.set(contract.contract, result);
        allProfileResults.push(result);
      }
    }
  }

  if (allProfileResults.length === 0) {
    let errorMessage = `No contracts found across ${input.profiles.length} profile(s). Try adjusting filters or different profiles.`;
    throw new Error(errorMessage);
  }

  logLines.push(`\n--- Final Results ---`);
  logLines.push(`3. Combined results from ${input.profiles.length} profile(s): Found ${allProfileResults.length} unique contracts total.`);
  
  // Show breakdown by profile
  const profileBreakdown = input.profiles.map(profile => {
    const count = allProfileResults.filter(r => r.foundByProfile === profile).length;
    return `${profile}: ${count}`;
  }).join(', ');
  logLines.push(`4. Breakdown by profile: ${profileBreakdown}`);

  const contractNamesForLog = allProfileResults.map(r => `${r.contract} (${r.foundByProfile})`);
  logLines.push(`5. Final contracts for analysis: ${contractNamesForLog.join(', ')}`);
  
  return {
    contracts: allProfileResults,
    log: logLines.join('\n\n')
  };
}

function applyProfileFiltering(tickers: any[], input: DiscoverContractsInput & { profile: string }, logLines: string[]): {
  contracts: {contract: string, score: number, volume: number, change: number, tickerData: any}[],
  processedCount: number,
  rejectedSamples: any[]
} {
  const MIN_VOLUME_USD = input.minVolume;
  let processedCount = 0;
  const rejectedSamples: any[] = [];

  const baseContracts = tickers
    .map(ticker => {
      processedCount++;
      
      // Gate.io API is inconsistent. Use volume_24h_settle as a fallback for USDT contracts
      // if volume_24h_usd is missing, as they are equivalent.
      let volumeStr = ticker.volume_24h_usd;
      if (input.settle === 'usdt' && (!volumeStr || typeof volumeStr !== 'string')) {
          volumeStr = ticker.volume_24h_settle;
      }
      
      const changeStr = ticker.change_percentage;
      
      // Filter out contracts with invalid data before parsing
      if (typeof volumeStr !== 'string' || volumeStr === '' || typeof changeStr !== 'string' || changeStr === '') {
        if (rejectedSamples.length < 5) {
            rejectedSamples.push({ contract: ticker.contract, reason: "Missing or invalid volume/change field", data: ticker });
        }
        return null;
      }
      
      const volume = parseFloat(volumeStr);
      const change = parseFloat(changeStr);
      
      if (isNaN(volume) || isNaN(change)) {
        if (rejectedSamples.length < 5) {
            rejectedSamples.push({ contract: ticker.contract, reason: "Volume or change is not a number", data: ticker });
        }
        return null;
      }
      
      return {
        contract: ticker.contract,
        volume,
        change,
        tickerData: ticker,
        fundingRate: parseFloat(ticker.funding_rate || '0'),
        openInterest: parseFloat(ticker.total_size || '0'),
        price: parseFloat(ticker.last || '0'),
        bid: parseFloat(ticker.highest_bid || '0'),
        ask: parseFloat(ticker.lowest_ask || '0'),
      };
    })
    .filter((c): c is {contract: string, volume: number, change: number, tickerData: any, fundingRate: number, openInterest: number, price: number, bid: number, ask: number} => c !== null);

  // Apply profile-specific filtering and scoring
  return applyProfileLogic(baseContracts, input, MIN_VOLUME_USD, rejectedSamples, processedCount, logLines);
}

function applyProfileLogic(
  contracts: any[],
  input: DiscoverContractsInput & { profile: string },
  MIN_VOLUME_USD: number,
  rejectedSamples: any[],
  processedCount: number,
  logLines: string[]
): {contracts: any[], processedCount: number, rejectedSamples: any[]} {
  
  switch (input.profile) {
    case 'low_cap_gems':
      logLines.push(`Applying Low-Cap Gems profile: Finding small-cap tokens with high potential...`);
      return {
        contracts: contracts
          .filter(c => {
            // Lower volume threshold for gems, focus on smaller tokens
            if (c.volume < MIN_VOLUME_USD * 0.1) return false; // Very low minimum
            if (c.volume > MIN_VOLUME_USD * 5) return false; // Not too big
            if (c.price > 10) return false; // Lower price tokens
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.log(c.volume + 1) * 0.3) + (Math.abs(c.change) * 0.5) + (1 / Math.max(c.price, 0.0001) * 0.2)
          })),
        processedCount,
        rejectedSamples
      };

    case 'volume_surge':
      logLines.push(`Applying Volume Surge profile: Finding contracts with sudden volume spikes...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            // Look for volume significantly above average (assuming current is surge)
            if (Math.abs(c.change) < 5) return false; // Need significant movement
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.log(c.volume + 1) * 0.7) + (Math.abs(c.change) * 0.3)
          })),
        processedCount,
        rejectedSamples
      };

    case 'contrarian':
      logLines.push(`Applying Contrarian profile: Finding oversold/overbought reversal opportunities...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            // Look for extreme moves that might reverse
            if (Math.abs(c.change) < 10) return false; // Need significant move
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.abs(c.change) * 0.6) + (Math.log(c.volume + 1) * 0.4)
          })),
        processedCount,
        rejectedSamples
      };

    case 'funding_arbitrage':
      logLines.push(`Applying Funding Arbitrage profile: Finding negative funding rate opportunities...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            if (c.fundingRate >= 0) return false; // Only negative funding rates
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.abs(c.fundingRate) * 100) + (Math.log(c.volume + 1) * 0.3)
          })),
        processedCount,
        rejectedSamples
      };

    case 'new_listings':
      logLines.push(`Applying New Listings profile: Finding recently listed contracts...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD * 0.5) return false; // Lower volume ok for new
            // Heuristic: new listings often have very high open interest to volume ratio
            const oiToVolumeRatio = c.openInterest / Math.max(c.volume, 1);
            if (oiToVolumeRatio < 0.1) return false; // Should have significant OI
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.abs(c.change) * 0.4) + (Math.log(c.volume + 1) * 0.4) + ((c.openInterest / Math.max(c.volume, 1)) * 0.2)
          })),
        processedCount,
        rejectedSamples
      };

    case 'stablecoin_pairs':
      logLines.push(`Applying Stablecoin Pairs profile: Finding stablecoin future opportunities...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            // Look for stablecoin pairs (price around $1)
            if (c.price < 0.5 || c.price > 2) return false;
            if (!c.contract.includes('USD')) return false; // Likely stablecoin
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.log(c.volume + 1) * 0.5) + (Math.abs(1 - c.price) * 100) + (Math.abs(c.fundingRate) * 50)
          })),
        processedCount,
        rejectedSamples
      };

    case 'mean_reversion':
      logLines.push(`Applying Mean Reversion profile: Finding oversold/overbought levels...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            if (Math.abs(c.change) < 3) return false; // Need some movement
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.abs(c.change) * 0.7) + (Math.log(c.volume + 1) * 0.3)
          })),
        processedCount,
        rejectedSamples
      };

    case 'breakout':
      logLines.push(`Applying Breakout profile: Finding momentum breakout opportunities...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            if (Math.abs(c.change) < 5) return false; // Need significant movement
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.abs(c.change) * 0.6) + (Math.log(c.volume + 1) * 0.4)
          })),
        processedCount,
        rejectedSamples
      };

    case 'default':
    default:
      logLines.push(`Applying Default profile: High volatility and volume focus...`);
      return {
        contracts: contracts
          .filter(c => {
            if (c.volume < MIN_VOLUME_USD) return false;
            return true;
          })
          .map(c => ({
            ...c,
            score: (Math.log(c.volume + 1) * 0.6) + (Math.abs(c.change) * 0.4)
          })),
        processedCount,
        rejectedSamples
      };
  }
}


const discoverContractsFlow = ai.defineFlow(
  {
    name: 'discoverContractsFlow',
    inputSchema: DiscoverContractsInputSchema,
    outputSchema: DiscoverContractsOutputSchema,
  },
  async input => {
    const { contracts } = await discoverContracts(input);
    return contracts.map(c => c.contract);
  }
);
