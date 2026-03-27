import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { UAParser } from 'ua-parser-js';
import { db } from '../db';
import { users, userRoles, roles, userOauthAccounts } from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { getOAuthProvider, isProviderConfigured } from '../lib/oauth';
import { generateTokenId, registerSession } from '../lib/session-manager';
import type { OAuthProviderType } from '@zenith/shared';
import { OAUTH_PROVIDERS } from '@zenith/shared';

const oauth = new Hono<{ Variables: { user: JwtPayload } }>();

const VALID_PROVIDERS = new Set<string>(OAUTH_PROVIDERS);

function isValidProvider(p: string | undefined): p is OAuthProviderType {
  return !!p && VALID_PROVIDERS.has(p);
}

async function getUserRoles(userId: number) {
  const rows = await db
    .select({ id: roles.id, name: roles.name, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows;
}

function issueTokens(user: { id: number; username: string }, roleCodes: string[]) {
  const tokenId = generateTokenId();
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, roles: roleCodes, jti: tokenId } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: '2h' },
  );
  const refreshToken = jwt.sign(
    { userId: user.id, username: user.username, type: 'refresh', jti: tokenId },
    config.jwtSecret,
    { expiresIn: '30d' },
  );
  return { accessToken, refreshToken, tokenId };
}

// ─── 获取当前用户绑定的 OAuth 账号列表 ──────────────────────────────────
oauth.get('/accounts', authMiddleware, async (c) => {
  const payload = c.get('user') as JwtPayload;
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

  return c.json({
    code: 0,
    message: 'ok',
    data: accounts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
});

// ─── 获取 OAuth 授权链接 ─────────────────────────────────────────────────
oauth.get('/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (!isValidProvider(provider)) {
    return c.json({ code: 400, message: '不支持的 OAuth 提供方', data: null }, 400);
  }
  if (!(await isProviderConfigured(provider))) {
    return c.json({ code: 400, message: '该 OAuth 提供方尚未配置，请联系管理员', data: null }, 400);
  }
  const state = crypto.randomBytes(16).toString('hex');
  const oauthProvider = await getOAuthProvider(provider);
  const authUrl = oauthProvider.getAuthUrl(state);
  return c.json({ code: 0, message: 'ok', data: { authUrl, state } });
});

// ─── OAuth 回调 → 登录或创建邮箱匹配用户 ──────────────────────────────────
oauth.post('/:provider/callback', async (c) => {
  const provider = c.req.param('provider');
  if (!isValidProvider(provider)) {
    return c.json({ code: 400, message: '不支持的 OAuth 提供方', data: null }, 400);
  }
  if (!(await isProviderConfigured(provider))) {
    return c.json({ code: 400, message: '该 OAuth 提供方尚未配置', data: null }, 400);
  }

  const body = await c.req.json();
  const code = body.code as string | undefined;
  if (!code) {
    return c.json({ code: 400, message: '缺少授权码', data: null }, 400);
  }

  const oauthProvider = await getOAuthProvider(provider);
  const tokenResult = await oauthProvider.getToken(code);
  const userInfo = await oauthProvider.getUserInfo(tokenResult);

  // 查找是否已绑定
  const [existingBind] = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.provider, provider), eq(userOauthAccounts.openId, userInfo.openId)))
    .limit(1);

  let userId: number;

  if (existingBind) {
    userId = existingBind.userId;
    // 更新 token 信息
    await db
      .update(userOauthAccounts)
      .set({
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken || null,
        expiresAt: tokenResult.expiresIn ? new Date(Date.now() + tokenResult.expiresIn * 1000) : null,
        nickname: userInfo.nickname,
        avatar: userInfo.avatar || null,
        updatedAt: new Date(),
      })
      .where(eq(userOauthAccounts.id, existingBind.id));
  } else {
    // 尝试通过邮箱自动匹配
    if (userInfo.email) {
      const [emailUser] = await db.select().from(users).where(eq(users.email, userInfo.email)).limit(1);
      if (emailUser) {
        userId = emailUser.id;
        // 自动绑定
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
      } else {
        return c.json({ code: 404, message: '未找到匹配账号，请先绑定', data: { needBind: true, oauthInfo: { provider, openId: userInfo.openId, nickname: userInfo.nickname, avatar: userInfo.avatar } } }, 200);
      }
    } else {
      return c.json({ code: 404, message: '未找到匹配账号，请先绑定', data: { needBind: true, oauthInfo: { provider, openId: userInfo.openId, nickname: userInfo.nickname, avatar: userInfo.avatar } } }, 200);
    }
  }

  // 检查用户状态
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status === 'disabled') {
    return c.json({ code: 403, message: '账号已被禁用', data: null }, 403);
  }

  const userRoleList = await getUserRoles(user.id);
  const roleCodes = userRoleList.map((r) => r.code);
  const { accessToken, refreshToken, tokenId } = issueTokens(user, roleCodes);

  // 注册 session
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
  return c.json({
    code: 0,
    message: '登录成功',
    data: {
      user: { ...userInfoClean, roles: userRoleList, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
      token: { accessToken, refreshToken },
    },
  });
});

// ─── 绑定 OAuth 账号到当前用户 ──────────────────────────────────────────
oauth.post('/bind', authMiddleware, async (c) => {
  const payload = c.get('user') as JwtPayload;
  const body = await c.req.json();
  const { provider, code } = body as { provider: string; code: string };
  if (!provider || !code) {
    return c.json({ code: 400, message: '缺少参数', data: null }, 400);
  }
  if (!isValidProvider(provider)) {
    return c.json({ code: 400, message: '不支持的 OAuth 提供方', data: null }, 400);
  }

  const oauthProvider = await getOAuthProvider(provider);
  const tokenResult = await oauthProvider.getToken(code);
  const userInfo = await oauthProvider.getUserInfo(tokenResult);

  // 检查是否已被其他用户绑定
  const [existing] = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.provider, provider), eq(userOauthAccounts.openId, userInfo.openId)))
    .limit(1);

  if (existing) {
    if (existing.userId === payload.userId) {
      return c.json({ code: 400, message: '该账号已绑定', data: null }, 400);
    }
    return c.json({ code: 400, message: '该第三方账号已被其他用户绑定', data: null }, 400);
  }

  // 检查当前用户是否已绑定同类型
  const [myBind] = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.userId, payload.userId), eq(userOauthAccounts.provider, provider)))
    .limit(1);

  if (myBind) {
    return c.json({ code: 400, message: '您已绑定该类型账号，请先解绑', data: null }, 400);
  }

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

  return c.json({ code: 0, message: '绑定成功', data: null });
});

// ─── 解绑 OAuth 账号 ──────────────────────────────────────────────────
oauth.delete('/unbind/:provider', authMiddleware, async (c) => {
  const payload = c.get('user') as JwtPayload;
  const provider = c.req.param('provider');
  if (!isValidProvider(provider)) {
    return c.json({ code: 400, message: '不支持的 OAuth 提供方', data: null }, 400);
  }

  const result = await db
    .delete(userOauthAccounts)
    .where(and(eq(userOauthAccounts.userId, payload.userId), eq(userOauthAccounts.provider, provider)))
    .returning();

  if (result.length === 0) {
    return c.json({ code: 404, message: '未找到该绑定', data: null }, 404);
  }

  return c.json({ code: 0, message: '已解绑', data: null });
});

export default oauth;
