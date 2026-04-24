import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { ApiTokenListItemDTO, ApiTokenCreatedDTO } from '../lib/openapi-dtos';
import { listApiTokens, createApiToken, deleteApiToken } from '../services/api-tokens.service';

const apiTokensRoute = new OpenAPIHono({ defaultHook: validationHook });

const CreateTokenBody = z.object({ name: z.string(), expiresAt: z.string().optional() });

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['ApiTokens'], summary: '获取我的 API Token 列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ApiTokenListItemDTO), 'Token 列表') },
  }),
  handler: async (c) => c.json(okBody(await listApiTokens()), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['ApiTokens'], summary: '创建 API Token（完整 token 仅返回一次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(CreateTokenBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(ApiTokenCreatedDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createApiToken(c.req.valid('json')), 'Token 已创建，请务必复制保存，此后将无法再次查看完整 Token'), 200),
});

const deleteToken = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['ApiTokens'], summary: '撤销 API Token',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('Token 已撤销') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteApiToken(id);
    return c.json(okBody(null, 'Token 已撤销'), 200);
  },
});

apiTokensRoute.openapiRoutes([list, create, deleteToken] as const);

export default apiTokensRoute;
