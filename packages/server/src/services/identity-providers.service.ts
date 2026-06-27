import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, desc, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  CreateTenantIdentityProviderInput,
  IdentityProviderAttributeMapping,
  UpdateTenantIdentityProviderInput,
} from '@zenith/shared';
import { config } from '../config';
import { db } from '../db';
import { roles, tenantIdentityProviders, tenants, userIdentityAccounts, userRoles, users } from '../db/schema';
import redis from '../lib/redis';
import { formatDateTime } from '../lib/datetime';
import { escapeLike } from '../lib/where-helpers';
import { pageOffset } from '../lib/pagination';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { httpGet, httpPost, HttpClientError } from '../lib/http-client';
import { finalizeLogin, type DeviceInfo } from './auth.service';

const SECRET_MASK = '******';
const OIDC_STATE_TTL = 5 * 60;
const OIDC_STATE_PREFIX = `${config.redis.keyPrefix}idp-oidc-state:`;

const DEFAULT_MAPPING: Required<IdentityProviderAttributeMapping> = {
  subject: 'sub',
  email: 'email',
  username: 'preferred_username',
  nickname: 'name',
};

interface OidcStatePayload {
  providerId: number;
  redirectTo?: string | null;
  ip: string;
  ua: string;
}

type ProviderRow = typeof tenantIdentityProviders.$inferSelect & {
  tenant?: { name: string; code: string; status: 'enabled' | 'disabled'; expireAt: Date | null } | null;
};

function maskSecret(value: string | null | undefined): string {
  return value ? SECRET_MASK : '';
}

function normalizeMapping(mapping?: IdentityProviderAttributeMapping | null): Required<IdentityProviderAttributeMapping> {
  return { ...DEFAULT_MAPPING, ...(mapping ?? {}) };
}

function readMappedString(profile: Record<string, unknown>, key: string): string | null {
  const value = profile[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

export function mapIdentityProvider(row: ProviderRow) {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    tenantName: row.tenant?.name ?? null,
    name: row.name,
    code: row.code,
    type: row.type,
    status: row.status,
    issuer: row.issuer,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    userinfoEndpoint: row.userinfoEndpoint,
    jwksUri: row.jwksUri,
    clientId: row.clientId,
    clientSecret: maskSecret(row.clientSecret),
    scopes: row.scopes,
    samlSsoUrl: row.samlSsoUrl,
    samlEntityId: row.samlEntityId,
    samlCertificate: maskSecret(row.samlCertificate),
    attributeMapping: normalizeMapping(row.attributeMapping),
    jitEnabled: row.jitEnabled,
    defaultRoleIds: row.defaultRoleIds,
    remark: row.remark,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function ensureTenantUsable(tenantId: number | null | undefined) {
  if (tenantId == null) return null;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new HTTPException(404, { message: '租户不存在' });
  if (tenant.status === 'disabled') throw new HTTPException(403, { message: '租户已禁用' });
  if (tenant.expireAt && tenant.expireAt < new Date()) throw new HTTPException(403, { message: '租户已过期' });
  return tenant;
}

async function ensureDefaultRolesExist(roleIds: number[], tenantId: number | null | undefined) {
  if (roleIds.length === 0) return;
  const uniq = Array.from(new Set(roleIds));
  const rows = await db.query.roles.findMany({
    where: tenantId == null
      ? and(isNull(roles.tenantId), or(...uniq.map((id) => eq(roles.id, id))))
      : and(eq(roles.tenantId, tenantId), or(...uniq.map((id) => eq(roles.id, id)))),
    columns: { id: true },
  });
  if (rows.length !== uniq.length) throw new HTTPException(400, { message: '默认角色不存在或不属于当前租户' });
}

function buildProviderValues(
  data: CreateTenantIdentityProviderInput | UpdateTenantIdentityProviderInput,
  existing?: typeof tenantIdentityProviders.$inferSelect,
) {
  const values: Partial<typeof tenantIdentityProviders.$inferInsert> = {};
  for (const key of [
    'tenantId', 'name', 'code', 'type', 'status', 'issuer', 'authorizationEndpoint',
    'tokenEndpoint', 'userinfoEndpoint', 'jwksUri', 'clientId', 'scopes', 'samlSsoUrl',
    'samlEntityId', 'attributeMapping', 'jitEnabled', 'defaultRoleIds', 'remark',
  ] as const) {
    if (key in data) {
      values[key] = data[key] as never;
    }
  }
  if ('clientSecret' in data && data.clientSecret !== SECRET_MASK) {
    values.clientSecret = data.clientSecret || null;
  } else if (!existing && !('clientSecret' in data)) {
    values.clientSecret = null;
  }
  if ('samlCertificate' in data && data.samlCertificate !== SECRET_MASK) {
    values.samlCertificate = data.samlCertificate || null;
  } else if (!existing && !('samlCertificate' in data)) {
    values.samlCertificate = null;
  }
  if (values.attributeMapping) values.attributeMapping = normalizeMapping(values.attributeMapping);
  if (values.defaultRoleIds) values.defaultRoleIds = Array.from(new Set(values.defaultRoleIds));
  return values;
}

export interface ListIdentityProvidersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  tenantId?: number;
  type?: 'oidc' | 'saml';
  status?: 'enabled' | 'disabled';
}

export async function listIdentityProviders(query: ListIdentityProvidersQuery) {
  const { page = 1, pageSize = 10, keyword, tenantId, type, status } = query;
  const conditions = [];
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(tenantIdentityProviders.name, kw), ilike(tenantIdentityProviders.code, kw)));
  }
  if (tenantId) conditions.push(eq(tenantIdentityProviders.tenantId, tenantId));
  if (type) conditions.push(eq(tenantIdentityProviders.type, type));
  if (status) conditions.push(eq(tenantIdentityProviders.status, status));
  const where = conditions.length ? and(...conditions) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(tenantIdentityProviders, where),
    db.query.tenantIdentityProviders.findMany({
      where,
      with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
      orderBy: desc(tenantIdentityProviders.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapIdentityProvider), total, page, pageSize };
}

export async function getIdentityProvider(id: number) {
  const row = await db.query.tenantIdentityProviders.findFirst({
    where: eq(tenantIdentityProviders.id, id),
    with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '身份源不存在' });
  return mapIdentityProvider(row);
}

export async function createIdentityProvider(data: CreateTenantIdentityProviderInput) {
  const tenantId = data.tenantId ?? null;
  await ensureTenantUsable(tenantId);
  await ensureDefaultRolesExist(data.defaultRoleIds ?? [], tenantId);
  const values = buildProviderValues({ ...data, tenantId });
  try {
    const [created] = await db.insert(tenantIdentityProviders).values(values as typeof tenantIdentityProviders.$inferInsert).returning();
    return getIdentityProvider(created.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '身份源编码已存在');
    throw err;
  }
}

export async function updateIdentityProvider(id: number, data: UpdateTenantIdentityProviderInput) {
  const [existing] = await db.select().from(tenantIdentityProviders).where(eq(tenantIdentityProviders.id, id)).limit(1);
  if (!existing) throw new HTTPException(404, { message: '身份源不存在' });
  const tenantId = data.tenantId === undefined ? existing.tenantId : (data.tenantId ?? null);
  await ensureTenantUsable(tenantId);
  await ensureDefaultRolesExist(data.defaultRoleIds ?? existing.defaultRoleIds, tenantId);
  if (data.code) {
    const [dup] = await db
      .select({ id: tenantIdentityProviders.id })
      .from(tenantIdentityProviders)
      .where(and(
        tenantId == null ? isNull(tenantIdentityProviders.tenantId) : eq(tenantIdentityProviders.tenantId, tenantId),
        eq(tenantIdentityProviders.code, data.code),
        ne(tenantIdentityProviders.id, id),
      ))
      .limit(1);
    if (dup) throw new HTTPException(400, { message: '身份源编码已存在' });
  }
  const values = buildProviderValues(data, existing);
  const [updated] = await db.update(tenantIdentityProviders).set(values).where(eq(tenantIdentityProviders.id, id)).returning();
  if (!updated) throw new HTTPException(404, { message: '身份源不存在' });
  return getIdentityProvider(id);
}

export async function deleteIdentityProvider(id: number) {
  const [row] = await db.delete(tenantIdentityProviders).where(eq(tenantIdentityProviders.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '身份源不存在' });
}

export async function getIdentityProviderBeforeAudit(id: number) {
  const row = await db.query.tenantIdentityProviders.findFirst({
    where: eq(tenantIdentityProviders.id, id),
    with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
  });
  return row ? mapIdentityProvider(row) : null;
}

export async function discoverEnterpriseIdentityProviders(tenantCode?: string | null) {
  let tenantId: number | null = null;
  if (tenantCode) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.code, tenantCode)).limit(1);
    if (!tenant || tenant.status === 'disabled' || (tenant.expireAt && tenant.expireAt < new Date())) {
      return { tenantCode, providers: [] };
    }
    tenantId = tenant.id;
  }

  const rows = await db
    .select({
      id: tenantIdentityProviders.id,
      name: tenantIdentityProviders.name,
      code: tenantIdentityProviders.code,
      type: tenantIdentityProviders.type,
    })
    .from(tenantIdentityProviders)
    .where(and(
      eq(tenantIdentityProviders.status, 'enabled'),
      tenantId == null ? isNull(tenantIdentityProviders.tenantId) : eq(tenantIdentityProviders.tenantId, tenantId),
    ))
    .orderBy(tenantIdentityProviders.id);
  return { tenantCode: tenantCode ?? null, providers: rows };
}

async function getUsableProvider(id: number) {
  const row = await db.query.tenantIdentityProviders.findFirst({
    where: eq(tenantIdentityProviders.id, id),
    with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '身份源不存在' });
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '身份源未启用' });
  if (row.tenant && row.tenant.status === 'disabled') throw new HTTPException(403, { message: '租户已禁用' });
  if (row.tenant?.expireAt && row.tenant.expireAt < new Date()) throw new HTTPException(403, { message: '租户已过期' });
  return row;
}

function oidcRedirectUri(): string {
  return `${config.oauth.callbackBaseUrl}/enterprise/callback`;
}

export async function generateEnterpriseAuthUrl(providerId: number, client: { ip: string; ua: string; redirectTo?: string | null }) {
  const provider = await getUsableProvider(providerId);
  if (provider.type === 'saml') {
    if (!provider.samlSsoUrl) throw new HTTPException(400, { message: 'SAML SSO URL 未配置' });
    return { authUrl: provider.samlSsoUrl, state: null };
  }
  if (!provider.authorizationEndpoint || !provider.clientId) {
    throw new HTTPException(400, { message: 'OIDC 授权端点或 Client ID 未配置' });
  }
  const state = crypto.randomBytes(24).toString('hex');
  const payload: OidcStatePayload = {
    providerId: provider.id,
    redirectTo: client.redirectTo ?? null,
    ip: client.ip,
    ua: client.ua,
  };
  await redis.set(`${OIDC_STATE_PREFIX}${state}`, JSON.stringify(payload), 'EX', OIDC_STATE_TTL);
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: oidcRedirectUri(),
    response_type: 'code',
    scope: provider.scopes || 'openid profile email',
    state,
  });
  return { authUrl: `${provider.authorizationEndpoint}?${params}`, state };
}

interface OidcTokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function exchangeOidcCode(provider: typeof tenantIdentityProviders.$inferSelect, code: string): Promise<OidcTokenResponse> {
  if (!provider.tokenEndpoint || !provider.clientId) throw new HTTPException(400, { message: 'OIDC Token Endpoint 或 Client ID 未配置' });
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oidcRedirectUri(),
    client_id: provider.clientId,
  });
  if (provider.clientSecret) body.set('client_secret', provider.clientSecret);
  const resp = await httpPost(provider.tokenEndpoint, body, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    timeout: 10_000,
    retries: 1,
  });
  const data = await resp.json<OidcTokenResponse>();
  if (!resp.ok || data.error) {
    throw new HttpClientError(data.error_description || data.error || 'OIDC token request failed', { status: resp.status, url: resp.url });
  }
  return data;
}

async function loadOidcProfile(provider: typeof tenantIdentityProviders.$inferSelect, token: OidcTokenResponse) {
  if (provider.userinfoEndpoint && token.access_token) {
    const resp = await httpGet(provider.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
      timeout: 10_000,
      retries: 1,
    });
    if (resp.ok) return resp.json<Record<string, unknown>>();
  }
  throw new HTTPException(400, { message: 'OIDC UserInfo Endpoint 未配置或无法获取用户信息' });
}

function normalizeExternalProfile(provider: typeof tenantIdentityProviders.$inferSelect, profile: Record<string, unknown>) {
  const mapping = normalizeMapping(provider.attributeMapping);
  const subject = readMappedString(profile, mapping.subject);
  if (!subject) throw new HTTPException(400, { message: '企业身份源未返回用户唯一标识' });
  const email = readMappedString(profile, mapping.email);
  const username = readMappedString(profile, mapping.username) ?? email?.split('@')[0] ?? `idp_${subject.slice(0, 24)}`;
  const nickname = readMappedString(profile, mapping.nickname) ?? username;
  return { subject, email, username, nickname };
}

async function findOrCreateUserForProvider(provider: typeof tenantIdentityProviders.$inferSelect, profile: Record<string, unknown>) {
  const external = normalizeExternalProfile(provider, profile);
  const now = new Date();
  const [existingAccount] = await db
    .select()
    .from(userIdentityAccounts)
    .where(and(eq(userIdentityAccounts.providerId, provider.id), eq(userIdentityAccounts.subject, external.subject)))
    .limit(1);
  if (existingAccount) {
    const [user] = await db.select().from(users).where(eq(users.id, existingAccount.userId)).limit(1);
    if (!user) throw new HTTPException(401, { message: '绑定用户不存在' });
    await db.update(userIdentityAccounts).set({ lastLoginAt: now, rawProfile: profile }).where(eq(userIdentityAccounts.id, existingAccount.id));
    return user;
  }

  const conditions = [];
  conditions.push(and(eq(users.username, external.username), provider.tenantId == null ? isNull(users.tenantId) : eq(users.tenantId, provider.tenantId)));
  if (external.email) {
    conditions.push(and(eq(users.email, external.email), provider.tenantId == null ? isNull(users.tenantId) : eq(users.tenantId, provider.tenantId)));
  }
  const [matchedUser] = await db.select().from(users).where(or(...conditions)).limit(1);
  if (matchedUser) {
    await db.insert(userIdentityAccounts).values({
      userId: matchedUser.id,
      providerId: provider.id,
      subject: external.subject,
      email: external.email,
      username: external.username,
      displayName: external.nickname,
      rawProfile: profile,
      lastLoginAt: now,
    });
    return matchedUser;
  }

  if (!provider.jitEnabled) throw new HTTPException(403, { message: '未找到匹配账号，请联系管理员开通账号或启用 JIT 创建' });
  if (!external.email) throw new HTTPException(400, { message: '企业身份源未返回邮箱，无法自动创建账号' });

  const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(users).values({
      username: external.username.slice(0, 32),
      nickname: external.nickname.slice(0, 32),
      email: external.email,
      password,
      tenantId: provider.tenantId ?? null,
    }).returning();
    await tx.insert(userIdentityAccounts).values({
      userId: created.id,
      providerId: provider.id,
      subject: external.subject,
      email: external.email,
      username: external.username,
      displayName: external.nickname,
      rawProfile: profile,
      lastLoginAt: now,
    });
    if (provider.defaultRoleIds.length > 0) {
      await tx.insert(userRoles).values(provider.defaultRoleIds.map((roleId) => ({ userId: created.id, roleId }))).onConflictDoNothing();
    }
    return created;
  });
}

export async function handleEnterpriseOidcCallback(code: string, state: string, deviceInfo?: DeviceInfo) {
  const stateKey = `${OIDC_STATE_PREFIX}${state}`;
  const raw = await redis.get(stateKey);
  if (!raw) throw new HTTPException(400, { message: '企业登录状态已过期，请重新发起登录' });
  await redis.del(stateKey);
  const payload = JSON.parse(raw) as OidcStatePayload;
  const provider = await getUsableProvider(payload.providerId);
  if (provider.type !== 'oidc') throw new HTTPException(400, { message: '身份源类型不匹配' });
  const token = await exchangeOidcCode(provider, code);
  const profile = await loadOidcProfile(provider, token);
  const user = await findOrCreateUserForProvider(provider, profile);
  if (user.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  const loginResult = await finalizeLogin(
    user,
    { ip: payload.ip, ua: payload.ua, deviceInfo },
    { logMessage: `企业身份源 ${provider.name} 登录成功` },
  );
  return { loginResult, redirectTo: payload.redirectTo ?? null };
}
