/**
 * OAuth2 授权服务（authorization_code + PKCE / client_credentials / refresh_token）
 * 令牌使用 opaque token（SHA256 哈希存储于 DB），支持精确撤销
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import {
  oauth2Clients,
  oauth2AuthorizationCodes,
  oauth2Tokens,
  oauth2UserGrants,
  users,
} from '../../db/schema';
import { currentUser } from '../../lib/context';
import { HTTPException } from 'hono/http-exception';

import { OAUTH2_TOKEN_EXPIRY } from '@zenith/shared';
import type { DbExecutor } from '../../db/types';

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function secretMatches(raw: string, expectedHash: string | null): boolean {
  if (!expectedHash || !/^[0-9a-f]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(sha256(raw), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function generateOpaqueToken(prefix: string): { raw: string; hash: string; tokenPrefix: string } {
  const raw = `${prefix}_${randomBytes(32).toString('hex')}`;
  const hash = sha256(raw);
  const tokenPrefix = `${raw.slice(0, 12)}...`;
  return { raw, hash, tokenPrefix };
}

/** PKCE S256 验证：base64url(sha256(codeVerifier)) === codeChallenge */
function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash('sha256').update(codeVerifier).digest('base64url');
  return digest === codeChallenge;
}

// ─── 辅助：校验客户端 ─────────────────────────────────────────────────────────

async function ensureClient(clientId: string) {
  const [row] = await db.select().from(oauth2Clients).where(eq(oauth2Clients.clientId, clientId));
  if (!row) throw new HTTPException(400, { message: 'invalid_client' });
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '应用已禁用' });
  return row;
}

async function ensureClientWithSecret(clientId: string, clientSecret: string) {
  const row = await ensureClient(clientId);
  if (row.isPublic) throw new HTTPException(400, { message: '公开客户端不使用 client_secret' });
  if (!secretMatches(clientSecret, row.clientSecretHash)) {
    throw new HTTPException(400, { message: 'invalid_client' });
  }
  return row;
}

// ─── 授权码端点：查询应用信息（GET /api/oauth2/authorize/info）──────────────

export async function getAuthorizeInfo(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  responseType: string;
}) {
  const { clientId, redirectUri, scope, responseType } = params;
  const client = await ensureClient(clientId);

  // 校验 redirect_uri
  const allowedRedirects: string[] = client.redirectUris ?? [];
  if (!allowedRedirects.includes(redirectUri)) {
    throw new HTTPException(400, { message: 'redirect_uri 不在允许列表中' });
  }

  // 校验 response_type
  if (responseType !== 'code') {
    throw new HTTPException(400, { message: 'unsupported_response_type：仅支持 code' });
  }
  if (!client.grantTypes?.includes('authorization_code')) {
    throw new HTTPException(400, { message: '该应用不支持 authorization_code 授权' });
  }

  const requestedScopes = scope.split(' ').filter(Boolean);
  const allowedScopes: string[] = client.allowedScopes ?? [];
  const invalidScopes = requestedScopes.filter((s) => !allowedScopes.includes(s));
  if (invalidScopes.length > 0) {
    throw new HTTPException(400, { message: `不支持的 scope：${invalidScopes.join(', ')}` });
  }

  // 检查当前用户是否已授权
  let alreadyGranted = false;
  try {
    const user = currentUser();
    const [grant] = await db.select().from(oauth2UserGrants).where(
      and(eq(oauth2UserGrants.userId, user.userId), eq(oauth2UserGrants.clientId, clientId)),
    );
    if (grant) {
      const grantedScopes: string[] = grant.scopes ?? [];
      alreadyGranted = requestedScopes.every((s) => grantedScopes.includes(s));
    }
  } catch {
    // currentUser() 抛异常说明未登录，视为 false
  }

  return {
    clientId: client.clientId,
    name: client.name,
    logoUrl: client.logoUrl,
    description: client.description,
    requestedScopes,
    alreadyGranted,
  };
}

// ─── 授权码端点：用户确认授权（POST /api/oauth2/authorize）────────────────────

export async function createAuthorizationCode(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  responseType: 'code';
}) {
  const user = currentUser();
  const { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, responseType } = params;
  const client = await ensureClient(clientId);
  if (responseType !== 'code') {
    throw new HTTPException(400, { message: 'unsupported_response_type：仅支持 code' });
  }

  // 校验 redirect_uri
  const allowedRedirects: string[] = client.redirectUris ?? [];
  if (!allowedRedirects.includes(redirectUri)) {
    throw new HTTPException(400, { message: 'redirect_uri 不在允许列表中' });
  }
  if (!client.grantTypes?.includes('authorization_code')) {
    throw new HTTPException(400, { message: '该应用不支持 authorization_code 授权' });
  }

  const requestedScopes = scope.split(' ').filter(Boolean);
  const invalidScopes = requestedScopes.filter((item) => !(client.allowedScopes ?? []).includes(item));
  if (invalidScopes.length > 0) {
    throw new HTTPException(400, { message: `不支持的 scope：${invalidScopes.join(', ')}` });
  }
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    throw new HTTPException(400, { message: '仅支持 PKCE S256' });
  }
  if (codeChallenge && !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new HTTPException(400, { message: 'code_challenge 格式无效' });
  }
  if (codeChallengeMethod && !codeChallenge) {
    throw new HTTPException(400, { message: 'code_challenge 必填' });
  }
  if (client.isPublic && !codeChallenge) {
    throw new HTTPException(400, { message: '公开客户端必须使用 PKCE S256' });
  }

  // 保存用户授权记录
  await db
    .insert(oauth2UserGrants)
    .values({ userId: user.userId, clientId, scopes: requestedScopes })
    .onConflictDoUpdate({
      target: [oauth2UserGrants.userId, oauth2UserGrants.clientId],
      set: { scopes: requestedScopes, updatedAt: new Date() },
    });

  // authorization_code flow
  const code = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + OAUTH2_TOKEN_EXPIRY.authorizationCode * 1000);
  await db.insert(oauth2AuthorizationCodes).values({
    codeHash: sha256(code),
    clientId,
    userId: user.userId,
    redirectUri,
    scopes: requestedScopes,
    codeChallenge: codeChallenge ?? null,
    codeChallengeMethod: codeChallenge ? 'S256' : null,
    expiresAt,
  });

  const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
  return { redirectUrl: `${redirectUri}?code=${code}${stateParam}` };
}

// ─── Token 端点（POST /api/oauth2/token）─────────────────────────────────────

async function issueTokenPair(executor: DbExecutor, opts: {
  clientId: string;
  userId: number | null;
  scopes: string[];
  includeRefresh: boolean;
}) {
  const { clientId, userId, scopes, includeRefresh } = opts;

  const accessTokenData = generateOpaqueToken('oat');
  const accessExpiresAt = new Date(Date.now() + OAUTH2_TOKEN_EXPIRY.accessToken * 1000);
  await executor.insert(oauth2Tokens).values({
    tokenType: 'access',
    tokenHash: accessTokenData.hash,
    tokenPrefix: accessTokenData.tokenPrefix,
    clientId,
    userId,
    scopes,
    expiresAt: accessExpiresAt,
  });

  let refreshTokenRaw: string | undefined;
  if (includeRefresh) {
    const refreshTokenData = generateOpaqueToken('ort');
    const refreshExpiresAt = new Date(Date.now() + OAUTH2_TOKEN_EXPIRY.refreshToken * 1000);
    await executor.insert(oauth2Tokens).values({
      tokenType: 'refresh',
      tokenHash: refreshTokenData.hash,
      tokenPrefix: refreshTokenData.tokenPrefix,
      clientId,
      userId,
      scopes,
      expiresAt: refreshExpiresAt,
    });
    refreshTokenRaw = refreshTokenData.raw;
  }

  return {
    access_token: accessTokenData.raw,
    token_type: 'Bearer' as const,
    expires_in: OAUTH2_TOKEN_EXPIRY.accessToken,
    refresh_token: refreshTokenRaw,
    scope: scopes.join(' '),
  };
}

export async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier?: string;
}) {
  const { code, redirectUri, clientId, clientSecret, codeVerifier } = params;
  const client = await ensureClient(clientId);

  // 验证 client_secret（confidential client）
  if (!client.isPublic) {
    if (!clientSecret) throw new HTTPException(400, { message: 'client_secret 必填' });
    if (!secretMatches(clientSecret, client.clientSecretHash)) {
      throw new HTTPException(400, { message: 'invalid_client' });
    }
  }

  // 查询授权码
  const [row] = await db.select().from(oauth2AuthorizationCodes).where(
    and(eq(oauth2AuthorizationCodes.codeHash, sha256(code)), eq(oauth2AuthorizationCodes.clientId, clientId)),
  );
  if (!row) throw new HTTPException(400, { message: 'invalid_grant：授权码不存在' });
  if (row.used) throw new HTTPException(400, { message: 'invalid_grant：授权码已使用' });
  if (row.expiresAt && row.expiresAt < new Date()) throw new HTTPException(400, { message: 'invalid_grant：授权码已过期' });
  if (row.redirectUri !== redirectUri) throw new HTTPException(400, { message: 'redirect_uri 不匹配' });

  // PKCE 验证
  if (row.codeChallenge) {
    if (!codeVerifier) throw new HTTPException(400, { message: 'code_verifier 必填（PKCE）' });
    if (row.codeChallengeMethod !== 'S256' || !verifyPkceS256(codeVerifier, row.codeChallenge)) {
      throw new HTTPException(400, { message: 'code_verifier 验证失败' });
    }
  } else if (client.isPublic) {
    throw new HTTPException(400, { message: '公开客户端必须使用 PKCE S256' });
  }

  const scopes: string[] = row.scopes ?? [];
  const includeRefresh = scopes.includes('offline_access') && client.grantTypes?.includes('refresh_token') === true;
  return db.transaction(async (tx) => {
    const consumed = await tx.update(oauth2AuthorizationCodes)
      .set({ used: true })
      .where(and(eq(oauth2AuthorizationCodes.id, row.id), eq(oauth2AuthorizationCodes.used, false)))
      .returning({ id: oauth2AuthorizationCodes.id });
    if (consumed.length === 0) {
      throw new HTTPException(400, { message: 'invalid_grant：授权码已使用' });
    }
    return issueTokenPair(tx, { clientId, userId: row.userId, scopes, includeRefresh });
  });
}

export async function clientCredentialsToken(params: {
  clientId: string;
  clientSecret: string;
  scope: string;
}) {
  const { clientId, clientSecret, scope } = params;
  const client = await ensureClientWithSecret(clientId, clientSecret);
  if (!client.grantTypes?.includes('client_credentials')) {
    throw new HTTPException(400, { message: '该应用不支持 client_credentials 授权' });
  }

  const requestedScopes = scope.split(' ').filter(Boolean);
  const allowedScopes: string[] = client.allowedScopes ?? [];
  const invalidScopes = requestedScopes.filter((s) => !allowedScopes.includes(s));
  if (invalidScopes.length > 0) {
    throw new HTTPException(400, { message: `不支持的 scope：${invalidScopes.join(', ')}` });
  }

  return issueTokenPair(db, { clientId, userId: null, scopes: requestedScopes, includeRefresh: false });
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}) {
  const { refreshToken, clientId, clientSecret } = params;
  const client = await ensureClient(clientId);
  if (!client.grantTypes?.includes('refresh_token')) {
    throw new HTTPException(400, { message: '该应用不支持 refresh_token 授权' });
  }
  if (!client.isPublic) {
    if (!clientSecret) throw new HTTPException(400, { message: 'client_secret 必填' });
    if (!secretMatches(clientSecret, client.clientSecretHash)) {
      throw new HTTPException(400, { message: 'invalid_client' });
    }
  }

  const tokenHash = sha256(refreshToken);
  const [row] = await db.select().from(oauth2Tokens).where(
    and(eq(oauth2Tokens.tokenHash, tokenHash), eq(oauth2Tokens.tokenType, 'refresh'), eq(oauth2Tokens.clientId, clientId)),
  );
  if (!row) throw new HTTPException(400, { message: 'invalid_grant：refresh_token 不存在' });
  if (row.revoked) throw new HTTPException(400, { message: 'invalid_grant：refresh_token 已撤销' });
  if (row.expiresAt && row.expiresAt < new Date()) throw new HTTPException(400, { message: 'invalid_grant：refresh_token 已过期' });

  const scopes: string[] = row.scopes ?? [];
  return db.transaction(async (tx) => {
    const revoked = await tx.update(oauth2Tokens)
      .set({ revoked: true })
      .where(and(eq(oauth2Tokens.id, row.id), eq(oauth2Tokens.revoked, false)))
      .returning({ id: oauth2Tokens.id });
    if (revoked.length === 0) {
      throw new HTTPException(400, { message: 'invalid_grant：refresh_token 已撤销' });
    }
    return issueTokenPair(tx, { clientId, userId: row.userId, scopes, includeRefresh: true });
  });
}

// ─── Token 撤销（POST /api/oauth2/token/revoke）───────────────────────────────

export async function revokeTokenByValue(token: string) {
  const tokenHash = sha256(token);
  await db.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.tokenHash, tokenHash));
  // RFC 7009：无论是否找到，都返回 200
}

// ─── Token 自省（POST /api/oauth2/token/introspect）──────────────────────────

export async function introspectToken(token: string) {
  const tokenHash = sha256(token);
  const [row] = await db.select().from(oauth2Tokens).where(eq(oauth2Tokens.tokenHash, tokenHash));

  if (!row || row.revoked || (row.expiresAt && row.expiresAt < new Date())) {
    return { active: false };
  }

  let username: string | undefined;
  if (row.userId) {
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, row.userId));
    username = u?.username;
  }

  return {
    active: true,
    scope: (row.scopes ?? []).join(' '),
    client_id: row.clientId,
    username,
    exp: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : undefined,
    iat: Math.floor(row.createdAt.getTime() / 1000),
    sub: row.userId?.toString(),
    token_type: row.tokenType,
  };
}

// ─── UserInfo（GET /api/oauth2/userinfo）──────────────────────────────────────

export async function getUserInfoByToken(accessToken: string) {
  const tokenHash = sha256(accessToken);
  const [row] = await db.select().from(oauth2Tokens).where(
    and(eq(oauth2Tokens.tokenHash, tokenHash), eq(oauth2Tokens.tokenType, 'access')),
  );
  if (!row || row.revoked || (row.expiresAt && row.expiresAt < new Date())) {
    throw new HTTPException(401, { message: 'invalid_token' });
  }
  if (!row.userId) {
    throw new HTTPException(400, { message: 'client_credentials token 无用户信息' });
  }

  const [user] = await db.select({
    id: users.id,
    username: users.username,
    nickname: users.nickname,
    email: users.email,
    avatar: users.avatar,
  }).from(users).where(eq(users.id, row.userId));

  if (!user) throw new HTTPException(404, { message: '用户不存在' });

  const scopes: string[] = row.scopes ?? [];
  return {
    sub: user.id.toString(),
    ...(scopes.includes('profile') ? { name: user.nickname, nickname: user.username, picture: user.avatar ?? undefined } : {}),
    ...(scopes.includes('email') && user.email ? { email: user.email, email_verified: true } : {}),
  };
}
