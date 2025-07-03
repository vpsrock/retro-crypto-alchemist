"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { schedulerSchema, type SchedulerValues } from "@/lib/schemas";
import type { ScheduledJob, TradePosition, SchedulerStats } from "@/services/database";
import { Clock, Play, Pause, TrendingUp, TrendingDown, DollarSign, BarChart3, Loader2, Trash2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

type SchedulerPanelProps = {
  addLog: (message: string, details?: string) => void;
};

export function SchedulerPanel({ addLog }: SchedulerPanelProps) {
  const { toast } = useToast();
  const [jobs, setJobs] = React.useState<ScheduledJob[]>([]);
  const [openPositions, setOpenPositions] = React.useState<TradePosition[]>([]);
  const [closedPositions, setClosedPositions] = React.useState<TradePosition[]>([]);
  const [stats, setStats] = React.useState<SchedulerStats | null>(null);
  const [isCreatingJob, setIsCreatingJob] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [deletingJobId, setDeletingJobId] = React.useState<string | null>(null);

  const schedulerForm = useForm<SchedulerValues>({
    resolver: zodResolver(schedulerSchema),
    defaultValues: {
      name: "Auto Trading Job",
      settle: "usdt",
      interval: "15m",
      scheduleInterval: "1h",
      threshold: 75,
      contractsPerProfile: 5,
      profiles: ["default"],
      minVolume: 1000000,
      tradeSizeUsd: 10,
      leverage: 10,
      isActive: true,
      enhancedAnalysisEnabled: false,
    },
  });

  // Load data on component mount
  React.useEffect(() => {
    loadAllData();
    // Refresh data every 30 seconds
    const interval = setInterval(loadAllData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadAllData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([
        loadJobs(),
        loadPositions(),
        loadStats(),
      ]);
    } catch (error) {
      console.error('Failed to load scheduler data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadJobs = async () => {
    try {
      const response = await fetch('/api/scheduler/jobs');
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  const loadPositions = async () => {
    try {
      const [openRes, closedRes] = await Promise.all([
        fetch('/api/scheduler/positions?type=open'),
        fetch('/api/scheduler/positions?type=closed'),
      ]);
      
      if (openRes.ok) {
        const openData = await openRes.json();
        setOpenPositions(openData.positions);
      }
      
      if (closedRes.ok) {
        const closedData = await closedRes.json();
        setClosedPositions(closedData.positions);
      }
    } catch (error) {
      console.error('Failed to load positions:', error);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch('/api/scheduler/positions?type=stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleCreateJob = async (data: SchedulerValues) => {
    try {
      setIsCreatingJob(true);
      const response = await fetch('/api/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();
      
      if (response.ok) {
        toast({
          title: "Scheduled Job Created",
          description: `Job "${data.name}" created successfully and will run every ${data.scheduleInterval}.`,
        });
        addLog(`SCHEDULER: Created new job "${data.name}" - ${data.profiles.length} profile(s), runs every ${data.scheduleInterval}`);
        
        // Reset form and reload jobs
        schedulerForm.reset();
        await loadJobs();
      } else {
        throw new Error(result.error || 'Failed to create job');
      }
    } catch (error: any) {
      toast({
        title: "Job Creation Failed",
        description: error.message,
        variant: "destructive",
      });
      addLog(`SCHEDULER ERROR: Failed to create job - ${error.message}`);
    } finally {
      setIsCreatingJob(false);
    }
  };

  const handleToggleJob = async (jobId: string, isActive: boolean) => {
    try {
      const response = await fetch('/api/scheduler/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, isActive }),
      });

      if (response.ok) {
        toast({
          title: `Job ${isActive ? 'Activated' : 'Deactivated'}`,
          description: `Scheduled job has been ${isActive ? 'activated' : 'deactivated'}.`,
        });
        addLog(`SCHEDULER: Job ${isActive ? 'activated' : 'deactivated'} - ${jobId}`);
        await loadJobs();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to toggle job');
      }
    } catch (error: any) {
      toast({
        title: "Job Toggle Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    try {
      setDeletingJobId(jobId);
      const response = await fetch(`/api/scheduler/jobs/${jobId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: "Job Deleted",
          description: `Job "${jobName}" has been permanently deleted.`,
        });
        addLog(`SCHEDULER: Job deleted - ${jobName} (${jobId})`);
        await loadJobs();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete job');
      }
    } catch (error: any) {
      toast({
        title: "Job Deletion Failed",
        description: error.message,
        variant: "destructive",
      });
      addLog(`SCHEDULER ERROR: Failed to delete job - ${error.message}`);
    } finally {
      setDeletingJobId(null);
    }
  };

  const formatVolume = (value: number) => {
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(0)}K`;
    }
    return `$${value}`;
  };

  const formatPnl = (pnl: number) => {
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(2)}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <Card className="flex-grow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-headline">
              <Clock className="w-5 h-5" />
              Automated Trading Scheduler
            </CardTitle>
            <CardDescription>
              Create and manage automated trading jobs that run on schedule.
            </CardDescription>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="create">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="create">Create Job</TabsTrigger>
            <TabsTrigger value="jobs">Active Jobs ({jobs.filter(j => j.isActive).length})</TabsTrigger>
            <TabsTrigger value="positions">Open Positions ({openPositions.length})</TabsTrigger>
            <TabsTrigger value="history">Closed Positions ({closedPositions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4">
            <Form {...schedulerForm}>
              <form onSubmit={schedulerForm.handleSubmit(handleCreateJob)} className="space-y-4">
                <FormField control={schedulerForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Name</FormLabel>
                    <FormControl><Input placeholder="e.g., Evening Scalper" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={schedulerForm.control} name="settle" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Settlement</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="usdt">USDT</SelectItem>
                          <SelectItem value="btc">BTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  
                  <FormField control={schedulerForm.control} name="interval" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Analysis Interval</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="5m">5m</SelectItem>
                          <SelectItem value="15m">15m</SelectItem>
                          <SelectItem value="1h">1h</SelectItem>
                          <SelectItem value="4h">4h</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={schedulerForm.control} name="scheduleInterval" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Run Every</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="5m">5 minutes</SelectItem>
                        <SelectItem value="15m">15 minutes</SelectItem>
                        <SelectItem value="30m">30 minutes</SelectItem>
                        <SelectItem value="1h">1 hour</SelectItem>
                        <SelectItem value="2h">2 hours</SelectItem>
                        <SelectItem value="4h">4 hours</SelectItem>
                        <SelectItem value="6h">6 hours</SelectItem>
                        <SelectItem value="12h">12 hours</SelectItem>
                        <SelectItem value="24h">24 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <FormField control={schedulerForm.control} name="profiles" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scan Profiles</FormLabel>
                    <div className="grid grid-cols-3 gap-2 p-3 border rounded-md">
                      {[
                        { value: "default", label: "Default" },
                        { value: "mean_reversion", label: "Mean Reversion" },
                        { value: "breakout", label: "Breakout" },
                        { value: "low_cap_gems", label: "Low-Cap Gems" },
                        { value: "volume_surge", label: "Volume Surge" },
                        { value: "contrarian", label: "Contrarian" },
                        { value: "funding_arbitrage", label: "Funding Arbitrage" },
                        { value: "new_listings", label: "New Listings" },
                        { value: "stablecoin_pairs", label: "Stablecoin Pairs" }
                      ].map((profile) => (
                        <label key={profile.value} className="flex items-center space-x-2 text-sm">
                          <input
                            type="checkbox"
                            checked={field.value?.includes(profile.value as any) || false}
                            onChange={(e) => {
                              const currentValues = field.value || [];
                              if (e.target.checked) {
                                field.onChange([...currentValues, profile.value as any]);
                              } else {
                                field.onChange(currentValues.filter(v => v !== profile.value));
                              }
                            }}
                            className="rounded"
                          />
                          <span>{profile.label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Selected: {field.value?.length || 0} profile(s)
                    </p>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={schedulerForm.control} name="contractsPerProfile" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contracts per Profile: {field.value}</FormLabel>
                      <FormControl><Slider defaultValue={[field.value]} min={1} max={20} step={1} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                    </FormItem>
                  )} />
                  
                  <FormField control={schedulerForm.control} name="threshold" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Confidence: {field.value}%</FormLabel>
                      <FormControl><Slider defaultValue={[field.value]} min={50} max={95} step={5} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={schedulerForm.control} name="minVolume" render={({ field }) => (
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

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={schedulerForm.control} name="tradeSizeUsd" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trade Size: ${field.value}</FormLabel>
                      <FormControl><Slider defaultValue={[field.value]} min={5} max={1000} step={5} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                    </FormItem>
                  )} />
                  
                  <FormField control={schedulerForm.control} name="leverage" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Leverage: {field.value}x</FormLabel>
                      <FormControl><Slider defaultValue={[field.value]} min={1} max={50} step={1} onValueChange={(value) => field.onChange(value[0])}/></FormControl>
                    </FormItem>
                  )} />
                </div>

                {/* Enhanced Analysis Toggle */}
                <FormField control={schedulerForm.control} name="enhancedAnalysisEnabled" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value || false}
                          onChange={field.onChange}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                      </FormControl>
                      <div className="flex-1">
                        <FormLabel className="text-sm font-medium text-gray-900 flex items-center gap-2 cursor-pointer">
                          Advanced Market Intelligence
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full font-medium">BETA</span>
                        </FormLabel>
                        <p className="text-xs text-gray-600 mt-1">
                          Include liquidation cascades, funding sentiment, institutional flow, and market microstructure data in automated analysis
                        </p>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />

                <Button type="submit" disabled={isCreatingJob} className="w-full">
                  {isCreatingJob ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                  Create Scheduled Job
                </Button>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="jobs" className="space-y-4">
            {stats && (
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Active Jobs</p>
                        <p className="text-2xl font-bold">{stats.activeJobs}</p>
                      </div>
                      <Clock className="w-8 h-8 text-blue-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Open Positions</p>
                        <p className="text-2xl font-bold">{stats.openPositions}</p>
                      </div>
                      <BarChart3 className="w-8 h-8 text-orange-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Today P&L</p>
                        <p className={`text-2xl font-bold ${stats.todayPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatPnl(stats.todayPnl)}
                        </p>
                      </div>
                      {stats.todayPnl >= 0 ? <TrendingUp className="w-8 h-8 text-green-500" /> : <TrendingDown className="w-8 h-8 text-red-500" />}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Total P&L</p>
                        <p className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatPnl(stats.totalPnl)}
                        </p>
                      </div>
                      <DollarSign className="w-8 h-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="space-y-2">
              {jobs.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    No scheduled jobs created yet. Create your first automated trading job!
                  </CardContent>
                </Card>
              ) : (
                jobs.map((job) => (
                  <Card key={job.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{job.name}</h3>
                            <Badge variant={job.isActive ? "default" : "secondary"}>
                              {job.isActive ? "Active" : "Inactive"}
                            </Badge>
                            <Badge variant="outline">Every {job.scheduleInterval}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {job.profiles.length} profile(s) • ${job.tradeSizeUsd} trades • {job.leverage}x leverage • Min {job.threshold}% confidence
                          </p>
                          {job.lastRun && (
                            <p className="text-xs text-muted-foreground">
                              Last run: {formatDate(job.lastRun)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteJob(job.id, job.name)}
                            disabled={deletingJobId === job.id}
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            {deletingJobId === job.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                          <Switch
                            checked={job.isActive}
                            onCheckedChange={(checked) => handleToggleJob(job.id, checked)}
                          />
                          {job.isActive ? <Play className="w-4 h-4 text-green-500" /> : <Pause className="w-4 h-4 text-gray-500" />}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="positions" className="space-y-4">
            <div className="space-y-2">
              {openPositions.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    No open positions from scheduled jobs.
                  </CardContent>
                </Card>
              ) : (
                openPositions.map((position) => (
                  <Card key={position.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{position.contract}</h3>
                            <Badge variant={position.tradeCall === 'long' ? "default" : "destructive"}>
                              {position.tradeCall.toUpperCase()}
                            </Badge>
                            <Badge variant="outline">{position.foundByProfile}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Entry: ${position.entryPrice} • Current: ${position.currentPrice} • Size: ${position.tradeSizeUsd} • {position.leverage}x
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Opened: {formatDate(position.openedAt)} • Confidence: {position.confidenceScore}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${position.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatPnl(position.unrealizedPnl)}
                          </p>
                          <Badge variant={position.status === 'open' ? "default" : "secondary"}>
                            {position.status}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <div className="space-y-2">
              {closedPositions.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    No closed positions from scheduled jobs yet.
                  </CardContent>
                </Card>
              ) : (
                closedPositions.map((position) => (
                  <Card key={position.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{position.contract}</h3>
                            <Badge variant={position.tradeCall === 'long' ? "default" : "destructive"}>
                              {position.tradeCall.toUpperCase()}
                            </Badge>
                            <Badge variant="outline">{position.foundByProfile}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Entry: ${position.entryPrice} • Exit: ${position.currentPrice} • Size: ${position.tradeSizeUsd} • {position.leverage}x
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(position.openedAt)} → {position.closedAt ? formatDate(position.closedAt) : 'Unknown'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${(position.realizedPnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatPnl(position.realizedPnl || 0)}
                          </p>
                          <Badge variant="secondary">Closed</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
