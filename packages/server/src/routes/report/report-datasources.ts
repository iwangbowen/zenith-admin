import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  createReportDatasourceSchema,
  updateReportDatasourceSchema,
  reportBatchStatusSchema,
  reportCloneSchema,
  reportDatasourceTestSchema,
  reportDatasourceTypeSchema,
  reportLookupQuerySchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { AsyncTaskDTO, ReportDatasourceDTO, ReportDatasourceTestResultDTO, ReportLookupOptionDTO } from '../../lib/openapi-dtos';
import {
  listDatasources, getDatasource, createDatasource, updateDatasource,
  deleteDatasource, ensureDatasourceExists, testDatasource,
  batchSetDatasourceStatus, cloneDatasource, listDatasourceLookup,
} from '../../services/report/report-datasource.service';
import { submitDatasourceHealthCheckTask } from '../../services/report/report-datasource-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['报表数据源'], summary: '数据源列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        type: reportDatasourceTypeSchema.optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDatasourceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDatasources(c.req.valid('query'))), 200),
});

const lookupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/lookup',
    tags: ['报表数据源'], summary: '数据源轻量下拉',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:list' })] as const,
    request: { query: reportLookupQuerySchema },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportLookupOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDatasourceLookup(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['报表数据源'], summary: '数据源详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportDatasourceDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getDatasource(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['报表数据源'], summary: '创建数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:create', audit: { description: '创建报表数据源', module: '报表数据源' } })] as const,
    request: { body: { content: jsonContent(createReportDatasourceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasourceDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDatasource(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['报表数据源'], summary: '更新数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '更新报表数据源', module: '报表数据源' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportDatasourceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasourceDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasourceExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateDatasource(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['报表数据源'], summary: '删除数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:delete', audit: { description: '删除报表数据源', module: '报表数据源' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasourceExists(id);
    setAuditBeforeData(c, before);
    await deleteDatasource(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status',
    tags: ['报表数据源'], summary: '批量启停数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '批量更新报表数据源状态', module: '报表数据源' } })] as const,
    request: { body: { content: jsonContent(reportBatchStatusSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已更新') },
  }),
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDatasourceStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个数据源状态`), 200);
  },
});

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/test',
    tags: ['报表数据源'], summary: '测试数据源连接（外部库）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:create' })] as const,
    request: { body: { content: jsonContent(reportDatasourceTestSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasourceTestResultDTO, '连接测试结果') },
  }),
  handler: async (c) => c.json(okBody(await testDatasource(c.req.valid('json'))), 200),
});

const testOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/test',
    tags: ['报表数据源'], summary: '测试并持久化数据源健康状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '测试报表数据源连接', module: '报表数据源' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportDatasourceTestResultDTO, '连接测试结果') },
  }),
  handler: async (c) => c.json(okBody(await testDatasource({ id: c.req.valid('param').id })), 200),
});

const cloneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/clone',
    tags: ['报表数据源'], summary: '复制数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:create', audit: { description: '复制报表数据源', module: '报表数据源' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportCloneSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDatasourceDTO, '复制成功') },
  }),
  handler: async (c) => c.json(okBody(await cloneDatasource(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

const healthCheckRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/health-check',
    tags: ['报表数据源'], summary: '批量健康检查',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '批量检测报表数据源健康状态', module: '报表数据源' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => c.json(okBody(await submitDatasourceHealthCheckTask(c.req.valid('json').ids), '任务已提交，可在任务中心查看进度'), 200),
});

router.openapiRoutes([listRoute, lookupRoute, batchStatusRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, testRoute, testOneRoute, cloneRoute, healthCheckRoute] as const);

export default router;
