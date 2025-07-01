import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hourglass, RefreshCw, XCircle } from "lucide-react";
import type { ListOpenOrdersOutput } from "@/lib/schemas";

type OrdersPanelProps = {
    orders: ListOpenOrdersOutput;
    onCancelOrder: (orderId: string) => void;
    isLoading: boolean;
    onRefresh: () => void;
};

export function OrdersPanel({ orders, onCancelOrder, isLoading, onRefresh }: OrdersPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
            <div>
                <CardTitle className="flex items-center gap-2 font-headline">
                    <Hourglass className="w-5 h-5" />
                    Order Management
                </CardTitle>
                <CardDescription>Track and manage open TP/SL orders.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onRefresh} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Market</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading && orders.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} className="text-center h-24">Loading open orders...</TableCell>
                        </TableRow>
                    ) : orders.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} className="text-center h-24">No open orders found.</TableCell>
                        </TableRow>
                    ) : (
                        orders.map((order) => (
                            <TableRow key={order.id}>
                                <TableCell>{order.initial.contract}</TableCell>
                                <TableCell className="capitalize">
                                    {order.order_type?.includes('long') ? 'Close Long' : order.order_type?.includes('short') ? 'Close Short' : 'N/A'}
                                </TableCell>
                                <TableCell>{order.trigger.price}</TableCell>
                                <TableCell>
                                    <Button variant="destructive" size="sm" onClick={() => onCancelOrder(order.id!)}>
                                        <XCircle className="w-4 h-4 mr-2" />
                                        Cancel
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
