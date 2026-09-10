import * as z from 'zod';
import { auditFieldsSchema, dateRangeBound, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CRON_ALERT_LEVELS, CRON_ALERT_TYPES, CRON_JOB_STATUSES, CRON_RUN_STATUSES } from '../constants';
import { createCronJobSchema, cronJobStatusSchema, cronValidateSchema, updateCronJobSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cronJobSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '数据库备份' }),
  cronExpression: z.string().meta({ example: '0 0 2 * * *' }),
  handler: z.string().meta({ example: 'backupDatabase' }),
  params: z.string().nullable(),
  status: z.enum(CRON_JOB_STATUSES),
  description: z.string(),
  retryCount: z.int(),
  retryInterval: z.int().meta({ description: '重试间隔，单位：秒' }),
  retryBackoff: z.boolean(),
  monitorTimeout: z.int().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.enum(CRON_RUN_STATUSES).nullable(),
  lastRunMessage: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CronJob' });

export type CronJob = z.infer<typeof cronJobSchema>;

export const cronJobLogSchema = z.object({
  id: z.int(),
  jobId: z.int(),
  jobName: z.string(),
  executionCount: z.int(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.int().nullable(),
  status: z.enum(CRON_RUN_STATUSES),
  output: z.string().nullable(),
}).meta({ id: 'CronJobLog' });

export type CronJobLog = z.infer<typeof cronJobLogSchema>;

export const cronJobStatsPerJobSchema = z.object({
  jobId: z.int(),
  jobName: z.string(),
  handler: z.string(),
  enabled: z.boolean(),
  cronExpression: z.string(),
  monitorTimeout: z.int().nullable().meta({ description: '监控超时（秒）' }),
  nextRunAt: z.string().nullable().meta({ description: '下次计划执行时刻；停用或表达式无效时为 null' }),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.enum(CRON_RUN_STATUSES).nullable(),
  lastSuccessAt: z.string().nullable(),
  lastFailAt: z.string().nullable(),
  lastError: z.string().nullable().meta({ description: '最近一次失败的输出片段' }),
  totalRuns: z.int().meta({ description: '历史累计执行次数（不受统计周期影响）' }),
  runs: z.int().meta({ description: '统计周期内执行次数' }),
  successCount: z.int(),
  failCount: z.int(),
  successRate: z.number().nullable().meta({ description: '周期内成功率（%），无执行时为 null' }),
  prevSuccessRate: z.number().nullable().meta({ description: '上一周期成功率（%），用于环比' }),
  todayRuns: z.int(),
  todayFailCount: z.int(),
  avgDurationMs: z.int().nullable(),
  prevAvgDurationMs: z.int().nullable().meta({ description: '上一周期平均耗时，用于耗时恶化提示' }),
  p95DurationMs: z.int().nullable().meta({ description: 'P95 耗时（长尾性能），无已完成执行时为 null' }),
  maxDurationMs: z.int().nullable(),
  recentResults: z.array(z.enum(CRON_RUN_STATUSES)).meta({ description: '近 20 次执行状态（旧 → 新）' }),
  recentDurations: z.array(z.int().nullable()).meta({ description: '近 20 次执行耗时（旧 → 新），运行中为 null' }),
  consecutiveFails: z.int().meta({ description: '当前连续失败次数（最近一次成功后归零）' }),
}).meta({ id: 'CronJobStatsPerJob' });

export type CronJobStatsPerJob = z.infer<typeof cronJobStatsPerJobSchema>;

export const cronJobDailyStatSchema = z.object({
  date: z.string().meta({ example: '2026-06-22' }),
  total: z.int(),
  successCount: z.int(),
  failCount: z.int(),
  avgDurationMs: z.int().nullable().meta({ description: '当日已完成执行的平均耗时' }),
  p95DurationMs: z.int().nullable(),
}).meta({ id: 'CronJobDailyStat' });

export type CronJobDailyStat = z.infer<typeof cronJobDailyStatSchema>;

export const cronJobDowHourStatSchema = z.object({
  dow: z.int().min(1).max(7).meta({ description: '星期（1=周一 … 7=周日）' }),
  hour: z.int().min(0).max(23),
  total: z.int(),
  failCount: z.int(),
}).meta({ id: 'CronJobDowHourStat' });

export type CronJobDowHourStat = z.infer<typeof cronJobDowHourStatSchema>;

export const cronJobRunSummarySchema = z.object({
  total: z.int(),
  successCount: z.int(),
  failCount: z.int(),
  runningCount: z.int(),
  avgDurationMs: z.int().nullable(),
  p95DurationMs: z.int().nullable(),
}).meta({ id: 'CronJobRunSummary' });

export type CronJobRunSummary = z.infer<typeof cronJobRunSummarySchema>;

export const cronJobSchedulerStatusSchema = z.object({
  online: z.boolean().meta({ description: '当前进程的调度器已初始化' }),
  nodeId: z.string(),
  hostname: z.string(),
  pid: z.int(),
  activeNodes: z.int().meta({ description: '心跳未过期的调度节点数' }),
  lastHeartbeatAt: z.string().nullable(),
  wipCount: z.int().meta({ description: '本节点（当前接口进程）正在执行的任务数' }),
}).meta({ id: 'CronJobSchedulerStatus' });

export type CronJobSchedulerStatus = z.infer<typeof cronJobSchedulerStatusSchema>;

export const cronJobAlertSchema = z.object({
  type: z.enum(CRON_ALERT_TYPES),
  level: z.enum(CRON_ALERT_LEVELS),
  jobId: z.int(),
  jobName: z.string(),
  message: z.string(),
  detail: z.string().nullable().meta({ description: '补充信息：最近错误、应执行时刻等' }),
}).meta({ id: 'CronJobAlert' });

export type CronJobAlert = z.infer<typeof cronJobAlertSchema>;

export const cronJobTopErrorSchema = z.object({
  message: z.string().meta({ description: '归一化后的错误信息（数字已替换为 #）' }),
  count: z.int(),
  jobNames: z.array(z.string()),
  lastAt: z.string(),
}).meta({ id: 'CronJobTopError' });

export type CronJobTopError = z.infer<typeof cronJobTopErrorSchema>;

export const cronJobUpcomingRunSchema = z.object({
  jobId: z.int(),
  jobName: z.string(),
  cronExpression: z.string(),
  runAt: z.string().meta({ description: '该任务的下一次计划执行时刻' }),
  runsPerDay: z.int().nullable().meta({ description: '按相邻两次触发间隔估算的日执行频次；只触发一次时为 null' }),
}).meta({ id: 'CronJobUpcomingRun' });

export type CronJobUpcomingRun = z.infer<typeof cronJobUpcomingRunSchema>;

export const cronJobStatsSchema = z.object({
  days: z.int().meta({ description: '本次统计周期天数' }),
  totalJobs: z.int(),
  enabledJobs: z.int(),
  runningJobs: z.int().meta({ description: '执行记录中仍处于运行中的条数' }),
  today: cronJobRunSummarySchema,
  yesterday: cronJobRunSummarySchema.meta({ description: '昨日全天汇总' }),
  yesterdaySameTime: cronJobRunSummarySchema.meta({ description: '昨日 0 点至昨日同一时刻，用于与今日环比' }),
  period: cronJobRunSummarySchema.meta({ description: '近 days 天汇总' }),
  prevPeriod: cronJobRunSummarySchema.meta({ description: '再往前 days 天汇总，用于环比' }),
  scheduler: cronJobSchedulerStatusSchema,
  alerts: z.array(cronJobAlertSchema),
  perJob: z.array(cronJobStatsPerJobSchema),
  dailyStats: z.array(cronJobDailyStatSchema),
  dowHourStats: z.array(cronJobDowHourStatSchema).meta({ description: '周期内 星期 × 小时 执行分布' }),
  topErrors: z.array(cronJobTopErrorSchema).meta({ description: '周期内失败原因聚合（Top 10）' }),
  upcoming: z.array(cronJobUpcomingRunSchema).meta({ description: '每个启用任务在未来 24 小时内的下一次计划执行，按时间升序' }),
}).meta({ id: 'CronJobStats' });

export type CronJobStats = z.infer<typeof cronJobStatsSchema>;

export const cronValidateResultSchema = z.object({ valid: z.boolean() }).meta({ id: 'CronValidateResult' });

export type CronValidateResult = z.infer<typeof cronValidateResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cronJobListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按任务名称模糊匹配' }),
});

export const cronJobLogListQuery = paginationQuery.extend({
  jobId: z.coerce.number().int().positive().optional(),
  status: queryEnum(CRON_RUN_STATUSES, '按执行状态筛选'),
  keyword: z.string().optional().meta({ description: '按任务名称 / 输出模糊匹配' }),
  startTime: dateRangeBound('开始时间下限'),
  endTime: dateRangeBound('开始时间上限'),
});

export type CronJobLogListQueryInput = z.infer<typeof cronJobLogListQuery>;

export const cronJobStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14).meta({ description: '统计周期天数（1-90，默认 14）；环比取再往前的等长周期' }),
});

export type CronJobStatsQueryInput = z.infer<typeof cronJobStatsQuery>;

export const cronJobClearLogsQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(180).meta({ description: '清除多少天之前的日志' }),
});

export const cronJobContract = defineContract('/api/cron-jobs', {
  handlers: op.get('/handlers', { response: z.array(z.string()), summary: '已注册 Handler' }),
  validate: op.post('/validate', { body: cronValidateSchema, response: cronValidateResultSchema, summary: '校验 Cron 表达式' }),
  list: op.get('/', { query: cronJobListQuery, response: paginated(cronJobSchema), summary: '任务列表' }),
  logs: op.get('/logs', { query: cronJobLogListQuery, response: paginated(cronJobLogSchema), summary: '所有执行日志' }),
  clearLogs: op.delete('/logs/clean', { query: cronJobClearLogsQuery, summary: '清除所有执行日志' }),
  stats: op.get('/stats', { query: cronJobStatsQuery, response: cronJobStatsSchema, summary: '任务统计' }),
  create: op.post('/', { body: createCronJobSchema, response: cronJobSchema, summary: '新增任务' }),
  detail: op.get('/{id}', { params: idParam, response: cronJobSchema, summary: '任务详情' }),
  update: op.put('/{id}', { params: idParam, body: updateCronJobSchema, response: cronJobSchema, summary: '更新任务' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除任务' }),
  run: op.post('/{id}/run', { params: idParam, summary: '手动执行' }),
  setStatus: op.put('/{id}/status', { params: idParam, body: cronJobStatusSchema, summary: '切换状态' }),
  jobLogs: op.get('/{id}/logs', { params: idParam, query: paginationQuery, response: paginated(cronJobLogSchema), summary: '单任务日志' }),
  clearJobLogs: op.delete('/{id}/logs/clean', { params: idParam, query: cronJobClearLogsQuery, summary: '清除单任务执行日志' }),
}, { tags: ['CronJobs'] });
