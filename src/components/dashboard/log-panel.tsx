"use client";

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type LogEntry = {
  id: number;
  timestamp: string;
  summary: string;
  details?: string;
};

type LogPanelProps = {
  logs: LogEntry[];
  onClear: () => void;
};

export function LogPanel({ logs, onClear }: LogPanelProps) {
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const lastLogId = logs.length > 0 ? logs[logs.length - 1].id : 0;

  React.useEffect(() => {
    if (scrollAreaRef.current) {
        setTimeout(() => {
          const viewport = scrollAreaRef.current?.querySelector('div[data-radix-scroll-area-viewport]');
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
          }
        }, 100);
    }
  }, [lastLogId]);

  return (
    <Card className="flex flex-col h-full min-h-[300px] lg:h-full">
      <CardHeader>
        <div className="flex items-start justify-between">
            <CardTitle className="flex items-center gap-2 font-headline">
              <Terminal className="w-5 h-5" />
              <span className="blinking-cursor">System Logs</span>
            </CardTitle>
            <Button 
                variant="outline" 
                size="icon" 
                onClick={onClear} 
                disabled={logs.length === 0}
                aria-label="Clear Logs"
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-grow p-0 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="p-6 pt-0 font-mono text-sm space-y-4">
              {logs.map((log) => (
                <div key={log.id} className="border-b border-border/50 pb-2">
                    <p className="whitespace-pre-wrap text-foreground">
                        <span className="text-primary/70 mr-2">&gt; {log.timestamp}</span>{log.summary}
                    </p>
                    {log.details && (
                        <pre className="mt-2 whitespace-pre-wrap p-2 bg-muted/50 rounded-md text-xs text-muted-foreground">{log.details}</pre>
                    )}
                </div>
              ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
