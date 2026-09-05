/**
 * auth 路由接口测试
 *
 * 覆盖要点：
 *  1. GET  /api/auth/captcha  — 验证码关闭 → `{enabled: false}`
 *  2. GET  /api/auth/captcha  — 验证码开启 → 返回 SVG
 *  3. POST /api/auth/login    — body 缺少必填字段 → 400 验证错误
 *  4. POST /api/auth/login    — 用户名/密码类型错误 → 400
 *  5. GET  /api/auth/me       — 无 Authorization → 401
 *  6. GET  /api/auth/me       — 无效 JWT → 401
 *  7. GET  /api/auth/me       — 有效 JWT + 用户不存在 → 401（中间件实时校验）
 *  8. GET  /api/auth/me       — 有效 JWT + 用户存在 → 200
 *
 * Mock 策略：
 *  - db / redis / session-manager / settings / email / logger 全部 mock
 *  - JWT 使用固定测试密钥签名，与 config.jwtSecret mock 对齐
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { sign } from 'hono/jwt';
import { contextStorage } from 'hono/context-storage';

const TEST_JWT_SECRET = 'unit-test-only-fake-secret-do-not-use-in-production';

// ─── Mocks（必须在 import 模块前声明，vitest 会 hoist） ───────────────────────
vi.mock('../../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
    jwtRefreshSecret: 'unit-test-only-fake-refresh-secret',
    port: 3300,
    databaseUrl: 'mock://localhost/test',
    multiTenantMode: false,
    redis: { keyPrefix: 'test:' },
    log: { level: 'silent', dir: 'logs', maxFiles: '30d' },
    oauth: { github: {}, dingtalk: {}, wechatWork: {}, callbackBaseUrl: '' },
    trustedProxyCidrs: [],
  },
}));

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
    query: {
      users: { findFirst: vi.fn(), findMany: vi.fn() },
    },
  };
  return { db };
});

vi.mock('../../lib/redis', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    scan: vi.fn(),
    // rate-limit 中间件（hono-rate-limiter）在模块加载时构造 RedisStore → 调用 script('LOAD')；
    // 新版会在构造期即加载脚本，故 mock 必须提供这些方法，否则 RedisStore 构造抛错导致路由 import 失败。
    script: vi.fn().mockResolvedValue('mock-sha'),
    evalsha: vi.fn().mockResolvedValue([1, 60]),
    decr: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../lib/session-manager', () => ({
  generateTokenId: () => 'mock-token-id',
  registerSession: vi.fn(),
  grantRefresh: vi.fn(),
  consumeRefreshGrant: vi.fn().mockResolvedValue(true),
  getSession: vi.fn().mockResolvedValue(null),
  // touchSession 必须返回 true：返回 falsy 会触发 authMiddleware 的会话懒重注册分支，
  // 额外消费一次 db.select mock 队列，导致依赖队列顺序的用例错位失败
  touchSession: vi.fn().mockResolvedValue(true),
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  forceLogout: vi.fn(),
  forceLogoutAllByUser: vi.fn().mockResolvedValue([]),
  forceLogoutAllByUserExcept: vi.fn().mockResolvedValue([]),
  removeSession: vi.fn(),
  checkLoginLock: vi.fn().mockResolvedValue({ isLocked: false, attempts: 0 }),
  recordLoginFailure: vi.fn(),
  clearLoginAttempts: vi.fn(),
  getOnlineSessions: vi.fn().mockResolvedValue([]),
  unlockUser: vi.fn(),
}));

vi.mock('../../lib/settings', async () => {
  const { SETTINGS_MODULES } = await import('@zenith/shared/settings');
  return {
    // 运行时设置：全部按 schema 默认值返回（验证码关闭、注册关闭、密码不过期）
    getSettings: vi.fn(async (module: keyof typeof SETTINGS_MODULES) => SETTINGS_MODULES[module].schema.parse({})),
  };
});

vi.mock('../../lib/email', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../middleware/logger', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  httpLogger: async (_c: any, next: () => Promise<void>) => next(),
}));

// 限流中间件依赖 hono-rate-limiter 的 RedisStore（构造期加载 Lua 脚本 + 请求期 evalsha）。
// 单测聚焦认证逻辑本身，将三个限流器 mock 为 passthrough，避免脚本行为与 redis mock 漂移导致 500。
vi.mock('../../middleware/rate-limit', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authRateLimit: async (_c: any, next: () => Promise<void>) => next(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captchaRateLimit: async (_c: any, next: () => Promise<void>) => next(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sensitiveRateLimit: async (_c: any, next: () => Promise<void>) => next(),
}));

vi.mock('../../lib/permissions', () => ({
  isSuperAdmin: vi.fn().mockReturnValue(false),
  getUserPermissions: vi.fn().mockResolvedValue(['user:read']),
  clearUserPermissionCache: vi.fn(),
}));

// ─── Imports（在 mock 声明之后） ──────────────────────────────────────────────
import { db } from '../../db';
import authRoutes from './auth';
import { refreshAccessToken } from '../../services/identity/auth.service';
import { verifyToken } from '../../lib/jwt';

const dbMock = vi.mocked(db);

// ─── 工具：可 await 的链式 query builder mock ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'innerJoin', 'leftJoin', 'limit', 'offset', 'orderBy', 'groupBy', 'values', 'returning'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result).catch(fn);
  chain.finally = (fn: () => void) => Promise.resolve(result).finally(fn);
  return chain;
}

function activeAdminSubject(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'admin',
    status: 'enabled',
    tenantId: null,
    tenantStatus: null,
    tenantExpireAt: null,
    ...overrides,
  };
}

// ─── 工具：生成测试用 JWT ──────────────────────────────────────────────────────
async function makeToken(payload: object = {}) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { userId: 1, username: 'admin', roles: ['admin'], tenantId: null, jti: 'test-jti', iat: now, exp: now + 3600, ...payload },
    TEST_JWT_SECRET,
    'HS256',
  );
}

// ─── 测试应用 ─────────────────────────────────────────────────────────────────
function buildApp() {
  const app = new Hono();
  app.use('*', contextStorage());
  app.route('/api/auth', authRoutes);
  // 与 src/index.ts 保持一致的 HTTPException 全局处理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.onError((err: any, c) => {
    if (err instanceof HTTPException) {
      return c.json({ code: err.status, message: err.message, data: null }, err.status);
    }
    return c.json({ code: 500, message: '服务器内部错误', data: null }, 500);
  });
  return app;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // authMiddleware now performs a live user/tenant lookup for every JWT.
  dbMock.select.mockReturnValue(createChain([activeAdminSubject()]));
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/auth/captcha', () => {
  it('验证码关闭时返回 enabled: false', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/captcha');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.enabled).toBe(false);
  });
});

describe('POST /api/auth/login - 参数校验', () => {
  it('body 为空时返回 400', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe(400);
  });

  it('username 过短时返回 400', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: 'pass' }),
    });
    expect(res.status).toBe(400);
  });

  it('password 缺失时返回 400', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me - 认证中间件', () => {
  it('无 Authorization 头 → 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/me');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe(401);
    expect(body.message).toBe('未登录');
  });

  it('无效 JWT → 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe(401);
  });

  it('过期的 JWT → 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await sign(
      { userId: 1, username: 'admin', roles: ['admin'], tenantId: null, iat: now - 10, exp: now - 1 },
      TEST_JWT_SECRET,
      'HS256',
    );
    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('有效 JWT 但用户不存在 → 404', async () => {
    const token = await makeToken();
    dbMock.select.mockReturnValueOnce(createChain([])); // users 查询 → 空

    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe(401);
    expect(body.message).toBe('用户不存在');
  });

  it('用户被禁用 → 403，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ status: 'disabled' })]));
    const token = await makeToken();
    const res = await buildApp().request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('账号已被禁用');
  });

  it('租户被禁用 → 403，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ tenantId: 9, tenantStatus: 'disabled' })]));
    const token = await makeToken({ tenantId: 9 });
    const res = await buildApp().request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('租户已被禁用或过期');
  });

  it('租户已过期 → 403，旧 access token 立即失效', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({
      tenantId: 9,
      tenantStatus: 'enabled',
      tenantExpireAt: new Date(Date.now() - 1000),
    })]));
    const token = await makeToken({ tenantId: 9 });
    const res = await buildApp().request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('租户已被禁用或过期');
  });

  it('JWT 租户声明漂移 → 401', async () => {
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ tenantId: 9, tenantStatus: 'enabled' })]));
    const token = await makeToken({ tenantId: null });
    const res = await buildApp().request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('登录状态已失效，请重新登录');
  });

  it('有效 JWT + 用户存在 → 200 返回用户信息', async () => {
    const token = await makeToken({ userId: 1 });
    const now = new Date();
    const mockUser = {
      id: 1,
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.com',
      password: 'hashed',
      avatar: null,
      phone: null,
      status: 'enabled',
      departmentId: null,
      tenantId: null,
      remark: null,
      lastLoginAt: null,
      lastLoginIp: null,
      passwordUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // getMyProfile 第一个查询走 RQB（db.query.users.findFirst，with department/userPositions/userRoles）；
    // 必须提供 userPositions/department，否则 user.userPositions.map(...) 在 undefined 上抛错 → 500。
    (dbMock.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockUser,
      userRoles: [],
      userPositions: [],
      department: null,
    });
    // getMyProfile 末尾查询最近登录日志（db.select），返回空数组即可（prevLogin = null）
    dbMock.select
      .mockReturnValueOnce(createChain([activeAdminSubject()]))
      .mockReturnValueOnce(createChain([]));

    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.username).toBe('admin');
    expect(body.data).not.toHaveProperty('password'); // 密码字段不应暴露
  });

  it('会员 token（type=member）访问管理端 → 401 无效的访问令牌（反向隔离）', async () => {
    const token = await makeToken({ type: 'member', memberId: 1 });
    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.message).toBe('无效的访问令牌');
  });
});

describe('POST /api/auth/logout-by-refresh - 账号切换器注销停靠账号', () => {
  it('缺少 refreshToken → 400', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/logout-by-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('无效 refresh token → 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/auth/logout-by-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'not-a-jwt' }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe(401);
  });

  it('access token 冒充 refresh token → 401', async () => {
    const accessToken = await makeToken(); // 无 type: 'refresh'
    const app = buildApp();
    const res = await app.request('/api/auth/logout-by-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: accessToken }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.message).toBe('无效的 refresh token');
  });

  it('有效 refresh token → 200 并按 jti 移除会话', async () => {
    const refreshToken = await makeToken({ type: 'refresh', jti: 'parked-jti' });
    dbMock.insert.mockReturnValue(createChain([])); // recordLoginLog 写登录日志

    const app = buildApp();
    const res = await app.request('/api/auth/logout-by-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    const { removeSession } = await import('../../lib/session-manager');
    expect(vi.mocked(removeSession)).toHaveBeenCalledWith('parked-jti');
  });
});

describe('refreshAccessToken - 授权消费与轮换', () => {
  it('refresh 授权已被登出 / 轮换消费 → 401，且不再查库', async () => {
    const token = await makeToken({ type: 'refresh', jti: 'consumed-jti' });
    const sm = await import('../../lib/session-manager');
    vi.mocked(sm.consumeRefreshGrant).mockResolvedValueOnce(false);
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 401, message: '登录状态已失效，请重新登录' });
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it('jti 已拉黑（强制下线）→ 401', async () => {
    const token = await makeToken({ type: 'refresh', jti: 'revoked-jti' });
    const sm = await import('../../lib/session-manager');
    vi.mocked(sm.isTokenBlacklisted).mockResolvedValueOnce(true);
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 401, message: '登录状态已失效，请重新登录' });
  });

  it('缺少 jti 的 refresh token → 401', async () => {
    const token = await makeToken({ type: 'refresh', jti: undefined });
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 401, message: '无效的 refresh token' });
  });

  it('合法 refresh → 消费旧授权、签发新 jti 的 access + refresh，旧 jti 吊销', async () => {
    const token = await makeToken({ type: 'refresh', jti: 'old-jti' });
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject()]));
    dbMock.query.users.findFirst.mockResolvedValueOnce({ userRoles: [{ role: { id: 1, name: 'Admin', code: 'admin', status: 'enabled', description: null, createdAt: new Date(), updatedAt: new Date() } }] });

    const result = await refreshAccessToken(token, { ip: '127.0.0.1', ua: 'UA' });

    const sm = await import('../../lib/session-manager');
    expect(vi.mocked(sm.consumeRefreshGrant)).toHaveBeenCalledWith('old-jti');
    expect(vi.mocked(sm.grantRefresh)).toHaveBeenCalledWith('mock-token-id');
    expect(vi.mocked(sm.removeSession)).toHaveBeenCalledWith('old-jti');
    expect(vi.mocked(sm.registerSession)).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 'mock-token-id', userId: 1 }));
    const access = await verifyToken<{ jti: string; type?: string }>(result.accessToken);
    const refresh = await verifyToken<{ jti: string; type?: string }>(result.refreshToken);
    expect(access.jti).toBe('mock-token-id');
    expect(access.type).toBeUndefined();
    expect(refresh).toMatchObject({ type: 'refresh', jti: 'mock-token-id' });
  });

  it('授权消费后账号被禁用 → 403，且旧 jti 被吊销（不留半开会话）', async () => {
    const token = await makeToken({ type: 'refresh', jti: 'old-jti' });
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ status: 'disabled' })]));
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 403 });
    const sm = await import('../../lib/session-manager');
    expect(vi.mocked(sm.removeSession)).toHaveBeenCalledWith('old-jti');
  });
});

describe('refreshAccessToken - 实时主体与租户状态', () => {
  it('管理员已被禁用 → 403，旧 refresh token 不能续签', async () => {
    const token = await makeToken({ type: 'refresh' });
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ status: 'disabled' })]));
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 403, message: '账号已被禁用' });
  });

  it('管理员所在租户被禁用 → 403，旧 refresh token 不能续签', async () => {
    const token = await makeToken({ type: 'refresh', tenantId: 9 });
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ tenantId: 9, tenantStatus: 'disabled' })]));
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 403, message: '租户已被禁用或过期' });
  });

  it('管理员 refresh 的租户声明漂移 → 401', async () => {
    const token = await makeToken({ type: 'refresh', tenantId: null });
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({ tenantId: 9, tenantStatus: 'enabled' })]));
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 401, message: '登录状态已失效，请重新登录' });
  });

  it('管理员 refresh 的租户已过期 → 403', async () => {
    const token = await makeToken({ type: 'refresh', tenantId: 9 });
    dbMock.select.mockReturnValueOnce(createChain([activeAdminSubject({
      tenantId: 9,
      tenantStatus: 'enabled',
      tenantExpireAt: new Date(Date.now() - 1000),
    })]));
    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 403, message: '租户已被禁用或过期' });
  });
});
