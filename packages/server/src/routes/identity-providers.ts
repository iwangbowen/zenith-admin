import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery,
  IdParam,
  commonErrorResponses,
  jsonContent,
  ok,
  okBody,
  okMsg,
  okPaginated,
  validationHook,
} from '../lib/openapi-schemas';
import {
  TenantIdentityProviderDTO,
} from '../lib/openapi-dtos';
import {
  createTenantIdentityProviderSchema,
  updateTenantIdentityProviderSchema,
} from '@zenith/shared/validation';
import {
  createIdentityProvider,
  deleteIdentityProvider,
  getIdentityProvider,
  getIdentityProviderBeforeAudit,
  listIdentityProviders,
  updateIdentityProvider,
} from '../services/identity-providers.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const permission = 'system:identity-provider:manage';

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['IdentityProviders'],
    summary: '企业身份源列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        tenantId: z.coerce.number().int().positive().optional(),
        type: z.enum(['oidc', 'saml']).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...okPaginated(TenantIdentityProviderDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listIdentityProviders(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['IdentityProviders'],
    summary: '企业身份源详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission })] as const,
    request: { params: IdParam },
    responses: { ...ok(TenantIdentityProviderDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getIdentityProvider(id)), 200);
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['IdentityProviders'],
    summary: '创建企业身份源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission, audit: { module: '企业身份源', description: '创建企业身份源' } })] as const,
    request: { body: { content: jsonContent(createTenantIdentityProviderSchema), required: true } },
    responses: { ...ok(TenantIdentityProviderDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createIdentityProvider(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['IdentityProviders'],
    summary: '更新企业身份源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission, audit: { module: '企业身份源', description: '更新企业身份源' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateTenantIdentityProviderSchema), required: true } },
    responses: { ...ok(TenantIdentityProviderDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getIdentityProviderBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateIdentityProvider(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['IdentityProviders'],
    summary: '删除企业身份源',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission, audit: { module: '企业身份源', description: '删除企业身份源' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getIdentityProviderBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteIdentityProvider(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
