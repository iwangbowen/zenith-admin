import { eq, like, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression } from '../lib/cron-scheduler';
import { exportToExcel } from '../lib/excel-export';
import { AppError } from '../lib/errors';

export function mapCronJob(row: typeof cronJobs.$inferSelect) {
  return {
    ...row,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapLog(r: typeof cronJobLogs.$inferSelect) {
  return {
    id: r.id,
    jobId: r.jobId,
    jobName: r.jobName,
    executionCount: r.executionCount,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    status: r.status,
    output: r.output,
  };
}

export async function listCronJobs(q: { page: number; pageSize: number; keyword?: string }) {
  const { page, pageSize, keyword } = q;
  const conditions = [];
  if (keyword) conditions.push(like(cronJobs.name, `%${keyword}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(cronJobs, where),
    db.select().from(cronJobs).where(where).orderBy(desc(cronJobs.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapCronJob), total, page, pageSize };
}

export async function createCronJob(data: typeof cronJobs.$inferInsert) {
  if (!validateCronExpression(data.cronExpression)) throw new AppError('Cron 表达式无效', 400);
  const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.name, data.name)).limit(1);
  if (existing) throw new AppError('任务名称已存在', 400);
  const [row] = await db.insert(cronJobs).values(data).returning();
  if (row.status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  return mapCronJob(row);
}

export async function updateCronJob(id: number, data: Partial<typeof cronJobs.$inferInsert>) {
  if (data.cronExpression && !validateCronExpression(data.cronExpression)) throw new AppError('Cron 表达式无效', 400);
  const [row] = await db.update(cronJobs).set({ ...data }).where(eq(cronJobs.id, id)).returning();
  if (!row) throw new AppError('任务不存在', 404);
  if (row.status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  else stopJob(row.id);
  return mapCronJob(row);
}

export async function deleteCronJob(id: number) {
  stopJob(id);
  const [row] = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning();
  if (!row) throw new AppError('任务不存在', 404);
}

export async function runCronJob(id: number) {
  const result = await runJobOnce(id);
  if (!result.success) throw new AppError(result.message, 500);
  return result.message;
}

export async function setCronJobStatus(id: number, status: 'active' | 'disabled') {
  const [row] = await db.update(cronJobs).set({ status }).where(eq(cronJobs.id, id)).returning();
  if (!row) throw new AppError('任务不存在', 404);
  if (status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  else stopJob(row.id);
  return status === 'active' ? '已启用' : '已停用';
}

export async function exportCronJobs(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const rows = await db.select().from(cronJobs).orderBy(desc(cronJobs.id));
  const buffer = await exportToExcel(
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
    rows.map((r) => ({ ...r, lastRunAt: r.lastRunAt?.toISOString() ?? '', createdAt: r.createdAt.toISOString() })),
    '定时任务',
  );
  return { buffer, filename: 'cron-jobs.xlsx' };
}

export async function listAllCronJobLogs(q: { page: number; pageSize: number }) {
  const { page, pageSize } = q;
  const [total, rows] = await Promise.all([
    db.$count(cronJobLogs),
    db.select().from(cronJobLogs).orderBy(desc(cronJobLogs.startedAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapLog), total, page, pageSize };
}

export async function listCronJobLogs(jobId: number, q: { page: number; pageSize: number }) {
  const { page, pageSize } = q;
  const [total, rows] = await Promise.all([
    db.$count(cronJobLogs, eq(cronJobLogs.jobId, jobId)),
    db.select().from(cronJobLogs).where(eq(cronJobLogs.jobId, jobId)).orderBy(desc(cronJobLogs.startedAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapLog), total, page, pageSize };
}
