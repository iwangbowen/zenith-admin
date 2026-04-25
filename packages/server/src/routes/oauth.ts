import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okMsg, okBody } from '../lib/openapi-schemas';
import { OAuthAccountDTO, OAuthAuthUrlDTO, LoginResultDTO } from '../lib/openapi-dtos';
import { getClientInfo } from '../services/auth.service';
import {
  listOAuthAccounts, generateAuthUrl, handleOAuthCallback,
  bindOAuthAccount, unbindOAuthAccount,
} from '../services/oauth.service';

const oauth = new OpenAPIHono({ defaultHook: validationHook });

const accountsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/accounts', tags: ['OAuth'], summary: '当前用户绑定列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(OAuthAccountDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listOAuthAccounts()), 200),
});

const OAuthNeedBindDTO = z.object({
  needBind: z.literal(true),
  oauthInfo: z.object({
    provider: z.string(),
    openId: z.string(),
    nickname: z.string(),
    avatar: z.string().nullable().optional(),
  }),
});

const authUrlRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{provider}', tags: ['OAuth'], summary: '获取授权链接',
    security: [],
    request: { params: z.object({ provider: z.string().openapi({ param: { name: 'provider', in: 'path' }, example: 'github', description: 'OAuth 提供方' }) }) },
    responses: {
      ...commonErrorResponses,
      ...ok(OAuthAuthUrlDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { provider } = c.req.valid('param');
    return c.json(okBody(await generateAuthUrl(provider)), 200);
  },
});

const callbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{provider}/callback', tags: ['OAuth'], summary: 'OAuth 回调',
    security: [],
    request: {
      params: z.object({ provider: z.string().openapi({ param: { name: 'provider', in: 'path' }, example: 'github', description: 'OAuth 提供方' }) }),
      body: { content: jsonContent(z.object({ code: z.string() }).openapi('OAuthCallbackBody')), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.union([LoginResultDTO, OAuthNeedBindDTO]), 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '账号已禁用' },
    },
  }),
  handler: async (c) => {
    const { provider } = c.req.valid('param');
    const { code } = c.req.valid('json');
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    const result = await handleOAuthCallback(provider, code, { ip, ua });
    return c.json(okBody(result.data, result.message), 200);
  },
});

const bindRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/bind', tags: ['OAuth'], summary: '绑定 OAuth 账号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(z.object({ provider: z.string(), code: z.string() }).openapi('OAuthBindBody')), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { provider, code } = c.req.valid('json');
    await bindOAuthAccount(provider, code);
    return c.json(okBody(null, '绑定成功'), 200);
  },
});

const unbindRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/unbind/{provider}', tags: ['OAuth'], summary: '解绑 OAuth 账号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ provider: z.string().openapi({ param: { name: 'provider', in: 'path' }, example: 'github', description: 'OAuth 提供方' }) }) },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '未找到' },
    },
  }),
  handler: async (c) => {
    const { provider } = c.req.valid('param');
    await unbindOAuthAccount(provider);
    return c.json(okBody(null, '已解绑'), 200);
  },
});

oauth.openapiRoutes([accountsRoute, authUrlRoute, callbackRoute, bindRoute, unbindRoute] as const);

export default oauth;
