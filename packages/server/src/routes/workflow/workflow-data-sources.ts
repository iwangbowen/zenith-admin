import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createWorkflowDataSourceSchema, updateWorkflowDataSourceSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { WorkflowDataSourceDTO, WorkflowDataSourceOptionDTO } from '../../lib/openapi-dtos';
import {
  listDataSources, getDataSource, createDataSource, updateDataSource,
  deleteDataSource, ensureDataSourceExists, fetchDataSourceOptions, fetchDataSourceRecord,
} from '../../services/workflow/workflow-data-source.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── GET / — 分页列表 ────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['远程数据源'], summary: '数据源列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:datasource:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowDataSourceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDataSources(c.req.valid('query'))), 200),
});

// ─── GET /{id}/options — 代理拉取选项（运行时填表用，仅需登录态） ──────────
const optionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/options',
    tags: ['远程数据源'], summary: '拉取数据源选项',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, query: z.object({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowDataSourceOptionDTO), '选项列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { keyword } = c.req.valid('query');
    return c.json(okBody(await fetchDataSourceOptions(id, keyword)), 200);
  },
});

// ─── GET /{id}/record — 按选项值取完整记录（联动赋值回填用，仅需登录态） ────
const recordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/record',
    tags: ['远程数据源'], summary: '按选项值取数据源完整记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, query: z.object({ value: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...ok(z.record(z.string(), z.unknown()).nullable(), '记录（未命中为 null）') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { value } = c.req.valid('query');
    return c.json(okBody(await fetchDataSourceRecord(id, value)), 200);
  },
});

// ─── GET /{id} — 详情 ────────────────────────────────────────────────────
const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['远程数据源'], summary: '数据源详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:datasource:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowDataSourceDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getDataSource(id)), 200);
  },
});

// ─── POST / — 创建 ────────────────────────────────────────────────────────
const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['远程数据源'], summary: '创建数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:datasource:create', audit: { description: '创建远程数据源', module: '远程数据源' } })] as const,
    request: { body: { content: jsonContent(createWorkflowDataSourceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowDataSourceDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDataSource(c.req.valid('json')), '创建成功'), 200),
});

// ─── PUT /{id} — 更新 ────────────────────────────────────────────────────
const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['远程数据源'], summary: '更新数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:datasource:update', audit: { description: '更新远程数据源', module: '远程数据源' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowDataSourceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowDataSourceDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDataSourceExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateDataSource(id, c.req.valid('json')), '更新成功'), 200);
  },
});

// ─── DELETE /{id} — 删除 ──────────────────────────────────────────────────
const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['远程数据源'], summary: '删除数据源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:datasource:delete', audit: { description: '删除远程数据源', module: '远程数据源' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDataSourceExists(id);
    setAuditBeforeData(c, before);
    await deleteDataSource(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, optionsRoute, recordRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
