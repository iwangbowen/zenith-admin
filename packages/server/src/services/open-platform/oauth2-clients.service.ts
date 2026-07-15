import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { and, eq, desc, ilike } from 'drizzle-orm';
import { db } from '../../db';
import {
  appWebhookSubscriptions,
  oauth2AuthorizationCodes,
  oauth2Clients,
  oauth2Tokens,
  oauth2UserGrants,
  users,
} from '../../db/schema';
import { currentUser } from '../../lib/context';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { encryptField, decryptField } from '../../lib/encryption';
import type { CreateOAuth2ClientInput, UpdateOAuth2ClientInput } from '@zenith/shared';
import { config } from '../../config';
import { escapeLike } from '../../lib/where-helpers';
import type { DbExecutor } from '../../db/types';

// ─── 辅助：生成 & 哈希 client_secret ────────────────────────────────────────

function generateClientSecret(): { raw: string; hash: string; prefix: string } {
  const raw = `oas_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = `${raw.slice(0, 10)}...`;
  return { raw, hash, prefix };
}

function mapClientRow(row: typeof oauth2Clients.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientSecretPrefix: row.clientSecretPrefix,
    name: row.name,
    description: row.description,
    logoUrl: row.logoUrl,
    redirectUris: row.redirectUris ?? [],
    allowedScopes: row.allowedScopes ?? [],
    grantTypes: row.grantTypes ?? [],
    isPublic: row.isPublic,
    ratePlanId: row.ratePlanId ?? null,
    signEnabled: row.signEnabled,
    ipAllowlist: row.ipAllowlist ?? [],
    environment: row.environment,
    reviewStatus: row.reviewStatus,
    reviewComment: row.reviewComment,
    submittedAt: formatNullableDateTime(row.submittedAt),
    reviewedAt: formatNullableDateTime(row.reviewedAt),
    reviewedBy: row.reviewedBy,
    previousSecretExpiresAt: formatNullableDateTime(row.previousSecretExpiresAt),
    status: row.status,
    ownerId: row.ownerId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapTokenAuditRow(row: typeof oauth2Tokens.$inferSelect) {
  return {
    id: row.id,
    tokenType: row.tokenType as 'access' | 'refresh',
    tokenPrefix: row.tokenPrefix,
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes ?? [],
    expiresAt: formatNullableDateTime(row.expiresAt),
    revoked: row.revoked,
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listOAuth2Clients(opts: {
  page: number;
  pageSize: number;
  keyword?: string;
  ownerId?: number;
  environment?: 'production' | 'sandbox';
  reviewStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
}) {
  const { page, pageSize, keyword, ownerId, environment, reviewStatus } = opts;
  const conditions = [];
  if (keyword) conditions.push(ilike(oauth2Clients.name, `%${escapeLike(keyword)}%`));
  if (ownerId !== undefined) conditions.push(eq(oauth2Clients.ownerId, ownerId));
  if (environment) conditions.push(eq(oauth2Clients.environment, environment));
  if (reviewStatus) conditions.push(eq(oauth2Clients.reviewStatus, reviewStatus));
  const where = conditions.length ? and(...conditions) : undefined;
  const [list, total] = await Promise.all([
    db.select().from(oauth2Clients)
      .where(where)
      .orderBy(desc(oauth2Clients.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(oauth2Clients, where),
  ]);
  return { list: list.map(mapClientRow), total, page, pageSize };
}

function validateIpAllowlist(values: string[]): void {
  for (const value of values) {
    const [address, prefix, ...extra] = value.split('/');
    const version = isIP(address);
    const maxPrefix = version === 4 ? 32 : 128;
    if (
      !version
      || extra.length > 0
      || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix))
    ) {
      throw new HTTPException(400, { message: `无效的 IP/CIDR：${value}` });
    }
  }
}

function validateClientConfiguration(input: {
  redirectUris: string[];
  grantTypes: string[];
  isPublic: boolean;
  signEnabled: boolean;
  ipAllowlist: string[];
}): void {
  if (input.grantTypes.includes('implicit')) {
    throw new HTTPException(400, { message: 'implicit 授权模式已停用，请使用 authorization_code + PKCE' });
  }
  if (input.grantTypes.includes('authorization_code') && input.redirectUris.length === 0) {
    throw new HTTPException(400, { message: '授权码模式至少需要一个回调 URL' });
  }
  if (input.isPublic && input.grantTypes.includes('client_credentials')) {
    throw new HTTPException(400, { message: '公开客户端不支持 client_credentials' });
  }
  if (input.grantTypes.includes('refresh_token') && !input.grantTypes.includes('authorization_code')) {
    throw new HTTPException(400, { message: 'refresh_token 必须与 authorization_code 同时启用' });
  }
  if (input.isPublic && input.signEnabled) {
    throw new HTTPException(400, { message: '公开客户端没有密钥，无法启用 HMAC 签名' });
  }
  validateIpAllowlist(input.ipAllowlist);
}

export async function createOAuth2Client(
  input: CreateOAuth2ClientInput,
  options: { reviewStatus?: 'draft' | 'approved' } = {},
) {
  const user = currentUser();
  if (!input.name?.trim()) throw new HTTPException(400, { message: '应用名称不能为空' });
  validateClientConfiguration({
    redirectUris: input.redirectUris,
    grantTypes: input.grantTypes,
    isPublic: input.isPublic,
    signEnabled: input.signEnabled ?? false,
    ipAllowlist: input.ipAllowlist,
  });

  const clientId = randomUUID();
  let secretHash: string | null = null;
  let secretPrefix: string | null = null;
  let secretRaw: string | null = null;
  let secretEncrypted: string | null = null;

  if (!input.isPublic) {
    const sec = generateClientSecret();
    secretHash = sec.hash;
    secretPrefix = sec.prefix;
    secretRaw = sec.raw;
    secretEncrypted = encryptField(sec.raw);
  }

  try {
    const [row] = await db.insert(oauth2Clients).values({
      clientId,
      clientSecretHash: secretHash,
      clientSecretEncrypted: secretEncrypted,
      clientSecretPrefix: secretPrefix,
      name: input.name.trim(),
      description: input.description,
      logoUrl: input.logoUrl,
      redirectUris: input.redirectUris,
      allowedScopes: input.allowedScopes,
      grantTypes: input.grantTypes,
      isPublic: input.isPublic,
      ratePlanId: input.ratePlanId ?? null,
      signEnabled: input.signEnabled ?? false,
      ipAllowlist: input.ipAllowlist,
      environment: input.environment,
      reviewStatus: options.reviewStatus ?? 'approved',
      reviewedAt: options.reviewStatus === 'draft' ? null : new Date(),
      reviewedBy: options.reviewStatus === 'draft' ? null : user.userId,
      ownerId: user.userId,
    }).returning();

    return { ...mapClientRow(row), clientSecret: secretRaw ?? '' };
  } catch (err) {
    rethrowPgUniqueViolation(err, '应用名称已存在');
    throw err;
  }
}

export async function getOAuth2Client(id: number) {
  const [row] = await db.select().from(oauth2Clients).where(eq(oauth2Clients.id, id));
  if (!row) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });
  return mapClientRow(row);
}

export async function getOAuth2ClientBeforeAudit(id: number) {
  return getOAuth2Client(id);
}

export async function getOAuth2ClientByClientId(clientId: string) {
  const [row] = await db.select().from(oauth2Clients).where(eq(oauth2Clients.clientId, clientId));
  return row ?? null;
}

/** 启用应用的轻量选项列表（供 Webhook/SDK 等下拉选择，仅需登录） */
export async function listAppOptions() {
  const rows = await db
    .select({ clientId: oauth2Clients.clientId, name: oauth2Clients.name })
    .from(oauth2Clients)
    .where(eq(oauth2Clients.status, 'enabled'))
    .orderBy(oauth2Clients.name);
  return rows.map((r) => ({ clientId: r.clientId, name: r.name }));
}

export async function updateOAuth2Client(
  id: number,
  input: UpdateOAuth2ClientInput,
  options: { resetReview?: boolean; revokeTokens?: boolean } = {},
) {
  const existing = await getOAuth2Client(id);
  if (!existing) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });
  validateClientConfiguration({
    redirectUris: input.redirectUris ?? existing.redirectUris,
    grantTypes: input.grantTypes ?? existing.grantTypes,
    isPublic: input.isPublic ?? existing.isPublic,
    signEnabled: input.signEnabled ?? existing.signEnabled,
    ipAllowlist: input.ipAllowlist ?? existing.ipAllowlist,
  });

  try {
    const applyUpdate = async (executor: DbExecutor) => {
      const [row] = await executor.update(oauth2Clients)
        .set({
          name: input.name?.trim() ?? undefined,
          description: input.description,
          logoUrl: input.logoUrl,
          redirectUris: input.redirectUris,
          allowedScopes: input.allowedScopes,
          grantTypes: input.grantTypes,
          isPublic: input.isPublic,
          ratePlanId: input.ratePlanId,
          signEnabled: input.signEnabled,
          ipAllowlist: input.ipAllowlist,
          environment: input.environment,
          reviewStatus: options.resetReview ? 'draft' : undefined,
          reviewComment: options.resetReview ? null : undefined,
          submittedAt: options.resetReview ? null : undefined,
          reviewedAt: options.resetReview ? null : undefined,
          reviewedBy: options.resetReview ? null : undefined,
          status: input.status,
        })
        .where(eq(oauth2Clients.id, id))
        .returning();
      if (options.revokeTokens || input.status === 'disabled') {
        await executor.update(oauth2Tokens)
          .set({ revoked: true })
          .where(eq(oauth2Tokens.clientId, existing.clientId));
      }
      return mapClientRow(row);
    };
    return options.revokeTokens || input.status === 'disabled'
      ? db.transaction(applyUpdate)
      : applyUpdate(db);
  } catch (err) {
    rethrowPgUniqueViolation(err, '应用名称已存在');
    throw err;
  }
}

export async function deleteOAuth2Client(id: number) {
  const existing = await getOAuth2Client(id);
  await db.transaction(async (tx) => {
    await tx.update(oauth2Tokens)
      .set({ revoked: true })
      .where(eq(oauth2Tokens.clientId, existing.clientId));
    await tx.delete(oauth2AuthorizationCodes)
      .where(eq(oauth2AuthorizationCodes.clientId, existing.clientId));
    await tx.delete(oauth2UserGrants)
      .where(eq(oauth2UserGrants.clientId, existing.clientId));
    await tx.update(appWebhookSubscriptions)
      .set({ status: 'disabled' })
      .where(eq(appWebhookSubscriptions.clientId, existing.clientId));
    const result = await tx.delete(oauth2Clients).where(eq(oauth2Clients.id, id)).returning();
    if (result.length === 0) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });
  });
}

export async function regenerateOAuth2ClientSecret(id: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(oauth2Clients)
      .where(eq(oauth2Clients.id, id))
      .for('update')
      .limit(1);
    if (!row) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });
    if (row.isPublic) throw new HTTPException(400, { message: '公开客户端不使用 secret' });

    const sec = generateClientSecret();
    const previousValidUntil = new Date(Date.now() + config.openPlatform.secretRotationGraceHours * 60 * 60 * 1000);
    await tx.update(oauth2Clients).set({
      previousClientSecretHash: row.clientSecretHash,
      previousClientSecretEncrypted: row.clientSecretEncrypted,
      previousSecretExpiresAt: previousValidUntil,
      clientSecretHash: sec.hash,
      clientSecretEncrypted: encryptField(sec.raw),
      clientSecretPrefix: sec.prefix,
    }).where(eq(oauth2Clients.id, id));
    await tx.update(oauth2Tokens)
      .set({ revoked: true })
      .where(eq(oauth2Tokens.clientId, row.clientId));

    return {
      clientId: row.clientId,
      clientSecret: sec.raw,
      previousValidUntil: formatDateTime(previousValidUntil),
    };
  });
}

/** 读取应用的明文签名密钥（= clientSecret），供开放 API 网关 HMAC 验签。公开客户端返回 null */
export async function getAppSigningSecret(clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ enc: oauth2Clients.clientSecretEncrypted })
    .from(oauth2Clients)
    .where(eq(oauth2Clients.clientId, clientId))
    .limit(1);
  if (!row?.enc) return null;
  return decryptField(row.enc);
}

export async function reviewOAuth2Client(
  id: number,
  input: { action: 'approve' | 'reject'; comment?: string },
) {
  const user = currentUser();
  return db.transaction(async (tx) => {
    const [row] = await tx.update(oauth2Clients).set({
      reviewStatus: input.action === 'approve' ? 'approved' : 'rejected',
      reviewComment: input.comment?.trim() || null,
      reviewedAt: new Date(),
      reviewedBy: user.userId,
    }).where(and(
      eq(oauth2Clients.id, id),
      eq(oauth2Clients.reviewStatus, 'pending'),
    )).returning();
    if (!row) throw new HTTPException(400, { message: '仅待审核应用可执行审核操作' });
    if (input.action === 'reject') {
      await tx.update(oauth2Tokens)
        .set({ revoked: true })
        .where(eq(oauth2Tokens.clientId, row.clientId));
    }
    return mapClientRow(row);
  });
}

// ─── 令牌管理 ─────────────────────────────────────────────────────────────────

export async function listClientTokens(clientId: string, opts: { page: number; pageSize: number }) {
  const { page, pageSize } = opts;
  const where = eq(oauth2Tokens.clientId, clientId);
  const [list, total] = await Promise.all([
    db.select().from(oauth2Tokens)
      .where(where)
      .orderBy(desc(oauth2Tokens.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(oauth2Tokens, where),
  ]);
  return {
    list: list.map((r) => ({
      id: r.id,
      tokenType: r.tokenType as 'access' | 'refresh',
      tokenPrefix: r.tokenPrefix,
      clientId: r.clientId,
      userId: r.userId,
      scopes: r.scopes ?? [],
      expiresAt: formatNullableDateTime(r.expiresAt),
      revoked: r.revoked,
      createdAt: formatDateTime(r.createdAt),
    })),
    total,
    page,
    pageSize,
  };
}

export async function listClientGrants(clientId: string, opts: { page: number; pageSize: number }) {
  const { page, pageSize } = opts;
  const where = eq(oauth2UserGrants.clientId, clientId);
  const [rows, total] = await Promise.all([
    db.select({
      id: oauth2UserGrants.id,
      userId: oauth2UserGrants.userId,
      username: users.username,
      nickname: users.nickname,
      clientId: oauth2UserGrants.clientId,
      scopes: oauth2UserGrants.scopes,
      createdAt: oauth2UserGrants.createdAt,
      updatedAt: oauth2UserGrants.updatedAt,
    })
      .from(oauth2UserGrants)
      .leftJoin(users, eq(oauth2UserGrants.userId, users.id))
      .where(where)
      .orderBy(desc(oauth2UserGrants.updatedAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(oauth2UserGrants, where),
  ]);
  return {
    list: rows.map((row) => ({
      ...row,
      scopes: row.scopes ?? [],
      createdAt: formatDateTime(row.createdAt),
      updatedAt: formatDateTime(row.updatedAt),
    })),
    total,
    page,
    pageSize,
  };
}

export async function getOAuth2TokenBeforeAudit(id: number) {
  const [row] = await db.select().from(oauth2Tokens).where(eq(oauth2Tokens.id, id));
  if (!row) throw new HTTPException(404, { message: '令牌不存在' });
  return mapTokenAuditRow(row);
}

export async function revokeToken(id: number) {
  const result = await db.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: '令牌不存在' });
}
