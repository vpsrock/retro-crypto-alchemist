
"use client";

import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { singleContractSchema, multiContractSchema, discoverySchema, SingleContractValues, MultiContractValues, DiscoveryValues } from "@/lib/schemas";
import { Play, ListCollapse, Clock, Loader2, Search, Save } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const DISCOVERY_DEFAULTS_KEY = "discoveryFormDefaults";

type AnalysisPanelProps = {
  onStartSingle: (data: SingleContractValues) => void;
  onStartMulti: (data: MultiContractValues) => void;
  onStartDiscovery: (data: DiscoveryValues) => void;
  isAnalyzing: boolean;
  addLog: (message: string, details?: string) => void;
  form: UseFormReturn<DiscoveryValues>;
};

export function AnalysisPanel({ onStartSingle, onStartMulti, onStartDiscovery, isAnalyzing, addLog, form: discoveryForm }: AnalysisPanelProps) {
  const { toast } = useToast();

  const singleForm = useForm<SingleContractValues>({
    resolver: zodResolver(singleContractSchema),
    defaultValues: {
      contract: "BTC_USDT",
      settle: "usdt",
      interval: "15m",
      threshold: 75,
    },
  });

  const multiForm = useForm<MultiContractValues>({
    resolver: zodResolver(multiContractSchema),
    defaultValues: {
      contracts: "BTC_USDT, ETH_USDT, SOL_USDT",
      profile: "default",
      settle: "usdt",
      interval: "15m",
      threshold: 75,
    },
  });

  const handleSchedule = () => {
    addLog("SCHEDULER: Scheduling feature not yet implemented. Please run analysis manually.");
    toast({
      title: "Feature Not Implemented",
      description: "Automated scheduling will be available in a future update.",
    });
  }
  
  const formatVolume = (value: number) => {
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(0)}K`;
    }
    return `$${value}`;
  };

  const handleSaveDefaults = () => {
    const currentValues = discoveryForm.getValues();
    localStorage.setItem(DISCOVERY_DEFAULTS_KEY, JSON.stringify(currentValues));
    toast({
        title: "Defaults Saved",
        description: "Your discovery settings have been saved as the new default.",
    });
    addLog("SETTINGS: Discovery defaults updated and saved locally.");
  };

  return (
    <Card className="flex-grow">
      <CardHeader>
        <div className="flex items-start justify-between">
            <div>
                <CardTitle className="flex items-center gap-2 font-headline">
                  <Play className="w-5 h-5" />
                  Analysis Control
                </CardTitle>
                <CardDescription>Configure and initiate analysis tasks.</CardDescription>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="discovery">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="discovery">Discovery</TabsTrigger>
            <TabsTrigger value="single">Single</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          </TabsList>

          <TabsContent value="discovery" className="mt-4">
            <Form {...discoveryForm}>
              <form onSubmit={discoveryForm.handleSubmit(onStartDiscovery)} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <FormField control={discoveryForm.control} name="profile" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Scan Profile</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="default">Default (High Volatility)</SelectItem>
                                <SelectItem value="mean_reversion">Mean Reversion</SelectItem>
                                <SelectItem value="breakout">Breakout</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    <FormField control={discoveryForm.control} name="sortBy" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Sort By</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="score">Score (Volume & Volatility)</SelectItem>
                                    <SelectItem value="volume">24h Volume</SelectItem>
                                    <SelectItem value="change">24h Change %</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={discoveryForm.control} name="settle" render={({ field }) => (
                    <FormItem><FormLabel>Settle</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="usdt">USDT</SelectItem><SelectItem value="btc">BTC</SelectItem></SelectContent></Select></FormItem>
                  )} />
                  <FormField control={discoveryForm.control} name="interval" render={({ field }) => (
                    <FormItem><FormLabel>Interval</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="5m">5m</SelectItem><SelectItem value="15m">15m</SelectItem><SelectItem value="1h">1h</SelectItem><SelectItem value="4h">4h</SelectItem></SelectContent></Select></FormItem>
                  )} />
                </div>
                 <FormField control={discoveryForm.control} name="contractsToFind" render={({ field }) => (
                  <FormItem>
                     <FormLabel>Contracts to Find: {field.value}</FormLabel>
                    <FormControl><Slider defaultValue={[field.value]} min={1} max={50} step={1} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                  </FormItem>
                )} />
                <FormField control={discoveryForm.control} name="minVolume" render={({ field }) => (
                  <FormItem>
                      <FormLabel>Min Volume: {formatVolume(field.value)}</FormLabel>
                      <FormControl><Slider
                          defaultValue={[field.value]}
                          min={100000}
                          max={50000000}
                          step={100000}
                          onValueChange={(value) => field.onChange(value[0])}
                      /></FormControl>
                  </FormItem>
                )} />
                 <FormField control={discoveryForm.control} name="concurrency" render={({ field }) => (
                  <FormItem>
                     <FormLabel>Parallel Analyses (Threads): {field.value}</FormLabel>
                    <FormControl><Slider defaultValue={[field.value]} min={1} max={10} step={1} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                  </FormItem>
                )} />
                <FormField control={discoveryForm.control} name="threshold" render={({ field }) => (
                  <FormItem>
                     <FormLabel>Confidence Threshold: {field.value}%</FormLabel>
                    <FormControl><Slider defaultValue={[field.value]} max={100} step={1} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                  </FormItem>
                )} />
                 <div className="border-t pt-4 space-y-4">
                    <FormField control={discoveryForm.control} name="tradeSizeUsd" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trade Notional Value: ${field.value}</FormLabel>
                        <FormControl><Slider defaultValue={[field.value]} min={5} max={1000} step={5} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={discoveryForm.control} name="leverage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Leverage: {field.value}x</FormLabel>
                        <FormControl><Slider defaultValue={[field.value]} min={1} max={100} step={1} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                      </FormItem>
                    )} />
                 </div>
                <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={isAnalyzing} className="flex-grow">
                      {isAnalyzing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Analyzing...</> : <><Search className="mr-2 h-4 w-4"/>Discover & Analyze</>}
                    </Button>
                    <Button type="button" variant="secondary" onClick={handleSaveDefaults} disabled={isAnalyzing}>
                        <Save className="h-4 w-4"/>
                    </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="single" className="mt-4">
            <Form {...singleForm}>
              <form onSubmit={singleForm.handleSubmit(onStartSingle)} className="space-y-4">
                <FormField control={singleForm.control} name="contract" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract</FormLabel>
                    <FormControl><Input placeholder="e.g., BTC_USDT" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={singleForm.control} name="settle" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Settle</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="usdt">USDT</SelectItem><SelectItem value="btc">BTC</SelectItem></SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                   <FormField control={singleForm.control} name="interval" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Interval</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="5m">5m</SelectItem><SelectItem value="15m">15m</SelectItem><SelectItem value="1h">1h</SelectItem><SelectItem value="4h">4h</SelectItem></SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
                <FormField control={singleForm.control} name="threshold" render={({ field }) => (
                  <FormItem>
                     <FormLabel>Confidence Threshold: {field.value}%</FormLabel>
                    <FormControl>
                        <Slider defaultValue={[75]} max={100} step={1} onValueChange={(value) => field.onChange(value[0])}/>
                    </FormControl>
                  </FormItem>
                )} />
                <Button type="submit" disabled={isAnalyzing} className="w-full">
                  {isAnalyzing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Analyzing...</> : <>Run Analysis</>}
                </Button>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="scheduled" className="mt-4">
             <div className="text-center p-4 space-y-4">
                <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="font-semibold">Automated Task Scheduler</h3>
                <p className="text-sm text-muted-foreground">This feature is coming soon. You will be able to schedule analysis tasks to run automatically at specific intervals or times.</p>
                <Button onClick={handleSchedule} disabled>Activate Schedule</Button>
             </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
