import * as z from 'zod';
import { dateRangeQuery, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { OPEN_API_STATS_GRANULARITIES, OPEN_APP_ENVIRONMENTS, OPEN_AUTH_CHANNELS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 开放 API 调用日志 */
export const openApiCallLogSchema = z.object({
  id: z.int(),
  clientId: z.string(),
  appName: z.string().nullable(),
  method: z.string().meta({ example: 'GET' }),
  path: z.string().meta({ example: '/api/open/v1/ping' }),
  statusCode: z.int(),
  success: z.boolean(),
  durationMs: z.int(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  scope: z.string().nullable().meta({ description: '本次调用所需 scope；无需 scope 的端点为 null' }),
  authChannel: z.enum(OPEN_AUTH_CHANNELS).nullable(),
  userId: z.int().nullable().meta({ description: '用户授权令牌对应的用户；client_credentials 与签名通道为 null' }),
  errorMessage: z.string().nullable(),
  requestId: z.string().nullable(),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
  createdAt: z.string(),
}).meta({ id: 'OpenApiCallLog' });

export type OpenApiCallLog = z.infer<typeof openApiCallLogSchema>;

/** 调用统计总览 */
export const openApiStatsOverviewSchema = z.object({
  totalCalls: z.int(),
  successCalls: z.int(),
  failedCalls: z.int(),
  successRate: z.number().meta({ description: '成功率（百分比，保留两位小数）' }),
  avgDurationMs: z.number(),
  p95DurationMs: z.number(),
  p99DurationMs: z.number(),
  percentilesPartial: z.boolean().meta({ description: '分位数仅覆盖日志保留期内的数据时为 true' }),
  percentileRetentionDays: z.int(),
  activeApps: z.int(),
  todayCalls: z.int(),
}).meta({ id: 'OpenApiStatsOverview' });

export type OpenApiStatsOverview = z.infer<typeof openApiStatsOverviewSchema>;

/** 调用趋势点（按小时 / 天聚合） */
export const openApiStatsTrendPointSchema = z.object({
  time: z.string().meta({ description: '按天为 YYYY-MM-DD，按小时为 YYYY-MM-DD HH:00:00' }),
  total: z.int(),
  success: z.int(),
  failed: z.int(),
}).meta({ id: 'OpenApiStatsTrendPoint' });

export type OpenApiStatsTrendPoint = z.infer<typeof openApiStatsTrendPointSchema>;

/** 按应用 / 端点聚合统计项 */
export const openApiStatsGroupItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  total: z.int(),
  success: z.int(),
  failed: z.int(),
  avgDurationMs: z.number(),
}).meta({ id: 'OpenApiStatsGroupItem' });

export type OpenApiStatsGroupItem = z.infer<typeof openApiStatsGroupItemSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

/** 统计维度：时间范围 / 应用 / 环境 */
export const openApiStatsRangeQuery = z.object({
  ...dateRangeQuery(),
  clientId: z.string().optional(),
  environment: queryEnum(OPEN_APP_ENVIRONMENTS),
});

export const openApiStatsTrendQuery = openApiStatsRangeQuery.extend({
  granularity: queryEnum(OPEN_API_STATS_GRANULARITIES).default('day'),
});

export const openApiStatsGroupQuery = openApiStatsRangeQuery.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10).meta({ description: 'Top N，最大 50' }),
});

export const openApiCallLogListQuery = paginationQuery.extend({
  clientId: z.string().optional(),
  success: queryBool('按调用结果筛选'),
  method: z.string().max(10).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  environment: queryEnum(OPEN_APP_ENVIRONMENTS),
  keyword: z.string().optional().meta({ description: '按路径 / 应用名称模糊匹配' }),
  ...dateRangeQuery(),
});

export const openApiStatsContract = defineContract('/api/open-api-stats', {
  overview: op.get('/overview', { query: openApiStatsRangeQuery, response: openApiStatsOverviewSchema, summary: '调用统计总览' }),
  trend: op.get('/trend', { query: openApiStatsTrendQuery, response: z.array(openApiStatsTrendPointSchema), summary: '调用趋势（按小时/天聚合）' }),
  byApp: op.get('/by-app', { query: openApiStatsGroupQuery, response: z.array(openApiStatsGroupItemSchema), summary: '按应用聚合统计（Top N）' }),
  byEndpoint: op.get('/by-endpoint', { query: openApiStatsGroupQuery, response: z.array(openApiStatsGroupItemSchema), summary: '按端点聚合统计（Top N）' }),
  logs: op.get('/logs', { query: openApiCallLogListQuery, response: paginated(openApiCallLogSchema), summary: '调用日志列表' }),
}, { tags: ['OpenApiStats'] });
