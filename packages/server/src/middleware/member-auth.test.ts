/**
 * 会员认证中间件隔离测试（内存集成测试，不走网络）。
 *
 * 安全关键：验证 memberAuthMiddleware 仅接受 type='member' 的 token，
 * 拒绝管理员 token（无 type='member'），杜绝前台/后台两套用户体系互窜。
 *
 * Mock 策略：config / member-session-manager / db / logger 全部 mock，
 * 用固定测试密钥签发 JWT，覆盖隔离的各条边界。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { contextStorage } from 'hono/context-storage';

const TEST_JWT_SECRET = 'unit-test-only-fake-secret-do-not-use-in-production';

vi.mock('../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
    jwtRefreshSecret: 'unit-test-only-fake-refresh-secret',
    port: 3300,
    databaseUrl: 'mock://localhost/test',
    multiTenantMode: false,
    redis: { keyPrefix: 'test:' },
    log: { level: 'silent', dir: 'logs', maxFiles: '30d' },
  },
}));

vi.mock('../lib/member-session-manager', () => ({
  isMemberTokenBlacklisted: vi.fn().mockResolvedValue(false),
  touchMemberSession: vi.fn().mockResolvedValue(true),
  registerMemberSession: vi.fn(),
}));

vi.mock('../db', () => ({
  db: { select: vi.fn() },
}));

vi.mock('../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { memberAuthMiddleware, resetMemberSubjectCache } from './member-auth';
import { db } from '../db';
import { dispatchInvalidation } from '../lib/invalidation-bus';

const dbMock = vi.mocked(db);

// Minimal thenable Drizzle chain used by the live member/tenant lookup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'leftJoin', 'where', 'limit']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function activeMemberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    nickname: 'Alice',
    phone: '13800138000',
    username: 'alice',
    email: null,
    status: 'active',
    tenantId: null,
    tenantStatus: null,
    tenantExpireAt: null,
    ...overrides,
  };
}

const now = () => Math.floor(Date.now() / 1000);

async function makeMemberToken(overrides: Record<string, unknown> = {}) {
  return sign(
    { memberId: 1, identifier: '13800138000', type: 'member', tenantId: null, jti: 'test-jti', iat: now(), exp: now() + 3600, ...overrides },
    TEST_JWT_SECRET,
    'HS256',
  );
}

async function makeAdminToken() {
  return sign(
    { userId: 1, username: 'admin', roles: ['admin'], tenantId: null, jti: 'admin-jti', iat: now(), exp: now() + 3600 },
    TEST_JWT_SECRET,
    'HS256',
  );
}

function buildApp() {
  const app = new Hono();
  app.use('*', contextStorage());
  app.get('/protected', memberAuthMiddleware, (c) => {
    const m = c.get('member');
    return c.json({ code: 0, message: 'ok', data: { memberId: m.memberId } });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // 会员 / 租户权威行带进程内副本，逐用例清空以免串台
  resetMemberSubjectCache();
  dbMock.select.mockReturnValue(createChain([activeMemberRow()]));
});

describe('memberAuthMiddleware - token 隔离（安全关键）', () => {
  it('无 Authorization 头 → 401 未登录', async () => {
    const res = await buildApp().request('/protected');
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('未登录');
  });

  it('合法会员 token（type=member）→ 200 通过并注入 member', async () => {
    const token = await makeMemberToken();
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.memberId).toBe(1);
  });

  it('会员已被封禁 → 403，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({ status: 'banned' })]));
    const token = await makeMemberToken();
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('账号不可用');
  });

  it('会员已删除/不存在 → 401，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([]));
    const token = await makeMemberToken();
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('会员不存在');
  });

  it('会员租户被禁用 → 403，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({ tenantId: 7, tenantStatus: 'disabled' })]));
    const token = await makeMemberToken({ tenantId: 7 });
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('租户已被禁用或过期');
  });

  it('会员租户已过期 → 403，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({
      tenantId: 7,
      tenantStatus: 'enabled',
      tenantExpireAt: new Date(Date.now() - 1000),
    })]));
    const token = await makeMemberToken({ tenantId: 7 });
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('租户已被禁用或过期');
  });

  it('会员租户声明与数据库不一致 → 401', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({ tenantId: 7, tenantStatus: 'enabled' })]));
    const token = await makeMemberToken({ tenantId: null });
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('登录状态已失效，请重新登录');
  });

  it('管理员 token（无 type=member）→ 401 无效的会员令牌（杜绝越权）', async () => {
    const token = await makeAdminToken();
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('无效的会员令牌');
  });

  it('type 被篡改为非 member → 401', async () => {
    const token = await makeMemberToken({ type: 'admin' });
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('缺少 memberId 的 token → 401', async () => {
    const token = await makeMemberToken({ memberId: undefined });
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('无效 JWT 字符串 → 401', async () => {
    const res = await buildApp().request('/protected', { headers: { Authorization: 'Bearer invalid.jwt.token' } });
    expect(res.status).toBe(401);
  });

  it('过期会员 token → 401', async () => {
    const token = await makeMemberToken({ iat: now() - 10, exp: now() - 1 });
    const res = await buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});

describe('memberAuthMiddleware - 主体权威行进程内副本', () => {
  async function probe(token: string) {
    return buildApp().request('/protected', { headers: { Authorization: `Bearer ${token}` } });
  }

  it('同一会员的连续请求只回源一次；不同会员各自回源', async () => {
    const tokenA = await makeMemberToken();
    const tokenB = await makeMemberToken({ memberId: 2, jti: 'test-jti-2' });
    dbMock.select.mockReturnValue(createChain([activeMemberRow({ id: 2 })]));
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow()]));

    expect((await probe(tokenA)).status).toBe(200);
    expect((await probe(tokenA)).status).toBe(200);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect((await probe(tokenB)).status).toBe(200);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('members 触发器广播 → 仅该会员副本失效，封禁立即生效', async () => {
    const tokenA = await makeMemberToken();
    const tokenB = await makeMemberToken({ memberId: 2, jti: 'test-jti-2' });
    dbMock.select.mockReturnValue(createChain([activeMemberRow({ id: 2 })]));
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow()]));
    await probe(tokenA);
    await probe(tokenB);
    expect(dbMock.select).toHaveBeenCalledTimes(2);

    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({ status: 'banned' })]));
    dispatchInvalidation({ topic: 'members', key: '1' });

    const denied = await probe(tokenA);
    expect(denied.status).toBe(403);
    expect((await denied.json()).message).toBe('账号不可用');
    // 会员 2 的副本未受影响
    expect((await probe(tokenB)).status).toBe(200);
    expect(dbMock.select).toHaveBeenCalledTimes(3);
  });

  it('tenants 触发器广播 → 全部副本清空，租户停用立即生效', async () => {
    const token = await makeMemberToken({ tenantId: 7 });
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({ tenantId: 7, tenantStatus: 'enabled' })]));
    expect((await probe(token)).status).toBe(200);

    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({ tenantId: 7, tenantStatus: 'disabled' })]));
    dispatchInvalidation({ topic: 'tenants', key: '7' });

    const denied = await probe(token);
    expect(denied.status).toBe(403);
    expect((await denied.json()).message).toBe('租户已被禁用或过期');
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });

  it('缓存的是原始行：租户 expireAt 到点后即使命中缓存也拒绝', async () => {
    const token = await makeMemberToken({ tenantId: 7 });
    dbMock.select.mockReturnValueOnce(createChain([activeMemberRow({
      tenantId: 7,
      tenantStatus: 'enabled',
      tenantExpireAt: new Date(Date.now() + 200),
    })]));
    expect((await probe(token)).status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await probe(token)).status).toBe(403);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('不存在的会员同样缓存，伪造 / 已删除主体不会反复回源', async () => {
    const token = await makeMemberToken({ memberId: 404 });
    dbMock.select.mockReturnValue(createChain([]));

    expect((await probe(token)).status).toBe(401);
    expect((await probe(token)).status).toBe(401);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it('resetMemberSubjectCache 清空后重新回源', async () => {
    const token = await makeMemberToken();
    await probe(token);
    expect(dbMock.select).toHaveBeenCalledTimes(1);

    resetMemberSubjectCache();
    await probe(token);
    expect(dbMock.select).toHaveBeenCalledTimes(2);
  });
});
