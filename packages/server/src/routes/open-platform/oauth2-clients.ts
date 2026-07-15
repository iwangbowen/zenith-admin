import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
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
} from '../../lib/openapi-schemas';
import {
  OAuth2ClientListItemDTO,
  OAuth2ClientCreatedDTO,
  OAuth2ClientSecretDTO,
  OAuth2TokenListItemDTO,
  OAuth2AppOptionDTO,
  OAuth2UserGrantDTO,
} from '../../lib/openapi-dtos';
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
  listAppOptions,
  listClientGrants,
  reviewOAuth2Client,
} from '../../services/open-platform/oauth2-clients.service';
import { createOAuth2ClientSchema, updateOAuth2ClientSchema } from '@zenith/shared';
import { notifyAppReviewResult } from '../../services/open-platform/developer-apps.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 公共 schema ──────────────────────────────────────────────────────────────

const ClientKeywordQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  environment: z.enum(['production', 'sandbox']).optional(),
  reviewStatus: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
});

const TokenListQuery = PaginationQuery.extend({
  clientId: z.string(),
});

const GrantListQuery = PaginationQuery;

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
    const { page, pageSize, keyword, environment, reviewStatus } = c.req.valid('query');
    return c.json(okBody(await listOAuth2Clients({ page, pageSize, keyword, environment, reviewStatus })), 200);
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
    request: { body: { content: jsonContent(createOAuth2ClientSchema), required: true } },
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

const grants = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/grants',
    tags: ['OAuth2Apps'],
    summary: '获取应用的用户授权记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth2-apps:view' })] as const,
    request: { params: IdParam, query: GrantListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(OAuth2UserGrantDTO, '用户授权记录') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    const client = await getOAuth2Client(id);
    return c.json(okBody(await listClientGrants(client.clientId, { page, pageSize })), 200);
  },
});

const review = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/review',
    tags: ['OAuth2Apps'],
    summary: '审核开发者应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:oauth2-apps:manage',
      audit: { description: '审核 OAuth2 应用', module: 'OAuth2 应用' },
    })] as const,
    request: {
      params: IdParam,
      body: {
        content: jsonContent(z.object({
          action: z.enum(['approve', 'reject']),
          comment: z.string().max(500).optional(),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientListItemDTO, '审核完成') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    const result = await reviewOAuth2Client(id, c.req.valid('json'));
    await notifyAppReviewResult(id);
    setAuditAfterData(c, result);
    return c.json(okBody(result, '审核完成'), 200);
  },
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
    request: { params: IdParam, body: { content: jsonContent(updateOAuth2ClientSchema), required: true } },
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

const options = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/options',
    tags: ['OAuth2Apps'],
    summary: '获取启用应用的选项列表（供 Webhook/SDK 下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(OAuth2AppOptionDTO), '应用选项列表') },
  }),
  handler: async (c) => c.json(okBody(await listAppOptions()), 200),
});

router.openapiRoutes([
  list, options, tokens, revokeTokenRoute,
  create, grants, review, detail, update, remove, regenerateSecret,
] as const);

export default router;
