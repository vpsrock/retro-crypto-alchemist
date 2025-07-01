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
        const tickerRes = await fetch(tickersUrl, {headers, next: { revalidate: 300 }}); // Cache for 5 minutes
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

export async function discoverContracts(input: DiscoverContractsInput): Promise<{contracts: {contract: string, tickerData: any}[], log: string}> {
  const logLines: string[] = [];
  
  const tickers = await fetchAllGateioTickers(input.settle);
  logLines.push(`1. Fetched ${tickers.length} tickers from Gate.io for '${input.settle}' settlement.`);

  if (!tickers || tickers.length === 0) {
    throw new Error('API returned no tickers. The Gate.io API might be temporarily unavailable or there are no contracts for the selected currency.');
  }
  
  // Apply profile-specific filtering and scoring
  const profileResults = applyProfileFiltering(tickers, input, logLines);
  const scoredContracts = profileResults.contracts;
  
  logLines.push(`2. Applied '${input.profile}' profile filtering. Processed ${profileResults.processedCount} tickers, kept ${scoredContracts.length} contracts.`);

  if (scoredContracts.length === 0) {
    const minVolumeText = `$${(input.minVolume / 1_000_000).toFixed(0)}M`;
    let errorMessage = `Applied '${input.profile}' profile but found 0 matching contracts. Try adjusting filters or different profile.`;
    if (profileResults.rejectedSamples.length > 0) {
        errorMessage += `\n\nDEBUG: Sample rejected contracts:\n${JSON.stringify(profileResults.rejectedSamples, null, 2)}`;
    }
    throw new Error(errorMessage);
  }

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
  
  const topContractsForLog = scoredContracts.slice(0, 20).map(c => ({contract: c.contract, score: c.score, volume: c.volume.toLocaleString(), change: c.change}));
  logLines.push(`3. Scored and sorted ${scoredContracts.length} valid contracts by '${input.sortBy}'. Top 20 shown below:\n${JSON.stringify(topContractsForLog, null, 2)}`);

  const finalContractTasks = scoredContracts.slice(0, input.contractsToFind).map(c => ({ contract: c.contract, tickerData: c.tickerData }));
  const contractNamesForLog = finalContractTasks.map(t => t.contract);

  logLines.push(`4. Selected top ${finalContractTasks.length} contracts for analysis: ${contractNamesForLog.join(', ')}.`);
  
  return {
    contracts: finalContractTasks,
    log: logLines.join('\n\n')
  };
}

function applyProfileFiltering(tickers: any[], input: DiscoverContractsInput, logLines: string[]): {
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
  input: DiscoverContractsInput,
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
