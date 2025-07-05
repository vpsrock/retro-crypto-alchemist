// Enhanced schema for dynamic position management
import { z } from 'genkit';

// ===== POSITION STATE MANAGEMENT =====

export const PositionStateSchema = z.object({
    id: z.string(), // position_id from database
    contract: z.string(),
    direction: z.enum(['long', 'short']),
    size: z.number(),
    entryPrice: z.number(),
    entryOrderId: z.string(),
    
    // Multi-TP Configuration
    strategyType: z.enum(['single', 'multi-tp']),
    tp1Size: z.number().optional(),
    tp2Size: z.number().optional(),
    runnerSize: z.number().optional(),
    
    // Order IDs for tracking
    tp1OrderId: z.string().optional(),
    tp2OrderId: z.string().optional(),
    currentSlOrderId: z.string(),
    
    // Dynamic State
    phase: z.enum(['initial', 'tp1_filled', 'tp2_filled', 'completed', 'stopped_out']),
    remainingSize: z.number(),
    realizedPnl: z.number().default(0),
    
    // Price Levels
    originalSlPrice: z.number(),
    currentSlPrice: z.number(),
    tp1Price: z.number().optional(),
    tp2Price: z.number().optional(),
    
    // Timestamps
    createdAt: z.string(),
    lastUpdated: z.string(),
    
    // Metadata
    apiKey: z.string(),
    apiSecret: z.string(),
    settle: z.enum(['usdt', 'btc'])
});

export type PositionState = z.infer<typeof PositionStateSchema>;

// ===== ORDER FILL DETECTION =====

export const OrderFillEventSchema = z.object({
    orderId: z.string(),
    contract: z.string(),
    fillType: z.enum(['tp1', 'tp2', 'sl', 'manual']),
    fillSize: z.number(),
    fillPrice: z.number(),
    fillTime: z.string(),
    positionId: z.string()
});

export type OrderFillEvent = z.infer<typeof OrderFillEventSchema>;

// ===== DYNAMIC SL UPDATE =====

export const SlUpdateRequestSchema = z.object({
    positionId: z.string(),
    newSlPrice: z.number(),
    reason: z.enum(['break_even', 'trailing', 'manual', 'emergency']),
    oldSlOrderId: z.string().optional(),
    contractSpec: z.object({
        tickSize: z.string(),
        decimalPlaces: z.number()
    })
});

export type SlUpdateRequest = z.infer<typeof SlUpdateRequestSchema>;

// ===== MONITORING STATE =====

export const MonitoringStateSchema = z.object({
    isActive: z.boolean(),
    lastCheck: z.string(),
    activePositions: z.array(z.string()), // position IDs
    errors: z.array(z.object({
        positionId: z.string(),
        error: z.string(),
        timestamp: z.string(),
        severity: z.enum(['warning', 'error', 'critical'])
    })),
    settings: z.object({
        checkInterval: z.number().default(30000), // 30 seconds
        maxRetries: z.number().default(3),
        breakEvenBuffer: z.number().default(0.0005), // 0.05% buffer for break-even
        trailingDistance: z.number().default(0.01) // 1% trailing distance
    })
});

export type MonitoringState = z.infer<typeof MonitoringStateSchema>;

// ===== ACTION AUDIT LOG =====

export const ActionAuditSchema = z.object({
    id: z.string(),
    positionId: z.string(),
    action: z.enum([
        'position_created',
        'tp1_filled', 
        'tp2_filled',
        'sl_filled',
        'manual_filled',
        'sl_updated_break_even',
        'sl_updated_trailing',
        'position_stopped_out',
        'position_completed',
        'error_occurred'
    ]),
    details: z.record(z.any()),
    timestamp: z.string(),
    success: z.boolean(),
    error: z.string().optional()
});

export type ActionAudit = z.infer<typeof ActionAuditSchema>;
