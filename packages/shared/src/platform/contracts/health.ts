import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { PROCESS_ROLES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const HEALTH_STATUSES = ['ok', 'degraded'] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** 单项检查：`degraded` = 功能可用但处于降级；任一关键项降级时整体 status 也会降级。 */
export const HEALTH_CHECK_RESULTS = ['ok', 'degraded', 'error'] as const;

export type HealthCheckResult = (typeof HEALTH_CHECK_RESULTS)[number];

export const healthSchema = z.object({
  status: z.enum(HEALTH_STATUSES).meta({ example: 'ok' }),
  version: z.string().meta({ example: '2.17.0' }),
  uptimeSeconds: z.int().meta({ example: 12345 }),
  /** 应答进程承担的角色（`ZENITH_ROLES`） */
  roles: z.array(z.enum(PROCESS_ROLES)).meta({ example: ['api'] }),
  checks: z.record(z.string(), z.enum(HEALTH_CHECK_RESULTS)).meta({
    description: '`workers`：仅 api 角色输出，近期无活跃 worker 心跳时为 degraded（作业会排队但无人执行）',
    example: { database: 'ok', redis: 'ok', invalidationBus: 'ok', workers: 'ok' },
  }),
}).meta({ id: 'Health' });

export type Health = z.infer<typeof healthSchema>;

export const HEALTH_PROBE_STATUSES = ['ok', 'degraded', 'unavailable'] as const;
export type HealthProbeStatus = (typeof HEALTH_PROBE_STATUSES)[number];

export const healthProbeSchema = z.object({
  status: z.enum(HEALTH_PROBE_STATUSES),
  ready: z.boolean(),
  version: z.string(),
  roles: z.array(z.enum(PROCESS_ROLES)),
  checks: z.record(z.string(), z.enum(['ok', 'degraded', 'error', 'unavailable'])),
}).meta({ id: 'HealthProbe' });

export type HealthProbe = z.infer<typeof healthProbeSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const healthContract = defineContract('/api/health', {
  check: op.get('/', {
    response: healthSchema,
    public: true,
    summary: '健康检查',
    description: '检查数据库与 Redis 连通状态，返回服务运行信息。',
  }),
  livez: op.get('/livez', { response: healthProbeSchema, public: true, summary: '进程存活探针' }),
  startupz: op.get('/startupz', { response: healthProbeSchema, public: true, summary: '服务启动探针' }),
  readyz: op.get('/readyz', { response: healthProbeSchema, public: true, summary: '服务就绪探针' }),
}, { tags: ['服务状态'] });
