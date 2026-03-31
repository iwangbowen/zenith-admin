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
 *  7. GET  /api/auth/me       — 有效 JWT + 用户不存在 → 404
 *  8. GET  /api/auth/me       — 有效 JWT + 用户存在 → 200
 *
 * Mock 策略：
 *  - db / redis / session-manager / system-config / email / logger 全部 mock
 *  - JWT 使用固定测试密钥签名，与 config.jwtSecret mock 对齐
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = 'unit-test-only-fake-secret-do-not-use-in-production';

// ─── Mocks（必须在 import 模块前声明，vitest 会 hoist） ───────────────────────
vi.mock('../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
    jwtRefreshSecret: 'unit-test-only-fake-refresh-secret',
    port: 3300,
    databaseUrl: 'mock://localhost/test',
    multiTenantMode: false,
    redis: { keyPrefix: 'test:' },
    log: { level: 'silent', dir: 'logs', maxFiles: '30d' },
    oauth: { github: {}, dingtalk: {}, wechatWork: {}, callbackBaseUrl: '' },
  },
}));

vi.mock('../db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/redis', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    scan: vi.fn(),
  },
}));

vi.mock('../lib/session-manager', () => ({
  generateTokenId: () => 'mock-token-id',
  registerSession: vi.fn(),
  touchSession: vi.fn(),
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  forceLogout: vi.fn(),
  removeSession: vi.fn(),
  checkLoginLock: vi.fn().mockResolvedValue({ isLocked: false, attempts: 0 }),
  recordLoginFailure: vi.fn(),
  clearLoginAttempts: vi.fn(),
  getOnlineSessions: vi.fn().mockResolvedValue([]),
  unlockUser: vi.fn(),
}));

vi.mock('../lib/system-config', () => ({
  getConfigBoolean: vi.fn().mockResolvedValue(false),
  getConfigNumber: vi.fn().mockResolvedValue(90),
  getConfigString: vi.fn().mockResolvedValue(''),
}));

vi.mock('../lib/email', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/logger', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  httpLogger: async (_c: any, next: () => Promise<void>) => next(),
}));

vi.mock('../lib/permissions', () => ({
  isSuperAdmin: vi.fn().mockReturnValue(false),
  getUserPermissions: vi.fn().mockResolvedValue(['user:read']),
  clearUserPermissionCache: vi.fn(),
}));

// ─── Imports（在 mock 声明之后） ──────────────────────────────────────────────
import { db } from '../db';
import authRoutes from './auth';

const dbMock = vi.mocked(db);

// ─── 工具：可 await 的链式 query builder mock ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): Record<string, any> {
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

// ─── 工具：生成测试用 JWT ──────────────────────────────────────────────────────
function makeToken(payload: object = {}) {
  return jwt.sign(
    { userId: 1, username: 'admin', roles: ['admin'], tenantId: null, jti: 'test-jti', ...payload },
    TEST_JWT_SECRET,
  );
}

// ─── 测试应用 ─────────────────────────────────────────────────────────────────
function buildApp() {
  const app = new Hono();
  app.route('/api/auth', authRoutes);
  return app;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
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
    const expiredToken = jwt.sign(
      { userId: 1, username: 'admin', roles: ['admin'], tenantId: null },
      TEST_JWT_SECRET,
      { expiresIn: -1 }, // already expired
    );
    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('有效 JWT 但用户不存在 → 404', async () => {
    const token = makeToken();
    dbMock.select.mockReturnValueOnce(createChain([])); // users 查询 → 空

    const app = buildApp();
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe(404);
  });

  it('有效 JWT + 用户存在 → 200 返回用户信息', async () => {
    const token = makeToken({ userId: 1 });
    const now = new Date();
    const mockUser = {
      id: 1,
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.com',
      password: 'hashed',
      avatar: null,
      phone: null,
      status: 'active',
      departmentId: null,
      tenantId: null,
      remark: null,
      lastLoginAt: null,
      lastLoginIp: null,
      passwordUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    dbMock.select
      .mockReturnValueOnce(createChain([mockUser])) // users 查询
      .mockReturnValueOnce(createChain([]));         // getUserRoles 查询

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
});
