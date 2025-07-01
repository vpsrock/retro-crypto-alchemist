import { z } from "zod";

// Settings Schemas
export const apiKeySettingsSchema = z.object({
  gateIoKey: z.string().optional(),
  gateIoSecret: z.string().optional(),
  openaiApiKey: z.string().optional(),
});
export type ApiKeySettings = z.infer<typeof apiKeySettingsSchema>;

export const aiModelConfigSchema = z.object({
    id: z.string(),
    name: z.string().min(1, "Name is required"),
    provider: z.enum(["openai", "googleai"]),
    modelId: z.string().min(1, "Model ID is required"),
    modelType: z.enum(["reasoning", "standard"]).default("standard").describe("The type of model, which can affect prompting strategy. 'reasoning' models support forced JSON output."),
    enabled: z.boolean(),
});
export type AiModelConfig = z.infer<typeof aiModelConfigSchema>;

export const promptSettingsSchema = z.object({
    id: z.string(),
    name: z.string(),
    content: z.string().min(10, "Prompt content is too short"),
});
export type PromptSettings = z.infer<typeof promptSettingsSchema>;


// Form Schemas
export const singleContractSchema = z.object({
  contract: z.string().min(3, "Contract name is required.").toUpperCase(),
  settle: z.enum(["usdt", "btc"]),
  interval: z.enum(["5m", "15m", "1h", "4h"]),
  threshold: z.number().min(0).max(100),
});
export type SingleContractValues = z.infer<typeof singleContractSchema>;


export const multiContractSchema = z.object({
    contracts: z.string().min(3, "At least one contract is required."),
    profile: z.enum(["default", "mean_reversion", "breakout", "low_cap_gems", "volume_surge", "contrarian", "funding_arbitrage", "new_listings", "stablecoin_pairs"]),
    settle: z.enum(["usdt", "btc"]),
    interval: z.enum(["5m", "15m", "1h", "4h"]),
    threshold: z.number().min(0).max(100),
});
export type MultiContractValues = z.infer<typeof multiContractSchema>;

export const discoverySchema = z.object({
    settle: z.enum(["usdt", "btc"]),
    interval: z.enum(["5m", "15m", "1h", "4h"]),
    threshold: z.number().min(0).max(100),
    contractsToFind: z.number().min(1).max(50).default(10),
    concurrency: z.number().min(1).max(20).default(10),
    profile: z.enum(["default", "mean_reversion", "breakout", "low_cap_gems", "volume_surge", "contrarian", "funding_arbitrage", "new_listings", "stablecoin_pairs"]),
    minVolume: z.number().min(0).default(1000000),
    sortBy: z.enum(["score", "volume", "change"]).default("score"),
    tradeSizeUsd: z.number().min(5).max(1000).default(10),
    leverage: z.number().min(1).max(100).default(10),
});
export type DiscoveryValues = z.infer<typeof discoverySchema>;


// AI Flow Schemas

export const AnalyzeTradeRecommendationsInputSchema = z.object({
  contract: z.string().describe('The crypto futures contract to analyze (e.g., BTC_USDT).'),
  settle: z.enum(["usdt", "btc"]).describe("Settlement currency ('usdt' or 'btc')."),
  interval: z.string().describe("Candle interval (e.g., '15m', '1h')."),
  openaiApiKey: z.string().optional().describe('The OpenAI API key for accessing the AI model.'),
  modelConfig: aiModelConfigSchema,
  promptTemplate: z.string(),
  threshold: z.number().min(0).max(100).optional(),
  tickerData: z.any().optional().describe('Pre-fetched ticker data to avoid redundant API calls.'),
});
export type AnalyzeTradeRecommendationsInput = z.infer<typeof AnalyzeTradeRecommendationsInputSchema>;

export type SingleContractInput = z.infer<typeof AnalyzeTradeRecommendationsInputSchema>;

export const AiTradeCallSchema = z.object({
  summary: z.string().describe('A summary of the analysis.'),
  trade_call: z.string().describe('Trade recommendation (long, short, or hold).'),
  take_profit: z.number().describe('Take profit price.'),
  stop_loss: z.number().describe('Stop loss price.'),
  confidence_score: z.number().describe('Confidence score (0-100).'),
});
export type AiTradeCall = z.infer<typeof AiTradeCallSchema>;

export const AnalyzeTradeRecommendationsOutputSchema = z.object({
  market: z.string().describe('The crypto futures contract being analyzed.'),
  trade_url: z.string().describe('The URL for trading the contract on Gate.io.'),
  trade_call: z.string().describe('The AI trade recommendation (long or short).'),
  confidence_score: z.number().describe('The confidence score of the AI trade recommendation (0-100).'),
  current_price: z.number().describe('The current price of the contract.'),
  take_profit: z.number().optional().describe('The take profit price.'),
  stop_loss: z.number().optional().describe('The stop loss price.'),
  summary: z.string().describe('A summary of the AI analysis and reasoning.'),
  rsi_14: z.number().nullable().describe('The 14-period Relative Strength Index.'),
  macd: z.number().nullable().describe('The Moving Average Convergence Divergence value.'),
  macdsignal: z.number().nullable().describe('The MACD signal value.'),
  bollinger_upper: z.number().nullable().describe('The upper Bollinger Band value.'),
  bollinger_lower: z.number().nullable().describe('The lower Bollinger Band value.'),
  atr_14: z.number().nullable().describe('The 14-period Average True Range, a volatility measure.'),
  stoch_k: z.number().nullable().describe('The %K line of the Stochastic Oscillator, a momentum indicator.'),
  stoch_d: z.number().nullable().describe('The %D line (signal line) of the Stochastic Oscillator.'),
  ema_12: z.number().nullable().describe('The 12-period Exponential Moving Average.'),
  ema_26: z.number().nullable().describe('The 26-period Exponential Moving Average.'),
  obv: z.number().nullable().describe('On-Balance Volume, a momentum indicator based on volume.'),
  buy_sell_ratio: z.number().describe('The ratio of buy volume to sell volume.'),
  imbalance_ratio: z.number().describe('The order book imbalance ratio.'),
  recent_buy_volume: z.number().describe('The recent buy volume.'),
  recent_sell_volume: z.number().describe('The recent sell volume.'),
  spread: z.number().describe('The spread between the highest bid and lowest ask.'),
  funding_rate: z.string().describe('The funding rate as a string.'),
  volume_24h_usd: z.string().describe('The 24-hour trading volume in USD as a string.'),
  open_interest_contracts: z.number().describe('The open interest in number of contracts.'),
  snapshot_timestamp_utc: z.number().describe('The timestamp of the data snapshot in UTC.'),
  analysisPayload: z.any().optional().describe("The full payload sent to the AI."),
  prompt: z.string().optional().describe("The full prompt sent to the AI."),
  rawResponse: z.string().optional().describe("The raw, unparsed response from the AI model."),
});
export type AnalyzeTradeRecommendationsOutput = z.infer<typeof AnalyzeTradeRecommendationsOutputSchema>;

export const CombinedResultSchema = AnalyzeTradeRecommendationsOutputSchema.extend({
  found_by_profile: z.string().describe('The profile that identified this contract.'),
  final_decision: z.string().describe('Final decision (TRADE, SKIP).'),
  tradeSizeUsd: z.number().optional(),
  leverage: z.number().optional(),
});
export type CombinedResult = z.infer<typeof CombinedResultSchema>;

export const ConfigureAIModelsInputSchema = z.array(aiModelConfigSchema).describe('Array of AI model configurations.');
export type ConfigureAIModelsInput = z.infer<typeof ConfigureAIModelsInputSchema>;

export const ConfigureAIModelsOutputSchema = z.object({
  configuredModels: z.array(aiModelConfigSchema).describe('The list of configured AI models.'),
});
export type ConfigureAIModelsOutput = z.infer<typeof ConfigureAIModelsOutputSchema>;

export const DiscoverContractsInputSchema = z.object({
  settle: z.enum(['usdt', 'btc']).describe('The settlement currency.'),
  contractsToFind: z.number().min(1).max(100).describe('The number of contracts to find.'),
  minVolume: z.number().min(0).describe('The minimum 24h volume in USD.'),
  sortBy: z.enum(['score', 'volume', 'change']).describe('The sorting strategy.'),
  profile: z.enum(["default", "mean_reversion", "breakout", "low_cap_gems", "volume_surge", "contrarian", "funding_arbitrage", "new_listings", "stablecoin_pairs"]).optional().default("default").describe('The scanning profile to use.'),
});
export type DiscoverContractsInput = z.infer<typeof DiscoverContractsInputSchema>;

export const DiscoverContractsOutputSchema = z.array(z.string()).describe('A list of contract names.');
export type DiscoverContractsOutput = z.infer<typeof DiscoverContractsOutputSchema>;

// Trade Management Schemas

export const PlaceTradeStrategyInputSchema = z.object({
    settle: z.enum(['usdt', 'btc']),
    tradeDetails: CombinedResultSchema,
    tradeSizeUsd: z.number().positive(),
    leverage: z.number().min(1).max(100),
    apiKey: z.string(),
    apiSecret: z.string(),
});
export type PlaceTradeStrategyInput = z.infer<typeof PlaceTradeStrategyInputSchema>;

export const PlaceTradeStrategyOutputSchema = z.object({
    entry_order_id: z.string(),
    take_profit_order_id: z.string(),
    stop_loss_order_id: z.string(),
    message: z.string(),
});
export type PlaceTradeStrategyOutput = z.infer<typeof PlaceTradeStrategyOutputSchema>;

export const ListOpenOrdersInputSchema = z.object({
    settle: z.enum(['usdt', 'btc']),
    apiKey: z.string(),
    apiSecret: z.string(),
});
export type ListOpenOrdersInput = z.infer<typeof ListOpenOrdersInputSchema>;

export const FuturesPriceTriggeredOrderSchema = z.object({
    initial: z.object({
        contract: z.string(),
        size: z.number(),
        price: z.string(),
        close: z.boolean().optional(),
        tif: z.string().optional(),
        text: z.string().optional(),
        reduce_only: z.boolean().optional(),
        auto_size: z.string().optional(),
    }),
    trigger: z.object({
        strategy_type: z.number().optional(),
        price_type: z.number().optional(),
        price: z.string(),
        rule: z.number(),
        expiration: z.number().optional(),
    }),
    id: z.string().optional(),
    user: z.string().optional(),
    create_time: z.number().optional(),
    finish_time: z.number().optional(),
    trade_id: z.string().optional(),
    status: z.string().optional(),
    finish_as: z.string().optional(),
    reason: z.string().optional(),
    order_type: z.string().optional(),
});
export type FuturesPriceTriggeredOrder = z.infer<typeof FuturesPriceTriggeredOrderSchema>;

export const ListOpenOrdersOutputSchema = z.array(FuturesPriceTriggeredOrderSchema);
export type ListOpenOrdersOutput = z.infer<typeof ListOpenOrdersOutputSchema>;

export const CancelOrderInputSchema = z.object({
    settle: z.enum(['usdt', 'btc']),
    orderId: z.string(),
    apiKey: z.string(),
    apiSecret: z.string(),
});
export type CancelOrderInput = z.infer<typeof CancelOrderInputSchema>;

export const CancelOrderOutputSchema = FuturesPriceTriggeredOrderSchema;
export type CancelOrderOutput = z.infer<typeof CancelOrderOutputSchema>;

export const FuturesOrderSchema = z.object({
    id: z.string(),
    text: z.string(),
    create_time: z.number(),
    update_time: z.number(),
    create_time_ms: z.number(),
    update_time_ms: z.number(),
    status: z.string(),
    contract: z.string(),
    size: z.number(),
    price: z.string(),
    left: z.number(),
    fill_price: z.string(),
    tif: z.string(),
    is_reduce_only: z.boolean(),
    is_close: z.boolean(),
    finish_as: z.string(),
});
export type FuturesOrder = z.infer<typeof FuturesOrderSchema>;


// Position Schemas
export const ListOpenPositionsInputSchema = z.object({
    settle: z.enum(['usdt', 'btc']),
    apiKey: z.string(),
    apiSecret: z.string(),
});
export type ListOpenPositionsInput = z.infer<typeof ListOpenPositionsInputSchema>;

export const FuturesPositionSchema = z.object({
    contract: z.string(),
    size: z.number(),
    leverage: z.string(),
    risk_limit: z.string(),
    leverage_max: z.string(),
    maintenance_rate: z.string(),
    value: z.string(),
    margin: z.string(),
    entry_price: z.string(),
    liq_price: z.string(),
    mark_price: z.string(),
    unrealised_pnl: z.string(),
    realised_pnl: z.string(),
    history_pnl: z.string(),
    last_close_pnl: z.string(),
    realised_point: z.string(),
    history_point: z.string(),
    adl_ranking: z.number(),
    pending_orders: z.number(),
    cross_leverage_limit: z.string().optional(),
    update_time: z.number().optional(),
    mode: z.string(),
    maintenance_margin: z.string(),
    realised_pnl_fee: z.string().optional(),
    cross_margin: z.string().optional(),
});
export type FuturesPosition = z.infer<typeof FuturesPositionSchema>;

export const ListOpenPositionsOutputSchema = z.array(FuturesPositionSchema);
export type ListOpenPositionsOutput = z.infer<typeof ListOpenPositionsOutputSchema>;

// Cleanup Schemas
export const CleanupOrphanedOrdersOutputSchema = z.object({
    cancelled_orders: z.array(z.object({
        id: z.string(),
        contract: z.string(),
    })),
    cancellation_failures: z.array(z.object({
        id: z.string().optional(),
        contract: z.string().optional(),
        error: z.string(),
    })).optional(),
    message: z.string(),
    active_position_contracts: z.array(z.string()).optional(),
    open_order_contracts: z.array(z.string()).optional(),
    orphaned_contracts_found: z.array(z.string()).optional(),
});
export type CleanupOrphanedOrdersOutput = z.infer<typeof CleanupOrphanedOrdersOutputSchema>;
