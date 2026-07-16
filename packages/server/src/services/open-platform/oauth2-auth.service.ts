/**
 * OAuth2 授权服务（authorization_code + PKCE / client_credentials / refresh_token）
 * 令牌使用 opaque token（SHA256 哈希存储于 DB），支持精确撤销
 */
import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import {
  oauth2Clients,
  oauth2AuthorizationCodes,
  oauth2TokenFamilies,
  oauth2Tokens,
  oauth2UserGrants,
  tenants,
  users,
} from '../../db/schema';
import { currentUser } from '../../lib/context';
import { HTTPException } from 'hono/http-exception';

import { isSafeOAuthRedirectUri, OAUTH2_TOKEN_EXPIRY } from '@zenith/shared';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { config } from '../../config';

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

function clientSecretMatches(
  raw: string,
  client: {
    clientSecretHash: string | null;
    previousClientSecretHash: string | null;
    previousSecretExpiresAt: Date | null;
  },
): boolean {
  if (secretMatches(raw, client.clientSecretHash)) return true;
  return Boolean(
    client.previousSecretExpiresAt
    && client.previousSecretExpiresAt > new Date()
    && secretMatches(raw, client.previousClientSecretHash),
  );
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
  const actual = Buffer.from(digest);
  const expected = Buffer.from(codeChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ─── 辅助：校验客户端 ─────────────────────────────────────────────────────────

async function ensureClient(clientId: string) {
  const [row] = await db.select().from(oauth2Clients).where(eq(oauth2Clients.clientId, clientId));
  if (!row) throw new HTTPException(400, { message: 'invalid_client' });
  if (!isClientUsable(row)) {
    throw new HTTPException(403, { message: row.status !== 'enabled' ? '应用已禁用' : '应用尚未审核通过' });
  }
  return row;
}

async function lockUsableClient(tx: DbTransaction, clientId: string) {
  const [row] = await tx.select().from(oauth2Clients)
    .where(eq(oauth2Clients.clientId, clientId))
    .for('update')
    .limit(1);
  if (!row) throw new HTTPException(400, { message: 'invalid_client' });
  if (!isClientUsable(row)) {
    throw new HTTPException(403, { message: row.status !== 'enabled' ? '应用已禁用' : '应用尚未审核通过' });
  }
  return row;
}

function isClientUsable(client: typeof oauth2Clients.$inferSelect): boolean {
  if (client.status !== 'enabled') return false;
  if (
    config.openPlatform.gatewayRequireApproval
    && client.reviewStatus !== 'approved'
  ) {
    return false;
  }
  return true;
}

async function getUsableOAuthUser(userId: number, executor: DbExecutor = db) {
  const [row] = await executor.select({
    id: users.id,
    username: users.username,
    nickname: users.nickname,
    email: users.email,
    avatar: users.avatar,
    status: users.status,
    tenantId: users.tenantId,
    tenantStatus: tenants.status,
    tenantExpireAt: tenants.expireAt,
  }).from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.status !== 'enabled') return null;
  if (
    row.tenantId !== null
    && (
      row.tenantStatus !== 'enabled'
      || (row.tenantExpireAt && row.tenantExpireAt < new Date())
    )
  ) {
    return null;
  }
  return row;
}

async function revokeTokenFamily(
  executor: DbExecutor,
  token: typeof oauth2Tokens.$inferSelect,
  compromised = false,
) {
  if (token.familyId) {
    await executor.update(oauth2TokenFamilies).set({
      revoked: true,
      compromised: compromised ? true : undefined,
    }).where(eq(oauth2TokenFamilies.id, token.familyId));
    await executor.update(oauth2Tokens)
      .set({ revoked: true })
      .where(eq(oauth2Tokens.familyId, token.familyId));
    return;
  }
  await executor.update(oauth2Tokens)
    .set({ revoked: true })
    .where(eq(oauth2Tokens.id, token.id));
}

async function isTokenFamilyUsable(token: typeof oauth2Tokens.$inferSelect, executor: DbExecutor = db) {
  if (!token.familyId) return false;
  const [family] = await executor.select({
    revoked: oauth2TokenFamilies.revoked,
    compromised: oauth2TokenFamilies.compromised,
  }).from(oauth2TokenFamilies)
    .where(eq(oauth2TokenFamilies.id, token.familyId))
    .limit(1);
  return Boolean(family && !family.revoked && !family.compromised);
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
  if (!isSafeOAuthRedirectUri(redirectUri)) {
    throw new HTTPException(400, { message: 'redirect_uri 协议不安全' });
  }

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
  const user = currentUser();
  const [grant] = await db.select().from(oauth2UserGrants).where(
    and(eq(oauth2UserGrants.userId, user.userId), eq(oauth2UserGrants.clientId, clientId)),
  );
  const grantedScopes: string[] = grant?.scopes ?? [];
  const alreadyGranted = requestedScopes.every((item) => grantedScopes.includes(item));

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
  if (!isSafeOAuthRedirectUri(redirectUri)) {
    throw new HTTPException(400, { message: 'redirect_uri 协议不安全' });
  }
  if (responseType !== 'code') {
    throw new HTTPException(400, { message: 'unsupported_response_type：仅支持 code' });
  }

  if (codeChallengeMethod !== 'S256') {
    throw new HTTPException(400, { message: '仅支持 PKCE S256' });
  }
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new HTTPException(400, { message: 'code_challenge 格式无效' });
  }

  return db.transaction(async (tx) => {
    const client = await lockUsableClient(tx, clientId);
    if (!(client.redirectUris ?? []).includes(redirectUri)) {
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

    await tx.insert(oauth2UserGrants)
      .values({ userId: user.userId, clientId, scopes: requestedScopes })
      .onConflictDoUpdate({
        target: [oauth2UserGrants.userId, oauth2UserGrants.clientId],
        set: { scopes: requestedScopes, updatedAt: new Date() },
      });

    const code = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + OAUTH2_TOKEN_EXPIRY.authorizationCode * 1000);
    await tx.insert(oauth2AuthorizationCodes).values({
      codeHash: sha256(code),
      clientId,
      userId: user.userId,
      redirectUri,
      scopes: requestedScopes,
      codeChallenge,
      codeChallengeMethod: 'S256',
      expiresAt,
    });
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    return { redirectUrl: `${redirectUri}?code=${code}${stateParam}` };
  });
}

// ─── Token 端点（POST /api/oauth2/token）─────────────────────────────────────

async function issueTokenPair(executor: DbExecutor, opts: {
  clientId: string;
  userId: number | null;
  scopes: string[];
  includeRefresh: boolean;
  familyId?: string;
}) {
  const { clientId, userId, scopes, includeRefresh } = opts;
  const familyId = opts.familyId ?? randomUUID();
  if (!opts.familyId) {
    await executor.insert(oauth2TokenFamilies).values({
      id: familyId,
      clientId,
      userId,
    });
  }

  const accessTokenData = generateOpaqueToken('oat');
  const accessExpiresAt = new Date(Date.now() + OAUTH2_TOKEN_EXPIRY.accessToken * 1000);
  await executor.insert(oauth2Tokens).values({
    tokenType: 'access',
    tokenHash: accessTokenData.hash,
    tokenPrefix: accessTokenData.tokenPrefix,
    familyId,
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
      familyId,
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
  if (!isSafeOAuthRedirectUri(redirectUri)) {
    throw new HTTPException(400, { message: 'redirect_uri 协议不安全' });
  }
  if (!codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw new HTTPException(400, { message: 'code_verifier 格式无效（PKCE）' });
  }
  return db.transaction(async (tx) => {
    const client = await lockUsableClient(tx, clientId);
    if (!client.isPublic) {
      if (!clientSecret || !clientSecretMatches(clientSecret, client)) {
        throw new HTTPException(400, { message: 'invalid_client' });
      }
    }
    if (!client.grantTypes?.includes('authorization_code')) {
      throw new HTTPException(400, { message: '该应用不支持 authorization_code 授权' });
    }
    const [row] = await tx.select().from(oauth2AuthorizationCodes).where(
      and(eq(oauth2AuthorizationCodes.codeHash, sha256(code)), eq(oauth2AuthorizationCodes.clientId, clientId)),
    ).for('update').limit(1);
    if (!row) throw new HTTPException(400, { message: 'invalid_grant：授权码不存在' });
    if (row.used) throw new HTTPException(400, { message: 'invalid_grant：授权码已使用' });
    if (row.expiresAt < new Date()) throw new HTTPException(400, { message: 'invalid_grant：授权码已过期' });
    if (row.redirectUri !== redirectUri) throw new HTTPException(400, { message: 'redirect_uri 不匹配' });
    if (
      !row.codeChallenge
      || row.codeChallengeMethod !== 'S256'
      || !verifyPkceS256(codeVerifier, row.codeChallenge)
    ) {
      throw new HTTPException(400, { message: 'code_verifier 验证失败' });
    }
    const scopes: string[] = row.scopes ?? [];
    if (scopes.some((scope) => !(client.allowedScopes ?? []).includes(scope))) {
      throw new HTTPException(400, { message: 'invalid_grant：授权范围已变更，请重新授权' });
    }
    if (!await getUsableOAuthUser(row.userId, tx)) {
      throw new HTTPException(400, { message: 'invalid_grant：用户或租户已停用' });
    }
    const consumed = await tx.update(oauth2AuthorizationCodes)
      .set({ used: true })
      .where(and(eq(oauth2AuthorizationCodes.id, row.id), eq(oauth2AuthorizationCodes.used, false)))
      .returning({ id: oauth2AuthorizationCodes.id });
    if (consumed.length === 0) {
      throw new HTTPException(400, { message: 'invalid_grant：授权码已使用' });
    }
    const includeRefresh = scopes.includes('offline_access') && client.grantTypes?.includes('refresh_token') === true;
    return issueTokenPair(tx, { clientId, userId: row.userId, scopes, includeRefresh });
  });
}

export async function clientCredentialsToken(params: {
  clientId: string;
  clientSecret: string;
  scope: string;
}) {
  const { clientId, clientSecret, scope } = params;
  return db.transaction(async (tx) => {
    const client = await lockUsableClient(tx, clientId);
    if (client.isPublic || !clientSecretMatches(clientSecret, client)) {
      throw new HTTPException(400, { message: 'invalid_client' });
    }
    if (!client.grantTypes?.includes('client_credentials')) {
      throw new HTTPException(400, { message: '该应用不支持 client_credentials 授权' });
    }
    const requestedScopes = scope.split(' ').filter(Boolean);
    const invalidScopes = requestedScopes.filter((item) => !(client.allowedScopes ?? []).includes(item));
    if (invalidScopes.length > 0) {
      throw new HTTPException(400, { message: `不支持的 scope：${invalidScopes.join(', ')}` });
    }
    return issueTokenPair(tx, { clientId, userId: null, scopes: requestedScopes, includeRefresh: false });
  });
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}) {
  const { refreshToken, clientId, clientSecret } = params;
  const tokenHash = sha256(refreshToken);
  const result = await db.transaction(async (tx) => {
    const client = await lockUsableClient(tx, clientId);
    if (!client.grantTypes?.includes('refresh_token')) {
      throw new HTTPException(400, { message: '该应用不支持 refresh_token 授权' });
    }
    if (!client.isPublic && (!clientSecret || !clientSecretMatches(clientSecret, client))) {
      throw new HTTPException(400, { message: 'invalid_client' });
    }

    const [row] = await tx.select().from(oauth2Tokens).where(and(
      eq(oauth2Tokens.tokenHash, tokenHash),
      eq(oauth2Tokens.tokenType, 'refresh'),
      eq(oauth2Tokens.clientId, clientId),
    )).for('update').limit(1);
    if (!row) throw new HTTPException(400, { message: 'invalid_grant：refresh_token 不存在' });
    if (!row.familyId) {
      await tx.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, row.id));
      return { error: 'invalid_grant：旧版 refresh_token 已失效，请重新授权' } as const;
    }

    const [family] = await tx.select().from(oauth2TokenFamilies)
      .where(eq(oauth2TokenFamilies.id, row.familyId))
      .for('update')
      .limit(1);
    if (!family) {
      await tx.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, row.id));
      return { error: 'invalid_grant：令牌族不存在' } as const;
    }
    if (row.revoked || family.revoked || family.compromised) {
      await tx.update(oauth2TokenFamilies).set({ revoked: true, compromised: true })
        .where(eq(oauth2TokenFamilies.id, family.id));
      await tx.update(oauth2Tokens).set({ revoked: true })
        .where(eq(oauth2Tokens.familyId, family.id));
      return { error: 'invalid_grant：检测到 refresh_token 重放，令牌族已撤销' } as const;
    }
    if (row.expiresAt && row.expiresAt < new Date()) {
      await tx.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, row.id));
      return { error: 'invalid_grant：refresh_token 已过期' } as const;
    }
    const scopes: string[] = row.scopes ?? [];
    if (scopes.some((item) => !(client.allowedScopes ?? []).includes(item))) {
      await tx.update(oauth2TokenFamilies).set({ revoked: true })
        .where(eq(oauth2TokenFamilies.id, family.id));
      await tx.update(oauth2Tokens).set({ revoked: true })
        .where(eq(oauth2Tokens.familyId, family.id));
      return { error: 'invalid_grant：授权范围已变更，请重新授权' } as const;
    }
    if (row.userId && !await getUsableOAuthUser(row.userId, tx)) {
      await tx.update(oauth2TokenFamilies).set({ revoked: true })
        .where(eq(oauth2TokenFamilies.id, family.id));
      await tx.update(oauth2Tokens).set({ revoked: true })
        .where(eq(oauth2Tokens.familyId, family.id));
      return { error: 'invalid_grant：用户或租户已停用' } as const;
    }

    await tx.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, row.id));
    const tokens = await issueTokenPair(tx, {
      clientId,
      userId: row.userId,
      scopes,
      includeRefresh: true,
      familyId: family.id,
    });
    return { tokens } as const;
  });
  if ('error' in result) {
    throw new HTTPException(400, { message: result.error });
  }
  return result.tokens;
}

// ─── Token 撤销（POST /api/oauth2/token/revoke）───────────────────────────────

export async function revokeTokenByValue(
  token: string,
  clientId: string,
  clientSecret?: string,
) {
  if (!clientId) throw new HTTPException(400, { message: 'invalid_client' });
  const tokenHash = sha256(token);
  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(oauth2Clients)
      .where(eq(oauth2Clients.clientId, clientId))
      .for('update')
      .limit(1);
    if (!client) throw new HTTPException(400, { message: 'invalid_client' });
    if (!client.isPublic && (!clientSecret || !clientSecretMatches(clientSecret, client))) {
      throw new HTTPException(400, { message: 'invalid_client' });
    }
    const [row] = await tx.select().from(oauth2Tokens)
      .where(and(eq(oauth2Tokens.tokenHash, tokenHash), eq(oauth2Tokens.clientId, clientId)))
      .for('update')
      .limit(1);
    if (!row) return;
    if (row.tokenType === 'refresh' && row.familyId) {
      await tx.select({ id: oauth2TokenFamilies.id }).from(oauth2TokenFamilies)
        .where(eq(oauth2TokenFamilies.id, row.familyId))
        .for('update')
        .limit(1);
      await revokeTokenFamily(tx, row);
      return;
    }
    await tx.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, row.id));
  });
  // RFC 7009：无论是否找到，都返回 200
}

// ─── Token 自省（POST /api/oauth2/token/introspect）──────────────────────────

export async function introspectToken(token: string, clientId: string, clientSecret: string) {
  if (!clientId || !clientSecret) throw new HTTPException(400, { message: 'invalid_client' });
  const client = await ensureClient(clientId);
  if (client.isPublic || !clientSecretMatches(clientSecret, client)) {
    throw new HTTPException(400, { message: 'invalid_client' });
  }
  const tokenHash = sha256(token);
  const [row] = await db.select().from(oauth2Tokens).where(and(
    eq(oauth2Tokens.tokenHash, tokenHash),
    eq(oauth2Tokens.clientId, clientId),
  ));

  if (!row || row.revoked || (row.expiresAt && row.expiresAt < new Date())) {
    return { active: false };
  }
  if (!await isTokenFamilyUsable(row)) return { active: false };

  let username: string | undefined;
  if (row.userId) {
    const user = await getUsableOAuthUser(row.userId);
    if (!user) return { active: false };
    username = user.username;
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
  if (!await isTokenFamilyUsable(row)) throw new HTTPException(401, { message: 'invalid_token' });
  await ensureClient(row.clientId);
  if (!row.userId) {
    throw new HTTPException(400, { message: 'client_credentials token 无用户信息' });
  }

  const user = await getUsableOAuthUser(row.userId);
  if (!user) throw new HTTPException(401, { message: 'invalid_token：用户或租户已停用' });

  const scopes: string[] = row.scopes ?? [];
  return {
    sub: user.id.toString(),
    ...(scopes.includes('profile') ? { name: user.nickname, nickname: user.username, picture: user.avatar ?? undefined } : {}),
    ...(scopes.includes('email') && user.email ? { email: user.email, email_verified: true } : {}),
  };
}
