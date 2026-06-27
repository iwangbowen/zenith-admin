import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { eq, desc, ilike } from 'drizzle-orm';
import { db } from '../db';
import { oauth2Clients, oauth2Tokens } from '../db/schema';
import { currentUser } from '../lib/context';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { pageOffset } from '../lib/pagination';
import { encryptField, decryptField } from '../lib/encryption';

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

export async function listOAuth2Clients(opts: { page: number; pageSize: number; keyword?: string }) {
  const { page, pageSize, keyword } = opts;
  const where = keyword ? ilike(oauth2Clients.name, `%${keyword}%`) : undefined;
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

export async function createOAuth2Client(input: {
  name: string;
  description?: string;
  logoUrl?: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: string[];
  isPublic: boolean;
  ratePlanId?: number | null;
  signEnabled?: boolean;
}) {
  const user = currentUser();
  if (!input.name?.trim()) throw new HTTPException(400, { message: '应用名称不能为空' });

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
      ownerId: user.userId,
    }).returning();

    return {
      id: row.id,
      clientId: row.clientId,
      clientSecret: secretRaw ?? '',
      name: row.name,
      redirectUris: row.redirectUris ?? [],
      allowedScopes: row.allowedScopes ?? [],
      grantTypes: row.grantTypes ?? [],
      isPublic: row.isPublic,
      status: row.status,
      createdAt: formatDateTime(row.createdAt),
    };
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

export async function updateOAuth2Client(id: number, input: {
  name?: string;
  description?: string;
  logoUrl?: string;
  redirectUris?: string[];
  allowedScopes?: string[];
  grantTypes?: string[];
  isPublic?: boolean;
  ratePlanId?: number | null;
  signEnabled?: boolean;
  status?: 'enabled' | 'disabled';
}) {
  const existing = await getOAuth2Client(id);
  if (!existing) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });

  try {
    const [row] = await db.update(oauth2Clients)
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
        status: input.status,
      })
      .where(eq(oauth2Clients.id, id))
      .returning();
    return mapClientRow(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '应用名称已存在');
    throw err;
  }
}

export async function deleteOAuth2Client(id: number) {
  const result = await db.delete(oauth2Clients).where(eq(oauth2Clients.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });
}

export async function regenerateOAuth2ClientSecret(id: number) {
  const existing = await getOAuth2Client(id);
  if (!existing) throw new HTTPException(404, { message: 'OAuth2 应用不存在' });
  if (existing.isPublic) throw new HTTPException(400, { message: '公开客户端不使用 secret' });

  const sec = generateClientSecret();
  await db.update(oauth2Clients).set({
    clientSecretHash: sec.hash,
    clientSecretEncrypted: encryptField(sec.raw),
    clientSecretPrefix: sec.prefix,
  }).where(eq(oauth2Clients.id, id));

  return { clientId: existing.clientId, clientSecret: sec.raw };
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

export async function getOAuth2TokenBeforeAudit(id: number) {
  const [row] = await db.select().from(oauth2Tokens).where(eq(oauth2Tokens.id, id));
  if (!row) throw new HTTPException(404, { message: '令牌不存在' });
  return mapTokenAuditRow(row);
}

export async function revokeToken(id: number) {
  const result = await db.update(oauth2Tokens).set({ revoked: true }).where(eq(oauth2Tokens.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: '令牌不存在' });
}
