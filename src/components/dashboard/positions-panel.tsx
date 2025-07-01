// NEW FILE
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ListOpenPositionsOutput } from "@/lib/schemas";
import { ArrowDown, ArrowUp, Briefcase, RefreshCw } from "lucide-react";
import { Badge } from "../ui/badge";

type PositionsPanelProps = {
    positions: ListOpenPositionsOutput;
    isLoading: boolean;
    onRefresh: () => void;
};

const PositionDetail = ({ label, value, valueClassName }: { label: string, value: React.ReactNode, valueClassName?: string }) => (
    <div className="flex flex-col space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className={`text-sm font-mono ${valueClassName}`}>{value}</span>
    </div>
);

export function PositionsPanel({ positions, isLoading, onRefresh }: PositionsPanelProps) {

    const formatPnl = (pnl: string) => {
        const pnlValue = parseFloat(pnl);
        const color = pnlValue > 0 ? "text-green-500" : pnlValue < 0 ? "text-red-500" : "text-foreground";
        return <span className={color}>{pnlValue.toFixed(4)} USDT</span>
    };
    
    const formatReturn = (pnl: string, margin: string) => {
        const pnlValue = parseFloat(pnl);
        const marginValue = parseFloat(margin);
        if(marginValue === 0) return "0.00%";

        const returnValue = (pnlValue / marginValue) * 100;
        const color = returnValue > 0 ? "text-green-500" : returnValue < 0 ? "text-red-500" : "text-foreground";
        return <span className={color}>{returnValue.toFixed(2)}%</span>
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2 font-headline">
                            <Briefcase className="w-5 h-5" />
                            Open Positions
                        </CardTitle>
                        <CardDescription>Your currently open futures positions.</CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onRefresh} disabled={isLoading}>
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full">
                    <div className="p-6 pt-0 space-y-4">
                        {isLoading && positions.length === 0 ? (
                            <div className="flex items-center justify-center h-48 text-muted-foreground">Loading open positions...</div>
                        ) : positions.length === 0 ? (
                            <div className="flex items-center justify-center h-48 text-muted-foreground">No open positions found.</div>
                        ) : (
                            positions.map(pos => (
                                <Card key={pos.contract} className="bg-muted/30">
                                    <CardHeader className="p-4 border-b">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <h3 className="font-bold text-lg">{pos.contract}</h3>
                                                <Badge variant={pos.size > 0 ? "default" : "destructive"}>
                                                    {pos.size > 0 ? <ArrowUp className="w-3 h-3 mr-1" /> : <ArrowDown className="w-3 h-3 mr-1" />}
                                                    {pos.size > 0 ? "Long" : "Short"} &middot; {pos.leverage}x
                                                </Badge>
                                                <Badge variant="secondary" className="capitalize">{pos.mode.replace('dual_','')}</Badge>
                                            </div>
                                             <div className="text-right">
                                                <PositionDetail label="Unrealized PnL" value={formatPnl(pos.unrealised_pnl)} />
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6">
                                        <PositionDetail label="Amount (Notional)" value={`${parseFloat(pos.value).toFixed(4)} USDT`} />
                                        <PositionDetail label="Entry Price" value={parseFloat(pos.entry_price).toFixed(8)} />
                                        <PositionDetail label="Mark Price" value={parseFloat(pos.mark_price).toFixed(8)} />
                                        <PositionDetail label="Return %" value={formatReturn(pos.unrealised_pnl, pos.margin)} />
                                        
                                        <PositionDetail label="Margin" value={`${parseFloat(pos.margin).toFixed(4)} USDT`} />
                                        <PositionDetail label="Break-Even Price" value={parseFloat(pos.entry_price).toFixed(8)} />
                                        <PositionDetail label="Est. Liq. Price" value={parseFloat(pos.liq_price).toFixed(8)} />
                                        <PositionDetail label="Realized PnL" value={formatPnl(pos.realised_pnl)} />

                                        <PositionDetail label="Maintenance Margin" value={`${parseFloat(pos.maintenance_margin).toFixed(4)} USDT`} />
                                        <PositionDetail label="MMR" value={`${parseFloat(pos.maintenance_rate)*100}%`} />
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
