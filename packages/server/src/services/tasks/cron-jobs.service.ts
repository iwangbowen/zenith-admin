import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { eq, and, desc, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import type {
  CronJobAlert,
  CronJobDetailStats,
  CronJobLogListQueryInput,
  CronJobRunSummary,
  CronJobSchedulerWarning,
  CronJobStats,
  CronJobStatsPerJob,
  CronJobStatsQueryInput,
  CronJobUpcomingRun,
  CronRunStatus,
} from '@zenith/shared/platform';
import {
  CRON_HEALTH_RULES,
  CRON_ALERT_TYPE_LABELS,
  countConsecutiveFails,
  cronSuccessRatePercent,
  isCronLowSuccessRate,
  isCronNearTimeout,
  isCronRunningTimeout,
  isCronSlowTail,
  toMinuteCron,
} from '@zenith/shared/platform';
import { buildWhere, dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { db, readSnapshot } from '../../db';
import type { DbTransaction } from '../../db/types';
import { cronJobs, cronJobLogs, systemSchedulerNodes } from '../../db/schema';
import {
  CRON_SCHEDULE_TZ,
  getSchedulerBamSummary,
  getSchedulerHealth,
  getSchedulerIntrospection,
  inspectCronSchedules,
  isSchedulerMaintaining,
  runJobOnce,
  scheduleJob,
  stopJob,
  validateCronExpression,
} from '../../lib/pg-boss-scheduler';
import { HTTPException } from 'hono/http-exception';
import { currentUserOrNull } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';

export function mapCronJob(row: typeof cronJobs.$inferSelect) {
  return {
    ...row,
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapLog(r: typeof cronJobLogs.$inferSelect) {
  return {
    id: r.id,
    jobId: r.jobId,
    jobName: r.jobName,
    executionCount: r.executionCount,
    startedAt: formatDateTime(r.startedAt),
    endedAt: formatNullableDateTime(r.endedAt),
    durationMs: r.durationMs,
    status: r.status,
    output: r.output,
    trigger: r.trigger,
    attempt: r.attempt,
    scheduledAt: formatNullableDateTime(r.scheduledAt),
    latencyMs: r.latencyMs,
    errorMessage: r.errorMessage,
    nodeId: r.nodeId,
    triggeredBy: r.triggeredBy,
  };
}

export async function listCronJobs(q: { page: number; pageSize: number; keyword?: string }) {
  const { page, pageSize, keyword } = q;
  const conditions = [];
  conditions.push(keywordCondition(keyword, [cronJobs.name]));
  const where = and(...conditions);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(cronJobs, where),
    rows: () => withPagination(db.select().from(cronJobs).where(where).orderBy(desc(cronJobs.id)).$dynamic(), page, pageSize),
    map: mapCronJob,
  });
}

export async function createCronJob(data: typeof cronJobs.$inferInsert) {
  if (!validateCronExpression(data.cronExpression)) throw new HTTPException(400, { message: 'Cron 表达式无效' });
  const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.name, data.name)).limit(1);
  if (existing) throw new HTTPException(400, { message: '任务名称已存在' });
  const [row] = await db.insert(cronJobs).values(data).returning();
  if (row.status === 'enabled') await scheduleJob(row);
  return mapCronJob(row);
}

export async function updateCronJob(id: number, data: Partial<typeof cronJobs.$inferInsert>) {
  if (data.cronExpression && !validateCronExpression(data.cronExpression)) throw new HTTPException(400, { message: 'Cron 表达式无效' });
  const [row] = await db.update(cronJobs).set({ ...data }).where(eq(cronJobs.id, id)).returning();
  requireRow(row, '任务不存在');
  if (row.status === 'enabled') await scheduleJob(row);
  else await stopJob(row.id);
  return mapCronJob(row);
}

export async function deleteCronJob(id: number) {
  const [row] = await db.select({ id: cronJobs.id, name: cronJobs.name }).from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  requireRow(row, '任务不存在');
  await stopJob(row.id);
  await db.delete(cronJobs).where(eq(cronJobs.id, id));
}

export async function getCronJob(id: number) {
  const [row] = await db.select().from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  requireRow(row, '任务不存在');
  return mapCronJob(row);
}

export async function getCronJobBeforeAudit(id: number) {
  const [row] = await db.select().from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  if (!row) return null;
  return mapCronJob(row);
}

export async function runCronJob(id: number) {
  const result = await runJobOnce(id, currentUserOrNull()?.userId ?? null);
  if (!result.success) throw new HTTPException(500, { message: result.message });
  return result.message;
}

export async function setCronJobStatus(id: number, status: 'enabled' | 'disabled') {
  const [row] = await db.update(cronJobs).set({ status }).where(eq(cronJobs.id, id)).returning();
  requireRow(row, '任务不存在');
  if (status === 'enabled') await scheduleJob(row);
  else await stopJob(row.id);
  return status === 'enabled' ? '已启用' : '已停用';
}

export async function listAllCronJobLogs(q: CronJobLogListQueryInput) {
  const { page, pageSize, jobId, status, trigger, keyword, startTime, endTime } = q;
  const where = buildWhere(
    jobId ? eq(cronJobLogs.jobId, jobId) : undefined,
    status ? eq(cronJobLogs.status, status) : undefined,
    trigger ? eq(cronJobLogs.trigger, trigger) : undefined,
    keywordCondition(keyword, [cronJobLogs.jobName, cronJobLogs.output, cronJobLogs.errorMessage], 'ilike'),
    ...dateRangeConditions(cronJobLogs.startedAt, startTime, endTime),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(cronJobLogs, where),
    rows: () => withPagination(db.select().from(cronJobLogs).where(where).orderBy(desc(cronJobLogs.startedAt)).$dynamic(), page, pageSize),
    map: mapLog,
  });
}

export async function listCronJobLogs(jobId: number, q: { page: number; pageSize: number }) {
  const { page, pageSize } = q;
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId)),
    rows: () => withPagination(db.select().from(cronJobLogs).where(eq(cronJobLogs.jobId, jobId)).orderBy(desc(cronJobLogs.startedAt)).$dynamic(), page, pageSize),
    map: mapLog,
  });
}

function buildClearCronJobLogsWhere(days: number, jobId?: number) {
  const conditions: ReturnType<typeof eq>[] = [
    lt(cronJobLogs.startedAt, new Date(Date.now() - days * 86_400_000)),
  ];
  if (jobId) conditions.push(eq(cronJobLogs.jobId, jobId));
  return and(...conditions);
}

export async function getClearCronJobLogsBeforeAudit(days: number, jobId?: number) {
  const where = buildClearCronJobLogsWhere(days, jobId);
  const [total, sample] = await Promise.all([
    db.$count(cronJobLogs, where),
    db.select().from(cronJobLogs).where(where).orderBy(desc(cronJobLogs.startedAt)).limit(20),
  ]);
  return { jobId, days, total, sample: sample.map(mapLog) };
}

/** 手动清除指定天数之前的定时任务执行日志 */
export async function clearCronJobLogs(days: number, jobId?: number) {
  const where = buildClearCronJobLogsWhere(days, jobId);
  const result = await db.delete(cronJobLogs).where(where);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}


// ─── 执行概览统计 ────────────────────────────────────────────────────────────

const RECENT_RESULTS_LIMIT = 20;
const UPCOMING_WINDOW_MS = 24 * 60 * 60_000;
const TOP_ERRORS_LIMIT = 10;

const RUNNING_STATUS: CronRunStatus = 'running';
const SCHEDULER_WARNINGS_LIMIT = 20;

/** 节点心跳 metadata.warnings 的形状校验（jsonb，来源不可信） */
function readNodeWarnings(metadata: Record<string, unknown> | null): Array<{ type: string; message: string; at: string }> {
  const raw = metadata?.warnings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((w): w is { type: string; message: string; at: string } => (
    typeof w === 'object' && w !== null
    && typeof (w as { type?: unknown }).type === 'string'
    && typeof (w as { message?: unknown }).message === 'string'
    && typeof (w as { at?: unknown }).at === 'string'
  ));
}

type JobRow = Pick<
  typeof cronJobs.$inferSelect,
  'id' | 'name' | 'handler' | 'cronExpression' | 'status' | 'monitorTimeout' | 'lastRunAt' | 'lastRunStatus' | 'createdAt' | 'updatedAt'
>;

/** `CURRENT_DATE - n 天` 的日期边界（沿用数据库会话时区，与每日分桶口径一致） */
function dateBefore(days: number) {
  return sql`(CURRENT_DATE - make_interval(days => ${days}))`;
}

const startedAt = cronJobLogs.startedAt;
const durationMs = cronJobLogs.durationMs;
const latencyMs = cronJobLogs.latencyMs;
const runStatus = cronJobLogs.status;
const runTrigger = cronJobLogs.trigger;
/** 失败 / 超时原因统一记录在 errorMessage */
const failureMessage = cronJobLogs.errorMessage;

/** 单个时间窗内的执行汇总（成功 / 失败 / 超时 / 运行中 / 重试 / 手动 / 平均 / P95 / 调度延迟） */
async function runSummary(tx: DbTransaction, window: SQL | undefined): Promise<CronJobRunSummary> {
  const [row] = await tx.select({
    total: sql<number>`CAST(COUNT(*) AS int)`,
    successCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'success') AS int)`,
    failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'fail') AS int)`,
    timeoutCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'timeout') AS int)`,
    runningCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'running') AS int)`,
    retryCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runTrigger} = 'retry') AS int)`,
    manualCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runTrigger} = 'manual') AS int)`,
    avgDurationMs: sql<number | null>`CAST(ROUND(AVG(${durationMs})) AS int)`,
    p95DurationMs: sql<number | null>`CAST(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${durationMs}) FILTER (WHERE ${durationMs} IS NOT NULL)) AS int)`,
    avgLatencyMs: sql<number | null>`CAST(ROUND(AVG(${latencyMs}) FILTER (WHERE ${latencyMs} >= 0)) AS int)`,
  }).from(cronJobLogs).where(window);
  return {
    total: Number(row?.total ?? 0),
    successCount: Number(row?.successCount ?? 0),
    failCount: Number(row?.failCount ?? 0),
    timeoutCount: Number(row?.timeoutCount ?? 0),
    runningCount: Number(row?.runningCount ?? 0),
    retryCount: Number(row?.retryCount ?? 0),
    manualCount: Number(row?.manualCount ?? 0),
    avgDurationMs: toNullableInt(row?.avgDurationMs),
    p95DurationMs: toNullableInt(row?.p95DurationMs),
    avgLatencyMs: toNullableInt(row?.avgLatencyMs),
  };
}

function toNullableInt(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

/** 与 pg-boss 同一口径：去掉秒位后按调度时区求值，否则「下次执行」会与实际触发对不上 */
function parseCron(expression: string, currentDate?: Date) {
  try {
    return CronExpressionParser.parse(toMinuteCron(expression), { tz: CRON_SCHEDULE_TZ, ...(currentDate ? { currentDate } : {}) });
  } catch {
    return null;
  }
}

/** 每个启用任务在未来 24 小时内的下一次执行；日频次按相邻两次触发间隔估算，避免逐分钟任务迭代上千次 */
function calcUpcomingRuns(jobs: JobRow[], now: Date): CronJobUpcomingRun[] {
  const deadline = now.getTime() + UPCOMING_WINDOW_MS;
  const runs: Array<{ jobId: number; jobName: string; cronExpression: string; at: Date; runsPerDay: number | null }> = [];
  for (const job of jobs) {
    if (job.status !== 'enabled') continue;
    const interval = parseCron(job.cronExpression, now);
    if (!interval) continue;
    let first: Date | null = null;
    let second: Date | null = null;
    try {
      first = interval.next().toDate();
      second = interval.next().toDate();
    } catch {
      // 表达式没有更多触发时刻：first 可能已取到，second 保持 null
    }
    if (!first || first.getTime() > deadline) continue;
    const gapMs = second ? second.getTime() - first.getTime() : 0;
    runs.push({
      jobId: job.id,
      jobName: job.name,
      cronExpression: job.cronExpression,
      at: first,
      runsPerDay: gapMs > 0 ? Math.max(1, Math.round(UPCOMING_WINDOW_MS / gapMs)) : null,
    });
  }
  return runs
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((r) => ({ jobId: r.jobId, jobName: r.jobName, cronExpression: r.cronExpression, runAt: formatDateTime(r.at), runsPerDay: r.runsPerDay }));
}

/**
 * 未按计划执行：启用中的任务，按表达式在「now - 容差」之前应有一次执行，
 * 但最近执行时刻早于该应执行时刻（或从未执行），且任务在该时刻之前就已存在并保持当前配置。
 */
function detectMissedRun(job: JobRow, now: Date): Date | null {
  if (job.status !== 'enabled') return null;
  const interval = parseCron(job.cronExpression, new Date(now.getTime() - CRON_HEALTH_RULES.missedRunGraceMs));
  if (!interval) return null;
  let expected: Date;
  try {
    expected = interval.prev().toDate();
  } catch {
    return null;
  }
  // 任务在应执行时刻之后才创建 / 修改（含启停切换），本轮不评估
  const configuredAt = Math.max(job.createdAt.getTime(), job.updatedAt.getTime());
  if (expected.getTime() <= configuredAt) return null;
  if (job.lastRunAt && job.lastRunAt.getTime() >= expected.getTime()) return null;
  return expected;
}

const ALERT_LEVEL_ORDER = { danger: 0, warning: 1, info: 2 } as const;

/** 提醒文案里的耗时：毫秒级直接显示毫秒，否则保留一位小数的秒 */
function describeMs(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

function buildAlerts(
  jobs: JobRow[],
  perJob: Map<number, CronJobStatsPerJob>,
  runningLogs: Array<{ jobId: number; startedAt: Date }>,
  now: Date,
): CronJobAlert[] {
  const alerts: CronJobAlert[] = [];
  const push = (type: CronJobAlert['type'], level: CronJobAlert['level'], job: JobRow, message: string, detail: string | null = null) => {
    alerts.push({ type, level, jobId: job.id, jobName: job.name, message, detail });
  };
  const runningByJob = new Map<number, Date>();
  for (const log of runningLogs) {
    const current = runningByJob.get(log.jobId);
    if (!current || log.startedAt < current) runningByJob.set(log.jobId, log.startedAt);
  }

  for (const job of jobs) {
    const stat = perJob.get(job.id);
    if (!stat) continue;

    const runningSince = runningByJob.get(job.id);
    if (runningSince && isCronRunningTimeout(runningSince.getTime(), now.getTime(), job.monitorTimeout)) {
      push('running_timeout', 'danger', job,
        `已运行 ${Math.round((now.getTime() - runningSince.getTime()) / 60_000)} 分钟，超过监控超时 ${job.monitorTimeout} 秒`,
        `开始于 ${formatDateTime(runningSince)}`);
    }

    if (stat.consecutiveFails >= CRON_HEALTH_RULES.consecutiveFailThreshold) {
      push('consecutive_fail', 'danger', job, `连续失败 ${stat.consecutiveFails} 次`, stat.lastError);
    } else if (isCronLowSuccessRate(stat.successRate, stat.runs)) {
      push('low_success_rate', 'warning', job, `成功率仅 ${stat.successRate}%（失败 ${stat.failCount} · 超时 ${stat.timeoutCount} / ${stat.runs} 次）`, stat.lastError);
    }

    const missedAt = detectMissedRun(job, now);
    if (missedAt) {
      push('missed_run', 'warning', job, `应于 ${formatDateTime(missedAt)} 执行，至今无执行记录`,
        stat.lastRunAt ? `最近执行 ${stat.lastRunAt}` : '从未执行');
    }

    if (isCronNearTimeout(stat.avgDurationMs, job.monitorTimeout)) {
      push('near_timeout', 'warning', job,
        `平均耗时 ${describeMs(stat.avgDurationMs)}，已达监控超时 ${job.monitorTimeout} 秒的 ${Math.round(((stat.avgDurationMs ?? 0) / 1000 / (job.monitorTimeout ?? 1)) * 100)}%，有超时风险`);
    }

    if (stat.runs >= CRON_HEALTH_RULES.successRateMinRuns && isCronSlowTail(stat.avgDurationMs, stat.p95DurationMs)) {
      push('slow_tail', 'info', job,
        `最慢 5% 的执行耗时约 ${describeMs(stat.p95DurationMs)}，是平均值 ${describeMs(stat.avgDurationMs)} 的 ${((stat.p95DurationMs ?? 0) / Math.max(stat.avgDurationMs ?? 1, 1)).toFixed(1)} 倍`);
    }

    if (job.status === 'enabled' && stat.totalRuns === 0 && !missedAt) {
      push('never_run', 'info', job, CRON_ALERT_TYPE_LABELS.never_run,
        stat.nextRunAt ? `下次执行 ${stat.nextRunAt}` : null);
    }
  }

  return alerts.sort((a, b) => ALERT_LEVEL_ORDER[a.level] - ALERT_LEVEL_ORDER[b.level] || a.jobName.localeCompare(b.jobName));
}

interface PeriodWindows {
  readonly days: number;
  readonly inPeriod: SQL;
  readonly inPrev: SQL;
  readonly inToday: SQL;
}

function periodWindows(days: number): PeriodWindows {
  return {
    days,
    inPeriod: sql`${startedAt} >= ${dateBefore(days - 1)}`,
    inPrev: sql`${startedAt} >= ${dateBefore(2 * days - 1)} AND ${startedAt} < ${dateBefore(days - 1)}`,
    inToday: sql`${startedAt} >= CURRENT_DATE`,
  };
}

const jobColumns = {
  id: cronJobs.id,
  name: cronJobs.name,
  handler: cronJobs.handler,
  cronExpression: cronJobs.cronExpression,
  status: cronJobs.status,
  monitorTimeout: cronJobs.monitorTimeout,
  lastRunAt: cronJobs.lastRunAt,
  lastRunStatus: cronJobs.lastRunStatus,
  createdAt: cronJobs.createdAt,
  updatedAt: cronJobs.updatedAt,
};

/**
 * 逐任务指标（概览任务表与单任务下钻共用）。
 * `jobId` 给定时只聚合该任务的日志，避免下钻时把全表重新扫一遍。
 */
async function loadPerJobStats(tx: DbTransaction, windows: PeriodWindows, now: Date, jobId?: number): Promise<{ jobs: JobRow[]; perJob: CronJobStatsPerJob[] }> {
  const { inPeriod, inPrev, inToday } = windows;
  const jobCondition = jobId ? eq(cronJobLogs.jobId, jobId) : undefined;
  const jobs: JobRow[] = await tx.select(jobColumns).from(cronJobs)
    .where(jobId ? eq(cronJobs.id, jobId) : undefined)
    .orderBy(cronJobs.id);

  const perJobAggRows = await tx.select({
    jobId: cronJobLogs.jobId,
    totalRuns: sql<number>`CAST(COUNT(*) AS int)`,
    runs: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPeriod}) AS int)`,
    successCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPeriod} AND ${runStatus} = 'success') AS int)`,
    failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPeriod} AND ${runStatus} = 'fail') AS int)`,
    timeoutCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPeriod} AND ${runStatus} = 'timeout') AS int)`,
    retryCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPeriod} AND ${runTrigger} = 'retry') AS int)`,
    avgLatencyMs: sql<number | null>`CAST(ROUND(AVG(${latencyMs}) FILTER (WHERE ${inPeriod} AND ${latencyMs} >= 0)) AS int)`,
    avgDurationMs: sql<number | null>`CAST(ROUND(AVG(${durationMs}) FILTER (WHERE ${inPeriod})) AS int)`,
    p95DurationMs: sql<number | null>`CAST(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${durationMs}) FILTER (WHERE ${inPeriod} AND ${durationMs} IS NOT NULL)) AS int)`,
    maxDurationMs: sql<number | null>`MAX(${durationMs}) FILTER (WHERE ${inPeriod})`,
    prevRuns: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPrev}) AS int)`,
    prevSuccessCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inPrev} AND ${runStatus} = 'success') AS int)`,
    prevAvgDurationMs: sql<number | null>`CAST(ROUND(AVG(${durationMs}) FILTER (WHERE ${inPrev})) AS int)`,
    todayRuns: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inToday}) AS int)`,
    todayFailCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${inToday} AND ${runStatus} = 'fail') AS int)`,
    lastSuccessAt: sql<Date | null>`MAX(${startedAt}) FILTER (WHERE ${runStatus} = 'success')`,
    lastFailAt: sql<Date | null>`MAX(${startedAt}) FILTER (WHERE ${runStatus} IN ('fail', 'timeout'))`,
  }).from(cronJobLogs).where(jobCondition).groupBy(cronJobLogs.jobId);

  // 每任务最近一次失败 / 超时的原因
  const lastErrorRows = await tx.execute<{ job_id: number; output: string | null }>(sql`
    SELECT DISTINCT ON (${cronJobLogs.jobId}) ${cronJobLogs.jobId} AS job_id, ${failureMessage} AS output
    FROM ${cronJobLogs}
    WHERE ${runStatus} IN ('fail', 'timeout') ${jobCondition ? sql`AND ${jobCondition}` : sql``}
    ORDER BY ${cronJobLogs.jobId}, ${startedAt} DESC
  `);

  // 每任务最近 N 次执行状态与耗时（窗口函数），返回时按时间升序（旧 → 新）
  const recentPerJobRows = await tx.execute<{ job_id: number; status: CronRunStatus; duration_ms: number | null }>(sql`
    SELECT job_id, status, duration_ms FROM (
      SELECT ${cronJobLogs.jobId} AS job_id, ${runStatus} AS status, ${durationMs} AS duration_ms, ${startedAt} AS started_at,
             ROW_NUMBER() OVER (PARTITION BY ${cronJobLogs.jobId} ORDER BY ${startedAt} DESC) AS rn
      FROM ${cronJobLogs}
      ${jobCondition ? sql`WHERE ${jobCondition}` : sql``}
    ) t WHERE rn <= ${RECENT_RESULTS_LIMIT} ORDER BY job_id, started_at ASC
  `);

  const aggMap = new Map(perJobAggRows.map((r) => [r.jobId, r]));
  const lastErrorMap = new Map(lastErrorRows.map((r) => [Number(r.job_id), r.output]));
  const recentMap = new Map<number, Array<{ status: CronRunStatus; durationMs: number | null }>>();
  for (const row of recentPerJobRows) {
    const list = recentMap.get(Number(row.job_id)) ?? [];
    list.push({ status: row.status, durationMs: toNullableInt(row.duration_ms) });
    recentMap.set(Number(row.job_id), list);
  }

  const perJob: CronJobStatsPerJob[] = jobs.map((job) => {
    const agg = aggMap.get(job.id);
    const recent = recentMap.get(job.id) ?? [];
    const recentResults = recent.map((r) => r.status);
    const runs = Number(agg?.runs ?? 0);
    const successCount = Number(agg?.successCount ?? 0);
    const prevRuns = Number(agg?.prevRuns ?? 0);
    const nextRun = job.status === 'enabled' ? parseCron(job.cronExpression, now) : null;
    let nextRunAt: string | null = null;
    if (nextRun) {
      try {
        nextRunAt = formatDateTime(nextRun.next().toDate());
      } catch {
        nextRunAt = null;
      }
    }
    return {
      jobId: job.id,
      jobName: job.name,
      handler: job.handler,
      enabled: job.status === 'enabled',
      cronExpression: job.cronExpression,
      monitorTimeout: job.monitorTimeout,
      nextRunAt,
      lastRunAt: formatNullableDateTime(job.lastRunAt),
      lastRunStatus: job.lastRunStatus,
      lastSuccessAt: formatNullableDateTime(agg?.lastSuccessAt ?? null),
      lastFailAt: formatNullableDateTime(agg?.lastFailAt ?? null),
      lastError: lastErrorMap.get(job.id) ?? null,
      totalRuns: Number(agg?.totalRuns ?? 0),
      runs,
      successCount,
      failCount: Number(agg?.failCount ?? 0),
      timeoutCount: Number(agg?.timeoutCount ?? 0),
      retryCount: Number(agg?.retryCount ?? 0),
      successRate: cronSuccessRatePercent(successCount, runs),
      prevSuccessRate: cronSuccessRatePercent(Number(agg?.prevSuccessCount ?? 0), prevRuns),
      todayRuns: Number(agg?.todayRuns ?? 0),
      todayFailCount: Number(agg?.todayFailCount ?? 0),
      avgDurationMs: toNullableInt(agg?.avgDurationMs),
      prevAvgDurationMs: toNullableInt(agg?.prevAvgDurationMs),
      p95DurationMs: toNullableInt(agg?.p95DurationMs),
      maxDurationMs: toNullableInt(agg?.maxDurationMs),
      avgLatencyMs: toNullableInt(agg?.avgLatencyMs),
      recentResults,
      recentDurations: recent.map((r) => r.durationMs),
      consecutiveFails: countConsecutiveFails(recentResults),
    };
  }).sort((a, b) => b.runs - a.runs || b.totalRuns - a.totalRuns || a.jobName.localeCompare(b.jobName));

  return { jobs, perJob };
}

function mapDailyRow(r: { date: string; total: number; successCount: number; failCount: number; timeoutCount: number; avgDurationMs: number | null; p95DurationMs: number | null }) {
  return {
    date: r.date,
    total: Number(r.total),
    successCount: Number(r.successCount),
    failCount: Number(r.failCount),
    timeoutCount: Number(r.timeoutCount),
    avgDurationMs: toNullableInt(r.avgDurationMs),
    p95DurationMs: toNullableInt(r.p95DurationMs),
  };
}

function dailyStatsQuery(tx: DbTransaction, where: SQL | undefined) {
  return tx.select({
    date: sql<string>`to_char(date(${startedAt}), 'YYYY-MM-DD')`,
    total: sql<number>`CAST(COUNT(*) AS int)`,
    successCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'success') AS int)`,
    failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'fail') AS int)`,
    timeoutCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} = 'timeout') AS int)`,
    avgDurationMs: sql<number | null>`CAST(ROUND(AVG(${durationMs})) AS int)`,
    p95DurationMs: sql<number | null>`CAST(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${durationMs}) FILTER (WHERE ${durationMs} IS NOT NULL)) AS int)`,
  }).from(cronJobLogs)
    .where(where)
    .groupBy(sql`date(${startedAt})`)
    .orderBy(sql`date(${startedAt})`);
}

export async function getCronJobStats(q: CronJobStatsQueryInput): Promise<CronJobStats> {
  const { days } = q;
  const now = new Date();
  const windows = periodWindows(days);
  const periodWindow = gte(startedAt, dateBefore(days - 1));
  const prevWindow = and(gte(startedAt, dateBefore(2 * days - 1)), lt(startedAt, dateBefore(days - 1)));
  const todayWindow = gte(startedAt, dateBefore(0));
  const yesterdayWindow = and(gte(startedAt, dateBefore(1)), lt(startedAt, dateBefore(0)));
  const yesterdaySameTimeWindow = and(gte(startedAt, dateBefore(1)), lt(startedAt, sql`(now() - INTERVAL '1 day')`));

  // 汇总卡片与明细榜单读同一快照，避免统计期间新落库的记录让各面板数字互相对不上
  const snapshot = await readSnapshot(async (tx) => {
    const { jobs: allJobs, perJob } = await loadPerJobStats(tx, windows, now);

    const today = await runSummary(tx, todayWindow);
    const yesterday = await runSummary(tx, yesterdayWindow);
    const yesterdaySameTime = await runSummary(tx, yesterdaySameTimeWindow);
    const period = await runSummary(tx, periodWindow);
    const prevPeriod = await runSummary(tx, prevWindow);

    const runningJobs = await tx.$count(cronJobLogs, eq(runStatus, RUNNING_STATUS));

    const dailyRows = await dailyStatsQuery(tx, periodWindow);

    const dowHourRows = await tx.select({
      dow: sql<number>`CAST(EXTRACT(ISODOW FROM ${startedAt}) AS int)`,
      hour: sql<number>`CAST(EXTRACT(HOUR FROM ${startedAt}) AS int)`,
      total: sql<number>`CAST(COUNT(*) AS int)`,
      failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${runStatus} IN ('fail', 'timeout')) AS int)`,
    }).from(cronJobLogs)
      .where(periodWindow)
      .groupBy(sql`EXTRACT(ISODOW FROM ${startedAt})`, sql`EXTRACT(HOUR FROM ${startedAt})`);

    // 失败原因归一化聚合：数字（ID / 时间 / 行数）替换为 # 后再分组，让同类错误合并
    const normalizedError = sql`left(regexp_replace(coalesce(${failureMessage}, ''), '[0-9]+', '#', 'g'), 200)`;
    const topErrorRows = await tx.select({
      message: sql<string>`${normalizedError}`,
      count: sql<number>`CAST(COUNT(*) AS int)`,
      jobNames: sql<string[]>`array_agg(DISTINCT ${cronJobLogs.jobName})`,
      lastAt: sql<Date>`MAX(${startedAt})`,
    }).from(cronJobLogs)
      .where(and(periodWindow, inArray(runStatus, ['fail', 'timeout'])))
      .groupBy(normalizedError)
      .orderBy(desc(sql`COUNT(*)`), desc(sql`MAX(${startedAt})`))
      .limit(TOP_ERRORS_LIMIT);

    const runningLogs = await tx.select({ jobId: cronJobLogs.jobId, startedAt })
      .from(cronJobLogs)
      .where(eq(runStatus, RUNNING_STATUS));

    const staleBefore = new Date(now.getTime() - CRON_HEALTH_RULES.schedulerHeartbeatStaleMs);
    const nodeRows = await tx.select({ nodeId: systemSchedulerNodes.nodeId, lastHeartbeatAt: systemSchedulerNodes.lastHeartbeatAt, metadata: systemSchedulerNodes.metadata })
      .from(systemSchedulerNodes)
      .where(and(eq(systemSchedulerNodes.active, true), gte(systemSchedulerNodes.lastHeartbeatAt, staleBefore)));

    return { allJobs, perJob, today, yesterday, yesterdaySameTime, period, prevPeriod, runningJobs, dailyRows, dowHourRows, topErrorRows, runningLogs, nodeRows };
  });

  const perJobMap = new Map(snapshot.perJob.map((p) => [p.jobId, p]));
  const scheduler = getSchedulerIntrospection();
  // 各在线节点随心跳上报的 pg-boss 警告 + 本进程尚未随心跳落库的最新几条，按时间倒序去重
  const warningMap = new Map<string, CronJobSchedulerWarning>();
  const collect = (nodeId: string, list: readonly { type: string; message: string; at: string }[]) => {
    for (const w of list) {
      const key = `${nodeId}|${w.type}|${w.message}`;
      const existing = warningMap.get(key);
      if (!existing || existing.at < w.at) warningMap.set(key, { type: w.type, message: w.message, nodeId, at: w.at });
    }
  };
  for (const node of snapshot.nodeRows) collect(node.nodeId, readNodeWarnings(node.metadata));
  collect(scheduler.node.id, scheduler.warnings);
  const schedulerWarnings = [...warningMap.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, SCHEDULER_WARNINGS_LIMIT);
  const thisNodeHeartbeat = snapshot.nodeRows.find((n) => n.nodeId === scheduler.node.id)?.lastHeartbeatAt
    ?? snapshot.nodeRows.reduce<Date | null>((latest, n) => (latest && latest > n.lastHeartbeatAt ? latest : n.lastHeartbeatAt), null);
  const health = getSchedulerHealth();
  const [bam, scheduleReconcile] = await Promise.all([
    getSchedulerBamSummary().catch(() => ({ pending: 0, failed: 0 })),
    inspectCronSchedules().catch(() => ({ missing: [], orphans: [] })),
  ]);

  return {
    days,
    totalJobs: snapshot.allJobs.length,
    enabledJobs: snapshot.allJobs.filter((j) => j.status === 'enabled').length,
    runningJobs: snapshot.runningJobs,
    today: snapshot.today,
    yesterday: snapshot.yesterday,
    yesterdaySameTime: snapshot.yesterdaySameTime,
    period: snapshot.period,
    prevPeriod: snapshot.prevPeriod,
    scheduler: {
      online: scheduler.initialized,
      nodeId: scheduler.node.id,
      hostname: scheduler.node.hostname,
      pid: scheduler.node.pid,
      activeNodes: snapshot.nodeRows.length,
      lastHeartbeatAt: formatNullableDateTime(thisNodeHeartbeat),
      wipCount: scheduler.runningJobCount,
      warnings: schedulerWarnings,
      schemaVersion: health.schemaVersion,
      schemaDriftOk: health.schemaDriftOk,
      schemaDriftIssues: health.schemaDriftIssues,
      maintaining: isSchedulerMaintaining(),
      bamPending: bam.pending,
      bamFailed: bam.failed,
      scheduleMissing: scheduleReconcile.missing,
      scheduleOrphans: scheduleReconcile.orphans,
    },
    alerts: buildAlerts(snapshot.allJobs, perJobMap, snapshot.runningLogs, now),
    perJob: snapshot.perJob,
    dailyStats: snapshot.dailyRows.map(mapDailyRow),
    dowHourStats: snapshot.dowHourRows.map((r) => ({
      dow: Number(r.dow),
      hour: Number(r.hour),
      total: Number(r.total),
      failCount: Number(r.failCount),
    })),
    topErrors: snapshot.topErrorRows.map((r) => ({
      message: r.message,
      count: Number(r.count),
      jobNames: r.jobNames ?? [],
      lastAt: formatDateTime(r.lastAt),
    })),
    upcoming: calcUpcomingRuns(snapshot.allJobs, now),
  };
}

// ─── 单任务下钻 ──────────────────────────────────────────────────────────────

const DETAIL_RUN_POINTS_LIMIT = 200;
const DETAIL_RECENT_ERRORS_LIMIT = 10;
const DETAIL_NEXT_RUNS = 10;

const LATENCY_BUCKETS: ReadonlyArray<{ label: string; maxMs: number }> = [
  { label: '<1s', maxMs: 1_000 },
  { label: '1-5s', maxMs: 5_000 },
  { label: '5-30s', maxMs: 30_000 },
  { label: '>30s', maxMs: Number.POSITIVE_INFINITY },
];

/** 单任务在统计周期内的明细：耗时散点、延迟分布、最近错误、未来执行 */
export async function getCronJobDetailStats(jobId: number, q: CronJobStatsQueryInput): Promise<CronJobDetailStats> {
  const { days } = q;
  const now = new Date();
  const jobFilter = eq(cronJobLogs.jobId, jobId);
  const periodWindow = and(jobFilter, gte(startedAt, dateBefore(days - 1)));
  const prevWindow = and(jobFilter, gte(startedAt, dateBefore(2 * days - 1)), lt(startedAt, dateBefore(days - 1)));

  const snapshot = await readSnapshot(async (tx) => {
    const { perJob } = await loadPerJobStats(tx, periodWindows(days), now, jobId);
    const job = perJob[0];
    requireRow(job, '任务不存在');

    const period = await runSummary(tx, periodWindow);
    const prevPeriod = await runSummary(tx, prevWindow);
    const dailyRows = await dailyStatsQuery(tx, periodWindow);

    // 最近 N 条执行点：先按时间倒序截断，再翻回升序供散点图使用
    const runRows = await tx.select({
      id: cronJobLogs.id,
      startedAt,
      status: runStatus,
      trigger: runTrigger,
      durationMs,
      latencyMs,
    }).from(cronJobLogs)
      .where(periodWindow)
      .orderBy(desc(startedAt))
      .limit(DETAIL_RUN_POINTS_LIMIT);

    const latencyRows = await tx.select({
      bucket: sql<number>`CASE
        WHEN ${latencyMs} < 1000 THEN 0
        WHEN ${latencyMs} < 5000 THEN 1
        WHEN ${latencyMs} < 30000 THEN 2
        ELSE 3 END`,
      count: sql<number>`CAST(COUNT(*) AS int)`,
    }).from(cronJobLogs)
      .where(and(periodWindow, gte(latencyMs, 0)))
      .groupBy(sql`1`);

    const errorRows = await tx.select({
      id: cronJobLogs.id,
      startedAt,
      status: runStatus,
      trigger: runTrigger,
      attempt: cronJobLogs.attempt,
      durationMs,
      message: sql<string>`coalesce(${failureMessage}, '')`,
    }).from(cronJobLogs)
      .where(and(periodWindow, inArray(runStatus, ['fail', 'timeout'])))
      .orderBy(desc(startedAt))
      .limit(DETAIL_RECENT_ERRORS_LIMIT);

    return { job, period, prevPeriod, dailyRows, runRows, latencyRows, errorRows };
  });
  const { job } = snapshot;

  const bucketCounts = new Map(snapshot.latencyRows.map((r) => [Number(r.bucket), Number(r.count)]));
  const nextRuns: string[] = [];
  if (job.enabled) {
    const interval = parseCron(job.cronExpression, now);
    if (interval) {
      for (let i = 0; i < DETAIL_NEXT_RUNS; i++) {
        try {
          nextRuns.push(formatDateTime(interval.next().toDate()));
        } catch {
          break;
        }
      }
    }
  }

  return {
    days,
    job,
    period: snapshot.period,
    prevPeriod: snapshot.prevPeriod,
    dailyStats: snapshot.dailyRows.map(mapDailyRow),
    runs: snapshot.runRows.reverse().map((r) => ({
      logId: r.id,
      startedAt: formatDateTime(r.startedAt),
      status: r.status,
      trigger: r.trigger,
      durationMs: r.durationMs,
      latencyMs: r.latencyMs,
    })),
    latencyBuckets: LATENCY_BUCKETS.map((b, i) => ({ bucket: b.label, count: bucketCounts.get(i) ?? 0 })),
    recentErrors: snapshot.errorRows.map((r) => ({
      logId: r.id,
      startedAt: formatDateTime(r.startedAt),
      status: r.status,
      trigger: r.trigger,
      attempt: r.attempt,
      durationMs: r.durationMs,
      message: r.message,
    })),
    nextRuns,
  };
}
