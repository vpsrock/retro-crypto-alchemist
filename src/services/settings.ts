// Client-side settings service that communicates with the database via API
export interface ApiKeySettings {
  gateIoKey?: string;
  gateIoSecret?: string;
  openaiApiKey?: string;
}

export interface AiModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'googleai';
  modelId: string;
  modelType: 'reasoning' | 'standard';
  enabled: boolean;
}

export interface PromptSettings {
  id: string;
  name: string;
  content: string;
}

export interface DiscoveryDefaults {
  settle: string;
  interval: string;
  threshold: number;
  contractsPerProfile: number;
  concurrency: number;
  profiles: string[];
  minVolume: number;
  sortBy: string;
  tradeSizeUsd: number;
  leverage: number;
}

class SettingsService {
  private baseUrl = '';

  async getAllSettings(): Promise<{
    api_keys?: ApiKeySettings;
    ai_models?: AiModelConfig[];
    prompts?: PromptSettings[];
    discovery_defaults?: DiscoveryDefaults;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings`);
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.statusText}`);
      }
      const data = await response.json();
      return data.success ? data.settings : {};
    } catch (error) {
      console.error('Error fetching settings:', error);
      return {};
    }
  }

  async getApiKeys(): Promise<ApiKeySettings> {
    const settings = await this.getAllSettings();
    return settings.api_keys || {
      gateIoKey: '',
      gateIoSecret: '',
      openaiApiKey: ''
    };
  }

  async saveApiKeys(apiKeys: ApiKeySettings): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'api_keys',
          data: apiKeys
        })
      });
      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Error saving API keys:', error);
      return false;
    }
  }

  async getAiModels(): Promise<AiModelConfig[]> {
    const settings = await this.getAllSettings();
    return settings.ai_models || [
      { id: "1", name: "OpenAI GPT-4o Mini (JSON Mode)", provider: "openai", modelId: "gpt-4o-mini", modelType: "reasoning", enabled: true },
      { id: "2", name: "Google Gemini 2.0 Flash (JSON Mode)", provider: "googleai", modelId: "gemini-2.0-flash", modelType: "reasoning", enabled: false },
      { id: "3", name: "OpenAI GPT-4 Turbo (Legacy)", provider: "openai", modelId: "gpt-4-turbo", modelType: "standard", enabled: false },
    ];
  }

  async saveAiModels(models: AiModelConfig[]): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'ai_models',
          data: models
        })
      });
      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Error saving AI models:', error);
      return false;
    }
  }

  async getPrompts(): Promise<PromptSettings[]> {
    const settings = await this.getAllSettings();
    return settings.prompts || [
      { 
        id: "1", 
        name: "Reasoning Model Prompt (for JSON mode)",
        content: `You are "Sigma-Desk", a quant-style crypto-futures strategist.

########################
## 1. SCOPE & RULESET ##
########################
You analyze perpetual futures data (order book, price movements, etc.) to recommend trade decisions.

OUTPUT FORMAT: Return valid JSON matching this structure:
{
  "confidence_score": number (1-100, where 90+ is EXTREMELY confident),
  "trade_call": "long" | "short" | "hold",
  "entry_price": number,
  "stop_loss": number,
  "take_profit": number,
  "reasoning": "brief explanation"
}

CRITICAL RULES:
- Confidence scores should be based on strength of signals and market conditions
- Only recommend "long" or "short" when there are clear, strong signals (85+ confidence)
- Use "hold" for unclear/mixed signals or low confidence situations
- Entry prices should be realistic based on current market price
- Stop losses should limit risk to 2-5% of position value
- Take profits should target 5-15% gains based on signal strength
- Keep reasoning concise but informative

########################
## 2. ANALYSIS FRAMEWORK ##
########################
Consider these factors in your analysis:
1. Price momentum and trends
2. Volume patterns and anomalies  
3. Order book imbalances
4. Support/resistance levels
5. Market volatility
6. Recent price action context

########################
## 3. RISK MANAGEMENT ##
########################
- Prioritize capital preservation
- Consider market volatility in position sizing recommendations
- Account for slippage in entry/exit prices
- Factor in current market conditions (bull/bear/sideways)

Analyze the provided market data and return your recommendation as valid JSON.`
      }
    ];
  }

  async savePrompts(prompts: PromptSettings[]): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'prompts',
          data: prompts
        })
      });
      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Error saving prompts:', error);
      return false;
    }
  }

  async getDiscoveryDefaults(): Promise<DiscoveryDefaults> {
    const settings = await this.getAllSettings();
    return settings.discovery_defaults || {
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
  }

  async saveDiscoveryDefaults(defaults: DiscoveryDefaults): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'discovery_defaults',
          data: defaults
        })
      });
      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Error saving discovery defaults:', error);
      return false;
    }
  }

  async getActivePrompt(): Promise<{
    prompt: string;
    promptName: string;
    modelConfig: AiModelConfig;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/settings/active-prompt`);
      if (!response.ok) {
        throw new Error(`Failed to fetch active prompt: ${response.statusText}`);
      }
      const data = await response.json();
      return data.success ? {
        prompt: data.prompt,
        promptName: data.promptName,
        modelConfig: data.modelConfig
      } : null;
    } catch (error) {
      console.error('Error fetching active prompt:', error);
      return null;
    }
  }
}

export const settingsService = new SettingsService();
