/**
 * OAuth2 标准端点
 *   authorize/info  — 查询应用信息（用于前端同意页面）
 *   authorize       — 用户确认授权
 *   token           — 令牌端点（application/x-www-form-urlencoded，RFC 6749）
 *   token/revoke    — 令牌撤销（RFC 7009）
 *   token/introspect — 令牌自省（RFC 7662）
 *   userinfo        — UserInfo（OIDC Core）
 *
 * 前两个走业务信封，由契约定义；后四个是 RFC 协议端点（表单入参 + 顶层响应，无业务信封），
 * 契约 DSL 不表达，保持 createRoute 声明。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { oauth2AuthContract, oauth2IntrospectResponseSchema, oauth2TokenResponseSchema, oauth2UserInfoSchema } from '@zenith/shared/open-platform';
import { OAuth2Error } from '../../lib/oauth2-error';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import {
  validationHook,
  commonErrorResponses,
  okBody,
} from '../../lib/openapi-schemas';
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

const authorizeInfo = defineContractRoute(oauth2AuthContract.authorizeInfo, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { client_id, redirect_uri, response_type, scope } = c.req.valid('query');
    return c.json(okBody(await getAuthorizeInfo({ clientId: client_id, redirectUri: redirect_uri, responseType: response_type, scope })), 200);
  },
});

// ─── 用户确认授权 ────────────────────────────────────────────────────────────

const authorize = defineContractRoute(oauth2AuthContract.authorize, {
  middleware: [authMiddleware],
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
    // 公开端点：覆盖 app.ts 注册的全局 BearerAuth 默认值
    security: [],
    responses: {
      200: {
        description: '令牌响应',
        content: { 'application/json': { schema: oauth2TokenResponseSchema } },
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

    throw new OAuth2Error('unsupported_grant_type', `不支持的 grant_type：${grantType || '(空)'}`);
  },
});

// ─── 令牌撤销（RFC 7009）──────────────────────────────────────────────────────

const revoke = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/token/revoke',
    tags: ['OAuth2'],
    summary: '撤销令牌（RFC 7009）',
    security: [],
    responses: {
      200: { description: '已撤销（RFC 7009 规定始终 200，无业务信封）', content: { 'application/json': { schema: z.object({}).openapi('OAuth2RevokeResponse') } } },
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    await revokeTokenByValue(
      body['token'] as string,
      body['client_id'] as string,
      body['client_secret'] as string | undefined,
    );
    return c.json({}, 200);
  },
});

// ─── 令牌自省（RFC 7662）──────────────────────────────────────────────────────

const introspect = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/token/introspect',
    tags: ['OAuth2'],
    summary: '令牌自省（RFC 7662）',
    security: [],
    responses: {
      200: { description: '自省结果（RFC 7662 顶层格式，无业务信封）', content: { 'application/json': { schema: oauth2IntrospectResponseSchema } } },
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    return c.json(await introspectToken(
      body['token'] as string,
      body['client_id'] as string,
      body['client_secret'] as string,
    ), 200);
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
    responses: {
      200: { description: '用户信息（OIDC 标准 claims 顶层格式，无业务信封）', content: { 'application/json': { schema: oauth2UserInfoSchema } } },
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new HTTPException(401, { message: 'missing token' });
    return c.json(await getUserInfoByToken(token), 200);
  },
});

router.openapiRoutes([authorizeInfo, authorize, token, revoke, introspect, userinfo] as const);

export default router;
