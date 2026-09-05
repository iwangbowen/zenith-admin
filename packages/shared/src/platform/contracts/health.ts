import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const HEALTH_STATUSES = ['ok', 'degraded'] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_CHECK_RESULTS = ['ok', 'error'] as const;

export type HealthCheckResult = (typeof HEALTH_CHECK_RESULTS)[number];

export const healthSchema = z.object({
  status: z.enum(HEALTH_STATUSES).meta({ example: 'ok' }),
  version: z.string().meta({ example: '2.17.0' }),
  uptimeSeconds: z.int().meta({ example: 12345 }),
  checks: z.record(z.string(), z.enum(HEALTH_CHECK_RESULTS)).meta({ example: { database: 'ok', redis: 'ok' } }),
}).meta({ id: 'Health' });

export type Health = z.infer<typeof healthSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const healthContract = defineContract('/api/health', {
  check: op.get('/', {
    response: healthSchema,
    public: true,
    summary: '健康检查',
    description: '检查数据库与 Redis 连通状态，返回服务运行信息。',
  }),
}, { tags: ['服务状态'] });
