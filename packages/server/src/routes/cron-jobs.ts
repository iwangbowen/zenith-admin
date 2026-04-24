import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validateCronExpression, getRegisteredHandlers } from '../lib/cron-scheduler';
import { createCronJobSchema, updateCronJobSchema } from '@zenith/shared';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { CronJobDTO, CronJobLogDTO } from '../lib/openapi-dtos';
import {
  listCronJobs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  runCronJob,
  setCronJobStatus,
  exportCronJobs,
  listAllCronJobLogs,
  listCronJobLogs,
} from '../services/cron-jobs.service';

const cronJobsRoute = new OpenAPIHono({ defaultHook: validationHook });

const handlersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/handlers', tags: ['CronJobs'], summary: '已注册 Handler',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(z.string()), 'ok') },
  }),
  handler: async (c) => c.json(okBody(getRegisteredHandlers()), 200),
});

const validateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/validate', tags: ['CronJobs'], summary: '校验 Cron 表达式',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { body: { content: jsonContent(z.object({ expression: z.string() }).openapi('CronValidateBody')), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ valid: z.boolean() }).openapi('CronValidateResult'), 'ok') },
  }),
  handler: async (c) => {
    const { expression } = c.req.valid('json');
    return c.json(okBody({ valid: validateCronExpression(expression) }), 200);
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['CronJobs'], summary: '任务列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(CronJobDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listCronJobs(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['CronJobs'], summary: '新增任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:create', audit: { module: '定时任务', description: '新增任务' } })] as const,
    request: { body: { content: jsonContent(createCronJobSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CronJobDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCronJob(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['CronJobs'], summary: '更新任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '更新任务' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCronJobSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CronJobDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateCronJob(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['CronJobs'], summary: '删除任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:delete', audit: { module: '定时任务', description: '删除任务' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteCronJob(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/run', tags: ['CronJobs'], summary: '手动执行',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:execute', audit: { module: '定时任务', description: '手动执行任务' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('执行成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const msg = await runCronJob(id);
    return c.json(okBody(null, msg), 200);
  },
});

const statusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/status', tags: ['CronJobs'], summary: '切换状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:update', audit: { module: '定时任务', description: '切换任务状态' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ status: z.enum(['active', 'disabled']) }).openapi('CronJobStatusBody')), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    const msg = await setCronJobStatus(id, status);
    return c.json(okBody(null, msg), 200);
  },
});

const exportRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['CronJobs'], summary: '导出任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportCronJobs();
    return excelBody(c, buffer, filename);
  },
});

const logsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/logs', tags: ['CronJobs'], summary: '所有执行日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CronJobLogDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listAllCronJobLogs(c.req.valid('query'))), 200),
});

const idLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/logs', tags: ['CronJobs'], summary: '单任务日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CronJobLogDTO, 'ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listCronJobLogs(id, c.req.valid('query'))), 200);
  },
});

cronJobsRoute.openapiRoutes([handlersRoute, validateRoute, listRoute, createRouteDef, updateRouteDef, deleteRouteDef, runRoute, statusRoute, exportRouteDef, logsRoute, idLogsRoute] as const);

export default cronJobsRoute;
