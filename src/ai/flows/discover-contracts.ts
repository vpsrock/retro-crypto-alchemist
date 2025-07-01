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
  
  const MIN_VOLUME_USD = input.minVolume;
  
  let processedCount = 0;
  const rejectedSamples: any[] = [];

  const scoredContracts = tickers
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
      
      if (volume < MIN_VOLUME_USD) {
        if (rejectedSamples.length < 5) {
          rejectedSamples.push({ contract: ticker.contract, reason: `volume ${volume} < minVolume ${MIN_VOLUME_USD}`, data: ticker });
        }
        return null;
      }
      
      // Scoring: 60% weight on log of volume, 40% on absolute price change percentage
      const score = (Math.log(volume + 1) * 0.6) + (Math.abs(change) * 0.4);
      
      return {
        contract: ticker.contract,
        score: parseFloat(score.toFixed(4)),
        volume,
        change,
        tickerData: ticker,
      };
    })
    .filter((c): c is { contract: string; score: number; volume: number; change: number; tickerData: any; } => c !== null);

  logLines.push(`2. Processed ${processedCount} tickers. Filtered out ${processedCount - scoredContracts.length} contracts that did not meet the minimum volume of $${MIN_VOLUME_USD.toLocaleString()}.`);

  if (scoredContracts.length === 0) {
    const minVolumeText = `$${(MIN_VOLUME_USD / 1_000_000).toFixed(0)}M`;
    let errorMessage = `Processed ${processedCount} tickers but found 0 matching the criteria (e.g., volume > ${minVolumeText}). The market may be slow, or you can try adjusting the filters.`;
    if (rejectedSamples.length > 0) {
        errorMessage += `\n\nDEBUG: Sample of rejected contracts:\n${JSON.stringify(rejectedSamples, null, 2)}`;
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
