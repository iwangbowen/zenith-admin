import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

/** Technical observability status. `partial` is explicit so missing samples are never rendered as zero. */
export const OBSERVABILITY_STATUSES = ['ok', 'degraded', 'unavailable'] as const;
export type ObservabilityStatus = (typeof OBSERVABILITY_STATUSES)[number];

export const observabilityWindowSchema = z.object({
  from: z.string(),
  to: z.string(),
  seconds: z.int().positive(),
}).meta({ id: 'ObservabilityWindow' });
export type ObservabilityWindow = z.infer<typeof observabilityWindowSchema>;

export const observabilitySourceSchema = z.object({
  key: z.string(),
  status: z.enum(OBSERVABILITY_STATUSES),
  generatedAt: z.string().nullable(),
  ageSeconds: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
}).meta({ id: 'ObservabilitySource' });
export type ObservabilitySource = z.infer<typeof observabilitySourceSchema>;

export const observabilitySloSchema = z.object({
  key: z.string(),
  name: z.string(),
  target: z.number().min(0).max(1),
  status: z.enum(OBSERVABILITY_STATUSES),
  achieved: z.number().min(0).max(1).nullable(),
  totalEvents: z.number().nonnegative().nullable(),
  badEvents: z.number().nonnegative().nullable(),
  errorBudgetRemaining: z.number().min(0).max(1).nullable(),
  burnRateFast: z.number().nonnegative().nullable(),
  burnRateSlow: z.number().nonnegative().nullable(),
  window: observabilityWindowSchema,
}).meta({ id: 'ObservabilitySlo' });
export type ObservabilitySlo = z.infer<typeof observabilitySloSchema>;

export const observabilityCapacitySchema = z.object({
  database: z.object({
    activeConnections: z.number().nonnegative().nullable(),
    totalConnections: z.number().nonnegative().nullable(),
    utilization: z.number().min(0).max(1).nullable(),
  }),
  redis: z.object({
    connectedClients: z.number().nonnegative().nullable(),
    maxClients: z.number().nonnegative().nullable(),
    utilization: z.number().min(0).max(1).nullable(),
    usedMemory: z.number().nonnegative().nullable(),
  }),
  workers: z.object({
    active: z.int().nonnegative().nullable(),
    required: z.int().nonnegative().nullable(),
  }),
  queues: z.array(z.object({
    name: z.string(),
    ready: z.int().nonnegative(),
    active: z.int().nonnegative(),
    deferred: z.int().nonnegative(),
    failed: z.int().nonnegative(),
  })),
}).meta({ id: 'ObservabilityCapacity' });
export type ObservabilityCapacity = z.infer<typeof observabilityCapacitySchema>;

export const observabilitySummarySchema = z.object({
  generatedAt: z.string(),
  status: z.enum(OBSERVABILITY_STATUSES),
  partial: z.boolean(),
  window: observabilityWindowSchema,
  sources: z.array(observabilitySourceSchema),
  dependencies: z.record(z.string(), z.enum(OBSERVABILITY_STATUSES)),
  slos: z.array(observabilitySloSchema),
  capacity: observabilityCapacitySchema,
}).meta({ id: 'ObservabilitySummary' });
export type ObservabilitySummary = z.infer<typeof observabilitySummarySchema>;

export const observabilityContract = defineContract('/api/observability', {
  summary: op.get('/summary', {
    access: { permission: 'system:monitor:view' },
    response: observabilitySummarySchema,
    summary: '获取观测汇总、SLO 和容量状态',
    description: '返回聚合后的低基数观测数据；缺失数据通过 partial 和 sources 显式表达，不以零值代替。',
  }),
}, { tags: ['Observability'] });
