import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { buildListResult } from '../../lib/list-query';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { isIP } from 'node:net';
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { oauth2ClientContract } from '@zenith/shared/open-platform';
import { db } from '../../db';
import {
  appWebhookDeliveries,
  appWebhookSubscriptions,
  oauth2AuthorizationCodes,
  oauth2Clients,
  oauth2TokenFamilies,
  oauth2Tokens,
  oauth2UserGrants,
  openQuotaAlerts,
  users,
} from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { encryptField, decryptField } from '../../lib/encryption';
import type { CreateOAuth2ClientInput, UpdateOAuth2ClientInput } from '@zenith/shared/open-platform';
import { config } from '../../config';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';

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
    tenantId: row.tenantId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    ...formatTimestamps(row),
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

export async function listOAuth2Clients(opts: QueryOutputOf<typeof oauth2ClientContract.list> & { ownerId?: number }) {
  const { page, pageSize, keyword, ownerId, environment, reviewStatus } = opts;
  const where = buildWhere(
    keywordCondition(keyword, [oauth2Clients.name], 'ilike'),
    ownerId !== undefined ? eq(oauth2Clients.ownerId, ownerId) : undefined,
    environment ? eq(oauth2Clients.environment, environment) : undefined,
    reviewStatus ? eq(oauth2Clients.reviewStatus, reviewStatus) : undefined,
    tenantCondition(oauth2Clients, currentUser()),
  );
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(oauth2Clients, where),
    rows: () => db.select().from(oauth2Clients)
  .where(where)
  .orderBy(desc(oauth2Clients.createdAt))
  .limit(pageSize)
  .offset(pageOffset(page, pageSize)),
    map: mapClientRow,
  });
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
      tenantId: getCreateTenantId(user),
    }).returning();

    return { ...mapClientRow(row), clientSecret: secretRaw ?? '' };
  } catch (err) {
    rethrowPgUniqueViolation(err, '应用名称已存在');
    throw err;
  }
}

export async function getOAuth2Client(id: number) {
  const [row] = await db
    .select()
    .from(oauth2Clients)
    .where(and(eq(oauth2Clients.id, id), tenantCondition(oauth2Clients, currentUser())));
  requireRow(row, 'OAuth2 应用不存在');
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
    .select({
      id: oauth2Clients.id,
      clientId: oauth2Clients.clientId,
      name: oauth2Clients.name,
      environment: oauth2Clients.environment,
      reviewStatus: oauth2Clients.reviewStatus,
      isPublic: oauth2Clients.isPublic,
      signEnabled: oauth2Clients.signEnabled,
    })
    .from(oauth2Clients)
    .where(and(eq(oauth2Clients.status, 'enabled'), tenantCondition(oauth2Clients, currentUser())))
    .orderBy(oauth2Clients.name);
  return rows;
}

export async function updateOAuth2Client(
  id: number,
  input: UpdateOAuth2ClientInput,
  options: {
    resetReview?: boolean;
    revokeTokens?: boolean;
    ownerId?: number;
    allowedReviewStatuses?: Array<'draft' | 'pending' | 'approved' | 'rejected'>;
  } = {},
) {
  const user = currentUser();
  const shouldRevokeTokens = Boolean(
    options.revokeTokens
    || input.status === 'disabled'
    || input.allowedScopes !== undefined
    || input.grantTypes !== undefined
    || input.isPublic !== undefined
    || input.environment !== undefined,
  );

  try {
    return await db.transaction(async (executor) => {
      const [locked] = await executor.select().from(oauth2Clients)
        .where(and(eq(oauth2Clients.id, id), tenantCondition(oauth2Clients, user)))
        .for('update')
        .limit(1);
      requireRow(locked, 'OAuth2 应用不存在');
      validateClientConfiguration({
        redirectUris: input.redirectUris ?? locked.redirectUris,
        grantTypes: input.grantTypes ?? locked.grantTypes,
        isPublic: input.isPublic ?? locked.isPublic,
        signEnabled: input.signEnabled ?? locked.signEnabled,
        ipAllowlist: input.ipAllowlist ?? locked.ipAllowlist,
      });
      const updateWhere = buildWhere(
        eq(oauth2Clients.id, id),
        tenantCondition(oauth2Clients, user),
        options.ownerId !== undefined ? eq(oauth2Clients.ownerId, options.ownerId) : undefined,
        options.allowedReviewStatuses?.length
          ? inArray(oauth2Clients.reviewStatus, options.allowedReviewStatuses)
          : undefined,
      );
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
        .where(updateWhere)
        .returning();
      requireRow(row, '应用状态已变化，请刷新后重试', 409);
      if (shouldRevokeTokens) {
        await executor.delete(oauth2AuthorizationCodes)
          .where(eq(oauth2AuthorizationCodes.clientId, locked.clientId));
        await executor.update(oauth2TokenFamilies)
          .set({ revoked: true })
          .where(eq(oauth2TokenFamilies.clientId, locked.clientId));
        await executor.update(oauth2Tokens)
          .set({ revoked: true })
          .where(eq(oauth2Tokens.clientId, locked.clientId));
      }
      return mapClientRow(row);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '应用名称已存在');
    throw err;
  }
}

/**
 * 删除应用并级联清理全部从属数据。
 *
 * 应用被删除后 client_id 不复存在，任何仍引用它的记录都会变成孤儿：Webhook 订阅会显示
 * 裸 client_id 且仍可触发投递，令牌记录无法再被任何流程回收。这里在同一事务内物理清理，
 * 只保留 open_api_call_logs / open_api_call_stats_daily —— 调用日志是审计快照，
 * 已冗余存储 appName，删除应用不应抹掉历史调用记录。
 */
export async function deleteOAuth2Client(
  id: number,
  options: {
    ownerId?: number;
    allowedReviewStatuses?: Array<'draft' | 'pending' | 'approved' | 'rejected'>;
  } = {},
) {
  const user = currentUser();
  const existing = await getOAuth2Client(id);
  await db.transaction(async (tx) => {
    await tx.select({ id: oauth2Clients.id }).from(oauth2Clients)
      .where(and(eq(oauth2Clients.id, id), tenantCondition(oauth2Clients, user)))
      .for('update')
      .limit(1);

    // 先删主行：ownerId / reviewStatus 条件不满足时直接失败，避免误删他人应用的从属数据
    const deleteWhere = buildWhere(
      eq(oauth2Clients.id, id),
      tenantCondition(oauth2Clients, user),
      options.ownerId !== undefined ? eq(oauth2Clients.ownerId, options.ownerId) : undefined,
      options.allowedReviewStatuses?.length
        ? inArray(oauth2Clients.reviewStatus, options.allowedReviewStatuses)
        : undefined,
    );
    const result = await tx.delete(oauth2Clients).where(deleteWhere).returning();
    requireRow(result[0], 'OAuth2 应用不存在');

    // Webhook：先删投递记录再删订阅（投递以订阅为父）
    const subscriptionIds = await tx.select({ id: appWebhookSubscriptions.id })
      .from(appWebhookSubscriptions)
      .where(eq(appWebhookSubscriptions.clientId, existing.clientId));
    if (subscriptionIds.length > 0) {
      await tx.delete(appWebhookDeliveries)
        .where(inArray(appWebhookDeliveries.subscriptionId, subscriptionIds.map((s) => s.id)));
      await tx.delete(appWebhookSubscriptions)
        .where(eq(appWebhookSubscriptions.clientId, existing.clientId));
    }

    // 凭证与授权：令牌 → 令牌族（令牌引用族）→ 授权码 → 用户授权
    await tx.delete(oauth2Tokens).where(eq(oauth2Tokens.clientId, existing.clientId));
    await tx.delete(oauth2TokenFamilies).where(eq(oauth2TokenFamilies.clientId, existing.clientId));
    await tx.delete(oauth2AuthorizationCodes).where(eq(oauth2AuthorizationCodes.clientId, existing.clientId));
    await tx.delete(oauth2UserGrants).where(eq(oauth2UserGrants.clientId, existing.clientId));

    // 配额告警队列
    await tx.delete(openQuotaAlerts).where(eq(openQuotaAlerts.clientId, existing.clientId));
  });
}

export async function regenerateOAuth2ClientSecret(id: number) {
  const user = currentUser();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(oauth2Clients)
      .where(and(eq(oauth2Clients.id, id), tenantCondition(oauth2Clients, user)))
      .for('update')
      .limit(1);
    requireRow(row, 'OAuth2 应用不存在');
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
    await tx.update(oauth2TokenFamilies)
      .set({ revoked: true })
      .where(eq(oauth2TokenFamilies.clientId, row.clientId));
    await tx.delete(oauth2AuthorizationCodes)
      .where(eq(oauth2AuthorizationCodes.clientId, row.clientId));

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
  const comment = input.comment?.trim() || null;
  // 驳回必须说明原因：开发者只能看到「已驳回」而不知道改什么，等于把流程卡死
  if (input.action === 'reject' && !comment) {
    throw new HTTPException(400, { message: '驳回必须填写审核意见' });
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.update(oauth2Clients).set({
      reviewStatus: input.action === 'approve' ? 'approved' : 'rejected',
      reviewComment: comment,
      reviewedAt: new Date(),
      reviewedBy: user.userId,
    }).where(and(
      eq(oauth2Clients.id, id),
      eq(oauth2Clients.reviewStatus, 'pending'),
      tenantCondition(oauth2Clients, user),
    )).returning();
    requireRow(row, '仅待审核应用可执行审核操作', 400);
    if (input.action === 'reject') {
      await tx.delete(oauth2AuthorizationCodes)
        .where(eq(oauth2AuthorizationCodes.clientId, row.clientId));
      await tx.update(oauth2TokenFamilies)
        .set({ revoked: true })
        .where(eq(oauth2TokenFamilies.clientId, row.clientId));
      await tx.update(oauth2Tokens)
        .set({ revoked: true })
        .where(eq(oauth2Tokens.clientId, row.clientId));
    }
    return mapClientRow(row);
  });
}

// ─── 令牌管理 ─────────────────────────────────────────────────────────────────

async function ensureScopedClientByClientId(clientId: string) {
  return requireFirstRow(
    db
      .select({ clientId: oauth2Clients.clientId })
      .from(oauth2Clients)
      .where(and(
        eq(oauth2Clients.clientId, clientId),
        tenantCondition(oauth2Clients, currentUser()),
      ))
      .limit(1),
    'OAuth2 应用不存在',
  );
}

export async function listClientTokens(clientId: string, opts: { page: number; pageSize: number }) {
  await ensureScopedClientByClientId(clientId);
  const { page, pageSize } = opts;
  const where = eq(oauth2Tokens.clientId, clientId);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(oauth2Tokens, where),
    rows: () => db.select().from(oauth2Tokens)
      .where(where)
      .orderBy(desc(oauth2Tokens.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (r) => ({
      id: r.id,
      tokenType: r.tokenType as 'access' | 'refresh',
      tokenPrefix: r.tokenPrefix,
      clientId: r.clientId,
      userId: r.userId,
      scopes: r.scopes ?? [],
      expiresAt: formatNullableDateTime(r.expiresAt),
      revoked: r.revoked,
      createdAt: formatDateTime(r.createdAt),
    }),
  });
}

export async function listClientGrants(clientId: string, opts: { page: number; pageSize: number }) {
  await ensureScopedClientByClientId(clientId);
  const { page, pageSize } = opts;
  const where = eq(oauth2UserGrants.clientId, clientId);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(oauth2UserGrants, where),
    rows: () => db.select({
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
    map: (row) => ({
      ...row,
      scopes: row.scopes ?? [],
      ...formatTimestamps(row),
    }),
  });
}

export async function getOAuth2TokenBeforeAudit(id: number) {
  const [row] = await db.select().from(oauth2Tokens).where(eq(oauth2Tokens.id, id));
  requireRow(row, '令牌不存在');
  await ensureScopedClientByClientId(row.clientId);
  return mapTokenAuditRow(row);
}

export async function revokeToken(id: number) {
  const [token] = await db.select({ clientId: oauth2Tokens.clientId }).from(oauth2Tokens).where(eq(oauth2Tokens.id, id)).limit(1);
  requireRow(token, '令牌不存在');
  await ensureScopedClientByClientId(token.clientId);
  const result = await db
    .update(oauth2Tokens)
    .set({ revoked: true })
    .where(and(eq(oauth2Tokens.id, id), eq(oauth2Tokens.clientId, token.clientId)))
    .returning();
  requireRow(result[0], '令牌不存在');
}

// ─── 用户自助授权管理（我的已授权应用）─────────────────────────────────────────

/**
 * 当前用户已授权的第三方应用列表。
 *
 * 对标 GitHub「Authorized OAuth Apps」：用户必须能看见自己把哪些权限交给了谁，
 * 并能随时收回——否则一旦授权就再也无法自主撤销，只能求助管理员。
 */
export async function listMyGrants(userId: number, opts: { page: number; pageSize: number }) {
  const { page, pageSize } = opts;
  const where = eq(oauth2UserGrants.userId, userId);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(oauth2UserGrants, where),
    rows: () => db.select({
      id: oauth2UserGrants.id,
      clientId: oauth2UserGrants.clientId,
      appName: oauth2Clients.name,
      appLogoUrl: oauth2Clients.logoUrl,
      appDescription: oauth2Clients.description,
      environment: oauth2Clients.environment,
      scopes: oauth2UserGrants.scopes,
      createdAt: oauth2UserGrants.createdAt,
      updatedAt: oauth2UserGrants.updatedAt,
    })
      .from(oauth2UserGrants)
      .leftJoin(oauth2Clients, eq(oauth2UserGrants.clientId, oauth2Clients.clientId))
      .where(where)
      .orderBy(desc(oauth2UserGrants.updatedAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (row) => ({
      id: row.id,
      clientId: row.clientId,
      appName: row.appName ?? row.clientId,
      appLogoUrl: row.appLogoUrl ?? null,
      appDescription: row.appDescription ?? null,
      environment: row.environment ?? 'production',
      scopes: row.scopes ?? [],
      ...formatTimestamps(row),
    }),
  });
}

/**
 * 撤销当前用户对某个应用的授权：删除授权记录，并连带作废该用户在该应用下的
 * 全部令牌与未兑换授权码——只删授权记录而留下有效 access_token 等于没撤销。
 */
export async function revokeMyGrant(userId: number, grantId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [grant] = await tx.select().from(oauth2UserGrants)
      .where(and(eq(oauth2UserGrants.id, grantId), eq(oauth2UserGrants.userId, userId)))
      .for('update')
      .limit(1);
    requireRow(grant, '授权记录不存在');

    await tx.delete(oauth2UserGrants).where(eq(oauth2UserGrants.id, grantId));
    await tx.delete(oauth2AuthorizationCodes).where(and(
      eq(oauth2AuthorizationCodes.clientId, grant.clientId),
      eq(oauth2AuthorizationCodes.userId, userId),
    ));
    await tx.update(oauth2Tokens).set({ revoked: true }).where(and(
      eq(oauth2Tokens.clientId, grant.clientId),
      eq(oauth2Tokens.userId, userId),
    ));
    await tx.update(oauth2TokenFamilies).set({ revoked: true }).where(and(
      eq(oauth2TokenFamilies.clientId, grant.clientId),
      eq(oauth2TokenFamilies.userId, userId),
    ));
  });
}
