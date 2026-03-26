import { Hono } from 'hono';
import { eq, like, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createCronJobSchema, updateCronJobSchema } from '@zenith/shared';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression, getRegisteredHandlers } from '../lib/cron-scheduler';
import { exportToExcel } from '../lib/excel-export';

const cronJobsRoute = new Hono();

cronJobsRoute.use('/*', authMiddleware);

// Get registered handler names
cronJobsRoute.get('/handlers', guard({ permission: 'system:cronjob:list' }), async (c) => {
  return c.json({ code: 0, message: 'ok', data: getRegisteredHandlers() });
});

// Validate cron expression
cronJobsRoute.post('/validate', guard({ permission: 'system:cronjob:list' }), async (c) => {
  const { expression } = await c.req.json();
  return c.json({ code: 0, message: 'ok', data: { valid: validateCronExpression(expression) } });
});

cronJobsRoute.get('/', guard({ permission: 'system:cronjob:list' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const keyword = c.req.query('keyword');

  const conditions = [];
  if (keyword) conditions.push(like(cronJobs.name, `%${keyword}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(cronJobs)
    .where(where);

  const rows = await db
    .select()
    .from(cronJobs)
    .where(where)
    .orderBy(desc(cronJobs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({
        ...r,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        nextRunAt: r.nextRunAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: count,
      page,
      pageSize,
    },
  });
});

cronJobsRoute.post('/', guard({ permission: 'system:cronjob:create', audit: { module: '定时任务', description: '新增任务' } }), async (c) => {
  const body = await c.req.json();
  const result = createCronJobSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  if (!validateCronExpression(result.data.cronExpression)) {
    return c.json({ code: 400, message: 'Cron 表达式无效', data: null }, 400);
  }

  const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.name, result.data.name)).limit(1);
  if (existing) {
    return c.json({ code: 400, message: '任务名称已存在', data: null }, 400);
  }

  const [row] = await db.insert(cronJobs).values(result.data).returning();

  if (row.status === 'active') {
    scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  }

  return c.json({
    code: 0,
    message: '创建成功',
    data: { ...row, lastRunAt: null, nextRunAt: null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
  });
});

cronJobsRoute.put('/:id', guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '更新任务' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateCronJobSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  if (result.data.cronExpression && !validateCronExpression(result.data.cronExpression)) {
    return c.json({ code: 400, message: 'Cron 表达式无效', data: null }, 400);
  }

  const [row] = await db.update(cronJobs)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(cronJobs.id, id))
    .returning();

  if (!row) {
    return c.json({ code: 404, message: '任务不存在', data: null }, 404);
  }

  // Reschedule/stop based on new status
  if (row.status === 'active') {
    scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  } else {
    stopJob(row.id);
  }

  return c.json({
    code: 0,
    message: '更新成功',
    data: { ...row, lastRunAt: row.lastRunAt?.toISOString() ?? null, nextRunAt: row.nextRunAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
  });
});

cronJobsRoute.delete('/:id', guard({ permission: 'system:cronjob:delete', audit: { module: '定时任务', description: '删除任务' } }), async (c) => {
  const id = Number(c.req.param('id'));
  stopJob(id);
  const [row] = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning();
  if (!row) {
    return c.json({ code: 404, message: '任务不存在', data: null }, 404);
  }
  return c.json({ code: 0, message: '删除成功', data: null });
});

// Manual execution
cronJobsRoute.post('/:id/run', guard({ permission: 'system:cronjob:execute', audit: { module: '定时任务', description: '手动执行任务' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const result = await runJobOnce(id);
  return c.json({ code: result.success ? 0 : 500, message: result.message, data: null });
});

// Toggle status
cronJobsRoute.put('/:id/status', guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '切换任务状态' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const { status } = await c.req.json();
  if (status !== 'active' && status !== 'disabled') {
    return c.json({ code: 400, message: '状态值无效', data: null }, 400);
  }

  const [row] = await db.update(cronJobs)
    .set({ status, updatedAt: new Date() })
    .where(eq(cronJobs.id, id))
    .returning();

  if (!row) {
    return c.json({ code: 404, message: '任务不存在', data: null }, 404);
  }

  if (status === 'active') {
    scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  } else {
    stopJob(row.id);
  }

  return c.json({ code: 0, message: status === 'active' ? '已启用' : '已停用', data: null });
});

cronJobsRoute.get('/export', guard({ permission: 'system:cronjob:list' }), async (c) => {
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
    rows.map((r) => ({
      ...r,
      lastRunAt: r.lastRunAt?.toISOString() ?? '',
      createdAt: r.createdAt.toISOString(),
    })),
    '定时任务'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=cron-jobs.xlsx');
  return c.body(buffer);
});

// GET /:id/logs — 定时任务执行日志
cronJobsRoute.get('/:id/logs', guard({ permission: 'system:cronjob:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const page     = Number(c.req.query('page'))     || 1;
  const pageSize = Number(c.req.query('pageSize')) || 20;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(cronJobLogs)
    .where(eq(cronJobLogs.jobId, id));

  const rows = await db
    .select()
    .from(cronJobLogs)
    .where(eq(cronJobLogs.jobId, id))
    .orderBy(desc(cronJobLogs.startedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const list = rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobName: r.jobName,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    status: r.status,
    output: r.output,
  }));

  return c.json({ code: 0, message: 'ok', data: { list, total: Number(count), page, pageSize } });
});

export default cronJobsRoute;
