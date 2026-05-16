import { eq, like, and, desc } from 'drizzle-orm';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { cronJobs, cronJobLogs } from '../db/schema';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression } from '../lib/cron-scheduler';
import { streamToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';

export function mapCronJob(row: typeof cronJobs.$inferSelect) {
  return {
    ...row,
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    nextRunAt: formatNullableDateTime(row.nextRunAt),
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
  if (row.status === 'enabled') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  return mapCronJob(row);
}

export async function updateCronJob(id: number, data: Partial<typeof cronJobs.$inferInsert>) {
  if (data.cronExpression && !validateCronExpression(data.cronExpression)) throw new HTTPException(400, { message: 'Cron 表达式无效' });
  const [row] = await db.update(cronJobs).set({ ...data }).where(eq(cronJobs.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  if (row.status === 'enabled') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  else stopJob(row.id);
  return mapCronJob(row);
}

export async function deleteCronJob(id: number) {
  stopJob(id);
  const [row] = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
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
  if (status === 'enabled') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  else stopJob(row.id);
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

export async function listAllCronJobLogs(q: { page: number; pageSize: number }) {
  const { page, pageSize } = q;
  const [total, rows] = await Promise.all([
    db.$count(cronJobLogs),
    withPagination(db.select().from(cronJobLogs).orderBy(desc(cronJobLogs.startedAt)).$dynamic(), page, pageSize),
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
