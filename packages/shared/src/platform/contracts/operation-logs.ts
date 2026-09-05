import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { OPERATION_LOG_RESULTS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const operationLogSchema = z.object({
  id: z.int(),
  userId: z.int().nullable(),
  username: z.string().nullable(),
  nickname: z.string().nullable().optional().meta({ description: '用户当前昵称（按 username 关联补充；用户已删除时为 null）' }),
  module: z.string().nullable(),
  description: z.string(),
  method: z.string(),
  path: z.string(),
  requestId: z.string().nullable().optional().meta({ description: '链路 ID（= 请求的 X-Request-Id），可跳转链路追踪' }),
  requestBody: z.string().nullable(),
  beforeData: z.string().nullable(),
  afterData: z.string().nullable(),
  responseCode: z.int().nullable(),
  responseBody: z.string().nullable(),
  durationMs: z.int().nullable(),
  ip: z.string().nullable(),
  location: z.string().nullable().optional(),
  userAgent: z.string().nullable(),
  os: z.string().nullable(),
  browser: z.string().nullable(),
  tenantId: z.int().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'OperationLog' });

export type OperationLog = z.infer<typeof operationLogSchema>;

const countByModuleSchema = z.object({ module: z.string(), count: z.int() });

export const operationLogStatsSchema = z.object({
  summary: z.object({
    total: z.int(),
    successCount: z.int(),
    failCount: z.int(),
    avgDurationMs: z.number().nullable(),
    uniqueUsers: z.int(),
    p50DurationMs: z.number().nullable().meta({ description: '耗时分位数（基于有耗时记录的请求）' }),
    p95DurationMs: z.number().nullable(),
    p99DurationMs: z.number().nullable(),
  }),
  prevSummary: z.object({
    total: z.int(),
    successCount: z.int(),
    failCount: z.int(),
    avgDurationMs: z.number().nullable(),
    uniqueUsers: z.int(),
  }).meta({ description: '上一周期（相同天数）汇总，用于环比' }),
  moduleStats: z.array(countByModuleSchema),
  moduleTimingStats: z.array(z.object({ module: z.string(), avgMs: z.number(), maxMs: z.number(), count: z.int() })),
  dailyStats: z.array(z.object({ date: z.string(), count: z.int(), successCount: z.int(), failCount: z.int(), avgMs: z.number().nullable() })),
  userStats: z.array(z.object({ username: z.string(), nickname: z.string().nullable().optional(), count: z.int() })),
  methodStats: z.array(z.object({ method: z.string(), count: z.int() })),
  hourlyStats: z.array(z.object({ hour: z.int(), count: z.int() })),
  statusClassStats: z.array(z.object({ statusClass: z.string(), count: z.int() })).meta({ description: '响应状态码分布（按 2xx/3xx/4xx/5xx 归类）' }),
  durationHistogram: z.array(z.object({ bucket: z.string(), count: z.int() })).meta({ description: '耗时区间分布' }),
  slowPaths: z.array(z.object({ path: z.string(), avgMs: z.number(), maxMs: z.number(), count: z.int() })).meta({ description: '慢接口 Top（按平均耗时）' }),
  failModuleStats: z.array(countByModuleSchema).meta({ description: '失败热点模块 Top（responseCode >= 400）' }),
  userModuleFlows: z.array(z.object({ username: z.string(), nickname: z.string().nullable().optional(), module: z.string(), count: z.int() }))
    .meta({ description: '用户 → 模块 操作流向（桑基图数据源）' }),
}).meta({ id: 'OperationLogStats' });

export type OperationLogStats = z.infer<typeof operationLogStatsSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const operationLogListQuery = paginationQuery.extend({
  username: z.string().optional().meta({ description: '按用户名 / 昵称匹配' }),
  module: z.string().optional(),
  description: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  ip: z.string().optional(),
  status: z.enum(OPERATION_LOG_RESULTS).optional(),
  content: z.string().optional().meta({ description: '内容关键字（匹配请求体与操作前后快照）' }),
  startTime: dateRangeBound('操作时间起'),
  endTime: dateRangeBound('操作时间止'),
  minDurationMs: z.coerce.number().int().nonnegative().optional(),
  maxDurationMs: z.coerce.number().int().nonnegative().optional(),
});

export const operationLogStatsQuery = z.object({
  days: z.coerce.number().optional().meta({ description: '统计天数，默认 7' }),
});

export const operationLogCleanQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(180).meta({ description: '清除多少天之前的日志' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const operationLogContract = defineContract('/api/operation-logs', {
  list: op.get('/', { query: operationLogListQuery, response: paginated(operationLogSchema), summary: '操作日志分页列表' }),
  stats: op.get('/stats', { query: operationLogStatsQuery, response: operationLogStatsSchema, summary: '操作日志统计' }),
  clean: op.delete('/clean', { query: operationLogCleanQuery, summary: '清除操作日志' }),
}, { tags: ['OperationLogs'] });
