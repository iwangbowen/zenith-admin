import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, like, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { cronJobs, cronJobLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression, getRegisteredHandlers } from '../lib/cron-scheduler';
import { exportToExcel } from '../lib/excel-export';
import { createCronJobSchema, updateCronJobSchema } from '@zenith/shared';
import { apiResponse, ErrorResponse, MessageResponse, PaginationQuery, paginatedResponse, jsonContent, validationHook } from '../lib/openapi-schemas';

const cronJobsRoute = new OpenAPIHono({ defaultHook: validationHook });
cronJobsRoute.use('*', authMiddleware);

const CronJobDTO = z.looseObject({}).openapi('CronJob');
const CronJobLogDTO = z.looseObject({}).openapi('CronJobLog');

function toCronJob(row: typeof cronJobs.$inferSelect) {
  return {
    ...row,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /handlers
const handlersRoute = createRoute({
  method: 'get',
  path: '/handlers',
  tags: ['CronJobs'],
  summary: '已注册 Handler',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:list' })] as const,
  responses: { 200: { content: jsonContent(apiResponse(z.array(z.string()))), description: 'ok' } },
});
cronJobsRoute.openapi(handlersRoute, async (c) => {
  return c.json({ code: 0 as const, message: 'ok', data: getRegisteredHandlers() }, 200);
});

// POST /validate
const validateRoute = createRoute({
  method: 'post',
  path: '/validate',
  tags: ['CronJobs'],
  summary: '校验 Cron 表达式',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:list' })] as const,
  request: { body: { content: jsonContent(z.object({ expression: z.string() })), required: true } },
  responses: { 200: { content: jsonContent(apiResponse(z.object({ valid: z.boolean() }))), description: 'ok' } },
});
cronJobsRoute.openapi(validateRoute, async (c) => {
  const { expression } = c.req.valid('json');
  return c.json({ code: 0 as const, message: 'ok', data: { valid: validateCronExpression(expression) } }, 200);
});

// GET /
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['CronJobs'],
  summary: '任务列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:list' })] as const,
  request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
  responses: { 200: { content: jsonContent(paginatedResponse(CronJobDTO)), description: 'ok' } },
});
cronJobsRoute.openapi(listRoute, async (c) => {
  const { page = 1, pageSize = 10, keyword } = c.req.valid('query');
  const conditions = [];
  if (keyword) conditions.push(like(cronJobs.name, `%${keyword}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`cast(count(*) as integer)` }).from(cronJobs).where(where);
  const rows = await db.select().from(cronJobs).where(where).orderBy(desc(cronJobs.id)).limit(pageSize).offset((page - 1) * pageSize);
  return c.json({ code: 0 as const, message: 'ok', data: { list: rows.map(toCronJob), total: Number(count), page, pageSize } }, 200);
});

// POST /
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['CronJobs'],
  summary: '新增任务',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:create', audit: { module: '定时任务', description: '新增任务' } })] as const,
  request: { body: { content: jsonContent(createCronJobSchema), required: true } },
  responses: {
    200: { content: jsonContent(apiResponse(CronJobDTO)), description: '创建成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
  },
});
cronJobsRoute.openapi(createRouteDef, async (c) => {
  const data = c.req.valid('json');
  if (!validateCronExpression(data.cronExpression)) return c.json({ code: 400, message: 'Cron 表达式无效', data: null }, 400);
  const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.name, data.name)).limit(1);
  if (existing) return c.json({ code: 400, message: '任务名称已存在', data: null }, 400);
  const [row] = await db.insert(cronJobs).values(data).returning();
  if (row.status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  return c.json({ code: 0 as const, message: '创建成功', data: toCronJob(row) }, 200);
});

// PUT /{id}
const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['CronJobs'],
  summary: '更新任务',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '更新任务' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }), body: { content: jsonContent(updateCronJobSchema), required: true } },
  responses: {
    200: { content: jsonContent(apiResponse(CronJobDTO)), description: '更新成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
cronJobsRoute.openapi(updateRouteDef, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  if (data.cronExpression && !validateCronExpression(data.cronExpression)) return c.json({ code: 400, message: 'Cron 表达式无效', data: null }, 400);
  const [row] = await db.update(cronJobs).set({ ...data, updatedAt: new Date() }).where(eq(cronJobs.id, id)).returning();
  if (!row) return c.json({ code: 404, message: '任务不存在', data: null }, 404);
  if (row.status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  else stopJob(row.id);
  return c.json({ code: 0 as const, message: '更新成功', data: toCronJob(row) }, 200);
});

// DELETE /{id}
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['CronJobs'],
  summary: '删除任务',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:delete', audit: { module: '定时任务', description: '删除任务' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
cronJobsRoute.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid('param');
  stopJob(id);
  const [row] = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning();
  if (!row) return c.json({ code: 404, message: '任务不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

// POST /{id}/run
const runRoute = createRoute({
  method: 'post',
  path: '/{id}/run',
  tags: ['CronJobs'],
  summary: '手动执行',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:execute', audit: { module: '定时任务', description: '手动执行任务' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    200: { content: jsonContent(MessageResponse), description: '执行成功' },
    500: { content: jsonContent(ErrorResponse), description: '执行失败' },
  },
});
cronJobsRoute.openapi(runRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await runJobOnce(id);
  if (result.success) return c.json({ code: 0 as const, message: result.message, data: null }, 200);
  return c.json({ code: 500, message: result.message, data: null }, 500);
});

// PUT /{id}/status
const statusRoute = createRoute({
  method: 'put',
  path: '/{id}/status',
  tags: ['CronJobs'],
  summary: '切换状态',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '切换任务状态' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }), body: { content: jsonContent(z.object({ status: z.enum(['active', 'disabled']) })), required: true } },
  responses: {
    200: { content: jsonContent(MessageResponse), description: 'ok' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
cronJobsRoute.openapi(statusRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { status } = c.req.valid('json');
  const [row] = await db.update(cronJobs).set({ status, updatedAt: new Date() }).where(eq(cronJobs.id, id)).returning();
  if (!row) return c.json({ code: 404, message: '任务不存在', data: null }, 404);
  if (status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
  else stopJob(row.id);
  return c.json({ code: 0 as const, message: status === 'active' ? '已启用' : '已停用', data: null }, 200);
});

// GET /export
const exportRouteDef = createRoute({
  method: 'get',
  path: '/export',
  tags: ['CronJobs'],
  summary: '导出任务',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:list' })] as const,
  responses: { 200: { content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } }, description: 'Excel 文件' } },
});
cronJobsRoute.openapi(exportRouteDef, async (c) => {
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
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=cron-jobs.xlsx');
  return c.body(buffer) as never;
});

// GET /logs
const logsRoute = createRoute({
  method: 'get',
  path: '/logs',
  tags: ['CronJobs'],
  summary: '所有执行日志',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:list' })] as const,
  request: { query: PaginationQuery },
  responses: { 200: { content: jsonContent(paginatedResponse(CronJobLogDTO)), description: 'ok' } },
});
cronJobsRoute.openapi(logsRoute, async (c) => {
  const { page = 1, pageSize = 20 } = c.req.valid('query');
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(cronJobLogs);
  const rows = await db.select().from(cronJobLogs).orderBy(desc(cronJobLogs.startedAt)).limit(pageSize).offset((page - 1) * pageSize);
  const list = rows.map((r) => ({
    id: r.id, jobId: r.jobId, jobName: r.jobName, executionCount: r.executionCount,
    startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.durationMs, status: r.status, output: r.output,
  }));
  return c.json({ code: 0 as const, message: 'ok', data: { list, total: Number(count), page, pageSize } }, 200);
});

// GET /{id}/logs
const idLogsRoute = createRoute({
  method: 'get',
  path: '/{id}/logs',
  tags: ['CronJobs'],
  summary: '单任务日志',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:cronjob:list' })] as const,
  request: { params: z.object({ id: z.coerce.number() }), query: PaginationQuery },
  responses: { 200: { content: jsonContent(paginatedResponse(CronJobLogDTO)), description: 'ok' } },
});
cronJobsRoute.openapi(idLogsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { page = 1, pageSize = 20 } = c.req.valid('query');
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(cronJobLogs).where(eq(cronJobLogs.jobId, id));
  const rows = await db.select().from(cronJobLogs).where(eq(cronJobLogs.jobId, id)).orderBy(desc(cronJobLogs.startedAt)).limit(pageSize).offset((page - 1) * pageSize);
  const list = rows.map((r) => ({
    id: r.id, jobId: r.jobId, jobName: r.jobName, executionCount: r.executionCount,
    startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
    durationMs: r.durationMs, status: r.status, output: r.output,
  }));
  return c.json({ code: 0 as const, message: 'ok', data: { list, total: Number(count), page, pageSize } }, 200);
});

export default cronJobsRoute;
