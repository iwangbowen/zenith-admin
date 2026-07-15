import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createDeveloperOAuth2ClientSchema, updateDeveloperOAuth2ClientSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import {
  commonErrorResponses,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okMsg,
  okPaginated,
  PaginationQuery,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  OAuth2ClientCreatedDTO,
  OAuth2ClientListItemDTO,
  OAuth2ClientSecretDTO,
  OpenApiDebugResultDTO,
  OpenAppQuotaUsageDTO,
} from '../../lib/openapi-dtos';
import {
  createMyOAuth2Client,
  deleteMyOAuth2Client,
  getMyOAuth2Client,
  getMyOAuth2ClientQuotaUsage,
  listMyOAuth2Clients,
  regenerateMyOAuth2ClientSecret,
  submitMyOAuth2ClientForReview,
  updateMyOAuth2Client,
} from '../../services/open-platform/developer-apps.service';
import { executeOpenApiDebugRequest } from '../../services/open-platform/open-api-debug.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const audit = (description: string) => guard({
  audit: { description, module: '开放平台-开发者中心', recordResponseBody: false },
});

const ListQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  environment: z.enum(['production', 'sandbox']).optional(),
  reviewStatus: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['DeveloperApps'], summary: '获取我的开放平台应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(OAuth2ClientListItemDTO, '我的应用列表') },
  }),
  handler: async (c) => c.json(okBody(await listMyOAuth2Clients(c.req.valid('query'))), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['DeveloperApps'], summary: '创建我的开放平台应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, audit('创建开发者应用')] as const,
    request: { body: { content: jsonContent(createDeveloperOAuth2ClientSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientCreatedDTO, '创建成功') },
  }),
  handler: async (c) => {
    const result = await createMyOAuth2Client(c.req.valid('json'));
    setAuditAfterData(c, { ...result, clientSecret: result.clientSecret ? '[REDACTED]' : '' });
    return c.json(okBody(result, '应用已保存为草稿，请保存密钥后提交审核'), 200);
  },
});

const detail = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['DeveloperApps'], summary: '获取我的应用详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientListItemDTO, '应用详情') },
  }),
  handler: async (c) => c.json(okBody(await getMyOAuth2Client(c.req.valid('param').id)), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['DeveloperApps'], summary: '更新我的开放平台应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, audit('更新开发者应用')] as const,
    request: { params: IdParam, body: { content: jsonContent(updateDeveloperOAuth2ClientSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientListItemDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMyOAuth2Client(id));
    const result = await updateMyOAuth2Client(id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '更新成功，应用已回到草稿状态'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['DeveloperApps'], summary: '删除我的开放平台应用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, audit('删除开发者应用')] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMyOAuth2Client(id));
    await deleteMyOAuth2Client(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const regenerate = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/regenerate-secret', tags: ['DeveloperApps'], summary: '轮换我的应用密钥',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, audit('轮换开发者应用密钥')] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientSecretDTO, '轮换成功') },
  }),
  handler: async (c) => {
    const result = await regenerateMyOAuth2ClientSecret(c.req.valid('param').id);
    setAuditAfterData(c, {
      clientId: result.clientId,
      clientSecret: '[REDACTED]',
      previousValidUntil: result.previousValidUntil,
    });
    return c.json(okBody(result, '密钥轮换成功'), 200);
  },
});

const submit = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/submit', tags: ['DeveloperApps'], summary: '提交应用审核',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, audit('提交开发者应用审核')] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(OAuth2ClientListItemDTO, '已提交审核') },
  }),
  handler: async (c) => c.json(okBody(await submitMyOAuth2ClientForReview(c.req.valid('param').id), '已提交审核'), 200),
});

const quotaUsage = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/quota-usage', tags: ['DeveloperApps'], summary: '获取应用实时配额用量',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(OpenAppQuotaUsageDTO, '配额用量') },
  }),
  handler: async (c) => c.json(okBody(await getMyOAuth2ClientQuotaUsage(c.req.valid('param').id)), 200),
});

const debugRequest = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/debug', tags: ['DeveloperApps'], summary: '在线调试开放 API',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, audit('在线调试开放 API')] as const,
    request: {
      params: IdParam,
      body: {
        content: jsonContent(z.object({
          method: z.enum(['GET', 'POST']),
          path: z.enum(['/api/open/v1/ping', '/api/open/v1/echo', '/api/open/v1/userinfo']),
          query: z.record(z.string(), z.string()).optional(),
          body: z.unknown().optional(),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(OpenApiDebugResultDTO, '调试结果') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await executeOpenApiDebugRequest(id, c.req.valid('json'))), 200);
  },
});

router.openapiRoutes([
  list, create, submit, regenerate, quotaUsage, debugRequest, detail, update, remove,
] as const);

export default router;
