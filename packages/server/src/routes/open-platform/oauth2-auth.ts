/**
 * OAuth2 标准端点
 *   GET  /api/oauth2/authorize/info  — 查询应用信息（用于前端同意页面）
 *   POST /api/oauth2/authorize       — 用户确认授权
 *   POST /api/oauth2/token           — 令牌端点（application/x-www-form-urlencoded，RFC 6749）
 *   POST /api/oauth2/token/revoke    — 令牌撤销（RFC 7009）
 *   POST /api/oauth2/token/introspect — 令牌自省（RFC 7662）
 *   GET  /api/oauth2/userinfo        — UserInfo（OIDC Core）
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../../middleware/auth';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okBody,
} from '../../lib/openapi-schemas';
import {
  OAuth2AuthorizeInfoDTO,
  OAuth2TokenResponseDTO,
  OAuth2UserInfoDTO,
  OAuth2IntrospectResponseDTO,
} from '../../lib/openapi-dtos';
import {
  getAuthorizeInfo,
  createAuthorizationCode,
  exchangeCodeForToken,
  clientCredentialsToken,
  refreshAccessToken,
  revokeTokenByValue,
  introspectToken,
  getUserInfoByToken,
} from '../../services/open-platform/oauth2-auth.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 查询应用信息（供同意页面展示）────────────────────────────────────────────

const AuthorizeInfoQuery = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  response_type: z.string(),
  scope: z.string(),
  state: z.string().optional(),
});

const authorizeInfo = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/authorize/info',
    tags: ['OAuth2'],
    summary: '获取 OAuth2 应用授权信息（供同意页面展示）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: AuthorizeInfoQuery },
    responses: { ...commonErrorResponses, ...ok(OAuth2AuthorizeInfoDTO, '应用信息') },
  }),
  handler: async (c) => {
    const { client_id, redirect_uri, response_type, scope } = c.req.valid('query');
    return c.json(okBody(await getAuthorizeInfo({ clientId: client_id, redirectUri: redirect_uri, responseType: response_type, scope })), 200);
  },
});

// ─── 用户确认授权（POST /authorize）──────────────────────────────────────────

const AuthorizeBody = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  response_type: z.literal('code'),
  scope: z.string(),
  state: z.string().optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
});

const AuthorizeResponseDTO = z.object({ redirectUrl: z.string() }).openapi('OAuth2AuthorizeResponse');

const authorize = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/authorize',
    tags: ['OAuth2'],
    summary: '用户确认授权（OAuth 2.1 授权码模式）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(AuthorizeBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(AuthorizeResponseDTO, '授权成功，返回跳转 URL') },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const result = await createAuthorizationCode({
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      responseType: body.response_type,
      scope: body.scope,
      state: body.state,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
    });
    return c.json(okBody(result), 200);
  },
});

// ─── 令牌端点（application/x-www-form-urlencoded，RFC 6749）──────────────────

const token = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/token',
    tags: ['OAuth2'],
    summary: '令牌端点（RFC 6749 application/x-www-form-urlencoded）',
    // 公开端点：无 security / middleware
    responses: {
      200: {
        description: '令牌响应',
        content: { 'application/json': { schema: OAuth2TokenResponseDTO } },
      },
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    const grantType = body['grant_type'] as string;

    if (grantType === 'authorization_code') {
      const result = await exchangeCodeForToken({
        code: body['code'] as string,
        redirectUri: body['redirect_uri'] as string,
        clientId: body['client_id'] as string,
        clientSecret: body['client_secret'] as string | undefined,
        codeVerifier: body['code_verifier'] as string | undefined,
      });
      return c.json(result, 200);
    }

    if (grantType === 'client_credentials') {
      const result = await clientCredentialsToken({
        clientId: body['client_id'] as string,
        clientSecret: body['client_secret'] as string,
        scope: (body['scope'] as string) ?? '',
      });
      return c.json(result, 200);
    }

    if (grantType === 'refresh_token') {
      const result = await refreshAccessToken({
        refreshToken: body['refresh_token'] as string,
        clientId: body['client_id'] as string,
        clientSecret: body['client_secret'] as string | undefined,
      });
      return c.json(result, 200);
    }

    throw new HTTPException(400, { message: 'unsupported_grant_type' });
  },
});

// ─── 令牌撤销（RFC 7009）──────────────────────────────────────────────────────

const revoke = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/token/revoke',
    tags: ['OAuth2'],
    summary: '撤销令牌（RFC 7009）',
    responses: { ...commonErrorResponses, ...okMsg('已撤销') },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    await revokeTokenByValue(
      body['token'] as string,
      body['client_id'] as string,
      body['client_secret'] as string | undefined,
    );
    return c.json(okBody(null), 200);
  },
});

// ─── 令牌自省（RFC 7662）──────────────────────────────────────────────────────

const introspect = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/token/introspect',
    tags: ['OAuth2'],
    summary: '令牌自省（RFC 7662）',
    responses: { ...commonErrorResponses, ...ok(OAuth2IntrospectResponseDTO, '自省结果') },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    return c.json(okBody(await introspectToken(
      body['token'] as string,
      body['client_id'] as string,
      body['client_secret'] as string,
    )), 200);
  },
});

// ─── UserInfo（OIDC Core）────────────────────────────────────────────────────

const userinfo = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/userinfo',
    tags: ['OAuth2'],
    summary: '获取用户信息（需要 Authorization: Bearer <access_token>）',
    security: [{ BearerAuth: [] }],
    responses: { ...commonErrorResponses, ...ok(OAuth2UserInfoDTO, '用户信息') },
  }),
  handler: async (c) => {
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new HTTPException(401, { message: 'missing token' });
    return c.json(okBody(await getUserInfoByToken(token)), 200);
  },
});

router.openapiRoutes([authorizeInfo, authorize, token, revoke, introspect, userinfo] as const);

export default router;
