import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okPaginated,
  IdParam,
  PaginationQuery,
  BatchIdsBody,
  okBody,
} from '../lib/openapi-schemas';
import { ApiScopeDTO } from '../lib/openapi-dtos';
import { createApiScopeSchema, updateApiScopeSchema } from '@zenith/shared';
import {
  listApiScopes,
  listEnabledApiScopes,
  getApiScope,
  getApiScopeBeforeAudit,
  createApiScope,
  updateApiScope,
  deleteApiScope,
  batchDeleteApiScopes,
} from '../services/api-scopes.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ListQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  scopeGroup: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['ApiScopes'],
    summary: '获取 API Scope 列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:scope:view' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ApiScopeDTO, 'API Scope 列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, keyword, scopeGroup, status } = c.req.valid('query');
    return c.json(okBody(await listApiScopes({ page, pageSize, keyword, scopeGroup, status })), 200);
  },
});

const options = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/options',
    tags: ['ApiScopes'],
    summary: '获取全部启用的 Scope（供应用配置下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ApiScopeDTO), '启用的 Scope 列表') },
  }),
  handler: async (c) => c.json(okBody(await listEnabledApiScopes()), 200),
});

const detail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['ApiScopes'],
    summary: '获取 API Scope 详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'open:scope:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ApiScopeDTO, 'API Scope 详情') },
  }),
  handler: async (c) => c.json(okBody(await getApiScope(c.req.valid('param').id)), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['ApiScopes'],
    summary: '创建 API Scope',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:scope:manage',
      audit: { description: '创建 API Scope', module: '开放平台-API Scope' },
    })] as const,
    request: { body: { content: jsonContent(createApiScopeSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ApiScopeDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createApiScope(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['ApiScopes'],
    summary: '更新 API Scope',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:scope:manage',
      audit: { description: '更新 API Scope', module: '开放平台-API Scope' },
    })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateApiScopeSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ApiScopeDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApiScopeBeforeAudit(id));
    return c.json(okBody(await updateApiScope(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const batchDelete = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/batch',
    tags: ['ApiScopes'],
    summary: '批量删除 API Scope',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:scope:manage',
      audit: { description: '批量删除 API Scope', module: '开放平台-API Scope' },
    })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('批量删除成功') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const n = await batchDeleteApiScopes(ids);
    return c.json(okBody(null, `已删除 ${n} 条记录`), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['ApiScopes'],
    summary: '删除 API Scope',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'open:scope:manage',
      audit: { description: '删除 API Scope', module: '开放平台-API Scope' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApiScopeBeforeAudit(id));
    await deleteApiScope(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, options, detail, create, update, batchDelete, remove] as const);

export default router;
