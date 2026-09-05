import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';

// ─── 数据集执行记录 / 运行治理 ──────────────────────────────────────────────────

export const reportDatasetExecutionLogSchema = z.object({
  id: z.int(),
  datasetId: z.int().nullable(),
  datasetName: z.string().nullable().optional(),
  datasourceId: z.int().nullable(),
  datasourceName: z.string().nullable().optional(),
  userId: z.int().nullable(),
  username: z.string().nullable().optional(),
  tenantId: z.int().nullable(),
  scene: z.string(),
  sourceRefId: z.string().nullable().optional(),
  durationMs: z.int(),
  rowCount: z.int().nullable(),
  bytes: z.int().nullable().optional(),
  truncated: z.boolean().optional(),
  slow: z.boolean().optional(),
  cacheHit: z.boolean(),
  success: z.boolean(),
  errorCode: z.int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  paramKeys: z.array(z.string()).optional(),
  executedAt: z.string(),
}).meta({ id: 'ReportDatasetExecutionLog' });

export type ReportDatasetExecutionLog = z.infer<typeof reportDatasetExecutionLogSchema>;

export const reportRuntimeGovernanceSchema = z.object({
  slowQueryMs: z.int(),
  dashboardMaxConcurrent: z.int(),
  datasetMaxRows: z.int(),
  datasetMaxBytes: z.int(),
  tenantMaxConcurrent: z.int().optional(),
  userMaxConcurrent: z.int().optional(),
  tenantDailyQueryLimit: z.int().optional(),
  userDailyQueryLimit: z.int().optional(),
  tenantDailyCostLimit: z.number().optional(),
  userDailyCostLimit: z.number().optional(),
}).meta({ id: 'ReportRuntimeGovernance' });

export type ReportRuntimeGovernance = z.infer<typeof reportRuntimeGovernanceSchema>;

export const reportExecutionStatsSlowItemSchema = z.object({
  datasetId: z.int().nullable(),
  datasetName: z.string().nullable().optional(),
  datasourceId: z.int().nullable(),
  datasourceName: z.string().nullable().optional(),
  scene: z.string(),
  count: z.int(),
  avgDurationMs: z.int(),
  maxDurationMs: z.int(),
  lastExecutedAt: z.string().nullable(),
}).meta({ id: 'ReportExecutionStatsSlowItem' });

export type ReportExecutionStatsSlowItem = z.infer<typeof reportExecutionStatsSlowItemSchema>;

/** 查询容量快照（全局并发 / 排队） */
export const reportQueryCapacitySchema = z.object({
  globalLimit: z.int(),
  running: z.int(),
  queueDepth: z.int(),
  datasourceQueues: z.int(),
}).meta({ id: 'ReportQueryCapacity' });

export type ReportQueryCapacity = z.infer<typeof reportQueryCapacitySchema>;

/** 查询成本趋势点（执行统计 series 与容量趋势共用） */
export const reportQueryCostTrendPointSchema = z.object({
  bucket: z.string(),
  queries: z.int(),
  rows: z.int(),
  bytes: z.int(),
  costUnits: z.number(),
  avgDurationMs: z.int(),
  queueMs: z.int(),
}).meta({ id: 'ReportQueryCostTrendPoint' });

export type ReportQueryCostTrendPoint = z.infer<typeof reportQueryCostTrendPointSchema>;

export const reportExecutionStatsSchema = z.object({
  total: z.int(),
  successCount: z.int(),
  successRate: z.number(),
  p95DurationMs: z.int(),
  avgDurationMs: z.int(),
  cacheHitRate: z.number(),
  slowCount: z.int(),
  truncatedCount: z.int(),
  governance: reportRuntimeGovernanceSchema,
  capacity: reportQueryCapacitySchema,
  series: z.array(reportQueryCostTrendPointSchema),
  topSlowQueries: z.array(reportExecutionStatsSlowItemSchema),
}).meta({ id: 'ReportExecutionStats' });

export type ReportExecutionStats = z.infer<typeof reportExecutionStatsSchema>;

const executionFilterFields = {
  datasetId: z.coerce.number().int().positive().optional(),
  datasourceId: z.coerce.number().int().positive().optional(),
  dashboardId: z.coerce.number().int().positive().optional(),
  scene: z.string().max(32).optional(),
  success: queryBool(),
  startAt: dateRangeBound('起始时间'),
  endAt: dateRangeBound('结束时间'),
};

export const reportExecutionListQuery = paginationQuery.extend({
  ...executionFilterFields,
  slow: queryBool('仅慢查询'),
});

export const reportExecutionStatsQuery = z.object(executionFilterFields);

export const reportExecutionContract = defineContract('/api/report/executions', {
  stats: op.get('/stats', { query: reportExecutionStatsQuery, response: reportExecutionStatsSchema, summary: '数据集执行日志统计' }),
  governance: op.get('/governance', { response: reportRuntimeGovernanceSchema, summary: '报表运行治理配置' }),
  list: op.get('/', { query: reportExecutionListQuery, response: paginated(reportDatasetExecutionLogSchema), summary: '数据集执行日志列表' }),
}, { tags: ['报表数据集'] });
