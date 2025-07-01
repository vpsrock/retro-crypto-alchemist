"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, TrendingUp, TrendingDown, Trash2, Loader2, Send } from "lucide-react";
import type { CombinedResult, ListOpenPositionsOutput } from "@/lib/schemas";

type ResultsPanelProps = {
  results: CombinedResult[];
  onPlaceTrade: (tradeDetails: CombinedResult) => Promise<void>;
  onClearResults: () => void;
  openPositions: ListOpenPositionsOutput;
};

export function ResultsPanel({ results, onPlaceTrade, onClearResults, openPositions }: ResultsPanelProps) {
    const [placingTradeMarket, setPlacingTradeMarket] = useState<string | null>(null);

    const openPositionContracts = useMemo(() => 
        new Set(openPositions.map(p => p.contract))
    , [openPositions]);

    const handlePlaceTrade = async (result: CombinedResult) => {
        setPlacingTradeMarket(result.market);
        try {
            await onPlaceTrade(result);
        } finally {
            setPlacingTradeMarket(null);
        }
    }
    
    const sortedResults = useMemo(() => {
        return [...results].sort((a, b) => b.confidence_score - a.confidence_score);
    }, [results]);

  return (
    <Card className="flex-grow flex flex-col min-h-[50vh] lg:min-h-0">
      <CardHeader>
        <div className="flex items-start justify-between">
            <div>
                <CardTitle className="flex items-center gap-2 font-headline">
                  <Bot className="w-5 h-5" />
                  AI Trade Recommendations
                </CardTitle>
                <CardDescription>
                  Results from the latest analysis runs.
                </CardDescription>
            </div>
            <Button 
                variant="outline" 
                size="icon" 
                onClick={onClearResults} 
                disabled={results.length === 0}
                aria-label="Clear Results"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-grow p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Call</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Take Profit</TableHead>
                <TableHead>Stop Loss</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">
                    No analysis results yet. Run a task to see recommendations.
                  </TableCell>
                </TableRow>
              ) : (
                sortedResults.map((r, index) => {
                    const isPositionOpen = openPositionContracts.has(r.market);
                    return (
                        <TableRow key={`${r.market}-${index}`} className={r.final_decision === "TRADE" ? "bg-primary/10" : ""}>
                            <TableCell className="font-medium">{r.market}</TableCell>
                            <TableCell>
                            <Badge variant={r.trade_call.toLowerCase() === 'long' ? 'default' : r.trade_call.toLowerCase() === 'short' ? 'destructive' : 'secondary'} className="capitalize">
                                {r.trade_call.toLowerCase() === 'long' && <TrendingUp className="mr-1 h-3 w-3" />}
                                {r.trade_call.toLowerCase() === 'short' && <TrendingDown className="mr-1 h-3 w-3" />}
                                {r.trade_call}
                            </Badge>
                            </TableCell>
                            <TableCell>
                                <span className={r.confidence_score >= 75 ? "text-primary" : r.confidence_score >= 50 ? "text-yellow-400" : "text-muted-foreground"}>
                                    {r.confidence_score}%
                                </span>
                            </TableCell>
                            <TableCell>{r.current_price.toFixed(8)}</TableCell>
                            <TableCell>{r.take_profit?.toFixed(8)}</TableCell>
                            <TableCell>{r.stop_loss?.toFixed(8)}</TableCell>
                            <TableCell>
                            <Button 
                                variant="outline" 
                                size="sm"
                                disabled={r.final_decision !== "TRADE" || !!placingTradeMarket || isPositionOpen}
                                onClick={() => handlePlaceTrade(r)}
                                title={isPositionOpen ? `A position for ${r.market} is already open.` : 'Place Trade'}
                            >
                                {placingTradeMarket === r.market ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                ) : (
                                    <Send className="mr-2 h-4 w-4" />
                                )}
                                Place Trade
                            </Button>
                            </TableCell>
                        </TableRow>
                    )
                })
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
