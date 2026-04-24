import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { UAParser } from 'ua-parser-js';
import { db } from '../db';
import { users, userOauthAccounts } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { signToken } from '../lib/jwt';
import { getOAuthProvider, isProviderConfigured } from '../lib/oauth';
import { generateTokenId, registerSession } from '../lib/session-manager';
import type { OAuthProviderType } from '@zenith/shared';
import { OAUTH_PROVIDERS } from '@zenith/shared';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okMsg, okBody, errBody } from '../lib/openapi-schemas';
import { OAuthAccountDTO, OAuthAuthUrlDTO, LoginResultDTO } from '../lib/openapi-dtos';

const oauth = new OpenAPIHono({ defaultHook: validationHook });

const VALID_PROVIDERS = new Set<string>(OAUTH_PROVIDERS);

function isValidProvider(p: string | undefined): p is OAuthProviderType {
  return !!p && VALID_PROVIDERS.has(p);
}

async function getUserRoles(userId: number) {
  const result = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {},
    with: { userRoles: { columns: {}, with: { role: true } } },
  });
  return (result?.userRoles ?? []).map(({ role: r }) => ({
    id: r.id, name: r.name, code: r.code, description: r.description,
    status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }));
}

async function issueTokens(user: { id: number; username: string }, roleCodes: string[]) {
  const tokenId = generateTokenId();
  const accessToken = await signToken<JwtPayload>(
    { userId: user.id, username: user.username, roles: roleCodes, tenantId: null, jti: tokenId },
    '2h',
  );
  const refreshToken = await signToken(
    { userId: user.id, username: user.username, type: 'refresh', jti: tokenId },
    '30d',
  );
  return { accessToken, refreshToken, tokenId };
}

const OAuthCallbackDTO = LoginResultDTO;

// GET /accounts
const accountsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/accounts',
    tags: ['OAuth'],
    summary: '当前用户绑定列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(OAuthAccountDTO), 'ok'),
    },
  }),
  handler: async (c) => {
    const payload = c.get('user');
    const accounts = await db
      .select({
        id: userOauthAccounts.id,
        provider: userOauthAccounts.provider,
        openId: userOauthAccounts.openId,
        nickname: userOauthAccounts.nickname,
        avatar: userOauthAccounts.avatar,
        createdAt: userOauthAccounts.createdAt,
      })
      .from(userOauthAccounts)
      .where(eq(userOauthAccounts.userId, payload.userId));
    return c.json(okBody(accounts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))), 200);
  },
});

// GET /{provider}
const authUrlRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{provider}',
    tags: ['OAuth'],
    summary: '获取授权链接',
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
    if (!isValidProvider(provider)) return c.json(errBody('不支持的 OAuth 提供方'), 400);
    if (!(await isProviderConfigured(provider))) return c.json(errBody('该 OAuth 提供方尚未配置，请联系管理员'), 400);
    const state = crypto.randomBytes(16).toString('hex');
    const oauthProvider = await getOAuthProvider(provider);
    const authUrl = oauthProvider.getAuthUrl(state);
    return c.json(okBody({ authUrl, state }), 200);
  },
});

// POST /{provider}/callback
const callbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{provider}/callback',
    tags: ['OAuth'],
    summary: 'OAuth 回调',
    security: [],
    request: {
      params: z.object({ provider: z.string().openapi({ param: { name: 'provider', in: 'path' }, example: 'github', description: 'OAuth 提供方' }) }),
      body: { content: jsonContent(z.object({ code: z.string() }).openapi('OAuthCallbackBody')), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(OAuthCallbackDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '账号已禁用' },
      404: { content: jsonContent(z.object({ code: z.number(), message: z.string(), data: z.looseObject({}) })), description: '未找到匹配账号' },
    },
  }),
  handler: async (c) => {
    const { provider } = c.req.valid('param');
    if (!isValidProvider(provider)) return c.json(errBody('不支持的 OAuth 提供方'), 400);
    if (!(await isProviderConfigured(provider))) return c.json(errBody('该 OAuth 提供方尚未配置'), 400);

    const { code } = c.req.valid('json');
    if (!code) return c.json(errBody('缺少授权码'), 400);

    const oauthProvider = await getOAuthProvider(provider);
    const tokenResult = await oauthProvider.getToken(code);
    const userInfo = await oauthProvider.getUserInfo(tokenResult);

    const [existingBind] = await db
      .select()
      .from(userOauthAccounts)
      .where(and(eq(userOauthAccounts.provider, provider), eq(userOauthAccounts.openId, userInfo.openId)))
      .limit(1);

    let userId: number;

    if (existingBind) {
      userId = existingBind.userId;
      await db
        .update(userOauthAccounts)
        .set({
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken || null,
          expiresAt: tokenResult.expiresIn ? new Date(Date.now() + tokenResult.expiresIn * 1000) : null,
          nickname: userInfo.nickname,
          avatar: userInfo.avatar || null,
        })
        .where(eq(userOauthAccounts.id, existingBind.id));
    } else {
      const emailUser = userInfo.email
        ? (await db.select().from(users).where(eq(users.email, userInfo.email)).limit(1))[0]
        : undefined;
      if (!emailUser) {
        return c.json({ code: 404, message: '未找到匹配账号，请先绑定', data: { needBind: true, oauthInfo: { provider, openId: userInfo.openId, nickname: userInfo.nickname, avatar: userInfo.avatar } } }, 404);
      }
      userId = emailUser.id;
      await db.insert(userOauthAccounts).values({
        userId,
        provider,
        openId: userInfo.openId,
        unionId: userInfo.unionId || null,
        nickname: userInfo.nickname,
        avatar: userInfo.avatar || null,
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken || null,
        expiresAt: tokenResult.expiresIn ? new Date(Date.now() + tokenResult.expiresIn * 1000) : null,
        raw: JSON.stringify(userInfo),
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.status === 'disabled') return c.json(errBody('账号已被禁用', 403), 403);

    const userRoleList = await getUserRoles(user.id);
    const roleCodes = userRoleList.map((r) => r.code);
    const { accessToken, refreshToken, tokenId } = await issueTokens(user, roleCodes);

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
    const ua = c.req.header('user-agent') || '';
    const parser = new UAParser(ua);
    const browserInfo = parser.getBrowser();
    const osInfo = parser.getOS();

    await registerSession({
      tokenId,
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      ip,
      browser: browserInfo.name ? `${browserInfo.name} ${browserInfo.version || ''}`.trim() : 'Unknown',
      os: osInfo.name ? `${osInfo.name} ${osInfo.version || ''}`.trim() : 'Unknown',
      loginAt: new Date(),
    });

    const { password: _, ...userInfoClean } = user;
    return c.json(okBody({
      user: { ...userInfoClean, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken, refreshToken },
    }, '登录成功'), 200);
  },
});

// POST /bind
const bindRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/bind',
    tags: ['OAuth'],
    summary: '绑定 OAuth 账号',
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
    const payload = c.get('user');
    const { provider, code } = c.req.valid('json');
    if (!provider || !code) return c.json(errBody('缺少参数'), 400);
    if (!isValidProvider(provider)) return c.json(errBody('不支持的 OAuth 提供方'), 400);

    const oauthProvider = await getOAuthProvider(provider);
    const tokenResult = await oauthProvider.getToken(code);
    const userInfo = await oauthProvider.getUserInfo(tokenResult);

    const [existing] = await db
      .select()
      .from(userOauthAccounts)
      .where(and(eq(userOauthAccounts.provider, provider), eq(userOauthAccounts.openId, userInfo.openId)))
      .limit(1);

    if (existing) {
      if (existing.userId === payload.userId) return c.json(errBody('该账号已绑定'), 400);
      return c.json(errBody('该第三方账号已被其他用户绑定'), 400);
    }

    const [myBind] = await db
      .select()
      .from(userOauthAccounts)
      .where(and(eq(userOauthAccounts.userId, payload.userId), eq(userOauthAccounts.provider, provider)))
      .limit(1);

    if (myBind) return c.json(errBody('您已绑定该类型账号，请先解绑'), 400);

    await db.insert(userOauthAccounts).values({
      userId: payload.userId,
      provider,
      openId: userInfo.openId,
      unionId: userInfo.unionId || null,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar || null,
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken || null,
      expiresAt: tokenResult.expiresIn ? new Date(Date.now() + tokenResult.expiresIn * 1000) : null,
      raw: JSON.stringify(userInfo),
    });

    return c.json(okBody(null, '绑定成功'), 200);
  },
});

// DELETE /unbind/{provider}
const unbindRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/unbind/{provider}',
    tags: ['OAuth'],
    summary: '解绑 OAuth 账号',
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
    const payload = c.get('user');
    const { provider } = c.req.valid('param');
    if (!isValidProvider(provider)) return c.json(errBody('不支持的 OAuth 提供方'), 400);
    const result = await db
      .delete(userOauthAccounts)
      .where(and(eq(userOauthAccounts.userId, payload.userId), eq(userOauthAccounts.provider, provider)))
      .returning();
    if (result.length === 0) return c.json(errBody('未找到该绑定', 404), 404);
    return c.json(okBody(null, '已解绑'), 200);
  },
});

oauth.openapiRoutes([accountsRoute, authUrlRoute, callbackRoute, bindRoute, unbindRoute] as const);

export default oauth;
