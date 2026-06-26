import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { validateCronExpression, getRegisteredHandlers } from '../lib/pg-boss-scheduler';
import { createCronJobSchema, updateCronJobSchema } from '@zenith/shared';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelStreamBody, okCsv, csvStreamBody } from '../lib/openapi-schemas';
import { CronJobDTO, CronJobLogDTO, CronJobStatsDTO } from '../lib/openapi-dtos';
import {
  listCronJobs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  runCronJob,
  setCronJobStatus,
  exportCronJobs, exportCronJobsAsCsv,
  listAllCronJobLogs,
  listCronJobLogs,
  clearCronJobLogs,
  getCronJobBeforeAudit,
  getClearCronJobLogsBeforeAudit,
  getCronJob,
  getCronJobStats,
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

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['CronJobs'], summary: '任务详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CronJobDTO, '任务详情') },
  }),
  handler: async (c) => c.json(okBody(await getCronJob(c.req.valid('param').id)), 200),
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
    const before = await getCronJobBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
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
    const before = await getCronJobBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
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
    request: { params: IdParam, body: { content: jsonContent(z.object({ status: z.enum(['enabled', 'disabled']) }).openapi('CronJobStatusBody')), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('ok') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    const before = await getCronJobBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const msg = await setCronJobStatus(id, status);
    const after = await getCronJobBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
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
    const { stream, filename } = await exportCronJobs();
    return excelStreamBody(c, stream, filename);
  },
});

const logsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/logs', tags: ['CronJobs'], summary: '所有执行日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    request: { query: PaginationQuery.extend({ jobId: z.coerce.number().int().positive().optional() }) },
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

const clearLogsMonthsQuery = z.object({
  months: z.coerce.number().int().refine((v) => [0, 1, 3, 6, 12].includes(v), { message: 'months 必须为 0（全部）、1、3、6 或 12' }),
}).openapi('ClearLogsQuery');

const clearAllLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/logs/clean', tags: ['CronJobs'], summary: '清除所有执行日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:delete', audit: { module: '定时任务', description: '清除所有执行日志' } })] as const,
    request: { query: clearLogsMonthsQuery },
    responses: { ...commonErrorResponses, ...okMsg('清除成功') },
  }),
  handler: async (c) => {
    const { months } = c.req.valid('query');
    const before = await getClearCronJobLogsBeforeAudit(months);
    setAuditBeforeData(c, before);
    const count = await clearCronJobLogs(months);
    setAuditAfterData(c, { months, deleted: count });
    return c.json(okBody(null, `已清除 ${count} 条日志`), 200);
  },
});

const clearJobLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/logs/clean', tags: ['CronJobs'], summary: '清除单任务执行日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:delete', audit: { module: '定时任务', description: '清除单任务执行日志' } })] as const,
    request: { params: IdParam, query: clearLogsMonthsQuery },
    responses: { ...commonErrorResponses, ...okMsg('清除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { months } = c.req.valid('query');
    const before = await getClearCronJobLogsBeforeAudit(months, id);
    setAuditBeforeData(c, before);
    const count = await clearCronJobLogs(months, id);
    setAuditAfterData(c, { jobId: id, months, deleted: count });
    return c.json(okBody(null, `已清除 ${count} 条日志`), 200);
  },
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['CronJobs'], summary: '任务统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(CronJobStatsDTO, '统计数据') },
  }),
  handler: async (c) => c.json(okBody(await getCronJobStats()), 200),
});

const exportCsvRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export/csv', tags: ['CronJobs'], summary: '导出任务 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:cronjob:list' })] as const,
    responses: { ...commonErrorResponses, ...okCsv('CSV 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportCronJobsAsCsv();
    return csvStreamBody(c, stream, filename);
  },
});

cronJobsRoute.openapiRoutes([handlersRoute, validateRoute, listRoute, exportRouteDef, exportCsvRouteDef, logsRoute, clearAllLogsRoute, statsRoute, createRouteDef, getOneRoute, updateRouteDef, deleteRouteDef, runRoute, statusRoute, idLogsRoute, clearJobLogsRoute] as const);

export default cronJobsRoute;
