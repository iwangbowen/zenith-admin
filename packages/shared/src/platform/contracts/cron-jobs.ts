import * as z from 'zod';
import { auditFieldsSchema, dateRangeBound, entityStatusQuery, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CRON_ALERT_LEVELS, CRON_ALERT_TYPES, CRON_JOB_STATUSES, CRON_RUN_STATUSES, CRON_RUN_TRIGGERS } from '../constants';
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
  output: z.string().nullable().meta({ description: '正常输出；失败 / 超时原因见 errorMessage' }),
  trigger: z.enum(CRON_RUN_TRIGGERS),
  attempt: z.int().meta({ description: '重试序号，0 = 首次执行' }),
  scheduledAt: z.string().nullable().meta({ description: '计划触发时刻' }),
  latencyMs: z.int().nullable().meta({ description: '调度延迟：实际开始 − 计划触发（毫秒）' }),
  errorMessage: z.string().nullable(),
  nodeId: z.string().nullable().meta({ description: '执行节点 hostname:pid' }),
  triggeredBy: z.int().nullable().meta({ description: '手动执行的操作人' }),
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
  timeoutCount: z.int(),
  retryCount: z.int().meta({ description: '周期内由失败重试触发的执行次数' }),
  successRate: z.number().nullable().meta({ description: '周期内成功率（%），无执行时为 null' }),
  prevSuccessRate: z.number().nullable().meta({ description: '上一周期成功率（%），用于环比' }),
  todayRuns: z.int(),
  todayFailCount: z.int(),
  avgDurationMs: z.int().nullable(),
  prevAvgDurationMs: z.int().nullable().meta({ description: '上一周期平均耗时，用于耗时恶化提示' }),
  p95DurationMs: z.int().nullable().meta({ description: 'P95 耗时（长尾性能），无已完成执行时为 null' }),
  maxDurationMs: z.int().nullable(),
  avgLatencyMs: z.int().nullable().meta({ description: '周期内平均调度延迟' }),
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
  timeoutCount: z.int(),
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
  timeoutCount: z.int(),
  runningCount: z.int(),
  retryCount: z.int().meta({ description: '由失败重试触发的执行次数' }),
  manualCount: z.int().meta({ description: '手动触发的执行次数' }),
  avgDurationMs: z.int().nullable(),
  p95DurationMs: z.int().nullable(),
  avgLatencyMs: z.int().nullable().meta({ description: '平均调度延迟（实际开始 − 计划触发）' }),
}).meta({ id: 'CronJobRunSummary' });

export type CronJobRunSummary = z.infer<typeof cronJobRunSummarySchema>;

export const cronJobSchedulerWarningSchema = z.object({
  type: z.string().meta({ description: 'pg-boss 警告类型，如 queue_backlog / xmin_horizon / autovacuum_disabled' }),
  message: z.string(),
  nodeId: z.string().meta({ description: '发出警告的调度节点' }),
  at: z.string(),
}).meta({ id: 'CronJobSchedulerWarning' });

export type CronJobSchedulerWarning = z.infer<typeof cronJobSchedulerWarningSchema>;

export const cronJobSchedulerStatusSchema = z.object({
  online: z.boolean().meta({ description: '当前进程的调度器已初始化' }),
  nodeId: z.string(),
  hostname: z.string(),
  pid: z.int(),
  activeNodes: z.int().meta({ description: '心跳未过期的调度节点数' }),
  lastHeartbeatAt: z.string().nullable(),
  wipCount: z.int().meta({ description: '本节点（当前接口进程）正在执行的任务数' }),
  warnings: z.array(cronJobSchedulerWarningSchema).meta({ description: '在线节点最近上报的 pg-boss 运维警告（新 → 旧，最多 20 条）' }),
  schemaVersion: z.int().nullable().meta({ description: 'pg-boss schema 版本（boss.schemaVersion()）' }),
  schemaDriftOk: z.boolean().nullable().meta({ description: 'detectSchemaDrift() 是否无漂移；尚未检查时为 null' }),
  schemaDriftIssues: z.int().meta({ description: '漂移条目数（缺失 / 无效 / 不一致的表、索引、函数、列、约束、枚举）' }),
  maintaining: z.boolean().meta({ description: '本节点是否正在执行维护（isMaintaining()）' }),
  bamPending: z.int().meta({ description: '待执行 / 进行中的异步迁移命令数' }),
  bamFailed: z.int().meta({ description: '失败的异步迁移命令数' }),
  scheduleMissing: z.array(z.int()).meta({ description: '启用中却没有 pg-boss schedule 的任务 ID' }),
  scheduleOrphans: z.array(z.string()).meta({ description: '有 schedule 但任务已停用或不存在的 key' }),
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
  message: z.string().meta({ description: '归一化后的错误信息（数字已替换为 #），来自失败 / 超时记录的 errorMessage' }),
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

// ─── 单任务下钻 ──────────────────────────────────────────────────────────────

export const cronJobRunPointSchema = z.object({
  logId: z.int(),
  startedAt: z.string(),
  status: z.enum(CRON_RUN_STATUSES),
  trigger: z.enum(CRON_RUN_TRIGGERS),
  durationMs: z.int().nullable(),
  latencyMs: z.int().nullable(),
}).meta({ id: 'CronJobRunPoint' });

export type CronJobRunPoint = z.infer<typeof cronJobRunPointSchema>;

export const cronJobLatencyBucketSchema = z.object({
  bucket: z.string().meta({ description: '延迟区间标签，如 "<1s" / "1-5s" / "5-30s" / ">30s"' }),
  count: z.int(),
}).meta({ id: 'CronJobLatencyBucket' });

export type CronJobLatencyBucket = z.infer<typeof cronJobLatencyBucketSchema>;

export const cronJobRecentErrorSchema = z.object({
  logId: z.int(),
  startedAt: z.string(),
  status: z.enum(CRON_RUN_STATUSES),
  trigger: z.enum(CRON_RUN_TRIGGERS),
  attempt: z.int(),
  durationMs: z.int().nullable(),
  message: z.string(),
}).meta({ id: 'CronJobRecentError' });

export type CronJobRecentError = z.infer<typeof cronJobRecentErrorSchema>;

export const cronJobDetailStatsSchema = z.object({
  days: z.int(),
  job: cronJobStatsPerJobSchema,
  period: cronJobRunSummarySchema.meta({ description: '近 days 天汇总' }),
  prevPeriod: cronJobRunSummarySchema,
  dailyStats: z.array(cronJobDailyStatSchema),
  runs: z.array(cronJobRunPointSchema).meta({ description: '周期内最近的执行点（旧 → 新，最多 200 条），用于耗时散点' }),
  latencyBuckets: z.array(cronJobLatencyBucketSchema),
  recentErrors: z.array(cronJobRecentErrorSchema).meta({ description: '周期内最近的失败 / 超时（最多 10 条，新 → 旧）' }),
  nextRuns: z.array(z.string()).meta({ description: '未来 10 次计划执行时刻；停用或表达式无效时为空' }),
}).meta({ id: 'CronJobDetailStats' });

export type CronJobDetailStats = z.infer<typeof cronJobDetailStatsSchema>;

export const cronValidateResultSchema = z.object({ valid: z.boolean() }).meta({ id: 'CronValidateResult' });

export type CronValidateResult = z.infer<typeof cronValidateResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cronJobListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按任务名称模糊匹配' }),
  status: entityStatusQuery,
});

export const cronJobLogListQuery = paginationQuery.extend({
  jobId: z.coerce.number().int().positive().optional(),
  status: queryEnum(CRON_RUN_STATUSES, '按执行状态筛选'),
  trigger: queryEnum(CRON_RUN_TRIGGERS, '按触发方式筛选'),
  keyword: z.string().optional().meta({ description: '按任务名称 / 输出模糊匹配' }),
  startTime: dateRangeBound('开始时间下限'),
  endTime: dateRangeBound('开始时间上限'),
});


export const cronJobStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14).meta({ description: '统计周期天数（1-90，默认 14）；环比取再往前的等长周期' }),
});


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
  jobStats: op.get('/{id}/stats', { params: idParam, query: cronJobStatsQuery, response: cronJobDetailStatsSchema, summary: '单任务执行统计' }),
  clearJobLogs: op.delete('/{id}/logs/clean', { params: idParam, query: cronJobClearLogsQuery, summary: '清除单任务执行日志' }),
}, { tags: ['CronJobs'] });
