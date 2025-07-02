"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trash2, PlusCircle, Save } from "lucide-react";
import type { ApiKeySettings, AiModelConfig, PromptSettings } from "@/lib/schemas";
import { useToast } from "@/hooks/use-toast";

type SettingsPanelProps = {
  apiKeys: ApiKeySettings;
  setApiKeys: (keys: ApiKeySettings) => void;
  aiModels: AiModelConfig[];
  setAiModels: (models: AiModelConfig[]) => void;
  prompts: PromptSettings[];
  setPrompts: (prompts: PromptSettings[]) => void;
  addLog: (message: string) => void;
};

export function SettingsPanel({
  apiKeys,
  setApiKeys,
  aiModels,
  setAiModels,
  prompts,
  setPrompts,
  addLog,
}: SettingsPanelProps) {
  const { toast } = useToast();
  
  // Local state for edits
  const [localApiKeys, setLocalApiKeys] = React.useState(apiKeys);
  const [localPrompts, setLocalPrompts] = React.useState(prompts);
  
  // Sync local state if props change from outside
  React.useEffect(() => { setLocalApiKeys(apiKeys) }, [apiKeys]);
  React.useEffect(() => { setLocalPrompts(prompts) }, [prompts]);
  
  const handleSaveApiKeys = () => {
    setApiKeys(localApiKeys);
    addLog("SETTINGS: API keys updated and saved to database.");
    toast({ title: "API Keys Saved", description: "Your API keys have been saved to the database." });
  };
  
  const handleSavePrompts = () => {
    setPrompts(localPrompts);
    addLog(`SETTINGS: Saved ${localPrompts.length} prompts to database.`);
    toast({ title: "Prompts Saved", description: "Your prompts have been saved to the database." });
  }

  const handleSaveModels = () => {
    setAiModels(aiModels);
    addLog("SETTINGS: AI Models saved to database.");
    toast({ title: "AI Models Saved", description: "Your model configuration has been saved to the database." });
  }

  const handleAddModel = () => {
    setAiModels([
      ...aiModels,
      { id: Date.now().toString(), name: "New Model", provider: "openai", modelId: "", modelType: "standard", enabled: false }
    ]);
  }
  
  const handleRemoveModel = (id: string) => {
    setAiModels(aiModels.filter(m => m.id !== id));
  }

  const handleModelChange = (id: string, field: keyof AiModelConfig, value: any) => {
    let newModels = [...aiModels];
    if (field === 'enabled' && value === true) {
      // When a model is enabled, disable all others.
      newModels = newModels.map(m => ({ ...m, enabled: m.id === id }));
    } else {
      newModels = newModels.map(m => m.id === id ? { ...m, [field]: value } : m);
    }
    setAiModels(newModels);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* API Keys Card */}
        <Card>
            <CardHeader>
                <CardTitle>API Keys</CardTitle>
                <CardDescription>Credentials for exchanges and AI providers. Saved in your browser.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="gateIoKey">Gate.io API Key</Label>
                  <Input id="gateIoKey" name="gateIoKey" type="password" value={localApiKeys.gateIoKey} onChange={e => setLocalApiKeys({...localApiKeys, gateIoKey: e.target.value})} />
                </div>
                <div>
                  <Label htmlFor="gateIoSecret">Gate.io API Secret</Label>
                  <Input id="gateIoSecret" name="gateIoSecret" type="password" value={localApiKeys.gateIoSecret} onChange={e => setLocalApiKeys({...localApiKeys, gateIoSecret: e.target.value})} />
                </div>
                <div>
                  <Label htmlFor="openaiApiKey">OpenAI API Key</Label>
                  <Input id="openaiApiKey" name="openaiApiKey" type="password" value={localApiKeys.openaiApiKey} onChange={e => setLocalApiKeys({...localApiKeys, openaiApiKey: e.target.value})}/>
                </div>
                <Button onClick={handleSaveApiKeys} className="w-full">
                    <Save className="mr-2 h-4 w-4"/>
                    Save API Keys
                </Button>
            </CardContent>
        </Card>

        {/* Prompts Card */}
        <Card>
            <CardHeader>
                <CardTitle>Analysis Prompts</CardTitle>
                <CardDescription>Customize the prompts used for AI analysis.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 {localPrompts.map((prompt, index) => (
                    <div key={prompt.id}>
                        <Label htmlFor={`prompt-${prompt.id}`} className="font-semibold">{prompt.name}</Label>
                        <Textarea 
                            id={`prompt-${prompt.id}`}
                            value={prompt.content}
                            onChange={(e) => {
                                const newPrompts = [...localPrompts];
                                newPrompts[index].content = e.target.value;
                                setLocalPrompts(newPrompts);
                            }}
                            className="min-h-[170px] font-mono text-xs"
                        />
                    </div>
                ))}
                <Button onClick={handleSavePrompts} className="w-full">
                    <Save className="mr-2 h-4 w-4"/>
                    Save Prompts
                </Button>
            </CardContent>
        </Card>

        {/* AI Models Card */}
        <div className="md:col-span-2">
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>AI Models</CardTitle>
                            <CardDescription>Configure AI models. Only one can be enabled at a time.</CardDescription>
                        </div>
                         <Button variant="outline" size="sm" onClick={handleAddModel}><PlusCircle className="mr-2 h-4 w-4"/>Add Model</Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                     {aiModels.map(model => (
                        <Card key={model.id} className="bg-muted/30">
                            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                                <div className="md:col-span-6">
                                    <Label>Model Name</Label>
                                    <Input placeholder="Model Name" value={model.name} onChange={e => handleModelChange(model.id, 'name', e.target.value)} />
                                </div>
                                <div className="md:col-span-2">
                                    <Label>Provider</Label>
                                    <Select value={model.provider} onValueChange={value => handleModelChange(model.id, 'provider', value)}>
                                        <SelectTrigger><SelectValue placeholder="Provider" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="openai">OpenAI</SelectItem>
                                            <SelectItem value="googleai">Google AI</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="md:col-span-2">
                                    <Label>Model Type</Label>
                                    <Select value={model.modelType || 'standard'} onValueChange={value => handleModelChange(model.id, 'modelType', value)}>
                                        <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="reasoning">Reasoning (JSON Mode)</SelectItem>
                                            <SelectItem value="standard">Standard (Legacy)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="md:col-span-2">
                                    <Label>Model ID</Label>
                                    <Input placeholder="e.g. gpt-4o-mini" value={model.modelId} onChange={e => handleModelChange(model.id, 'modelId', e.target.value)} />
                                </div>
                                <div className="flex items-center space-x-4 md:col-span-6 justify-end">
                                    <div className="flex items-center space-x-2">
                                        <Label htmlFor={`enabled-${model.id}`}>Enabled</Label>
                                        <Switch id={`enabled-${model.id}`} checked={model.enabled} onCheckedChange={checked => handleModelChange(model.id, 'enabled', checked)} />
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={() => handleRemoveModel(model.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    <Button onClick={handleSaveModels} className="w-full mt-4">
                        <Save className="mr-2 h-4 w-4"/>
                        Save Model Configuration
                    </Button>
                </CardContent>
            </Card>
        </div>
    </div>
  );
}
