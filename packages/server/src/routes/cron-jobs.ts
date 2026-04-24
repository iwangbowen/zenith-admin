import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, like, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { cronJobs, cronJobLogs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { scheduleJob, stopJob, runJobOnce, validateCronExpression, getRegisteredHandlers } from '../lib/cron-scheduler';
import { exportToExcel } from '../lib/excel-export';
import { createCronJobSchema, updateCronJobSchema } from '@zenith/shared';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody } from '../lib/openapi-schemas';
import { CronJobDTO, CronJobLogDTO } from '../lib/openapi-dtos';

const cronJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

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
const handlersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/handlers',
    tags: ['CronJobs'],
    summary: '已注册 Handler',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(z.string()), 'ok'),
    },
  }),
  handler: async (c) => {
    return c.json(okBody(getRegisteredHandlers()), 200);
  },
});

// POST /validate
const validateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/validate',
    tags: ['CronJobs'],
    summary: '校验 Cron 表达式',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { body: { content: jsonContent(z.object({ expression: z.string() }).openapi('CronValidateBody')), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({ valid: z.boolean() }).openapi('CronValidateResult'), 'ok'),
    },
  }),
  handler: async (c) => {
    const { expression } = c.req.valid('json');
    return c.json(okBody({ valid: validateCronExpression(expression) }), 200);
  },
});

// GET /
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['CronJobs'],
    summary: '任务列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(CronJobDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 10, keyword } = c.req.valid('query');
    const conditions = [];
    if (keyword) conditions.push(like(cronJobs.name, `%${keyword}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [count, rows] = await Promise.all([
      db.$count(cronJobs, where),
      db.select().from(cronJobs).where(where).orderBy(desc(cronJobs.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);
    return c.json(okBody({ list: rows.map(toCronJob), total: count, page, pageSize }), 200);
  },
});

// POST /
const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['CronJobs'],
    summary: '新增任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:create', audit: { module: '定时任务', description: '新增任务' } })] as const,
    request: { body: { content: jsonContent(createCronJobSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CronJobDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    if (!validateCronExpression(data.cronExpression)) return c.json(errBody('Cron 表达式无效'), 400);
    const [existing] = await db.select().from(cronJobs).where(eq(cronJobs.name, data.name)).limit(1);
    if (existing) return c.json(errBody('任务名称已存在'), 400);
    const [row] = await db.insert(cronJobs).values(data).returning();
    if (row.status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
    return c.json(okBody(toCronJob(row), '创建成功'), 200);
  },
});

// PUT /{id}
const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['CronJobs'],
    summary: '更新任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '更新任务' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCronJobSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CronJobDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    if (data.cronExpression && !validateCronExpression(data.cronExpression)) return c.json(errBody('Cron 表达式无效'), 400);
    const [row] = await db.update(cronJobs).set({ ...data }).where(eq(cronJobs.id, id)).returning();
    if (!row) return c.json(errBody('任务不存在', 404), 404);
    if (row.status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
    else stopJob(row.id);
    return c.json(okBody(toCronJob(row), '更新成功'), 200);
  },
});

// DELETE /{id}
const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['CronJobs'],
    summary: '删除任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:delete', audit: { module: '定时任务', description: '删除任务' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    stopJob(id);
    const [row] = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning();
    if (!row) return c.json(errBody('任务不存在', 404), 404);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// POST /{id}/run
const runRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/run',
    tags: ['CronJobs'],
    summary: '手动执行',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:execute', audit: { module: '定时任务', description: '手动执行任务' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('执行成功'),
      500: { content: jsonContent(ErrorResponse), description: '执行失败' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await runJobOnce(id);
    if (result.success) return c.json(okBody(null, result.message), 200);
    return c.json(errBody(result.message, 500), 500);
  },
});

// PUT /{id}/status
const statusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/status',
    tags: ['CronJobs'],
    summary: '切换状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '切换任务状态' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ status: z.enum(['active', 'disabled']) }).openapi('CronJobStatusBody')), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    const [row] = await db.update(cronJobs).set({ status }).where(eq(cronJobs.id, id)).returning();
    if (!row) return c.json(errBody('任务不存在', 404), 404);
    if (status === 'active') scheduleJob(row.id, row.cronExpression, row.handler, row.params);
    else stopJob(row.id);
    return c.json(okBody(null, status === 'active' ? '已启用' : '已停用'), 200);
  },
});

// GET /export
const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/export',
    tags: ['CronJobs'],
    summary: '导出任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } }, description: 'Excel 文件' },
    },
  }),
  handler: async (c) => {
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
  },
});

// GET /logs
const logsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/logs',
    tags: ['CronJobs'],
    summary: '所有执行日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { query: PaginationQuery },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(CronJobLogDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 20 } = c.req.valid('query');
    const [count, rows] = await Promise.all([
      db.$count(cronJobLogs),
      db.select().from(cronJobLogs).orderBy(desc(cronJobLogs.startedAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);
    const list = rows.map((r) => ({
      id: r.id, jobId: r.jobId, jobName: r.jobName, executionCount: r.executionCount,
      startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
      durationMs: r.durationMs, status: r.status, output: r.output,
    }));
    return c.json(okBody({ list, total: count, page, pageSize }), 200);
  },
});

// GET /{id}/logs
const idLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/logs',
    tags: ['CronJobs'],
    summary: '单任务日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(CronJobLogDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page = 1, pageSize = 20 } = c.req.valid('query');
    const [count, rows] = await Promise.all([
      db.$count(cronJobLogs, eq(cronJobLogs.jobId, id)),
      db.select().from(cronJobLogs).where(eq(cronJobLogs.jobId, id)).orderBy(desc(cronJobLogs.startedAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    ]);
    const list = rows.map((r) => ({
      id: r.id, jobId: r.jobId, jobName: r.jobName, executionCount: r.executionCount,
      startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
      durationMs: r.durationMs, status: r.status, output: r.output,
    }));
    return c.json(okBody({ list, total: count, page, pageSize }), 200);
  },
});

cronJobsRoute.openapiRoutes([handlersRoute, validateRoute, listRoute, createRouteDef, updateRouteDef, deleteRouteDef, runRoute, statusRoute, exportRouteDef, logsRoute, idLogsRoute] as const);

export default cronJobsRoute;
