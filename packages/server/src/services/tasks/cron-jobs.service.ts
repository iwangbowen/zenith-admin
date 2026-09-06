import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { eq, and, desc, lt, sql } from 'drizzle-orm';
import { withPagination, keywordCondition } from '../../lib/where-helpers';
import { db } from '../../db';
import { cronJobs, cronJobLogs } from '../../db/schema';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression, getRunningJobCount } from '../../lib/pg-boss-scheduler';
import { HTTPException } from 'hono/http-exception';
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
  if (row.status === 'enabled') await scheduleJob(row.id, row.name, row.cronExpression, row.handler, row.params, { retryCount: row.retryCount, retryDelay: row.retryInterval, retryBackoff: row.retryBackoff, monitorTimeout: row.monitorTimeout });
  return mapCronJob(row);
}

export async function updateCronJob(id: number, data: Partial<typeof cronJobs.$inferInsert>) {
  if (data.cronExpression && !validateCronExpression(data.cronExpression)) throw new HTTPException(400, { message: 'Cron 表达式无效' });
  const [row] = await db.update(cronJobs).set({ ...data }).where(eq(cronJobs.id, id)).returning();
  requireRow(row, '任务不存在');
  if (row.status === 'enabled') await scheduleJob(row.id, row.name, row.cronExpression, row.handler, row.params, { retryCount: row.retryCount, retryDelay: row.retryInterval, retryBackoff: row.retryBackoff, monitorTimeout: row.monitorTimeout });
  else await stopJob(row.id, row.name);
  return mapCronJob(row);
}

export async function deleteCronJob(id: number) {
  const [row] = await db.select({ id: cronJobs.id, name: cronJobs.name }).from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  requireRow(row, '任务不存在');
  await stopJob(row.id, row.name);
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
  const result = await runJobOnce(id);
  if (!result.success) throw new HTTPException(500, { message: result.message });
  return result.message;
}

export async function setCronJobStatus(id: number, status: 'enabled' | 'disabled') {
  const [row] = await db.update(cronJobs).set({ status }).where(eq(cronJobs.id, id)).returning();
  requireRow(row, '任务不存在');
  if (status === 'enabled') await scheduleJob(row.id, row.name, row.cronExpression, row.handler, row.params, { retryCount: row.retryCount, retryDelay: row.retryInterval, retryBackoff: row.retryBackoff, monitorTimeout: row.monitorTimeout });
  else await stopJob(row.id, row.name);
  return status === 'enabled' ? '已启用' : '已停用';
}

export async function listAllCronJobLogs(q: { page: number; pageSize: number; jobId?: number }) {
  const { page, pageSize, jobId } = q;
  const where = jobId ? eq(cronJobLogs.jobId, jobId) : undefined;
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

export async function getCronJobStats() {
  const [allJobs, [summaryRow], perJobAggRows, dailyRows, hourlyRows, recentPerJobRows, recentRows] = await Promise.all([
    db.select({
      id: cronJobs.id,
      name: cronJobs.name,
      status: cronJobs.status,
      lastRunStatus: cronJobs.lastRunStatus,
      lastRunAt: cronJobs.lastRunAt,
    }).from(cronJobs),
    db.select({
      todayRuns: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.startedAt} >= CURRENT_DATE) AS int)`,
      todaySuccesses: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.startedAt} >= CURRENT_DATE AND ${cronJobLogs.status} = 'success') AS int)`,
      todayFails: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.startedAt} >= CURRENT_DATE AND ${cronJobLogs.status} = 'fail') AS int)`,
      todayAvgDurationMs: sql<number | null>`CAST(ROUND(AVG(${cronJobLogs.durationMs}) FILTER (WHERE ${cronJobLogs.startedAt} >= CURRENT_DATE)) AS int)`,
    }).from(cronJobLogs),
    db.select({
      jobId: cronJobLogs.jobId,
      totalRuns: sql<number>`CAST(COUNT(*) AS int)`,
      successCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'success') AS int)`,
      failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'fail') AS int)`,
      avgDurationMs: sql<number | null>`CAST(ROUND(AVG(${cronJobLogs.durationMs})) AS int)`,
      p95DurationMs: sql<number | null>`CAST(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${cronJobLogs.durationMs}) FILTER (WHERE ${cronJobLogs.durationMs} IS NOT NULL)) AS int)`,
    }).from(cronJobLogs).groupBy(cronJobLogs.jobId),
    db.select({
      date: sql<string>`to_char(date(${cronJobLogs.startedAt}), 'YYYY-MM-DD')`,
      total: sql<number>`CAST(COUNT(*) AS int)`,
      successCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'success') AS int)`,
      failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'fail') AS int)`,
      avgDurationMs: sql<number | null>`CAST(ROUND(AVG(${cronJobLogs.durationMs})) AS int)`,
    }).from(cronJobLogs)
      .where(sql`${cronJobLogs.startedAt} >= CURRENT_DATE - INTERVAL '13 days'`)
      .groupBy(sql`date(${cronJobLogs.startedAt})`)
      .orderBy(sql`date(${cronJobLogs.startedAt})`),
    db.select({
      hour: sql<number>`CAST(EXTRACT(HOUR FROM ${cronJobLogs.startedAt}) AS int)`,
      total: sql<number>`CAST(COUNT(*) AS int)`,
      failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'fail') AS int)`,
    }).from(cronJobLogs)
      .where(sql`${cronJobLogs.startedAt} >= CURRENT_DATE - INTERVAL '6 days'`)
      .groupBy(sql`EXTRACT(HOUR FROM ${cronJobLogs.startedAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${cronJobLogs.startedAt})`),
    // 每任务最近 10 次执行状态（窗口函数），返回时按时间升序（旧 → 新）
    db.execute<{ job_id: number; status: 'success' | 'fail' | 'running' }>(sql`
      SELECT job_id, status FROM (
        SELECT ${cronJobLogs.jobId} AS job_id, ${cronJobLogs.status} AS status, ${cronJobLogs.startedAt} AS started_at,
               ROW_NUMBER() OVER (PARTITION BY ${cronJobLogs.jobId} ORDER BY ${cronJobLogs.startedAt} DESC) AS rn
        FROM ${cronJobLogs}
      ) t WHERE rn <= 10 ORDER BY job_id, started_at ASC
    `),
    db.select({
      id: cronJobLogs.id,
      jobId: cronJobLogs.jobId,
      jobName: cronJobLogs.jobName,
      status: cronJobLogs.status,
      durationMs: cronJobLogs.durationMs,
      startedAt: cronJobLogs.startedAt,
      executionCount: cronJobLogs.executionCount,
      output: cronJobLogs.output,
    }).from(cronJobLogs).orderBy(desc(cronJobLogs.startedAt)).limit(12),
  ]);

  const aggMap = new Map(perJobAggRows.map(r => [r.jobId, r]));
  const recentMap = new Map<number, Array<'success' | 'fail' | 'running'>>();
  for (const row of recentPerJobRows) {
    const list = recentMap.get(row.job_id) ?? [];
    list.push(row.status);
    recentMap.set(row.job_id, list);
  }

  const perJob = allJobs
    .map(job => {
      const agg = aggMap.get(job.id);
      const total = Number(agg?.totalRuns ?? 0);
      const success = Number(agg?.successCount ?? 0);
      const recentResults = recentMap.get(job.id) ?? [];
      // 连续失败：从最新往回数 fail（running 跳过不中断）
      let consecutiveFails = 0;
      for (let i = recentResults.length - 1; i >= 0; i--) {
        if (recentResults[i] === 'running') continue;
        if (recentResults[i] !== 'fail') break;
        consecutiveFails++;
      }
      return {
        jobId: job.id,
        jobName: job.name,
        totalRuns: total,
        successCount: success,
        failCount: Number(agg?.failCount ?? 0),
        successRate: total > 0 ? Math.round((success / total) * 100) : 0,
        avgDurationMs: agg?.avgDurationMs == null ? null : Number(agg.avgDurationMs),
        p95DurationMs: agg?.p95DurationMs == null ? null : Number(agg.p95DurationMs),
        recentResults,
        consecutiveFails,
        lastRunStatus: job.lastRunStatus,
        lastRunAt: formatNullableDateTime(job.lastRunAt),
      };
    })
    .sort((a, b) => b.totalRuns - a.totalRuns);

  return {
    totalJobs: allJobs.length,
    enabledJobs: allJobs.filter(j => j.status === 'enabled').length,
    runningJobs: getRunningJobCount(),
    todayRuns: Number(summaryRow?.todayRuns ?? 0),
    todaySuccesses: Number(summaryRow?.todaySuccesses ?? 0),
    todayFails: Number(summaryRow?.todayFails ?? 0),
    todayAvgDurationMs: summaryRow?.todayAvgDurationMs == null ? null : Number(summaryRow.todayAvgDurationMs),
    perJob,
    dailyStats: dailyRows.map(r => ({
      date: r.date,
      total: Number(r.total),
      successCount: Number(r.successCount),
      failCount: Number(r.failCount),
      avgDurationMs: r.avgDurationMs == null ? null : Number(r.avgDurationMs),
    })),
    hourlyStats: hourlyRows.map(r => ({
      hour: Number(r.hour),
      total: Number(r.total),
      failCount: Number(r.failCount),
    })),
    recentLogs: recentRows.map(r => ({
      id: r.id,
      jobId: r.jobId,
      jobName: r.jobName,
      status: r.status,
      durationMs: r.durationMs,
      startedAt: formatDateTime(r.startedAt),
      executionCount: r.executionCount,
      output: r.output,
    })),
  };
}
