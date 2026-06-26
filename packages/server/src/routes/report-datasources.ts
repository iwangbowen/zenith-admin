import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createReportDatasourceSchema, updateReportDatasourceSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { ReportDatasourceDTO } from '../lib/openapi-dtos';
import {
  listDatasources, getDatasource, createDatasource, updateDatasource,
  deleteDatasource, ensureDatasourceExists,
} from '../services/report-datasource.service';

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
        type: z.enum(['api', 'sql']).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDatasourceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDatasources(c.req.valid('query'))), 200),
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

router.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
