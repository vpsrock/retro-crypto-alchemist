// This is a server-side file.
'use server';

/**
 * @fileOverview Analyzes crypto futures contracts using technical analysis and AI, providing trade recommendations.
 *
 * - analyzeTradeRecommendations - Analyzes and provides trade recommendations for a given crypto futures contract.
 * - AnalyzeTradeRecommendationsInput - The input type for the analyzeTradeRecommendations function.
 * - AnalyzeTradeRecommendationsOutput - The return type for the analyzeTradeRecommendations function.
 */

import {ai} from '@/ai/genkit';
import {googleAI} from '@genkit-ai/googleai';
import {z} from 'genkit';
import { Decimal } from 'decimal.js';
import { RSI, MACD, BollingerBands, ATR, Stochastic, OBV, EMA } from 'technicalindicators';
import { 
  AnalyzeTradeRecommendationsInputSchema,
  AnalyzeTradeRecommendationsOutputSchema,
  AiTradeCallSchema,
} from '@/lib/schemas';
import type { 
  AnalyzeTradeRecommendationsInput, 
  AnalyzeTradeRecommendationsOutput,
  AiTradeCall
} from '@/lib/schemas';

// Require the OpenAI library once at the module level.
const OpenAI = require('openai');
// Cache for OpenAI clients to avoid re-initialization on every call.
const openAIClients = new Map<string, any>();

function getOpenAIClient(apiKey: string) {
    if (!apiKey) {
        throw new Error('OpenAI API key is missing. Please add it in Settings.');
    }
    if (openAIClients.has(apiKey)) {
        return openAIClients.get(apiKey);
    }
    const client = new OpenAI({ apiKey });
    openAIClients.set(apiKey, client);
    return client;
}

export type { AnalyzeTradeRecommendationsInput, AnalyzeTradeRecommendationsOutput };

export async function analyzeTradeRecommendations(input: AnalyzeTradeRecommendationsInput): Promise<AnalyzeTradeRecommendationsOutput | null> {
  return analyzeTradeRecommendationsFlow(input);
}

// New function that accepts scheduler logger for enhanced logging
export async function analyzeTradeRecommendationsWithLogger(
  input: AnalyzeTradeRecommendationsInput, 
  schedulerLogger?: any
): Promise<AnalyzeTradeRecommendationsOutput | null> {
  return analyzeTradeRecommendationsWithLoggerInternal(input, schedulerLogger);
}

async function analyzeTradeRecommendationsWithLoggerInternal(
  input: AnalyzeTradeRecommendationsInput,
  schedulerLogger?: any
): Promise<AnalyzeTradeRecommendationsOutput | null> {
  const { contract, settle, tickerData } = input;

  const rawData = await fetchGateioData(settle, contract, input.interval, tickerData);
  const analysisPayload = await prepareAnalysisPayload(rawData, contract);
  const { aiCall, fullPrompt, rawResponse, requestDetails } = await getAiTradeCall(analysisPayload, input, schedulerLogger);
  
  const trade_url = `https://www.gate.com/futures/${settle.toUpperCase()}/${contract}`;

  const output: AnalyzeTradeRecommendationsOutput = {
    market: contract,
    trade_url,
    trade_call: aiCall.trade_call,
    confidence_score: aiCall.confidence_score,
    current_price: analysisPayload.current_price,
    take_profit: aiCall.take_profit,
    stop_loss: aiCall.stop_loss,
    summary: aiCall.summary,
    rsi_14: analysisPayload.rsi_14,
    macd: analysisPayload.macd,
    macdsignal: analysisPayload.macdsignal,
    bollinger_upper: analysisPayload.bollinger_upper,
    bollinger_lower: analysisPayload.bollinger_lower,
    atr_14: analysisPayload.atr_14,
    stoch_k: analysisPayload.stoch_k,
    stoch_d: analysisPayload.stoch_d,
    ema_12: analysisPayload.ema_12,
    ema_26: analysisPayload.ema_26,
    obv: analysisPayload.obv,
    buy_sell_ratio: analysisPayload.buy_sell_ratio,
    imbalance_ratio: analysisPayload.imbalance_ratio,
    recent_buy_volume: analysisPayload.recent_buy_volume,
    recent_sell_volume: analysisPayload.recent_sell_volume,
    spread: analysisPayload.spread,
    funding_rate: analysisPayload.funding_rate,
    volume_24h_usd: analysisPayload["24h_volume_usd"],
    open_interest_contracts: analysisPayload.open_interest_contracts,
    snapshot_timestamp_utc: analysisPayload.snapshot_timestamp_utc,
    analysisPayload: analysisPayload,
    prompt: fullPrompt,
    rawResponse: rawResponse,
    // Add request details for enhanced logging
    requestDetails: requestDetails,
  };

  return output;
}

async function fetchGateioData(settle: string, contract: string, interval: string, providedTickerData?: any): Promise<any> {
    const baseUrl = "https://api.gateio.ws/api/v4";
    const headers = { 
        'Accept': 'application/json', 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
    };
    
    const fetchPromises = [
         fetch(`${baseUrl}/futures/${settle}/candlesticks?${new URLSearchParams({contract, interval, limit: '500'})}`, {headers, cache: 'no-store'}),
         fetch(`${baseUrl}/futures/${settle}/order_book?${new URLSearchParams({contract, interval: '0', limit: '100'})}`, {headers, cache: 'no-store'}),
         fetch(`${baseUrl}/futures/${settle}/trades?${new URLSearchParams({contract, limit: '500'})}`, {headers, cache: 'no-store'}),
    ];

    if (!providedTickerData) {
        fetchPromises.push(fetch(`${baseUrl}/futures/${settle}/tickers`, {headers, cache: 'no-store'})); // Always fetch fresh data - no caching
    }

    const responses = await Promise.all(fetchPromises);
    const [candlestickRes, orderbookRes, tradesRes, allTickersRes] = responses;

    if (!candlestickRes.ok) throw new Error(`Gate.io API error for candlesticks: ${candlestickRes.status}`);
    if (!orderbookRes.ok) throw new Error(`Gate.io API error for order book: ${orderbookRes.status}`);
    if (!tradesRes.ok) throw new Error(`Gate.io API error for trades: ${tradesRes.status}`);
    
    let tickerData = providedTickerData;
    if (allTickersRes) {
         if (!allTickersRes.ok) throw new Error(`Gate.io API error for ticker: ${allTickersRes.status}`);
         const allTickers = await allTickersRes.json();
         tickerData = allTickers.find((t: any) => t.contract === contract);
    }
    
    if (!tickerData) {
        throw new Error(`Could not find or fetch ticker data for ${contract}.`);
    }

    const [candlesticks, orderBook, trades] = await Promise.all([
        candlestickRes.json(),
        orderbookRes.json(),
        tradesRes.json(),
    ]);

    return { candlesticks, order_book: orderBook, trades, ticker_data: tickerData };
}

async function prepareAnalysisPayload(raw_data: any, contract: string): Promise<any> {
    const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));
    
    console.log(`[${new Date().toISOString()}] TECHNICAL: Starting technical analysis for ${contract}`);
    
    const ticker_data = raw_data?.ticker_data;
    if (!ticker_data) throw new Error(`Ticker data missing for ${contract}.`);
    
    const last_price_raw = ticker_data?.last;
    if (last_price_raw === undefined) throw new Error(`Could not determine last price for ${contract}.`);

    if (!raw_data?.candlesticks || raw_data.candlesticks.length === 0) {
        throw new Error(`Candlestick data missing or empty for ${contract}.`);
    }

    const df = raw_data.candlesticks.map((candle: { t: number; v: string; c: string; h: string; l: string; o: string; }) => ({
        timestamp: candle.t,
        volume: Number(candle.v),
        close: Number(candle.c),
        high: Number(candle.h),
        low: Number(candle.l),
        open: Number(candle.o)
    })).filter((c: any) => !isNaN(c.close) && !isNaN(c.high) && !isNaN(c.low) && c.close > 0);

    const requiredCandles = 26;
    if (df.length < requiredCandles) {
      throw new Error(`Not enough valid candlestick data for ${contract}. Found ${df.length}, need at least ${requiredCandles} for all indicators.`);
    }

    console.log(`[${new Date().toISOString()}] TECHNICAL: Processing ${df.length} candles for ${contract}`);

    const closePrices = df.map((c: any) => c.close);
    const highPrices = df.map((c: any) => c.high);
    const lowPrices = df.map((c: any) => c.low);
    const volumes = df.map((c: any) => c.volume);

    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating RSI for ${contract}`);
    await yieldToEventLoop();
    const rsiResult = RSI.calculate({ values: closePrices, period: 14 });
    const lastRsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;
    
    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating MACD for ${contract}`);
    await yieldToEventLoop();
    const macdInput = { values: closePrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false };
    const macdResult = MACD.calculate(macdInput);
    const lastMacd = macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;
    
    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating Bollinger Bands for ${contract}`);
    await yieldToEventLoop();
    const bbInput = { period: 20, values: closePrices, stdDev: 2 };
    const bbResult = BollingerBands.calculate(bbInput);
    const lastBb = bbResult.length > 0 ? bbResult[bbResult.length - 1] : null;

    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating ATR for ${contract}`);
    await yieldToEventLoop();
    const atrInput = { high: highPrices, low: lowPrices, close: closePrices, period: 14 };
    const atrResult = ATR.calculate(atrInput);
    const lastAtr = atrResult.length > 0 ? atrResult[atrResult.length - 1] : null;

    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating Stochastic for ${contract}`);
    await yieldToEventLoop();
    const stochasticInput = { high: highPrices, low: lowPrices, close: closePrices, period: 14, signalPeriod: 3 };
    const stochasticResult = Stochastic.calculate(stochasticInput);
    const lastStoch = stochasticResult.length > 0 ? stochasticResult[stochasticResult.length - 1] : null;

    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating EMA indicators for ${contract}`);
    await yieldToEventLoop();
    const ema12Result = EMA.calculate({ period: 12, values: closePrices });
    const lastEma12 = ema12Result.length > 0 ? ema12Result[ema12Result.length - 1] : null;
    const ema26Result = EMA.calculate({ period: 26, values: closePrices });
    const lastEma26 = ema26Result.length > 0 ? ema26Result[ema26Result.length - 1] : null;

    console.log(`[${new Date().toISOString()}] TECHNICAL: Calculating OBV for ${contract}`);
    await yieldToEventLoop();
    const obvInput = { close: closePrices, volume: volumes };
    const obvResult = OBV.calculate(obvInput);
    const lastObv = obvResult.length > 0 ? obvResult[obvResult.length - 1] : null;

    console.log(`[${new Date().toISOString()}] TECHNICAL: Completed technical analysis for ${contract}`);
    const tech_analysis = { 
        rsi_14: lastRsi ? Number(lastRsi.toFixed(2)) : null,
        macd: (lastMacd && lastMacd.MACD !== undefined) ? Number(lastMacd.MACD.toFixed(8)) : null,
        macdsignal: (lastMacd && lastMacd.signal !== undefined) ? Number(lastMacd.signal.toFixed(8)) : null,
        bollinger_upper: (lastBb && lastBb.upper !== undefined) ? Number(lastBb.upper.toFixed(8)) : null,
        bollinger_lower: (lastBb && lastBb.lower !== undefined) ? Number(lastBb.lower.toFixed(8)) : null,
        atr_14: lastAtr ? Number(lastAtr.toFixed(8)) : null,
        stoch_k: (lastStoch && lastStoch.k !== undefined) ? Number(lastStoch.k.toFixed(2)) : null,
        stoch_d: (lastStoch && lastStoch.d !== undefined) ? Number(lastStoch.d.toFixed(2)) : null,
        ema_12: lastEma12 ? Number(lastEma12.toFixed(8)) : null,
        ema_26: lastEma26 ? Number(lastEma26.toFixed(8)) : null,
        obv: lastObv ? Number(lastObv.toFixed(0)) : null,
    };

    const order_book = raw_data?.order_book;
    const bids = order_book?.bids || [];
    const asks = order_book?.asks || [];
    const highest_bid = bids.length > 0 ? Number(bids[0].p) : 0;
    const lowest_ask = asks.length > 0 ? Number(asks[0].p) : 0;
    const total_bid_vol = bids.reduce((sum: number, bid: any) => sum + Number(bid.s), 0);
    const total_ask_vol = asks.reduce((sum: number, ask: any) => sum + Number(ask.s), 0);

    const trades = raw_data?.trades || [];
    const buy_vol = trades.reduce((sum: number, trade: any) => sum + (trade.size > 0 ? Number(trade.size) : 0), 0);
    const sell_vol = trades.reduce((sum: number, trade: any) => sum + (trade.size < 0 ? Math.abs(Number(trade.size)) : 0), 0);
    
    let volume24hUsd = ticker_data?.volume_24h_usd;
    if (!volume24hUsd || typeof volume24hUsd !== 'string') {
        volume24hUsd = ticker_data?.volume_24h_settle;
    }

    return {
        market: contract,
        snapshot_timestamp_utc: Date.now(),
        current_price: Number(last_price_raw),
        ...tech_analysis,
        spread: Number((lowest_ask - highest_bid).toFixed(8)),
        imbalance_ratio: Number(((total_bid_vol / (total_bid_vol + total_ask_vol)) || 0.5).toFixed(2)),
        recent_buy_volume: buy_vol,
        recent_sell_volume: sell_vol,
        buy_sell_ratio: Number(((buy_vol / (buy_vol + sell_vol)) || 0.5).toFixed(2)),
        open_interest_contracts: Number(ticker_data?.total_size || 0),
        funding_rate: new Decimal(ticker_data?.funding_rate || 0).toFixed(4),
        "24h_volume_usd": new Decimal(volume24hUsd || 0).toFixed(2),
    };
}

async function getAiTradeCall(
    payload: any,
    input: AnalyzeTradeRecommendationsInput,
    schedulerLogger?: any
): Promise<{aiCall: AiTradeCall, fullPrompt: string, rawResponse: string, requestDetails: any}> {
    const { contract, modelConfig, openaiApiKey, promptTemplate, interval } = input;

    console.log(`[${new Date().toISOString()}] AI: Creating prompt for ${contract}`);
    
    // First, replace the timeframe placeholder, then the JSON snapshot.
    const promptWithTimeframe = promptTemplate.replace(/\[TIMEFRAME\]/g, interval);
    const fullPrompt = promptWithTimeframe.replace('<<INSERT JSON SNAPSHOT HERE>>', JSON.stringify(payload, null, 2));
    
    console.log(`[${new Date().toISOString()}] AI: Prompt created for ${contract} (${fullPrompt.length} chars)`);
    
    if (modelConfig.provider === 'openai') {
        if (!openaiApiKey) {
            throw new Error('OpenAI API key is missing. Please add it in Settings.');
        }
        try {
            const completionParams: any = {
                model: modelConfig.modelId,
                messages: [{ role: "user", content: fullPrompt }],
            };
            
            if (modelConfig.modelType === 'reasoning') {
                completionParams.response_format = { type: "json_object" };
            }

            // Log detailed AI request information
            const requestDetails = {
                provider: modelConfig.provider,
                modelId: modelConfig.modelId,
                modelName: modelConfig.name,
                modelType: modelConfig.modelType,
                temperature: completionParams.temperature,
                maxTokens: completionParams.max_tokens,
                responseFormat: completionParams.response_format,
                promptLength: fullPrompt.length,
                promptPreview: fullPrompt.substring(0, 500) + (fullPrompt.length > 500 ? '...' : ''),
                fullPrompt: fullPrompt
            };

            console.log(`[${new Date().toISOString()}] AI: Sending request to OpenAI for ${contract}`, requestDetails);
            
            // Log to scheduler logger if available
            if (schedulerLogger) {
                schedulerLogger.log('DEBUG', 'AI_REQUEST', `AI request sent for ${contract}`, {
                    contract,
                    ...requestDetails
                });
            }

            const requestStart = Date.now();
            const client = getOpenAIClient(openaiApiKey);
            const response = await client.chat.completions.create(completionParams);
            const requestDuration = Date.now() - requestStart;
            
            console.log(`[${new Date().toISOString()}] AI: Received response from OpenAI for ${contract}`);
            const responseContent = response.choices[0].message.content;
            if (!responseContent) {
                throw new Error('AI returned an empty response.');
            }
            console.log(`[${new Date().toISOString()}] AI: Processing AI response for ${contract} (${responseContent.length} chars)`);
            
            let aiCall;
            if (modelConfig.modelType === 'reasoning') {
                aiCall = JSON.parse(responseContent);
            } else {
                const jsonMatch = responseContent.match(/```json\n([\s\S]*?)\n```/);
                if (jsonMatch && jsonMatch[1]) {
                     try {
                        aiCall = JSON.parse(jsonMatch[1]);
                    } catch (e: any) {
                         throw new Error(`Failed to parse JSON from AI response markdown block. Error: ${e.message}. Content: ${jsonMatch[1]}`);
                    }
                } else {
                    try {
                        aiCall = JSON.parse(responseContent);
                    } catch (e: any) {
                        throw new Error(`AI response was not valid JSON and did not contain a JSON code block. Content: ${responseContent}`);
                    }
                }
            }

            // Log detailed AI response information
            const responseDetails = {
                responseLength: responseContent.length,
                responsePreview: responseContent.substring(0, 500) + (responseContent.length > 500 ? '...' : ''),
                fullResponse: responseContent,
                parsedResult: {
                    confidence: aiCall.confidence_score,
                    tradeCall: aiCall.trade_call,
                    takeProfit: aiCall.take_profit,
                    stopLoss: aiCall.stop_loss
                },
                duration: requestDuration
            };

            // Log to scheduler logger if available
            if (schedulerLogger) {
                schedulerLogger.log('SUCCESS', 'AI_RESPONSE', `AI response received for ${contract}`, {
                    contract,
                    ...responseDetails
                });
            }

            return { aiCall, fullPrompt, rawResponse: responseContent, requestDetails };
        } catch (error: any) {
            // Log error to scheduler logger if available
            if (schedulerLogger) {
                schedulerLogger.log('ERROR', 'AI_REQUEST', `AI request failed for ${contract}`, { contract }, error);
            }
            throw new Error(`Error during OpenAI API call for ${contract}: ${error.message}`);
        }
    } else {
        // For Google AI models, we'll use OpenAI for now since genkit integration needs adjustment
        throw new Error('Google AI models are temporarily unavailable. Please use OpenAI models.');
    }
}

const analyzeTradeRecommendationsFlow = ai.defineFlow(
  {
    name: 'analyzeTradeRecommendationsFlow',
    inputSchema: AnalyzeTradeRecommendationsInputSchema,
    outputSchema: z.nullable(AnalyzeTradeRecommendationsOutputSchema),
  },
  async input => {
    const { contract, settle, tickerData } = input;

    const rawData = await fetchGateioData(settle, contract, input.interval, tickerData);
    const analysisPayload = await prepareAnalysisPayload(rawData, contract);
    const result = await getAiTradeCall(analysisPayload, input);
    const { aiCall, fullPrompt, rawResponse } = result;
    
    const trade_url = `https://www.gate.com/futures/${settle.toUpperCase()}/${contract}`;

    const output: AnalyzeTradeRecommendationsOutput = {
      market: contract,
      trade_url,
      trade_call: aiCall.trade_call,
      confidence_score: aiCall.confidence_score,
      current_price: analysisPayload.current_price,
      take_profit: aiCall.take_profit,
      stop_loss: aiCall.stop_loss,
      summary: aiCall.summary,
      rsi_14: analysisPayload.rsi_14,
      macd: analysisPayload.macd,
      macdsignal: analysisPayload.macdsignal,
      bollinger_upper: analysisPayload.bollinger_upper,
      bollinger_lower: analysisPayload.bollinger_lower,
      atr_14: analysisPayload.atr_14,
      stoch_k: analysisPayload.stoch_k,
      stoch_d: analysisPayload.stoch_d,
      ema_12: analysisPayload.ema_12,
      ema_26: analysisPayload.ema_26,
      obv: analysisPayload.obv,
      buy_sell_ratio: analysisPayload.buy_sell_ratio,
      imbalance_ratio: analysisPayload.imbalance_ratio,
      recent_buy_volume: analysisPayload.recent_buy_volume,
      recent_sell_volume: analysisPayload.recent_sell_volume,
      spread: analysisPayload.spread,
      funding_rate: analysisPayload.funding_rate,
      volume_24h_usd: analysisPayload["24h_volume_usd"],
      open_interest_contracts: analysisPayload.open_interest_contracts,
      snapshot_timestamp_utc: analysisPayload.snapshot_timestamp_utc,
      analysisPayload: analysisPayload,
      prompt: fullPrompt,
      rawResponse: rawResponse,
    };

    return output;
  }
);
