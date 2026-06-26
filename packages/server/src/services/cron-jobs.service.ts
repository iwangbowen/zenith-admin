import { eq, like, and, desc, lt, sql } from 'drizzle-orm';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { cronJobs, cronJobLogs } from '../db/schema';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression, getRunningJobCount } from '../lib/pg-boss-scheduler';
import { streamToExcel, streamToCsv, formatDateTimeForExcel } from '../lib/excel-export';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';

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
  if (keyword) conditions.push(like(cronJobs.name, `%${escapeLike(keyword)}%`));
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(cronJobs, where),
    withPagination(db.select().from(cronJobs).where(where).orderBy(desc(cronJobs.id)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map(mapCronJob), total, page, pageSize };
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
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  if (row.status === 'enabled') await scheduleJob(row.id, row.name, row.cronExpression, row.handler, row.params, { retryCount: row.retryCount, retryDelay: row.retryInterval, retryBackoff: row.retryBackoff, monitorTimeout: row.monitorTimeout });
  else await stopJob(row.id, row.name);
  return mapCronJob(row);
}

export async function deleteCronJob(id: number) {
  const [row] = await db.select({ id: cronJobs.id, name: cronJobs.name }).from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  await stopJob(row.id, row.name);
  await db.delete(cronJobs).where(eq(cronJobs.id, id));
}

export async function getCronJob(id: number) {
  const [row] = await db.select().from(cronJobs).where(eq(cronJobs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
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
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  if (status === 'enabled') await scheduleJob(row.id, row.name, row.cronExpression, row.handler, row.params, { retryCount: row.retryCount, retryDelay: row.retryInterval, retryBackoff: row.retryBackoff, monitorTimeout: row.monitorTimeout });
  else await stopJob(row.id, row.name);
  return status === 'enabled' ? '已启用' : '已停用';
}

export async function exportCronJobs(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db.select().from(cronJobs).orderBy(desc(cronJobs.id));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '任务名称', key: 'name', width: 20 },
      { header: 'Cron 表达式', key: 'cronExpression', width: 18 },
      { header: '处理器', key: 'handler', width: 20 },
      { header: '状态', key: 'status', width: 10 },
      { header: '最后执行', key: 'lastRunAt', width: 22 },
      { header: '执行结果', key: 'lastRunStatus', width: 12 },
      { header: '描述', key: 'description', width: 30 },
    ],
    rows.map((r) => ({ ...r, lastRunAt: formatDateTimeForExcel(r.lastRunAt), createdAt: formatDateTimeForExcel(r.createdAt) })),
    '定时任务',
  );
  return { stream, filename: 'cron-jobs.xlsx' };
}

export async function exportCronJobsAsCsv(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db.select().from(cronJobs).orderBy(desc(cronJobs.id));
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '任务名称', key: 'name', width: 20 },
      { header: 'Cron 表达式', key: 'cronExpression', width: 18 },
      { header: '处理器', key: 'handler', width: 20 },
      { header: '状态', key: 'status', width: 10 },
      { header: '最后执行', key: 'lastRunAt', width: 22 },
      { header: '执行结果', key: 'lastRunStatus', width: 12 },
      { header: '描述', key: 'description', width: 30 },
    ],
    rows.map((r) => ({ ...r, lastRunAt: formatDateTimeForExcel(r.lastRunAt), createdAt: formatDateTimeForExcel(r.createdAt) })),
  );
  return { stream, filename: 'cron-jobs.csv' };
}

export async function listAllCronJobLogs(q: { page: number; pageSize: number; jobId?: number }) {
  const { page, pageSize, jobId } = q;
  const where = jobId ? eq(cronJobLogs.jobId, jobId) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(cronJobLogs, where),
    withPagination(db.select().from(cronJobLogs).where(where).orderBy(desc(cronJobLogs.startedAt)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map(mapLog), total, page, pageSize };
}

export async function listCronJobLogs(jobId: number, q: { page: number; pageSize: number }) {
  const { page, pageSize } = q;
  const [total, rows] = await Promise.all([
    db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId)),
    withPagination(db.select().from(cronJobLogs).where(eq(cronJobLogs.jobId, jobId)).orderBy(desc(cronJobLogs.startedAt)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map(mapLog), total, page, pageSize };
}

function buildClearCronJobLogsWhere(months: number, jobId?: number) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (months > 0) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    conditions.push(lt(cronJobLogs.startedAt, cutoff));
  }
  if (jobId) conditions.push(eq(cronJobLogs.jobId, jobId));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getClearCronJobLogsBeforeAudit(months: number, jobId?: number) {
  const where = buildClearCronJobLogsWhere(months, jobId);
  const [total, sample] = await Promise.all([
    db.$count(cronJobLogs, where),
    db.select().from(cronJobLogs).where(where).orderBy(desc(cronJobLogs.startedAt)).limit(20),
  ]);
  return { jobId, months, total, sample: sample.map(mapLog) };
}

export async function clearCronJobLogs(months: number, jobId?: number) {
  // months=0 表示清除全部
  const where = buildClearCronJobLogsWhere(months, jobId);
  const deleted = await db.delete(cronJobLogs).where(where).returning({ id: cronJobLogs.id });
  return deleted.length;
}

export async function getCronJobStats() {
  const [allJobs, [summaryRow], perJobAggRows, dailyRows, recentRows] = await Promise.all([
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
    }).from(cronJobLogs).groupBy(cronJobLogs.jobId),
    db.select({
      date: sql<string>`to_char(date(${cronJobLogs.startedAt}), 'YYYY-MM-DD')`,
      total: sql<number>`CAST(COUNT(*) AS int)`,
      successCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'success') AS int)`,
      failCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'fail') AS int)`,
    }).from(cronJobLogs)
      .where(sql`${cronJobLogs.startedAt} >= CURRENT_DATE - INTERVAL '13 days'`)
      .groupBy(sql`date(${cronJobLogs.startedAt})`)
      .orderBy(sql`date(${cronJobLogs.startedAt})`),
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
  const perJob = allJobs
    .map(job => {
      const agg = aggMap.get(job.id);
      const total = Number(agg?.totalRuns ?? 0);
      const success = Number(agg?.successCount ?? 0);
      return {
        jobId: job.id,
        jobName: job.name,
        totalRuns: total,
        successCount: success,
        failCount: Number(agg?.failCount ?? 0),
        successRate: total > 0 ? Math.round((success / total) * 100) : 0,
        avgDurationMs: agg?.avgDurationMs == null ? null : Number(agg.avgDurationMs),
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
