"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Header } from "@/components/header";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { AnalysisPanel } from "@/components/dashboard/analysis-panel";
import { ResultsPanel } from "@/components/dashboard/results-panel";
import { OrdersPanel } from "@/components/dashboard/orders-panel";
import { LogPanel, type LogEntry } from "@/components/dashboard/log-panel";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { PositionsPanel } from "@/components/dashboard/positions-panel";
import { SchedulerPanel } from "@/components/dashboard/scheduler-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { discoverySchema, type AnalyzeTradeRecommendationsOutput, type ApiKeySettings, type AiModelConfig, type PromptSettings, type DiscoveryValues, type MultiContractValues, type SingleContractValues, type CombinedResult, type ListOpenOrdersOutput, type ListOpenPositionsOutput } from "@/lib/schemas";
import { runSingleContractAnalysis, runContractDiscovery, runPlaceTradeStrategy, runListOpenOrders, runCancelOrder, runListOpenPositions, runCleanupOrphanedOrders } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { settingsService, type DiscoveryDefaults } from "@/services/settings";

// Temporary stub - settings will be loaded from database
const safelyParseJson = (jsonString: string | null, defaultValue: any) => {
  return defaultValue; // Return default for now, will be replaced by database loading
};

const defaultDiscoveryValues: DiscoveryValues = {
    settle: "usdt",
    interval: "15m",
    threshold: 75,
    contractsPerProfile: 10,
    concurrency: 10,
    profiles: ["default"],
    minVolume: 1000000,
    sortBy: "score",
    tradeSizeUsd: 10,
    leverage: 10,
};

export default function Home() {
  const logCounter = React.useRef(0);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [results, setResults] = React.useState<CombinedResult[]>([]);
  const [openOrders, setOpenOrders] = React.useState<ListOpenOrdersOutput>([]);
  const [isFetchingOrders, setIsFetchingOrders] = React.useState(false);
  const [openPositions, setOpenPositions] = React.useState<ListOpenPositionsOutput>([]);
  const [isFetchingPositions, setIsFetchingPositions] = React.useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = React.useState(true);

  const { toast } = useToast();

  // --- State Initialization with LocalStorage ---

  const [apiKeys, setApiKeys] = React.useState<ApiKeySettings>({
      gateIoKey: "",
      gateIoSecret: "",
      openaiApiKey: "",
    });

  const [aiModels, setAiModels] = React.useState<AiModelConfig[]>([]);

  const [prompts, setPrompts] = React.useState<PromptSettings[]>([]);
  
  const discoveryForm = useForm<DiscoveryValues>({
    resolver: zodResolver(discoverySchema),
    defaultValues: defaultDiscoveryValues,
  });
  
  React.useEffect(() => {
    // Initialize app settings from localStorage
    setApiKeys(safelyParseJson(localStorage.getItem("apiKeys"), {
      gateIoKey: "",
      gateIoSecret: "",
      openaiApiKey: "",
    }));

    setAiModels(safelyParseJson(localStorage.getItem("aiModels"), [
      { id: "1", name: "OpenAI GPT-4o Mini (JSON Mode)", provider: "openai", modelId: "gpt-4o-mini", modelType: "reasoning", enabled: true },
      { id: "2", name: "Google Gemini 2.0 Flash (JSON Mode)", provider: "googleai", modelId: "gemini-2.0-flash", modelType: "reasoning", enabled: false },
      { id: "3", name: "OpenAI GPT-4 Turbo (Legacy)", provider: "openai", modelId: "gpt-4-turbo", modelType: "standard", enabled: false },
    ]));
    
    const storedPrompts = safelyParseJson(localStorage.getItem("prompts_v3"), null);
    if (storedPrompts) {
        setPrompts(storedPrompts);
    } else {
        const defaultPrompts = [
          { 
            id: "1", 
            name: "Reasoning Model Prompt (for JSON mode)",
            content: `You are “Sigma-Desk”, a quant-style crypto-futures strategist.

########################
## 1. SCOPE & RULESET ##
########################
Analyse the supplied JSON snapshot for a **[TIMEFRAME]** perpetual-futures market.  
Only recommend a trade when **all** of these conditions hold (else return 'hold'):

1. RSI divergence or value < 35 -> oversold long bias; > 65 -> overbought short bias.  
2. MACD histogram crossed zero in last two candles OR current MACD – Signal ≥ |MACD∙0.25|.  
3. Price is within Bollinger channel (not piercing both bands).  
4. Order-book imbalance_ratio ≥ 0.6 (bull) or ≤ 0.4 (bear).  
5. Buy/Sell volume confirms bias (ratio ≥ 1.2 or ≤ 0.8).

If fewer than **3/5** rules are met → mandatory **'hold'**.

###########################
## 2. RISK-MANAGEMENT ##
###########################
*  **Risk:Reward** must be **≥ 2 : 1**.  
*  **ATR-Aware Stops**  
   - Long: stop_loss = current_price – 1.5·ATR  
   - Short: stop_loss = current_price + 1.5·ATR  
*  **Take-Profit**  
   - Long: min(current_price + 3·ATR, bollinger_upper)  
   - Short: max(current_price – 3·ATR, bollinger_lower)  

#########################
## 3. OUTPUT CONTRACT ##
#########################
Return **one** JSON object that validates against this schema:

{
  "summary":   string  (≤ 25 words, rationale citing ≥ 2 indicators),
  "trade_call": "long" | "short" | "hold",
  "take_profit": float,
  "stop_loss": float,
  "confidence_score": integer 0–100 (use rubric below)
}

### Confidence Rubric
- 80-100  ➜ ≥ 4/5 rules met, strong OBV confirmation  
- 60-79   ➜ 3/5 rules met  
- 40-59   ➜ ambiguous but still tradeable  
- 0-39    ➜ output 'hold'

### Validation Edge-Cases
* If any price math violates required inequalities, overwrite trade_call to 'hold', set TP & SL to 0, confidence_score = 0.
* Output **nothing** except the JSON.

#######################
## 4. MARKET DATA   ##
#######################
<<INSERT JSON SNAPSHOT HERE>>`
          },
          { 
            id: "2", 
            name: "Standard Model Prompt (for legacy models)",
            content: `You are “Sigma-Desk”, a quant-style crypto-futures strategist.

########################
## 1. SCOPE & RULESET ##
########################
Analyse the supplied JSON snapshot for a **[TIMEFRAME]** perpetual-futures market.  
Only recommend a trade when **all** of these conditions hold (else return 'hold'):

1. RSI divergence or value < 35 -> oversold long bias; > 65 -> overbought short bias.  
2. MACD histogram crossed zero in last two candles OR current MACD – Signal ≥ |MACD∙0.25|.  
3. Price is within Bollinger channel (not piercing both bands).  
4. Order-book imbalance_ratio ≥ 0.6 (bull) or ≤ 0.4 (bear).  
5. Buy/Sell volume confirms bias (ratio ≥ 1.2 or ≤ 0.8).

If fewer than **3/5** rules are met → mandatory **'hold'**.

###########################
## 2. RISK-MANAGEMENT ##
###########################
*  **Risk:Reward** must be **≥ 2 : 1**.  
*  **ATR-Aware Stops**  
   - Long: stop_loss = current_price – 1.5·ATR  
   - Short: stop_loss = current_price + 1.5·ATR  
*  **Take-Profit**  
   - Long: min(current_price + 3·ATR, bollinger_upper)  
   - Short: max(current_price – 3·ATR, bollinger_lower)  

#########################
## 3. OUTPUT CONTRACT ##
#########################
Your response MUST contain a single JSON code block with a valid JSON object inside. The JSON object should have the following keys: "summary", "trade_call", "take_profit", "stop_loss", "confidence_score".

{
  "summary":   string  (≤ 25 words, rationale citing ≥ 2 indicators),
  "trade_call": "long" | "short" | "hold",
  "take_profit": float,
  "stop_loss": float,
  "confidence_score": integer 0–100 (use rubric below)
}

### Confidence Rubric
- 80-100  ➜ ≥ 4/5 rules met, strong OBV confirmation  
- 60-79   ➜ 3/5 rules met  
- 40-59   ➜ ambiguous but still tradeable  
- 0-39    ➜ output 'hold'

### Validation Edge-Cases
* If any price math violates required inequalities, overwrite trade_call to 'hold', set TP & SL to 0, confidence_score = 0.
* Output **nothing** except the JSON.

#######################
## 4. MARKET DATA   ##
#######################
<<INSERT JSON SNAPSHOT HERE>>`
          },
        ];
        setPrompts(defaultPrompts);
    }
    
    const discoveryDefaults = safelyParseJson(localStorage.getItem("discoveryFormDefaults"), defaultDiscoveryValues);
    discoveryForm.reset(discoveryDefaults);
    
    // Initialize database and scheduler
    async function initializeScheduler() {
      try {
        const response = await fetch('/api/scheduler/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          addLog("Database and scheduler initialized successfully", "success");
        } else {
          addLog("Failed to initialize database and scheduler", "error");
        }
      } catch (error) {
        console.error('Error initializing scheduler:', error);
        addLog("Error initializing scheduler: " + String(error), "error");
      }
    }
    
    initializeScheduler();
    
    // Auto-initialize scheduler and database on app startup
    async function initializeAppSystems() {
      try {
        const response = await fetch('/api/scheduler/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          addLog("✅ STARTUP: Database and scheduler auto-initialized successfully", "success");
        } else {
          addLog("⚠️ STARTUP: Failed to auto-initialize scheduler", "warning");
        }
      } catch (error) {
        console.error('Error auto-initializing scheduler:', error);
        addLog("❌ STARTUP: Error auto-initializing scheduler: " + String(error), "error");
      }
    }
    
    // Initialize systems after a short delay to let the page load
    setTimeout(initializeAppSystems, 2000);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Load settings from database (overrides localStorage defaults) ---
  React.useEffect(() => {
    async function loadFromDatabase() {
      try {
        setIsLoadingSettings(true);
        
        // Load all settings from database  
        const allSettings = await fetch('/api/settings');
        const { settings } = await allSettings.json();
        
        // Update state with database values
        setApiKeys(settings.api_keys);
        setAiModels(settings.ai_models);
        setPrompts(settings.prompts);
        
        // Update discovery form with database defaults
        discoveryForm.reset(settings.discovery_defaults);
        
        addLog("Settings loaded from database", "success");
      } catch (error) {
        console.error('Error loading from database:', error);
        addLog("Database loading failed, using defaults: " + String(error), "warning");
      } finally {
        setIsLoadingSettings(false);
      }
    }
    
    loadFromDatabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Save settings to database when they change ---
  React.useEffect(() => {
    if (!isLoadingSettings) {
      settingsService.saveApiKeys(apiKeys).catch(console.error);
    }
  }, [apiKeys, isLoadingSettings]);

  React.useEffect(() => {
    if (!isLoadingSettings) {
      settingsService.saveAiModels(aiModels).catch(console.error);
    }
  }, [aiModels, isLoadingSettings]);

  React.useEffect(() => {
    if (!isLoadingSettings) {
      settingsService.savePrompts(prompts).catch(console.error);
    }
  }, [prompts, isLoadingSettings]);

  React.useEffect(() => {
    if (!isLoadingSettings) {
      const subscription = discoveryForm.watch((values) => {
        if (values) {
          settingsService.saveDiscoveryDefaults(values as DiscoveryDefaults).catch(console.error);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, [discoveryForm, isLoadingSettings]);

  const addLog = React.useCallback((summary: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { id: logCounter.current++, timestamp, summary, details }]);
  }, []);
  
  const addBatchLogs = React.useCallback((newLogs: {summary: string, details?: string}[]) => {
      const timestamp = new Date().toLocaleTimeString();
      const formattedLogs = newLogs.map(log => ({
          ...log,
          id: logCounter.current++,
          timestamp,
      }));
      setLogs(prev => [...prev, ...formattedLogs]);
  }, []);

  const getAnalysisConfig = () => {
    const activeModel = aiModels.find(m => m.enabled);
    if (!activeModel) {
      toast({ variant: "destructive", title: "Configuration Error", description: "No AI model is enabled. Please enable one in Settings." });
      addLog("ERROR: No enabled AI model found.");
      return null;
    }
    
    const isReasoning = activeModel.provider === 'googleai' || activeModel.modelType === 'reasoning';
    const activePrompt = prompts.find(p => p.id === (isReasoning ? '1' : '2'));
    if (!activePrompt) {
      const errorMsg = `No suitable prompt found for the selected model's type (${activeModel.modelType}).`;
      toast({ variant: "destructive", title: "Configuration Error", description: errorMsg });
      addLog(`ERROR: ${errorMsg}`);
      return null;
    }
    
    if (activeModel.provider === 'openai' && !apiKeys.openaiApiKey) {
        toast({ variant: "destructive", title: "Configuration Error", description: "OpenAI API key is missing. Please add it in Settings." });
        addLog("ERROR: OpenAI model is selected, but the API key is missing.");
        return null;
    }
    
    return { activeModel, activePrompt, apiKey: apiKeys.openaiApiKey };
  }

  const processAndLogResults = (newResults: CombinedResult[]) => {
      setResults(prev => [...newResults.filter(r => r !== null), ...prev]);

      const analysisLogs = newResults.map(res => {
        if (!res) return null;
        
        const summary = `[Analysis for ${res.market}] Call: ${res.trade_call}, Confidence: ${res.confidence_score}%`;
        
        let details = '';
        if (res.prompt) {
            details += `PROMPT:\n${"-".repeat(40)}\n${res.prompt}\n\n`;
        }
        if (res.analysisPayload) {
            details += `PAYLOAD:\n${"-".repeat(40)}\n${JSON.stringify(res.analysisPayload, null, 2)}\n\n`;
        }
        if (res.rawResponse) {
            details += `RAW RESPONSE:\n${"-".repeat(40)}\n${res.rawResponse}\n\n`;
        }
        details += `FULL RESULT:\n${"-".repeat(40)}\n${JSON.stringify(res, null, 2)}`;
        
        return { summary, details };
      }).filter((l): l is { summary: string, details: string } => l !== null);
      
      if(analysisLogs.length > 0) {
        addBatchLogs(analysisLogs);
      }
  }

  const handleStartSingleAnalysis = async (data: SingleContractValues) => {
    const config = getAnalysisConfig();
    if (!config) return;
    
    setIsAnalyzing(true);
    addLog(`ANALYSIS: Starting single contract analysis for ${data.contract}...`);
    
    const populatedPrompt = config.activePrompt.content.replace('[TIMEFRAME]', data.interval);
    
    const analysisInput = {
      ...data,
      openaiApiKey: config.apiKey,
      modelConfig: config.activeModel,
      promptTemplate: populatedPrompt,
      enhancedAnalysisEnabled: false // For now, keep enhanced analysis disabled in UI for stability
    };

    const result = await runSingleContractAnalysis(analysisInput);
    
    if (result.error) {
      addLog(`ERROR: Analysis Failed for ${data.contract}`, result.error);
      toast({ variant: "destructive", title: "Analysis Failed", description: "Check logs for details." });
    } else if (result.data) {
      const newResult: CombinedResult = {
          ...result.data,
          final_decision: result.data.confidence_score > (data.threshold || 75) ? 'TRADE' : 'SKIP',
          found_by_profile: 'Single Contract',
      }
      addLog(`SUCCESS: Analysis for ${data.contract} complete.`);
      processAndLogResults([newResult]);
    }
    setIsAnalyzing(false);
  };
  
  const handleStartMultiAnalysis = async (data: MultiContractValues) => {
    addLog("ERROR: Multi-analysis is deprecated. Please use the Discovery tab.");
    toast({ variant: "destructive", title: "Feature Deprecated", description: "Please use the more powerful Discovery & Analyze feature." });
  };
  
  const handleStartDiscoveryAnalysis = async (data: DiscoveryValues) => {
    console.log("🚀 NEW PARALLEL PROCESSING CODE IS RUNNING! v2.0 - 17:43");
    setIsAnalyzing(true);
    setResults([]); 
    addLog(`DISCOVERY: Starting discovery for top ${data.contractsPerProfile} contracts per profile across ${data.profiles.length} profile(s)...`);
    addLog("🚀 USING NEW MULTI-PROFILE DISCOVERY SYSTEM!");

    const discoveryResult = await runContractDiscovery({
      settle: data.settle,
      contractsPerProfile: data.contractsPerProfile,
      minVolume: data.minVolume,
      sortBy: data.sortBy,
      profiles: data.profiles,
    });
    
    if (discoveryResult.data?.log) {
        addLog('DISCOVERY PROCESS:', discoveryResult.data.log);
    }

    if (discoveryResult.error || !discoveryResult.data || !discoveryResult.data.contracts || discoveryResult.data.contracts.length === 0) {
      const errorMsg = discoveryResult.error || "Discovery returned no data.";
      addLog(`ERROR: Discovery Failed`, errorMsg);
      toast({ variant: "destructive", title: "Discovery Failed", description: "Check logs for details." });
      setIsAnalyzing(false);
      return;
    }
    
    const config = getAnalysisConfig();
    if (!config) {
        setIsAnalyzing(false);
        return;
    }

    const tasks = discoveryResult.data.contracts.map(task => ({
        contract: task.contract,
        settle: data.settle,
        interval: data.interval,
        threshold: data.threshold,
        foundByProfile: task.foundByProfile,
        tickerData: task.tickerData,
        openaiApiKey: config.apiKey,
        modelConfig: config.activeModel,
        promptTemplate: config.activePrompt.content.replace('[TIMEFRAME]', data.interval),
    }));
    
    addLog(`ANALYSIS: Starting analysis for ${tasks.length} contracts with up to ${data.concurrency} parallel threads...`);
    
    // Implement proper parallel processing with controlled concurrency
    const processTasksBatch = async (taskBatch: typeof tasks) => {
        const batchStartTime = Date.now();
        addLog(`BATCH: Starting parallel batch of ${taskBatch.length} contracts: [${taskBatch.map(t => t.contract).join(', ')}]`);
        addLog(`BATCH: Creating ${taskBatch.length} parallel promises...`);
        
        const promises = taskBatch.map(async (task, index) => {
            const threadId = `THREAD-${index + 1}`;
            try {
                const taskStartTime = Date.now();
                addLog(`${threadId}: Starting analysis for ${task.contract}`);
                
                // This should run in parallel - using API endpoint
                const response = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(task),
                });
                
                const result = await response.json();
                const taskDuration = Date.now() - taskStartTime;
                
                if (result.error) {
                    addLog(`${threadId}: Analysis Failed for ${task.contract} (${taskDuration}ms)`, result.error);
                    return null;
                } else if (result.data) {
                    const newResult: CombinedResult = {
                        ...result.data,
                        final_decision: result.data.confidence_score > (task.threshold || 75) ? 'TRADE' : 'SKIP',
                        found_by_profile: task.foundByProfile || 'Discovery',
                        tradeSizeUsd: data.tradeSizeUsd,
                        leverage: data.leverage,
                    };
                    
                    // Clean, concise completion log
                    addLog(`[Analysis for ${task.contract}] Call: ${result.data.trade_call}, Confidence: ${result.data.confidence_score}%`);
                    
                    return newResult;
                }
                return null;
            } catch (error: any) {
                addLog(`${threadId}: ERROR: Unexpected error analyzing ${task.contract}`, error.message);
                return null;
            }
        });
        
        addLog(`BATCH: Waiting for ${promises.length} parallel operations to complete...`);
        const results = await Promise.all(promises);
        const batchDuration = Date.now() - batchStartTime;
        addLog(`BATCH: Completed parallel processing in ${batchDuration}ms (${taskBatch.length} contracts simultaneously)`);
        return results;
    };

    // Process tasks in parallel batches based on concurrency limit
    const processTasks = async () => {
        const allResults: CombinedResult[] = [];
        const concurrencyLimit = data.concurrency;
        
        for (let i = 0; i < tasks.length; i += concurrencyLimit) {
            const batch = tasks.slice(i, i + concurrencyLimit);
            addLog(`BATCH: Processing batch ${Math.floor(i / concurrencyLimit) + 1} with ${batch.length} contracts: [${batch.map(t => t.contract).join(', ')}]`);
            
            const batchResults = await processTasksBatch(batch);
            const validResults = batchResults.filter((r): r is CombinedResult => r !== null);
            
            if (validResults.length > 0) {
                processAndLogResults(validResults);
                allResults.push(...validResults);
            }
            
            addLog(`BATCH: Completed batch ${Math.floor(i / concurrencyLimit) + 1} (${validResults.length}/${batch.length} successful)`);
        }
        
        addLog(`ANALYSIS: All analyses complete. Processed ${allResults.length}/${tasks.length} contracts successfully.`);
        setIsAnalyzing(false);
    };

    // Start processing
    processTasks().catch(error => {
        addLog("ANALYSIS: Critical error during parallel processing", error.message);
        setIsAnalyzing(false);
    });
  };
  
  const handleClearResults = () => {
    setResults([]);
    addLog("UI: Cleared analysis results from view.");
    toast({ title: "Results Cleared", description: "The recommendations table has been cleared." });
  };

  const handleClearLogs = () => {
    setLogs([]);
    toast({ title: "Logs Cleared", description: "The system log display has been cleared." });
  };
  
  const fetchOpenOrders = React.useCallback(async (isInitial: boolean = false) => {
    if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) return;
    setIsFetchingOrders(true);
    if (isInitial) addLog("ORDERS: Fetching open orders...");
    const result = await runListOpenOrders({
      settle: 'usdt',
      apiKey: apiKeys.gateIoKey,
      apiSecret: apiKeys.gateIoSecret,
    });
    if (result.data) {
      setOpenOrders(result.data);
      if (isInitial) addLog(`ORDERS: Found ${result.data.length} open TP/SL orders.`);
    } else if (isInitial) {
      addLog(`ORDERS: Failed to fetch open orders.`, result.error);
      toast({ variant: "destructive", title: "Failed to Fetch Orders", description: result.error });
    }
    setIsFetchingOrders(false);
  }, [apiKeys.gateIoKey, apiKeys.gateIoSecret, addLog, toast]);

  const runAndLogCleanup = React.useCallback(async (isInitial: boolean = false) => {
    if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) return;
    
    if (isInitial) {
        addLog(`CLEANUP: Performing check for orphaned TP/SL orders...`);
    }
    
    const result = await runCleanupOrphanedOrders({
      settle: 'usdt',
      apiKey: apiKeys.gateIoKey,
      apiSecret: apiKeys.gateIoSecret,
    });
    
    if (result.error) {
        addLog(`CLEANUP: Error during cleanup check.`, result.error);
        toast({ variant: "destructive", title: "Cleanup Failed", description: result.error });
    } else if (result.data) {
        if (isInitial) {
            const positionsLog = `Active Positions: [${result.data.active_position_contracts?.join(', ') || 'None'}]`;
            const ordersLog = `Open Conditional Orders: [${result.data.open_order_contracts?.join(', ') || 'None'}]`;
            const orphanedLog = `Orphaned Orders Found: [${result.data.orphaned_contracts_found?.join(', ') || 'None'}]`;
            addLog('CLEANUP: Data snapshot for check.', `${positionsLog}\n${ordersLog}\n${orphanedLog}`);
        }

        if (result.data.cancelled_orders.length > 0) {
            const cancelledInfo = result.data.cancelled_orders.map(o => `${o.contract} (ID: ${o.id})`).join(', ');
            addLog(`CLEANUP: ${result.data.message}`, `Cancelled: ${cancelledInfo}`);
            toast({ title: "Order Cleanup", description: `${result.data.message} Refresh orders to see changes.` });
            fetchOpenOrders(false); 
        } else if (isInitial) {
            if (result.data.cancellation_failures && result.data.cancellation_failures.length > 0) {
                const failureDetails = `Details:\n${JSON.stringify(result.data.cancellation_failures, null, 2)}`;
                const orphans = result.data.orphaned_contracts_found?.join(', ') || 'Unknown';
                addLog(`CLEANUP: Found ${result.data.orphaned_contracts_found?.length} orphaned order(s) but failed to cancel them. This may be due to missing order IDs from the API.`, `Orphans Found: [${orphans}]\n${failureDetails}`);
            } else {
                addLog('CLEANUP: No orphaned orders found to cancel.');
            }
        }
    }
  }, [apiKeys.gateIoKey, apiKeys.gateIoSecret, addLog, toast, fetchOpenOrders]);

  const fetchOpenPositions = React.useCallback(async (isInitial: boolean = false) => {
    if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) return;
    setIsFetchingPositions(true);
    if (isInitial) addLog("POSITIONS: Fetching open positions...");
    const result = await runListOpenPositions({
      settle: 'usdt',
      apiKey: apiKeys.gateIoKey,
      apiSecret: apiKeys.gateIoSecret,
    });
    if (result.data) {
      const activePositions = result.data.filter(p => p.size !== 0);
      setOpenPositions(activePositions);
      if (isInitial) addLog(`POSITIONS: Found ${activePositions.length} open positions.`);
      runAndLogCleanup(isInitial);
    } else if (isInitial) {
      addLog(`POSITIONS: Failed to fetch open positions.`, result.error);
      toast({ variant: "destructive", title: "Failed to Fetch Positions", description: result.error });
    }
    setIsFetchingPositions(false);
  }, [apiKeys.gateIoKey, apiKeys.gateIoSecret, addLog, toast, runAndLogCleanup]);

  const handlePlaceTrade = async (tradeDetails: CombinedResult) => {
    if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) {
      addLog("TRADE ERROR: Gate.io API keys are not set.");
      toast({ variant: "destructive", title: "API Keys Missing", description: "Please set Gate.io keys in Settings." });
      return;
    }
    addLog(`TRADE: Placing trade for ${tradeDetails.market}...`);
    const result = await runPlaceTradeStrategy({
      settle: 'usdt',
      tradeDetails: tradeDetails,
      tradeSizeUsd: tradeDetails.tradeSizeUsd || 10,
      leverage: tradeDetails.leverage || 10,
      apiKey: apiKeys.gateIoKey,
      apiSecret: apiKeys.gateIoSecret,
    });

    if (result.data) {
      addLog(`TRADE SUCCESS: ${result.data.message}`, JSON.stringify(result.data, null, 2));
      toast({ title: "Trade Placed Successfully", description: `Placed orders for ${tradeDetails.market}.` });
      setTimeout(() => fetchOpenPositions(true), 1500); 
      setTimeout(() => fetchOpenOrders(true), 1500);
    } else {
      addLog(`TRADE FAILED: Could not place trade for ${tradeDetails.market}.`, result.error);
      toast({ variant: "destructive", title: "Trade Failed", description: result.error });
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) return;
    addLog(`ORDERS: Cancelling order ${orderId}...`);
    const result = await runCancelOrder({
      settle: 'usdt',
      orderId: orderId,
      apiKey: apiKeys.gateIoKey,
      apiSecret: apiKeys.gateIoSecret,
    });
    if (result.data) {
      addLog(`ORDERS: Successfully cancelled order ${orderId}.`);
      toast({ title: "Order Cancelled", description: `Order ${orderId} has been cancelled.` });
      fetchOpenOrders(true);
    } else {
      addLog(`ORDERS: Failed to cancel order ${orderId}.`, result.error);
      toast({ variant: "destructive", title: "Cancellation Failed", description: result.error });
    }
  };

  // Initial load
  React.useEffect(() => {
    setLogs([
      { id: logCounter.current++, timestamp: new Date().toLocaleTimeString(), summary: "Welcome to Retro Crypto Alchemist." },
      { id: logCounter.current++, timestamp: new Date().toLocaleTimeString(), summary: "Initializing dashboard panels..." },
      { id: logCounter.current++, timestamp: new Date().toLocaleTimeString(), summary: "Ready for analysis. Configure settings and start a task." },
    ]);
    if (apiKeys.gateIoKey && apiKeys.gateIoSecret) {
        fetchOpenPositions(true);
        fetchOpenOrders(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys.gateIoKey, apiKeys.gateIoSecret]);
  
  // Auto-refresh positions and orders
  React.useEffect(() => {
    if (!apiKeys.gateIoKey || !apiKeys.gateIoSecret) return;

    const intervalId = setInterval(() => {
        fetchOpenPositions(false); // Subsequent fetches are not "initial"
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(intervalId);
  }, [apiKeys.gateIoKey, apiKeys.gateIoSecret, fetchOpenPositions]);

  const refreshAll = React.useCallback(() => {
      fetchOpenPositions(true);
      fetchOpenOrders(true);
  }, [fetchOpenPositions, fetchOpenOrders]);

  return (
    <div className="bg-background text-foreground font-body min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow p-4">
        <Tabs defaultValue="dashboard" className="w-full h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="scheduler">Scheduler</TabsTrigger>
                <TabsTrigger value="positions">Positions</TabsTrigger>
                <TabsTrigger value="logs">System Logs</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard" className="flex-grow mt-4">
                <DashboardLayout
                    analysisPanel={
                        <AnalysisPanel
                        onStartSingle={handleStartSingleAnalysis}
                        onStartMulti={handleStartMultiAnalysis}
                        onStartDiscovery={handleStartDiscoveryAnalysis}
                        isAnalyzing={isAnalyzing}
                        addLog={addLog}
                        form={discoveryForm}
                        />
                    }
                    resultsPanel={<ResultsPanel results={results} onPlaceTrade={handlePlaceTrade} onClearResults={handleClearResults} openPositions={openPositions} />}
                    ordersPanel={<OrdersPanel orders={openOrders} onCancelOrder={handleCancelOrder} isLoading={isFetchingOrders} onRefresh={refreshAll} />}
                    logPanel={<LogPanel logs={logs} onClear={handleClearLogs} />}
                />
            </TabsContent>
            <TabsContent value="scheduler" className="flex-grow mt-4">
                <SchedulerPanel addLog={addLog} />
            </TabsContent>
            <TabsContent value="positions" className="flex-grow mt-4">
                <PositionsPanel 
                    positions={openPositions}
                    isLoading={isFetchingPositions}
                    onRefresh={refreshAll}
                />
            </TabsContent>
            <TabsContent value="logs" className="flex-grow mt-4">
                 <Card className="h-full">
                    <CardContent className="p-0 h-full">
                        <LogPanel logs={logs} onClear={handleClearLogs} />
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="settings" className="flex-grow mt-4">
                <SettingsPanel
                    apiKeys={apiKeys}
                    setApiKeys={setApiKeys}
                    aiModels={aiModels}
                    setAiModels={setAiModels}
                    prompts={prompts}
                    setPrompts={setPrompts}
                    addLog={addLog}
                />
            </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
