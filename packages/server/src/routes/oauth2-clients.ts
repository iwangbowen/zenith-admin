import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okPaginated,
  IdParam,
  PaginationQuery,
  okBody,
} from '../lib/openapi-schemas';
import {
  OAuth2ClientListItemDTO,
  OAuth2ClientCreatedDTO,
  OAuth2ClientSecretDTO,
  OAuth2TokenListItemDTO,
} from '../lib/openapi-dtos';
import {
  listOAuth2Clients,
  createOAuth2Client,
  getOAuth2Client,
  updateOAuth2Client,
  deleteOAuth2Client,
  regenerateOAuth2ClientSecret,
  listClientTokens,
  revokeToken,
  getOAuth2ClientBeforeAudit,
  getOAuth2TokenBeforeAudit,
} from '../services/oauth2-clients.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 公共 schema ──────────────────────────────────────────────────────────────

const ClientBody = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  logoUrl: z.string().regex(/^https?:\/\/.+/).optional(),
  redirectUris: z.array(z.string().min(1)).min(1),
  allowedScopes: z.array(z.string()).min(1),
  grantTypes: z.array(z.string()).min(1),
  isPublic: z.boolean(),
  ratePlanId: z.number().int().positive().nullable().optional(),
  signEnabled: z.boolean().optional(),
});

const UpdateClientBody = ClientBody.partial().extend({
  status: z.enum(['enabled', 'disabled']).optional(),
});

const ClientKeywordQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
});

const TokenListQuery = PaginationQuery.extend({
  clientId: z.string(),
});

// ─── 路由定义 ─────────────────────────────────────────────────────────────────

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['OAuth2Apps'],
    summary: '获取 OAuth2 应用列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth2-apps:view' })] as const,
    request: { query: ClientKeywordQuery },
    responses: { ...commonErrorResponses, ...okPaginated(OAuth2ClientListItemDTO, 'OAuth2 应用列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, keyword } = c.req.valid('query');
    return c.json(okBody(await listOAuth2Clients({ page, pageSize, keyword })), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['OAuth2Apps'],
    summary: '创建 OAuth2 应用（clientSecret 仅在此返回一次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:oauth2-apps:manage',
      audit: { description: '创建 OAuth2 应用', module: 'OAuth2 应用', recordResponseBody: false },
    })] as const,
    request: { body: { content: jsonContent(ClientBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientCreatedDTO, '创建成功') },
  }),
  handler: async (c) => {
    const created = await createOAuth2Client(c.req.valid('json'));
    setAuditAfterData(c, { ...created, clientSecret: created.clientSecret ? '[REDACTED]' : '' });
    return c.json(okBody(created, '应用已创建，client_secret 仅返回一次，请妥善保存'), 200);
  },
});

const detail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['OAuth2Apps'],
    summary: '获取 OAuth2 应用详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth2-apps:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientListItemDTO, '应用详情') },
  }),
  handler: async (c) => c.json(okBody(await getOAuth2Client(c.req.valid('param').id)), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['OAuth2Apps'],
    summary: '更新 OAuth2 应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:oauth2-apps:manage',
      audit: { description: '更新 OAuth2 应用', module: 'OAuth2 应用' },
    })] as const,
    request: { params: IdParam, body: { content: jsonContent(UpdateClientBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientListItemDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    return c.json(okBody(await updateOAuth2Client(id, c.req.valid('json'))), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['OAuth2Apps'],
    summary: '删除 OAuth2 应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:oauth2-apps:manage',
      audit: { description: '删除 OAuth2 应用', module: 'OAuth2 应用' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    await deleteOAuth2Client(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const regenerateSecret = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/regenerate-secret',
    tags: ['OAuth2Apps'],
    summary: '重置 OAuth2 应用的 client_secret（仅返回一次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:oauth2-apps:manage',
      audit: { description: '重置 OAuth2 应用密钥', module: 'OAuth2 应用', recordResponseBody: false },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientSecretDTO, '重置成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    const result = await regenerateOAuth2ClientSecret(id);
    setAuditAfterData(c, { clientId: result.clientId, clientSecret: '[REDACTED]' });
    return c.json(okBody(result, '新 secret 仅返回一次，请妥善保存'), 200);
  },
});

const tokens = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/tokens',
    tags: ['OAuth2Apps'],
    summary: '获取应用令牌列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth2-apps:view' })] as const,
    request: { query: TokenListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(OAuth2TokenListItemDTO, '令牌列表') },
  }),
  handler: async (c) => {
    const { clientId, page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listClientTokens(clientId, { page, pageSize })), 200);
  },
});

const revokeTokenRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/tokens/{id}',
    tags: ['OAuth2Apps'],
    summary: '撤销令牌',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:oauth2-apps:manage',
      audit: { description: '撤销 OAuth2 令牌', module: 'OAuth2 应用' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('令牌已撤销') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2TokenBeforeAudit(id));
    await revokeToken(id);
    return c.json(okBody(null, '令牌已撤销'), 200);
  },
});

router.openapiRoutes([list, create, detail, update, remove, regenerateSecret, tokens, revokeTokenRoute] as const);

export default router;
