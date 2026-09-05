/**
 * 企业身份源服务单测 —— 锁定 C1 修复的行为契约：
 * 1. 登录时不再按 username 隐式关联本地账号；按邮箱关联必须显式开启且邮箱已验证，且永不接管平台超管；
 * 2. JIT 建号的默认角色经 resolveGrantableDefaultRoleIds 过滤；
 * 3. 管理员同步：邮箱关联允许，但邮箱覆盖受 autoLinkByEmail 约束；
 * 4. 创建身份源：归属由 resolveManagedTenantId 决定，默认角色经 assertDefaultRolesGrantable 校验；
 * 5. 企业 SSO 登录复用密码登录的 MFA 决策。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    query: { tenantIdentityProviders: { findFirst: vi.fn(), findMany: vi.fn() } },
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});
vi.mock('../../lib/redis', () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn() },
}));
vi.mock('ldapts', () => ({ Client: class {}, InvalidCredentialsError: class extends Error {} }));
vi.mock('@node-saml/node-saml', () => ({ SAML: class {}, ValidateInResponseTo: { always: 'always' } }));
vi.mock('../../lib/http-client', () => ({
  httpGet: vi.fn(),
  httpPost: vi.fn(),
  HttpClientError: class extends Error {},
}));
vi.mock('../../lib/password', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('../../lib/tenant-quota', () => ({ reserveTenantSeats: vi.fn() }));
vi.mock('../../lib/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tenant')>()),
  resolveManagedTenantId: vi.fn(),
  tenantScope: vi.fn(() => undefined),
}));
vi.mock('../../lib/settings', async () => {
  const { SETTINGS_MODULES } = await import('@zenith/shared/settings');
  return { getSettings: vi.fn(async (module: keyof typeof SETTINGS_MODULES) => SETTINGS_MODULES[module].schema.parse({})) };
});
vi.mock('../../lib/session-manager', () => ({
  checkLoginLock: vi.fn(async () => 0), clearLoginAttempts: vi.fn(), recordLoginFailure: vi.fn(),
}));
vi.mock('./user-group-rules.service', () => ({ syncUserDynamicMembershipsSafe: vi.fn() }));
vi.mock('./auth.service', () => ({ finalizeLogin: vi.fn(), recordLoginLog: vi.fn(), completeLoginWithMfa: vi.fn() }));
vi.mock('./role-grant', () => ({
  assertDefaultRolesGrantable: vi.fn(),
  resolveGrantableDefaultRoleIds: vi.fn(async () => []),
  userHasPlatformSuperRole: vi.fn(async () => false),
}));

import { db } from '../../db';
import redis from '../../lib/redis';
import { httpGet, httpPost } from '../../lib/http-client';
import { resolveManagedTenantId } from '../../lib/tenant';
import { completeLoginWithMfa } from './auth.service';
import { assertDefaultRolesGrantable, resolveGrantableDefaultRoleIds, userHasPlatformSuperRole } from './role-grant';
import {
  createIdentityProvider,
  findOrCreateUserForProvider,
  handleEnterpriseOidcCallback,
  syncUserForProvider,
} from './identity-providers.service';
import type { TenantIdentityProviderRow } from '../../db/schema';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown = []): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'innerJoin', 'orderBy', 'set', 'values', 'returning', 'onConflictDoNothing']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function provider(overrides: Partial<TenantIdentityProviderRow> = {}): TenantIdentityProviderRow {
  return {
    id: 1,
    tenantId: 3,
    name: 'Okta',
    code: 'okta',
    type: 'oidc',
    status: 'enabled',
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: 'https://idp.example.com/token',
    userinfoEndpoint: 'https://idp.example.com/userinfo',
    jwksUri: null,
    clientId: 'client',
    clientSecret: null,
    scopes: 'openid profile email',
    samlSsoUrl: null,
    samlEntityId: null,
    samlCertificate: null,
    ldapUrl: null,
    ldapStartTls: false,
    ldapSkipTlsVerify: false,
    ldapBaseDn: null,
    ldapBindDn: null,
    ldapBindPassword: null,
    ldapUserFilter: null,
    ldapUserSearchFilter: null,
    ldapSyncFilter: null,
    ldapGroupBaseDn: null,
    ldapGroupFilter: null,
    ldapTimeoutMs: 5000,
    attributeMapping: { subject: 'sub', email: 'email', username: 'preferred_username', nickname: 'name' },
    jitEnabled: false,
    autoLinkByEmail: false,
    defaultRoleIds: [],
    remark: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TenantIdentityProviderRow;
}

const localUser = {
  id: 42, username: 'alice', nickname: 'Alice', email: 'alice@example.com', phone: null,
  password: 'x', status: 'enabled', tenantId: 3, createdAt: new Date(), updatedAt: new Date(),
};

const oidcProfile = { sub: 'sub-1', email: 'alice@example.com', email_verified: true, preferred_username: 'admin', name: 'Alice' };

async function expectHttpError(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(status);
  }
}

/** 第一条查询固定是 userIdentityAccounts 按 (providerId, subject) 查绑定 */
function mockNoBoundAccount() {
  dbMock.select.mockReturnValueOnce(createChain([]));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(userHasPlatformSuperRole).mockResolvedValue(false);
  vi.mocked(resolveGrantableDefaultRoleIds).mockResolvedValue([]);
  dbMock.transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
});

describe('findOrCreateUserForProvider（登录路径）', () => {
  it('已绑定的外部身份直接返回本地用户，不做任何匹配', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ id: 9, userId: 42 }]))
      .mockReturnValueOnce(createChain([localUser]));
    dbMock.update.mockReturnValueOnce(createChain([]));

    const user = await findOrCreateUserForProvider(provider(), oidcProfile);

    expect(user.id).toBe(42);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('未开启 autoLinkByEmail：不查询本地账号（username 与 email 都不匹配），未开 JIT → 403', async () => {
    mockNoBoundAccount();

    await expectHttpError(() => findOrCreateUserForProvider(provider(), oidcProfile), 403);
    // 仅查了一次绑定表；没有第二条按 username / email 找既有账号的查询
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('开启 autoLinkByEmail 但 OIDC 未断言 email_verified → 不关联', async () => {
    mockNoBoundAccount();

    await expectHttpError(
      () => findOrCreateUserForProvider(provider({ autoLinkByEmail: true }), { ...oidcProfile, email_verified: false }),
      403,
    );
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('开启 autoLinkByEmail 且邮箱已验证：唯一命中的本地账号被关联并返回', async () => {
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([localUser]));
    const insertChain = createChain([]);
    dbMock.insert.mockReturnValueOnce(insertChain);

    const user = await findOrCreateUserForProvider(provider({ autoLinkByEmail: true }), oidcProfile);

    expect(user.id).toBe(42);
    expect(userHasPlatformSuperRole).toHaveBeenCalledWith(42);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, providerId: 1, subject: 'sub-1' }));
  });

  it('邮箱命中多个账号时不关联（避免歧义接管）', async () => {
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([localUser, { ...localUser, id: 43 }]));

    await expectHttpError(() => findOrCreateUserForProvider(provider({ autoLinkByEmail: true }), oidcProfile), 403);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('命中的账号持有平台超管角色 → 永不自动关联', async () => {
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([localUser]));
    vi.mocked(userHasPlatformSuperRole).mockResolvedValue(true);

    await expectHttpError(() => findOrCreateUserForProvider(provider({ autoLinkByEmail: true }), oidcProfile), 403);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('命中的账号已禁用 → 登录路径不建立绑定', async () => {
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([{ ...localUser, status: 'disabled' }]));

    await expectHttpError(() => findOrCreateUserForProvider(provider({ autoLinkByEmail: true }), oidcProfile), 403);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('LDAP 源（无 email_verified 语义）开启 autoLinkByEmail 即可按目录邮箱关联', async () => {
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([localUser]));
    dbMock.insert.mockReturnValueOnce(createChain([]));
    const ldap = provider({ type: 'ldap', autoLinkByEmail: true, attributeMapping: { subject: 'entryUUID', email: 'mail', username: 'uid', nickname: 'cn' } });

    const user = await findOrCreateUserForProvider(ldap, { dn: 'uid=alice,dc=x', entryUUID: 'u1', mail: 'alice@example.com', uid: 'alice', cn: 'Alice' });

    expect(user.id).toBe(42);
  });

  it('JIT 建号：默认角色只写入 resolveGrantableDefaultRoleIds 过滤后的结果', async () => {
    mockNoBoundAccount();
    const created = { ...localUser, id: 100, username: 'admin' };
    const userInsert = createChain([created]);
    const accountInsert = createChain([]);
    const roleInsert = createChain([]);
    dbMock.insert.mockReturnValueOnce(userInsert).mockReturnValueOnce(accountInsert).mockReturnValueOnce(roleInsert);
    vi.mocked(resolveGrantableDefaultRoleIds).mockResolvedValue([7]);

    const user = await findOrCreateUserForProvider(provider({ jitEnabled: true, defaultRoleIds: [1, 7] }), oidcProfile);

    expect(user.id).toBe(100);
    expect(userInsert.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 3, email: 'alice@example.com' }));
    expect(resolveGrantableDefaultRoleIds).toHaveBeenCalledWith([1, 7], 3, db);
    expect(roleInsert.values).toHaveBeenCalledWith([{ userId: 100, roleId: 7 }]);
  });

  it('JIT 建号：过滤后没有可授予角色时不写 user_roles', async () => {
    mockNoBoundAccount();
    dbMock.insert.mockReturnValueOnce(createChain([{ ...localUser, id: 101 }])).mockReturnValueOnce(createChain([]));

    await findOrCreateUserForProvider(provider({ jitEnabled: true, defaultRoleIds: [1] }), oidcProfile);

    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });
});

describe('syncUserForProvider（管理员同步）', () => {
  const ldap = provider({ type: 'ldap', attributeMapping: { subject: 'entryUUID', email: 'mail', username: 'uid', nickname: 'cn', phone: 'telephoneNumber' } });
  const entry = { dn: 'uid=alice,dc=x', entryUUID: 'u1', mail: 'attacker@evil.example', uid: 'alice', cn: 'Alice' };

  it('已绑定账号：未开启 autoLinkByEmail 时不用目录邮箱覆盖本地邮箱', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ id: 9, userId: 42 }]))
      .mockReturnValueOnce(createChain([localUser]));
    const accountUpdate = createChain([]);
    const userUpdate = createChain([]);
    dbMock.update.mockReturnValueOnce(accountUpdate).mockReturnValueOnce(userUpdate);

    expect(await syncUserForProvider(ldap, entry)).toBe('updated');
    const patch = userUpdate.set.mock.calls[0][0];
    expect(patch).not.toHaveProperty('email');
    expect(patch.nickname).toBe('Alice');
  });

  it('已绑定账号：开启 autoLinkByEmail 后以目录邮箱为准', async () => {
    dbMock.select
      .mockReturnValueOnce(createChain([{ id: 9, userId: 42 }]))
      .mockReturnValueOnce(createChain([localUser]));
    const userUpdate = createChain([]);
    dbMock.update.mockReturnValueOnce(createChain([])).mockReturnValueOnce(userUpdate);

    await syncUserForProvider({ ...ldap, autoLinkByEmail: true }, entry);
    expect(userUpdate.set.mock.calls[0][0].email).toBe('attacker@evil.example');
  });

  it('未绑定：管理员同步可按邮箱关联（无需开启 autoLinkByEmail），但平台超管除外', async () => {
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([localUser]));
    dbMock.insert.mockReturnValueOnce(createChain([]));
    expect(await syncUserForProvider(ldap, entry)).toBe('linked');

    vi.resetAllMocks();
    vi.mocked(userHasPlatformSuperRole).mockResolvedValue(true);
    mockNoBoundAccount();
    dbMock.select.mockReturnValueOnce(createChain([localUser]));
    expect(await syncUserForProvider(ldap, entry)).toBe('skipped');
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe('createIdentityProvider（归属与默认角色）', () => {
  it('归属由 resolveManagedTenantId 决定，默认角色经 assertDefaultRolesGrantable 校验后落库', async () => {
    vi.mocked(resolveManagedTenantId).mockReturnValue(3);
    // ensureTenantUsable → tenants 查询
    dbMock.select.mockReturnValueOnce(createChain([{ id: 3, status: 'enabled', expireAt: null }]));
    const insertChain = createChain([{ id: 55 }]);
    dbMock.insert.mockReturnValueOnce(insertChain);
    dbMock.query.tenantIdentityProviders.findFirst.mockResolvedValueOnce(provider({ id: 55 }));

    await createIdentityProvider({
      tenantId: null, // 租户管理员试图声明平台级 —— 以 resolveManagedTenantId 的裁决为准
      name: 'Okta', code: 'okta', type: 'oidc', status: 'disabled', scopes: 'openid',
      ldapStartTls: false, ldapSkipTlsVerify: false, ldapTimeoutMs: 5000,
      attributeMapping: {}, jitEnabled: true, autoLinkByEmail: false, defaultRoleIds: [1, 7],
    });

    expect(resolveManagedTenantId).toHaveBeenCalledWith(null, expect.any(String));
    expect(assertDefaultRolesGrantable).toHaveBeenCalledWith([1, 7], 3);
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 3, defaultRoleIds: [1, 7], autoLinkByEmail: false }));
  });

  it('resolveManagedTenantId 拒绝时不会触碰数据库', async () => {
    vi.mocked(resolveManagedTenantId).mockImplementation(() => { throw new HTTPException(403, { message: '无权' }); });

    await expectHttpError(() => createIdentityProvider({
      tenantId: 9, name: 'x', code: 'x', type: 'oidc', status: 'disabled', scopes: 'openid',
      ldapStartTls: false, ldapSkipTlsVerify: false, ldapTimeoutMs: 5000,
      attributeMapping: {}, jitEnabled: false, autoLinkByEmail: false, defaultRoleIds: [],
    }), 403);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe('handleEnterpriseOidcCallback（SSO 复用 MFA 决策）', () => {
  function mockOidcExchange() {
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify({ providerId: 1, ip: '1.1.1.1', ua: 'ua', redirectTo: '/home' }));
    dbMock.query.tenantIdentityProviders.findFirst.mockResolvedValueOnce({ ...provider(), tenant: null });
    vi.mocked(httpPost).mockResolvedValue({ ok: true, status: 200, url: 'u', json: async () => ({ access_token: 'at' }) } as never);
    vi.mocked(httpGet).mockResolvedValue({ ok: true, status: 200, url: 'u', json: async () => oidcProfile } as never);
    // 已绑定账号
    dbMock.select
      .mockReturnValueOnce(createChain([{ id: 9, userId: 42 }]))
      .mockReturnValueOnce(createChain([localUser]));
    dbMock.update.mockReturnValueOnce(createChain([]));
  }

  it('登录收口经 completeLoginWithMfa（与密码登录同一套 MFA / 密码过期决策），并透传 deviceId', async () => {
    mockOidcExchange();
    const challenge = { mfaRequired: true, challengeId: 'ch-1', methods: ['totp'], expiresAt: 123, reason: 'MFA 策略要求' };
    vi.mocked(completeLoginWithMfa).mockResolvedValue(challenge as never);

    const result = await handleEnterpriseOidcCallback('code', 'state', undefined, 'device-1');

    expect(result.redirectTo).toBe('/home');
    expect(result.loginResult).toEqual(challenge);
    expect(completeLoginWithMfa).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      expect.objectContaining({ ip: '1.1.1.1', ua: 'ua', deviceId: 'device-1' }),
      expect.stringContaining('Okta'),
    );
  });

  it('不需要 MFA 时返回 token', async () => {
    mockOidcExchange();
    vi.mocked(completeLoginWithMfa).mockResolvedValue({ token: { accessToken: 'a', refreshToken: 'r' } } as never);

    const result = await handleEnterpriseOidcCallback('code', 'state');

    expect(result.loginResult).toEqual({ token: { accessToken: 'a', refreshToken: 'r' } });
  });
});
