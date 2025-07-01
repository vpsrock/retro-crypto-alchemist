"use server";

import { discoverContracts, DiscoverContractsInput } from "@/ai/flows/discover-contracts";
import { analyzeTradeRecommendations, AnalyzeTradeRecommendationsInput } from "@/ai/flows/analyze-trade-recommendations";
import { placeTradeStrategy, listOpenOrders, cancelOrder, listOpenPositions, cleanupOrphanedOrders } from "@/ai/flows/trade-management";
import type { PlaceTradeStrategyInput, ListOpenOrdersInput, CancelOrderInput, ListOpenPositionsInput } from "@/ai/flows/trade-management";

export async function runSingleContractAnalysis(data: AnalyzeTradeRecommendationsInput) {
  const startTime = Date.now();
  
  try {
    console.log(`[${new Date().toISOString()}] Starting analysis for ${data.contract}`);
    const result = await analyzeTradeRecommendations(data);
    const duration = Date.now() - startTime;
    
    if (!result) {
      console.log(`[${new Date().toISOString()}] Analysis failed for ${data.contract} after ${duration}ms`);
      return { error: 'Analysis failed to return a result. The contract may not exist or the API is unavailable.' };
    }
    
    console.log(`[${new Date().toISOString()}] Analysis completed for ${data.contract} in ${duration}ms (Score: ${result.confidence_score}%)`);
    return { data: result };
  } catch (e: any) {
    const duration = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] Single contract analysis error for ${data.contract} after ${duration}ms:`, e);
    return { error: `Analysis for ${data.contract} failed: ${e.message || e.toString()}` };
  }
}

export async function runContractDiscovery(data: DiscoverContractsInput) {
  try {
    console.log(`[${new Date().toISOString()}] Starting contract discovery for ${data.contractsToFind} contracts`);
    const result = await discoverContracts(data);
    if (!result || !result.contracts || result.contracts.length === 0) {
      return { error: 'Discovery completed but found no contracts. The market may be quiet or filters are too strict.', data: result };
    }
    console.log(`[${new Date().toISOString()}] Discovery completed, found ${result.contracts.length} contracts`);
    return { data: result };
  } catch (e: any) {
    console.error("Contract discovery error:", e);
    return { error: e.message || e.toString() };
  }
}

export async function runPlaceTradeStrategy(data: PlaceTradeStrategyInput) {
    try {
        const result = await placeTradeStrategy(data);
        return { data: result };
    } catch (e: any) {
        console.error("Place trade strategy error:", e);
        return { error: e.message || e.toString() };
    }
}

export async function runListOpenOrders(data: ListOpenOrdersInput) {
    try {
        const result = await listOpenOrders(data);
        return { data: result };
    } catch (e: any) {
        console.error("List open orders error:", e);
        return { error: e.message || e.toString() };
    }
}

export async function runCancelOrder(data: CancelOrderInput) {
    try {
        const result = await cancelOrder(data);
        return { data: result };
    } catch (e: any) {
        console.error("Cancel order error:", e);
        return { error: e.message || e.toString() };
    }
}

export async function runListOpenPositions(data: ListOpenPositionsInput) {
    try {
        const result = await listOpenPositions(data);
        return { data: result };
    } catch (e: any) {
        console.error("List open positions error:", e);
        return { error: e.message || e.toString() };
    }
}

export async function runCleanupOrphanedOrders(data: ListOpenOrdersInput) {
    try {
        const result = await cleanupOrphanedOrders(data);
        return { data: result };
    } catch (e: any) {
        console.error("Cleanup orphaned orders error:", e);
        return { error: e.message || e.toString() };
    }
}
