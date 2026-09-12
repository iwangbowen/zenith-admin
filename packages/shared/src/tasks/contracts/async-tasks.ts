import * as z from 'zod';
import { batchIdsBody, dateRangeQuery, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { ASYNC_TASK_ITEM_STATUSES, ASYNC_TASK_STATUSES } from '../constants';
import { updateAsyncTaskTypePolicySchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const asyncTaskSchema = z.object({
  id: z.int(),
  taskType: z.string().meta({ example: 'demo-batch' }),
  title: z.string(),
  module: z.string().nullable().meta({ description: '所属模块（注册表展示名；类型已下线时为 null）' }),
  status: z.enum(ASYNC_TASK_STATUSES),
  payload: z.record(z.string(), z.unknown()),
  totalCount: z.int().nullable().meta({ description: '总量；不可枚举的任务为 null（前端显示不定进度条）' }),
  processedCount: z.int(),
  failedCount: z.int(),
  progressNote: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  cancelRequested: z.boolean(),
  attempts: z.int(),
  maxAttempts: z.int().meta({ description: '最大执行次数（提交时从类型策略快照；失败自动重试直到用尽）' }),
  retryDelayMs: z.int().meta({ description: '重试退避基数快照（毫秒；断点恢复与自动重试沿用，重新开始时刷新）' }),
  nextRunAt: z.string().nullable().meta({ description: '下次自动重试时间（退避中）；null = 无待定重试' }),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  tenantId: z.int().nullable(),
  traceId: z.string().nullable().meta({ description: '链路 ID（= 提交请求的 X-Request-Id），可跳转链路追踪' }),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AsyncTask' });

export type AsyncTask = z.infer<typeof asyncTaskSchema>;

/** 任务类型元信息（注册默认值 + 运行时策略合并后的生效值） */
export const asyncTaskTypeMetaSchema = z.object({
  taskType: z.string(),
  title: z.string(),
  module: z.string(),
  description: z.string().nullable(),
  allowConcurrent: z.boolean().meta({ description: 'false：同一用户存在未结束任务时禁止重复提交' }),
  enabled: z.boolean().meta({ description: 'false：暂停新提交' }),
  maxAttempts: z.int(),
  retryDelayMs: z.int().meta({ description: '重试退避基数（毫秒），实际延迟 = retryDelayMs * 2^(attempts-1)' }),
  retentionDays: z.int().nullable().meta({ description: '已结束任务保留天数；null = 跟随全局' }),
}).meta({ id: 'AsyncTaskTypeMeta' });

export type AsyncTaskTypeMeta = z.infer<typeof asyncTaskTypeMetaSchema>;

/** 任务项明细（行级处理状态） */
export const asyncTaskItemSchema = z.object({
  id: z.int(),
  taskId: z.int(),
  itemKey: z.string(),
  label: z.string().nullable(),
  status: z.enum(ASYNC_TASK_ITEM_STATUSES),
  message: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  attempt: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AsyncTaskItem' });

export type AsyncTaskItem = z.infer<typeof asyncTaskItemSchema>;

/** 单个任务类型的执行统计 */
export const asyncTaskTypeStatSchema = z.object({
  taskType: z.string(),
  title: z.string().meta({ description: '注册表中的展示名；类型已下线时回落为 taskType' }),
  module: z.string().nullable(),
  total: z.int(),
  running: z.int(),
  success: z.int(),
  failed: z.int(),
  successRate: z.number().nullable().meta({ description: '已结束任务中的成功占比（百分比，保留一位小数）；无已结束任务为 null' }),
  avgDurationMs: z.int().nullable().meta({ description: '成功任务的平均耗时（毫秒）；无数据为 null' }),
}).meta({ id: 'AsyncTaskTypeStat' });

export type AsyncTaskTypeStat = z.infer<typeof asyncTaskTypeStatSchema>;

/** 任务中心统计概览 */
export const asyncTaskStatsSchema = z.object({
  total: z.int(),
  pending: z.int(),
  running: z.int(),
  success: z.int(),
  failed: z.int(),
  cancelled: z.int(),
  avgDurationMs: z.int().nullable().meta({ description: '近 24 小时完成任务平均耗时（毫秒）；无数据为 null' }),
  duration: z.object({
    p50: z.int().nullable(),
    p95: z.int().nullable(),
    max: z.int().nullable(),
  }).meta({ description: '近 24 小时完成任务耗时分位（毫秒）' }),
  today: z.object({
    submitted: z.int(),
    success: z.int(),
    failed: z.int(),
    yesterdaySubmitted: z.int(),
  }).meta({ description: '今日提交概览与昨日提交数（环比用）' }),
  daily: z.array(z.object({
    date: z.string(),
    submitted: z.int(),
    success: z.int(),
    failed: z.int(),
  })).meta({ description: '近 14 天每日提交/成功/失败数（date: YYYY-MM-DD）' }),
  hourly: z.array(z.object({
    hour: z.string(),
    submitted: z.int(),
    failed: z.int(),
  })).meta({ description: '近 24 小时每小时提交/失败数（hour: YYYY-MM-DD HH:00）' }),
  successRate: z.number().nullable().meta({ description: '已结束任务中的成功占比（百分比，保留一位小数）' }),
  backlog: z.object({
    pending: z.int(),
    oldestPendingMinutes: z.int().nullable().meta({ description: '最早一条待执行任务已等待的分钟数；无积压为 null' }),
  }),
  retried: z.int().meta({ description: '发生过重试的任务数（attempts > 1）' }),
  retriedRecovered: z.int().meta({ description: '重试后最终成功的任务数' }),
  items: z.object({
    processed: z.int(),
    failed: z.int(),
  }).meta({ description: '行级处理量累计' }),
  topSubmitters: z.array(z.object({
    userId: z.int().nullable(),
    username: z.string(),
    count: z.int(),
    failed: z.int(),
  })).meta({ description: '近 30 天提交人 Top 5（createdBy 为空的系统任务合并为「系统」）' }),
  byType: z.array(asyncTaskTypeStatSchema).meta({ description: '按任务类型聚合（按总数降序，仅含有记录的类型）' }),
}).meta({ id: 'AsyncTaskStats' });

export type AsyncTaskStats = z.infer<typeof asyncTaskStatsSchema>;

export const asyncTaskBatchResultSchema = z.object({ affected: z.int() }).meta({ id: 'AsyncTaskBatchResult' });

export type AsyncTaskBatchResult = z.infer<typeof asyncTaskBatchResultSchema>;

export const asyncTaskCleanupResultSchema = z.object({ cleaned: z.int() }).meta({ id: 'AsyncTaskCleanupResult' });

export type AsyncTaskCleanupResult = z.infer<typeof asyncTaskCleanupResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const asyncTaskListQuery = paginationQuery.extend({
  taskType: z.string().optional(),
  status: queryEnum(ASYNC_TASK_STATUSES),
  keyword: z.string().optional().meta({ description: '匹配任务标题 / 任务类型' }),
  content: z.string().optional().meta({ description: '任务内容关键字（匹配入参与产出）' }),
  createdBy: z.string().optional().meta({ description: '提交人（模糊匹配用户名 / 昵称）' }),
  ...dateRangeQuery(),
});

export const asyncTaskItemListQuery = paginationQuery.extend({
  status: queryEnum(ASYNC_TASK_ITEM_STATUSES),
  keyword: z.string().optional(),
});

export const asyncTaskTypeParam = z.object({
  taskType: z.string().min(1).meta({ description: '任务类型标识', example: 'demo-batch' }),
});

export const asyncTaskContract = defineContract('/api/async-tasks', {
  types: op.get('/types', { response: z.array(asyncTaskTypeMetaSchema), summary: '已注册的任务类型（含生效策略）' }),
  updateTypePolicy: op.put('/types/{taskType}/config', {
    params: asyncTaskTypeParam,
    body: updateAsyncTaskTypePolicySchema,
    response: asyncTaskTypeMetaSchema,
    summary: '更新任务类型运行时策略',
  }),
  stats: op.get('/stats', { response: asyncTaskStatsSchema, summary: '任务中心统计概览' }),
  mine: op.get('/mine', { query: asyncTaskListQuery, response: paginated(asyncTaskSchema), summary: '我的任务列表（业务页面进度展示）' }),
  list: op.get('/', { query: asyncTaskListQuery, response: paginated(asyncTaskSchema), summary: '全局任务列表（任务中心）' }),
  cleanup: op.post('/cleanup', { response: asyncTaskCleanupResultSchema, summary: '立即清理超过保留期的已结束任务' }),
  batchCancel: op.post('/batch-cancel', { body: batchIdsBody, response: asyncTaskBatchResultSchema, summary: '批量取消任务' }),
  batchDelete: op.post('/batch-delete', { body: batchIdsBody, response: asyncTaskBatchResultSchema, summary: '批量删除任务记录（仅已结束）' }),
  detail: op.get('/{id}', { params: idParam, response: asyncTaskSchema, summary: '任务详情（创建者本人或管理员）' }),
  items: op.get('/{id}/items', {
    params: idParam,
    query: asyncTaskItemListQuery,
    response: paginated(asyncTaskItemSchema),
    summary: '任务项明细（行级状态，创建者本人或管理员）',
  }),
  cancel: op.post('/{id}/cancel', { params: idParam, response: asyncTaskSchema, summary: '取消任务（执行中为协作式取消）' }),
  resume: op.post('/{id}/resume', { params: idParam, response: asyncTaskSchema, summary: '断点恢复（保留进度从中断处继续）' }),
  restart: op.post('/{id}/restart', { params: idParam, response: asyncTaskSchema, summary: '重新开始（清空进度从头执行）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除任务记录' }),
}, { tags: ['AsyncTasks'] });
