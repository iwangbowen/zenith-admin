import crypto from 'node:crypto';
import { hashPassword } from '../../lib/password';
import { Client, InvalidCredentialsError, type Entry } from 'ldapts';
import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateTenantIdentityProviderInput, IdentityProviderConnectionTestResult, IdentityProviderAttributeMapping, IdentityProviderSyncResult, IdentityProviderType, LdapDirectoryUser, UpdateTenantIdentityProviderInput } from '@zenith/shared/identity';
import { config } from '../../config';
import { db } from '../../db';
import { identityProviderSyncLogs, tenantIdentityProviders, tenants, userIdentityAccounts, userRoles, users, type UserRow } from '../../db/schema';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import { isTenantActive, isTenantExpired, resolveManagedTenantId, tenantScope } from '../../lib/tenant';
import { syncUserDynamicMembershipsSafe } from './user-group-rules.service';
import redis from '../../lib/redis';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { httpGet, httpPost, HttpClientError } from '../../lib/http-client';
import { getSettings } from '../../lib/settings';
import { checkLoginLock, clearLoginAttempts, recordLoginFailure } from '../../lib/session-manager';
import { completeLoginWithMfa, recordLoginLog, type DeviceInfo } from './auth.service';
import { assertDefaultRolesGrantable, resolveGrantableDefaultRoleIds, userHasPlatformSuperRole } from './role-grant';

const SECRET_MASK = '******';
const OIDC_STATE_TTL = 5 * 60;
const OIDC_STATE_PREFIX = `${config.redis.keyPrefix}idp-oidc-state:`;
const SAML_STATE_TTL = 5 * 60;
const SAML_STATE_PREFIX = `${config.redis.keyPrefix}idp-saml-state:`;
const SAML_REQUEST_PREFIX = `${config.redis.keyPrefix}idp-saml-request:`;
const SAML_LOGIN_TICKET_TTL = 60;
const SAML_LOGIN_TICKET_PREFIX = `${config.redis.keyPrefix}idp-saml-login-ticket:`;
const DEFAULT_LDAP_USER_FILTER = '(&(objectClass=person)(|(uid={{username}})(sAMAccountName={{username}})(mail={{username}})))';
const DEFAULT_LDAP_USER_SEARCH_FILTER = '(&(objectClass=person)(|(cn=*{{keyword}}*)(displayName=*{{keyword}}*)(uid=*{{keyword}}*)(sAMAccountName=*{{keyword}}*)(mail=*{{keyword}}*)))';
const DEFAULT_LDAP_SYNC_FILTER = '(&(objectClass=person)(|(uid=*)(sAMAccountName=*)(mail=*)))';

const DEFAULT_MAPPING: Required<IdentityProviderAttributeMapping> = {
  subject: 'sub',
  email: 'email',
  username: 'preferred_username',
  nickname: 'name',
  phone: 'phone_number',
  department: 'department',
};

const SAML_DEFAULT_MAPPING: Required<IdentityProviderAttributeMapping> = {
  subject: 'NameID',
  email: 'email',
  username: 'username',
  nickname: 'displayName',
  phone: 'phone',
  department: 'department',
};

const LDAP_DEFAULT_MAPPING: Required<IdentityProviderAttributeMapping> = {
  subject: 'entryUUID',
  email: 'mail',
  username: 'uid',
  nickname: 'cn',
  phone: 'telephoneNumber',
  department: 'ou',
};

const AD_DEFAULT_MAPPING: Required<IdentityProviderAttributeMapping> = {
  subject: 'objectGUID',
  email: 'mail',
  username: 'sAMAccountName',
  nickname: 'displayName',
  phone: 'telephoneNumber',
  department: 'department',
};

interface EnterpriseAuthStatePayload {
  providerId: number;
  redirectTo?: string | null;
  ip: string;
  ua: string;
  samlRequestId?: string;
}

type EnterpriseLoginResult = Awaited<ReturnType<typeof completeLoginWithMfa>>;

interface SamlLoginTicketPayload {
  loginResult: EnterpriseLoginResult;
  redirectTo?: string | null;
}

type ProviderRow = typeof tenantIdentityProviders.$inferSelect & {
  tenant?: { name: string; code: string; status: 'enabled' | 'disabled'; expireAt: Date | null } | null;
};

function maskSecret(value: string | null | undefined): string {
  return value ? SECRET_MASK : '';
}

function normalizeMapping(
  mapping?: IdentityProviderAttributeMapping | null,
  providerType: IdentityProviderType = 'oidc',
): Required<IdentityProviderAttributeMapping> {
  const base = providerType === 'saml'
    ? SAML_DEFAULT_MAPPING
    : providerType === 'ldap'
      ? LDAP_DEFAULT_MAPPING
      : providerType === 'ad'
        ? AD_DEFAULT_MAPPING
        : DEFAULT_MAPPING;
  return { ...base, ...(mapping ?? {}) };
}

function readMappedString(profile: Record<string, unknown>, key: string): string | null {
  if (!key) return null;
  const value = profile[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      if (typeof item === 'number') return String(item);
    }
  }
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
    ldapUrl: row.ldapUrl,
    ldapStartTls: row.ldapStartTls,
    ldapSkipTlsVerify: row.ldapSkipTlsVerify,
    ldapBaseDn: row.ldapBaseDn,
    ldapBindDn: row.ldapBindDn,
    ldapBindPassword: maskSecret(row.ldapBindPassword),
    ldapUserFilter: row.ldapUserFilter,
    ldapUserSearchFilter: row.ldapUserSearchFilter,
    ldapSyncFilter: row.ldapSyncFilter,
    ldapGroupBaseDn: row.ldapGroupBaseDn,
    ldapGroupFilter: row.ldapGroupFilter,
    ldapTimeoutMs: row.ldapTimeoutMs,
    attributeMapping: normalizeMapping(row.attributeMapping, row.type),
    jitEnabled: row.jitEnabled,
    autoLinkByEmail: row.autoLinkByEmail,
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
  if (tenant.status !== 'enabled') throw new HTTPException(403, { message: '租户已禁用' });
  if (isTenantExpired(tenant)) throw new HTTPException(403, { message: '租户已过期' });
  return tenant;
}

const PROVIDER_TENANT_SCOPE_MESSAGE = '无权为其他租户或平台配置身份源';

/**
 * 管理侧读取：id + 调用者租户作用域，越界一律 404（不暴露存在性）。
 * 公开登录流程请用 `getUsableProvider`（不依赖请求用户）。
 */
async function getManageableProvider(id: number): Promise<ProviderRow> {
  const row = await db.query.tenantIdentityProviders.findFirst({
    where: and(eq(tenantIdentityProviders.id, id), tenantScope(tenantIdentityProviders)),
    with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '身份源不存在' });
  return row;
}

function buildProviderValues(
  data: CreateTenantIdentityProviderInput | UpdateTenantIdentityProviderInput,
  existing?: typeof tenantIdentityProviders.$inferSelect,
) {
  const values: Partial<typeof tenantIdentityProviders.$inferInsert> = {};
  for (const key of [
    'tenantId', 'name', 'code', 'type', 'status', 'issuer', 'authorizationEndpoint',
    'tokenEndpoint', 'userinfoEndpoint', 'jwksUri', 'clientId', 'scopes', 'samlSsoUrl',
    'samlEntityId', 'ldapUrl', 'ldapStartTls', 'ldapSkipTlsVerify', 'ldapBaseDn', 'ldapBindDn',
    'ldapUserFilter', 'ldapUserSearchFilter', 'ldapSyncFilter', 'ldapGroupBaseDn', 'ldapGroupFilter',
    'ldapTimeoutMs', 'attributeMapping', 'jitEnabled', 'autoLinkByEmail', 'defaultRoleIds', 'remark',
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
  if ('ldapBindPassword' in data && data.ldapBindPassword !== SECRET_MASK) {
    values.ldapBindPassword = data.ldapBindPassword || null;
  } else if (!existing && !('ldapBindPassword' in data)) {
    values.ldapBindPassword = null;
  }
  if (values.attributeMapping) {
    const providerType = (values.type ?? existing?.type ?? data.type ?? 'oidc') as IdentityProviderType;
    values.attributeMapping = normalizeMapping(values.attributeMapping, providerType);
  }
  if (values.defaultRoleIds) values.defaultRoleIds = Array.from(new Set(values.defaultRoleIds));
  return values;
}

export interface ListIdentityProvidersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  tenantId?: number;
  type?: IdentityProviderType;
  status?: 'enabled' | 'disabled';
}

export async function listIdentityProviders(query: ListIdentityProvidersQuery) {
  const { page = 1, pageSize = 10, keyword, tenantId, type, status } = query;
  // 调用者租户作用域先行；query.tenantId 只是平台管理员的筛选项（租户用户传他租户 → 与作用域取交为空集）
  const where = buildWhere(
    tenantScope(tenantIdentityProviders),
    keywordCondition(keyword, [tenantIdentityProviders.name, tenantIdentityProviders.code], 'ilike'),
    tenantId ? eq(tenantIdentityProviders.tenantId, tenantId) : undefined,
    type ? eq(tenantIdentityProviders.type, type) : undefined,
    status ? eq(tenantIdentityProviders.status, status) : undefined,
  );

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
  return mapIdentityProvider(await getManageableProvider(id));
}

export async function createIdentityProvider(data: CreateTenantIdentityProviderInput) {
  const tenantId = resolveManagedTenantId(data.tenantId, PROVIDER_TENANT_SCOPE_MESSAGE);
  await ensureTenantUsable(tenantId);
  await assertDefaultRolesGrantable(data.defaultRoleIds ?? [], tenantId);
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
  const existing = await getManageableProvider(id);
  // 归属迁移只对平台管理员开放；其他人未传则沿用，传了不一致的值由 resolveManagedTenantId 拒绝
  const tenantId = data.tenantId === undefined
    ? existing.tenantId
    : resolveManagedTenantId(data.tenantId, PROVIDER_TENANT_SCOPE_MESSAGE);
  await ensureTenantUsable(tenantId);
  await assertDefaultRolesGrantable(data.defaultRoleIds ?? existing.defaultRoleIds, tenantId);
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
  const values = buildProviderValues({ ...data, tenantId }, existing);
  const [updated] = await db.update(tenantIdentityProviders).set(values)
    .where(and(eq(tenantIdentityProviders.id, id), tenantScope(tenantIdentityProviders)))
    .returning();
  if (!updated) throw new HTTPException(404, { message: '身份源不存在' });
  return getIdentityProvider(id);
}

export async function deleteIdentityProvider(id: number) {
  const [row] = await db.delete(tenantIdentityProviders)
    .where(and(eq(tenantIdentityProviders.id, id), tenantScope(tenantIdentityProviders)))
    .returning();
  if (!row) throw new HTTPException(404, { message: '身份源不存在' });
}

export async function getIdentityProviderBeforeAudit(id: number) {
  const row = await db.query.tenantIdentityProviders.findFirst({
    where: and(eq(tenantIdentityProviders.id, id), tenantScope(tenantIdentityProviders)),
    with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
  });
  return row ? mapIdentityProvider(row) : null;
}

export async function discoverEnterpriseIdentityProviders(tenantCode?: string | null) {
  let tenantId: number | null = null;
  if (tenantCode) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.code, tenantCode)).limit(1);
    if (!tenant || !isTenantActive(tenant)) {
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

function assertProviderUsable(row: ProviderRow): ProviderRow {
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '身份源未启用' });
  if (row.tenant && row.tenant.status !== 'enabled') throw new HTTPException(403, { message: '租户已禁用' });
  if (row.tenant && isTenantExpired(row.tenant)) throw new HTTPException(403, { message: '租户已过期' });
  return row;
}

/** 公开登录流程用：不依赖请求用户，只校验身份源与租户可用 */
async function getUsableProvider(id: number) {
  const row = await db.query.tenantIdentityProviders.findFirst({
    where: eq(tenantIdentityProviders.id, id),
    with: { tenant: { columns: { name: true, code: true, status: true, expireAt: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '身份源不存在' });
  return assertProviderUsable(row);
}

/** 管理侧操作（测试连接 / 目录搜索 / 同步）用：先限定调用者租户作用域，再校验可用 */
async function getManageableUsableProvider(id: number) {
  return assertProviderUsable(await getManageableProvider(id));
}

/** 供通讯录同步连接器复用：加载可用的 LDAP/AD 身份源（含启用与租户校验） */
export async function getUsableDirectoryProvider(id: number) {
  const provider = await getUsableProvider(id);
  ensureDirectoryProvider(provider);
  return provider;
}

function isDirectoryProviderType(type: IdentityProviderType): type is 'ldap' | 'ad' {
  return type === 'ldap' || type === 'ad';
}

function ensureDirectoryProvider(provider: typeof tenantIdentityProviders.$inferSelect) {
  if (!isDirectoryProviderType(provider.type)) throw new HTTPException(400, { message: '该身份源不是 LDAP/AD 类型' });
  if (!provider.ldapUrl?.trim()) throw new HTTPException(400, { message: 'LDAP URL 未配置' });
  if (!provider.ldapBaseDn?.trim()) throw new HTTPException(400, { message: 'LDAP Base DN 未配置' });
}

function createDirectoryClient(provider: typeof tenantIdentityProviders.$inferSelect): Client {
  ensureDirectoryProvider(provider);
  return new Client({
    url: provider.ldapUrl!.trim(),
    timeout: provider.ldapTimeoutMs,
    connectTimeout: provider.ldapTimeoutMs,
    tlsOptions: { rejectUnauthorized: !provider.ldapSkipTlsVerify },
  });
}

async function prepareDirectoryClient(provider: typeof tenantIdentityProviders.$inferSelect): Promise<Client> {
  const client = createDirectoryClient(provider);
  if (provider.ldapStartTls) {
    await client.startTLS({ rejectUnauthorized: !provider.ldapSkipTlsVerify });
  }
  return client;
}

async function bindDirectoryServiceAccount(client: Client, provider: typeof tenantIdentityProviders.$inferSelect) {
  if (provider.ldapBindDn?.trim()) {
    await client.bind(provider.ldapBindDn.trim(), provider.ldapBindPassword ?? '');
  }
}

async function withDirectoryClient<T>(
  provider: typeof tenantIdentityProviders.$inferSelect,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await prepareDirectoryClient(provider);
  try {
    await bindDirectoryServiceAccount(client, provider);
    return await fn(client);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\0()*\\]/g, (char) => {
    switch (char) {
      case '\0': return '\\00';
      case '(': return '\\28';
      case ')': return '\\29';
      case '*': return '\\2a';
      case '\\': return '\\5c';
      default: return char;
    }
  });
}

function renderLdapFilter(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeLdapFilterValue(variables[key] ?? ''));
}

function normalizeEntryValue(attribute: string, value: Entry[string]): string | string[] | undefined {
  const normalizeOne = (item: Buffer | string): string => {
    if (Buffer.isBuffer(item)) return item.toString(attribute.toLowerCase() === 'objectguid' ? 'base64' : 'utf8').trim();
    return item.trim();
  };
  if (Buffer.isBuffer(value) || typeof value === 'string') {
    const normalized = normalizeOne(value);
    return normalized || undefined;
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item) => normalizeOne(item))
      .filter(Boolean);
    if (values.length === 0) return undefined;
    return values.length === 1 ? values[0] : values;
  }
  return undefined;
}

function entryToRecord(entry: Entry): Record<string, unknown> {
  const record: Record<string, unknown> = { dn: entry.dn };
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'dn') continue;
    const normalized = normalizeEntryValue(key, value);
    if (normalized !== undefined) record[key] = normalized;
  }
  return record;
}

function directorySearchAttributes(provider: typeof tenantIdentityProviders.$inferSelect): string[] {
  const mapping = normalizeMapping(provider.attributeMapping, provider.type);
  return Array.from(new Set([
    ...Object.values(mapping),
    'cn',
    'displayName',
    'mail',
    'uid',
    'sAMAccountName',
    'telephoneNumber',
    'department',
    'ou',
    'entryUUID',
    'objectGUID',
  ].filter(Boolean)));
}

export function mapDirectoryProfile(provider: typeof tenantIdentityProviders.$inferSelect, entry: Entry): { profile: Record<string, unknown>; user: LdapDirectoryUser } {
  const profile = entryToRecord(entry);
  const external = normalizeExternalProfile(provider, profile);
  const mapping = normalizeMapping(provider.attributeMapping, provider.type);
  const user: LdapDirectoryUser = {
    dn: entry.dn,
    subject: external.subject,
    email: external.email ?? null,
    username: external.username,
    nickname: external.nickname,
    phone: readMappedString(profile, mapping.phone) ?? null,
    department: readMappedString(profile, mapping.department) ?? null,
  };
  return { profile, user };
}

export async function searchDirectoryEntries(
  provider: typeof tenantIdentityProviders.$inferSelect,
  options: { keyword?: string; username?: string; limit: number; mode: 'login' | 'search' | 'sync' },
): Promise<Entry[]> {
  ensureDirectoryProvider(provider);
  const template = options.mode === 'login'
    ? (provider.ldapUserFilter || DEFAULT_LDAP_USER_FILTER)
    : options.mode === 'sync'
      ? (provider.ldapSyncFilter || DEFAULT_LDAP_SYNC_FILTER)
      : (provider.ldapUserSearchFilter || DEFAULT_LDAP_USER_SEARCH_FILTER);
  const filter = renderLdapFilter(template, {
    username: options.username ?? '',
    keyword: options.keyword ?? '',
  });
  return withDirectoryClient(provider, async (client) => {
    const { searchEntries } = await client.search(provider.ldapBaseDn!.trim(), {
      scope: 'sub',
      filter,
      attributes: directorySearchAttributes(provider),
      sizeLimit: options.limit,
      timeLimit: Math.ceil(provider.ldapTimeoutMs / 1000),
    });
    return searchEntries;
  });
}

function oidcRedirectUri(): string {
  return `${config.oauth.callbackBaseUrl}/enterprise/callback`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function samlAcsUrl(): string {
  return `${trimTrailingSlash(config.oauth.samlAcsBaseUrl)}/api/auth/enterprise/saml/acs`;
}

function enterpriseCallbackUrl(ticket: string): string {
  const url = new URL(`${trimTrailingSlash(config.oauth.callbackBaseUrl)}/enterprise/callback`);
  url.searchParams.set('samlTicket', ticket);
  return url.toString();
}

function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

class RedisSamlCacheProvider implements CacheProvider {
  constructor(private readonly prefix: string, private readonly ttlSeconds: number) {}

  async saveAsync(key: string, value: string): Promise<CacheItem> {
    await redis.set(`${this.prefix}${key}`, value, 'EX', this.ttlSeconds);
    return { value, createdAt: Date.now() };
  }

  async getAsync(key: string): Promise<string | null> {
    if (!key) return null;
    return redis.get(`${this.prefix}${key}`);
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const redisKey = `${this.prefix}${key}`;
    const value = await redis.get(redisKey);
    await redis.del(redisKey);
    return value;
  }
}

function getSamlSpEntityId(provider: typeof tenantIdentityProviders.$inferSelect): string {
  const spEntityId = provider.samlEntityId?.trim();
  if (!spEntityId) throw new HTTPException(400, { message: 'SAML SP Entity ID 未配置' });
  return spEntityId;
}

function createSamlClient(
  provider: typeof tenantIdentityProviders.$inferSelect,
  options: { onRequestId?: (id: string) => void } = {},
): SAML {
  if (!provider.samlSsoUrl) throw new HTTPException(400, { message: 'SAML SSO URL 未配置' });
  if (!provider.samlCertificate) throw new HTTPException(400, { message: 'SAML 签名证书未配置' });
  const spEntityId = getSamlSpEntityId(provider);
  const idpIssuer = provider.issuer?.trim();
  if (!idpIssuer) throw new HTTPException(400, { message: 'SAML IdP Issuer 未配置' });
  return new SAML({
    entryPoint: provider.samlSsoUrl,
    idpCert: provider.samlCertificate,
    issuer: spEntityId,
    audience: spEntityId,
    idpIssuer,
    callbackUrl: samlAcsUrl(),
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 120_000,
    maxAssertionAgeMs: SAML_STATE_TTL * 1000,
    requestIdExpirationPeriodMs: SAML_STATE_TTL * 1000,
    validateInResponseTo: ValidateInResponseTo.always,
    cacheProvider: new RedisSamlCacheProvider(`${SAML_REQUEST_PREFIX}${provider.id}:`, SAML_STATE_TTL),
    generateUniqueId: () => {
      const id = `_${randomToken(20)}`;
      options.onRequestId?.(id);
      return id;
    },
  });
}

export async function generateEnterpriseAuthUrl(providerId: number, client: { ip: string; ua: string; redirectTo?: string | null }) {
  const provider = await getUsableProvider(providerId);
  if (isDirectoryProviderType(provider.type)) {
    throw new HTTPException(400, { message: 'LDAP/AD 身份源不支持跳转授权，请使用目录账号密码登录' });
  }
  if (provider.type === 'saml') {
    const state = randomToken();
    let samlRequestId: string | undefined;
    const payload: EnterpriseAuthStatePayload = {
      providerId: provider.id,
      redirectTo: client.redirectTo ?? null,
      ip: client.ip,
      ua: client.ua,
    };
    const authUrl = await createSamlClient(provider, {
      onRequestId: (id) => {
        samlRequestId = id;
      },
    }).getAuthorizeUrlAsync(state, undefined, {});
    if (!samlRequestId) throw new HTTPException(500, { message: 'SAML AuthnRequest 生成失败' });
    payload.samlRequestId = samlRequestId;
    await redis.set(`${SAML_STATE_PREFIX}${state}`, JSON.stringify(payload), 'EX', SAML_STATE_TTL);
    return { authUrl, state };
  }
  if (!provider.authorizationEndpoint || !provider.clientId) {
    throw new HTTPException(400, { message: 'OIDC 授权端点或 Client ID 未配置' });
  }
  const state = randomToken();
  const payload: EnterpriseAuthStatePayload = {
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

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
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
  const mapping = normalizeMapping(provider.attributeMapping, provider.type);
  const subject = readMappedString(profile, mapping.subject);
  const fallbackSubject = readMappedString(profile, 'dn');
  const resolvedSubject = subject ?? fallbackSubject;
  if (!resolvedSubject) throw new HTTPException(400, { message: '企业身份源未返回用户唯一标识' });
  const email = readMappedString(profile, mapping.email);
  const username = readMappedString(profile, mapping.username) ?? email?.split('@')[0] ?? `idp_${resolvedSubject.slice(0, 24)}`;
  const nickname = readMappedString(profile, mapping.nickname) ?? username;
  const phone = readMappedString(profile, mapping.phone);
  const department = readMappedString(profile, mapping.department);
  return { subject: resolvedSubject, email, username, nickname, phone, department };
}

type NormalizedExternalProfile = ReturnType<typeof normalizeExternalProfile>;

const OIDC_EMAIL_VERIFIED_CLAIM = 'email_verified';

/**
 * IdP 是否断言邮箱已验证：OIDC 读标准 claim `email_verified`；
 * SAML / LDAP / AD 没有对应标准字段，视企业目录为权威源。
 */
function externalEmailVerified(provider: typeof tenantIdentityProviders.$inferSelect, profile: Record<string, unknown>): boolean {
  if (provider.type !== 'oidc') return true;
  const value = profile[OIDC_EMAIL_VERIFIED_CLAIM];
  return value === true || value === 'true';
}

/**
 * 按邮箱查找可与外部身份关联的本地账号（登录 / 同步共用）：
 * - 只按邮箱匹配 —— username 由 IdP 任意指定且 `admin` 之类可枚举，不能作为关联依据；
 * - 限定在身份源自己的租户作用域内，且必须唯一命中；
 * - 登录路径要求身份源显式开启 `autoLinkByEmail`（默认关闭）并由 IdP 断言邮箱已验证；
 * - 目标账号不得持有平台超管角色：超管只能在已登录态下显式绑定，任何自动路径都不接管它。
 */
async function findLinkableUserByEmail(
  provider: typeof tenantIdentityProviders.$inferSelect,
  external: NormalizedExternalProfile,
  profile: Record<string, unknown>,
  options: { requireOptIn: boolean },
): Promise<UserRow | null> {
  if (!external.email) return null;
  if (options.requireOptIn && (!provider.autoLinkByEmail || !externalEmailVerified(provider, profile))) return null;
  const tenant = provider.tenantId == null ? isNull(users.tenantId) : eq(users.tenantId, provider.tenantId);
  const matches = await db.select().from(users)
    .where(and(eq(users.email, external.email), tenant))
    .limit(2);
  if (matches.length !== 1) return null;
  const [matched] = matches;
  // 登录路径不给已禁用账号建立绑定（登录本身也会被拒绝）；管理员同步允许先绑定、后启用
  if (options.requireOptIn && matched.status !== 'enabled') return null;
  if (await userHasPlatformSuperRole(matched.id)) return null;
  return matched;
}

function identityAccountValues(input: {
  providerId: number;
  userId: number;
  external: NormalizedExternalProfile;
  profile: Record<string, unknown>;
  lastLoginAt?: Date;
}) {
  return {
    userId: input.userId,
    providerId: input.providerId,
    subject: input.external.subject,
    email: input.external.email,
    username: input.external.username,
    displayName: input.external.nickname,
    rawProfile: input.profile,
    ...(input.lastLoginAt ? { lastLoginAt: input.lastLoginAt } : {}),
  };
}

function assignStringAlias(target: Record<string, unknown>, key: string, value: unknown) {
  if (target[key] !== undefined) return;
  if (typeof value === 'string' && value.trim()) target[key] = value.trim();
}

function mapSamlProfile(profile: Profile): Record<string, unknown> {
  const source = profile as Record<string, unknown>;
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'function') record[key] = value;
  }
  const attrs = source.attributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
      if (record[key] === undefined) record[key] = value;
    }
  }
  assignStringAlias(record, 'NameID', profile.nameID);
  assignStringAlias(record, 'nameId', profile.nameID);
  assignStringAlias(record, 'sub', profile.nameID);
  assignStringAlias(record, 'email', profile.email ?? profile.mail ?? profile['urn:oid:0.9.2342.19200300.100.1.3']);
  assignStringAlias(record, 'username', record.uid ?? record.userName ?? record.email);
  assignStringAlias(record, 'displayName', record.displayName ?? record.cn ?? record.name);
  return record;
}

/**
 * 登录路径：解析外部身份对应的本地账号。
 * 1) 已绑定（providerId + subject）→ 直接返回；
 * 2) 身份源开启 autoLinkByEmail 且 IdP 断言邮箱已验证 → 关联唯一命中的本地账号（排除平台超管）；
 * 3) 否则按 JIT 建号，默认角色经 resolveGrantableDefaultRoleIds 过滤（永不授予平台保留角色）。
 * 未命中且未开 JIT → 403，请管理员先同步 / 绑定；不再按 username 隐式关联。
 */
export async function findOrCreateUserForProvider(provider: typeof tenantIdentityProviders.$inferSelect, profile: Record<string, unknown>) {
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

  const matchedUser = await findLinkableUserByEmail(provider, external, profile, { requireOptIn: true });
  if (matchedUser) {
    await db.insert(userIdentityAccounts).values(identityAccountValues({
      providerId: provider.id,
      userId: matchedUser.id,
      external,
      profile,
      lastLoginAt: now,
    }));
    return matchedUser;
  }

  if (!provider.jitEnabled) throw new HTTPException(403, { message: '未找到已绑定账号，请联系管理员完成账号绑定或启用 JIT 创建' });
  if (!external.email) throw new HTTPException(400, { message: '企业身份源未返回邮箱，无法自动创建账号' });
  const email = external.email;

  const password = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const createdUser = await db.transaction(async (tx) => {
    await reserveTenantSeats(tx, provider.tenantId ?? null);
    const [created] = await tx.insert(users).values({
      username: external.username.slice(0, 32),
      nickname: external.nickname.slice(0, 32),
      email,
      password,
      tenantId: provider.tenantId ?? null,
    }).returning();
    await tx.insert(userIdentityAccounts).values({
      userId: created.id,
      providerId: provider.id,
      subject: external.subject,
      email,
      username: external.username,
      displayName: external.nickname,
      rawProfile: profile,
      lastLoginAt: now,
    });
    const roleIds = await resolveGrantableDefaultRoleIds(provider.defaultRoleIds, provider.tenantId ?? null, tx);
    if (roleIds.length > 0) {
      await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: created.id, roleId }))).onConflictDoNothing();
    }
    return created;
  });
  syncUserDynamicMembershipsSafe([createdUser.id], 'SSO JIT 建号');
  return createdUser;
}

type ProviderSyncAction = 'created' | 'linked' | 'updated' | 'skipped';

/**
 * 管理员显式触发的目录同步：允许按邮箱把目录条目关联到本地账号（同样排除平台超管），
 * 但邮箱是找回密码的凭证通道 —— 只有身份源声明「以目录邮箱为准」（autoLinkByEmail）时才允许同步覆盖本地邮箱。
 */
export async function syncUserForProvider(provider: typeof tenantIdentityProviders.$inferSelect, profile: Record<string, unknown>): Promise<ProviderSyncAction> {
  const external = normalizeExternalProfile(provider, profile);
  const [existingAccount] = await db
    .select()
    .from(userIdentityAccounts)
    .where(and(eq(userIdentityAccounts.providerId, provider.id), eq(userIdentityAccounts.subject, external.subject)))
    .limit(1);

  if (existingAccount) {
    const [user] = await db.select().from(users).where(eq(users.id, existingAccount.userId)).limit(1);
    if (!user) return 'skipped';
    await Promise.all([
      db.update(userIdentityAccounts).set({
        email: external.email,
        username: external.username,
        displayName: external.nickname,
        rawProfile: profile,
      }).where(eq(userIdentityAccounts.id, existingAccount.id)),
      db.update(users).set({
        ...(provider.autoLinkByEmail && external.email ? { email: external.email } : {}),
        nickname: external.nickname.slice(0, 32),
        phone: external.phone ?? user.phone,
      }).where(eq(users.id, user.id)),
    ]);
    return 'updated';
  }

  const matchedUser = await findLinkableUserByEmail(provider, external, profile, { requireOptIn: false });
  if (matchedUser) {
    await db.insert(userIdentityAccounts).values(identityAccountValues({
      providerId: provider.id,
      userId: matchedUser.id,
      external,
      profile,
    }));
    return 'linked';
  }

  if (!provider.jitEnabled || !external.email) return 'skipped';
  const password = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const jitCreated = await db.transaction(async (tx) => {
    await reserveTenantSeats(tx, provider.tenantId ?? null);
    const [created] = await tx.insert(users).values({
      username: external.username.slice(0, 32),
      nickname: external.nickname.slice(0, 32),
      email: external.email!,
      phone: external.phone ?? null,
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
    });
    const roleIds = await resolveGrantableDefaultRoleIds(provider.defaultRoleIds, provider.tenantId ?? null, tx);
    if (roleIds.length > 0) {
      await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: created.id, roleId }))).onConflictDoNothing();
    }
    return created;
  });
  syncUserDynamicMembershipsSafe([jitCreated.id], '身份源同步建号');
  return 'created';
}

export async function testIdentityProviderConnection(id: number): Promise<IdentityProviderConnectionTestResult> {
  const provider = await getManageableUsableProvider(id);
  ensureDirectoryProvider(provider);
  try {
    const entries = await searchDirectoryEntries(provider, { mode: 'sync', limit: 3 });
    return {
      ok: true,
      message: '连接成功',
      sampleUsers: entries.map((entry) => mapDirectoryProfile(provider, entry).user),
    };
  } catch (err) {
    return {
      ok: false,
      message: `连接失败：${getErrorMessage(err, '未知错误')}`,
      sampleUsers: [],
    };
  }
}

export async function searchIdentityProviderUsers(
  id: number,
  query: { keyword?: string; limit?: number },
): Promise<LdapDirectoryUser[]> {
  const provider = await getManageableUsableProvider(id);
  ensureDirectoryProvider(provider);
  const entries = await searchDirectoryEntries(provider, {
    mode: query.keyword ? 'search' : 'sync',
    keyword: query.keyword,
    limit: query.limit ?? 20,
  });
  return entries.map((entry) => mapDirectoryProfile(provider, entry).user);
}

export async function syncIdentityProviderUsers(
  id: number,
  input: { limit?: number },
): Promise<IdentityProviderSyncResult> {
  const provider = await getManageableUsableProvider(id);
  ensureDirectoryProvider(provider);
  const startedAt = new Date();
  const [log] = await db.insert(identityProviderSyncLogs).values({
    providerId: provider.id,
    status: 'failed',
    triggerType: 'manual',
    startedAt,
    message: '同步中',
  }).returning();
  const stats = {
    total: 0,
    created: 0,
    linked: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const failures: Array<Record<string, unknown>> = [];
  try {
    const entries = await searchDirectoryEntries(provider, {
      mode: 'sync',
      limit: input.limit ?? 500,
    });
    stats.total = entries.length;
    for (const entry of entries) {
      try {
        const { profile, user } = mapDirectoryProfile(provider, entry);
        const action = await syncUserForProvider(provider, profile);
        stats[action] += 1;
        if (action === 'skipped' && failures.length < 50) {
          failures.push({ dn: user.dn, username: user.username, reason: '未匹配本地账号，且未启用 JIT 或缺少邮箱' });
        }
      } catch (err) {
        stats.failed += 1;
        if (failures.length < 50) failures.push({ dn: entry.dn, reason: getErrorMessage(err, '同步失败') });
      }
    }
    const status: IdentityProviderSyncResult['status'] = stats.failed > 0
      ? 'partial'
      : 'success';
    const message = `同步完成：创建 ${stats.created}，绑定 ${stats.linked}，更新 ${stats.updated}，跳过 ${stats.skipped}，失败 ${stats.failed}`;
    await db.update(identityProviderSyncLogs).set({
      ...stats,
      status,
      message,
      details: failures,
      completedAt: new Date(),
    }).where(eq(identityProviderSyncLogs.id, log.id));
    return { logId: log.id, status, ...stats, message };
  } catch (err) {
    const message = `同步失败：${getErrorMessage(err, '未知错误')}`;
    await db.update(identityProviderSyncLogs).set({
      ...stats,
      status: 'failed',
      message,
      errorMessage: getErrorMessage(err, '未知错误'),
      details: failures,
      completedAt: new Date(),
    }).where(eq(identityProviderSyncLogs.id, log.id));
    return { logId: log.id, status: 'failed', ...stats, message };
  }
}

/** 企业 SSO 的登录收口：复用 auth.service 的 MFA 决策 + 密码过期检查 + finalizeLogin */
const completeEnterpriseLogin = completeLoginWithMfa;

export async function handleEnterpriseLdapLogin(input: {
  providerId: number;
  username: string;
  password: string;
  redirectTo?: string | null;
  ip: string;
  ua: string;
  deviceInfo?: DeviceInfo;
  deviceId?: string;
}) {
  const provider = await getUsableProvider(input.providerId);
  ensureDirectoryProvider(provider);
  const lockKey = `enterprise:${provider.id}:${input.username.toLowerCase()}`;
  const remainingLockSeconds = await checkLoginLock(lockKey);
  if (remainingLockSeconds > 0) {
    const remainingMinutes = Math.ceil(remainingLockSeconds / 60);
    throw new HTTPException(423, { message: `账号已被锁定，请 ${remainingMinutes} 分钟后重试` });
  }
  // 企业身份源归属租户的身份安全策略（平台级身份源用平台策略）
  const { lockout } = await getSettings('identitySecurity', { tenantId: provider.tenantId ?? null });
  const loginMaxAttempts = lockout.maxAttempts;
  const lockDurationSeconds = lockout.durationMinutes * 60;
  const failCredentials = async () => {
    await Promise.all([
      recordLoginLog({
        ip: input.ip,
        ua: input.ua,
        username: input.username,
        status: 'fail',
        message: `企业身份源 ${provider.name} 目录账号或密码错误`,
        tenantId: provider.tenantId ?? null,
      }),
      recordLoginFailure(lockKey, loginMaxAttempts, lockDurationSeconds),
    ]);
    throw new HTTPException(400, { message: '目录账号或密码错误' });
  };

  let entry: Entry;
  try {
    const entries = await searchDirectoryEntries(provider, {
      mode: 'login',
      username: input.username,
      limit: 2,
    });
    if (entries.length !== 1) await failCredentials();
    entry = entries[0];
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    await recordLoginLog({
      ip: input.ip,
      ua: input.ua,
      username: input.username,
      status: 'fail',
      message: `企业身份源 ${provider.name} 目录查询失败`,
      tenantId: provider.tenantId ?? null,
    });
    throw new HTTPException(400, { message: '目录登录暂不可用，请联系管理员' });
  }

  const client = await prepareDirectoryClient(provider);
  try {
    await client.bind(entry.dn, input.password);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) await failCredentials();
    await recordLoginLog({
      ip: input.ip,
      ua: input.ua,
      username: input.username,
      status: 'fail',
      message: `企业身份源 ${provider.name} 目录认证失败`,
      tenantId: provider.tenantId ?? null,
    });
    throw new HTTPException(400, { message: '目录认证失败，请联系管理员' });
  } finally {
    await client.unbind().catch(() => undefined);
  }

  const { profile } = mapDirectoryProfile(provider, entry);
  const user = await findOrCreateUserForProvider(provider, profile);
  if (user.status === 'disabled') {
    await recordLoginLog({
      ip: input.ip,
      ua: input.ua,
      username: input.username,
      status: 'fail',
      message: '账号已被禁用',
      userId: user.id,
      tenantId: user.tenantId ?? null,
    });
    throw new HTTPException(403, { message: '账号已被禁用' });
  }
  await clearLoginAttempts(lockKey);
  const loginResult = await completeEnterpriseLogin(
    user,
    { ip: input.ip, ua: input.ua, deviceInfo: input.deviceInfo, deviceId: input.deviceId },
    `企业身份源 ${provider.name} LDAP 登录成功`,
  );
  return { loginResult, redirectTo: input.redirectTo ?? null };
}

export async function handleEnterpriseOidcCallback(code: string, state: string, deviceInfo?: DeviceInfo, deviceId?: string) {
  const stateKey = `${OIDC_STATE_PREFIX}${state}`;
  const raw = await redis.get(stateKey);
  if (!raw) throw new HTTPException(400, { message: '企业登录状态已过期，请重新发起登录' });
  await redis.del(stateKey);
  const payload = JSON.parse(raw) as EnterpriseAuthStatePayload;
  const provider = await getUsableProvider(payload.providerId);
  if (provider.type !== 'oidc') throw new HTTPException(400, { message: '身份源类型不匹配' });
  const token = await exchangeOidcCode(provider, code);
  const profile = await loadOidcProfile(provider, token);
  const user = await findOrCreateUserForProvider(provider, profile);
  if (user.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  const loginResult = await completeEnterpriseLogin(
    user,
    { ip: payload.ip, ua: payload.ua, deviceInfo, deviceId },
    `企业身份源 ${provider.name} 登录成功`,
  );
  return { loginResult, redirectTo: payload.redirectTo ?? null };
}

export async function handleEnterpriseSamlAcs(samlResponse: string, relayState: string) {
  if (!samlResponse) throw new HTTPException(400, { message: 'SAMLResponse 不能为空' });
  if (!relayState) throw new HTTPException(400, { message: 'RelayState 不能为空' });
  const stateKey = `${SAML_STATE_PREFIX}${relayState}`;
  const raw = await redis.get(stateKey);
  if (!raw) throw new HTTPException(400, { message: '企业登录状态已过期，请重新发起登录' });
  await redis.del(stateKey);

  const payload = JSON.parse(raw) as EnterpriseAuthStatePayload;
  const provider = await getUsableProvider(payload.providerId);
  if (provider.type !== 'saml') throw new HTTPException(400, { message: '身份源类型不匹配' });

  let profile: Profile | null;
  try {
    const validated = await createSamlClient(provider).validatePostResponseAsync({ SAMLResponse: samlResponse });
    profile = validated.profile;
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'SAML 断言校验失败';
    throw new HTTPException(400, { message: `SAML 断言校验失败：${message}` });
  }
  if (!profile) throw new HTTPException(400, { message: 'SAML 断言未返回用户信息' });
  const profileRecord = mapSamlProfile(profile);
  const inResponseTo = typeof profileRecord.inResponseTo === 'string' ? profileRecord.inResponseTo : null;
  if (payload.samlRequestId && inResponseTo !== payload.samlRequestId) {
    throw new HTTPException(400, { message: 'SAML 响应与本次登录请求不匹配' });
  }

  const user = await findOrCreateUserForProvider(provider, profileRecord);
  if (user.status === 'disabled') throw new HTTPException(403, { message: '账号已被禁用' });
  // 票据里可能是登录结果，也可能是 MFA 挑战：前端兑换后按 mfaRequired 分流
  const loginResult = await completeEnterpriseLogin(
    user,
    { ip: payload.ip, ua: payload.ua },
    `企业身份源 ${provider.name} SAML 登录成功`,
  );
  const ticket = randomToken(32);
  const ticketPayload: SamlLoginTicketPayload = {
    loginResult,
    redirectTo: payload.redirectTo ?? null,
  };
  await redis.set(`${SAML_LOGIN_TICKET_PREFIX}${ticket}`, JSON.stringify(ticketPayload), 'EX', SAML_LOGIN_TICKET_TTL);
  return { ticket, redirectUrl: enterpriseCallbackUrl(ticket) };
}

export async function exchangeEnterpriseSamlTicket(ticket: string) {
  if (!ticket) throw new HTTPException(400, { message: 'SAML 登录票据不能为空' });
  const ticketKey = `${SAML_LOGIN_TICKET_PREFIX}${ticket}`;
  const raw = await redis.get(ticketKey);
  if (!raw) throw new HTTPException(400, { message: 'SAML 登录票据已过期，请重新登录' });
  await redis.del(ticketKey);
  return JSON.parse(raw) as SamlLoginTicketPayload;
}
