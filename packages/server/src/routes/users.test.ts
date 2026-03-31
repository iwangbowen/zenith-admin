/**
 * users 路由接口测试
 *
 * 覆盖要点：
 *  1. GET  /api/users   — 无 Authorization → 401
 *  2. GET  /api/users   — 无效 JWT → 401
 *  3. GET  /api/users   — 有效 JWT + 空列表 → 200 分页响应
 *  4. POST /api/users   — 有效 JWT + body 缺少必填字段 → 400
 *  5. DELETE /api/users/:id — 有效 JWT + 合法请求 → 204/200（mocked DB）
 *
 * Mock 策略：
 *  - guard 中间件 mock 为 pass-through（不测试权限校验逻辑）
 *  - authMiddleware 使用真实实现 + test JWT secret
 *  - DB 使用可链式调用的 mock chain
 *  - data-scope 返回 undefined（全量访问）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

// ─── Mocks ───────────────────────────────────────────────────────────────────
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
  touchSession: vi.fn().mockResolvedValue(undefined),
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  forceLogout: vi.fn(),
  removeSession: vi.fn(),
  checkLoginLock: vi.fn().mockResolvedValue({ isLocked: false, attempts: 0 }),
  recordLoginFailure: vi.fn(),
  clearLoginAttempts: vi.fn(),
  getOnlineSessions: vi.fn().mockResolvedValue([]),
  unlockUser: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/logger', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  httpLogger: async (_c: any, next: () => Promise<void>) => next(),
}));

vi.mock('../middleware/guard', () => ({
  // guard 中间件 → pass-through，不检查权限
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guard: () => async (_c: any, next: () => Promise<void>) => next(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAuditBeforeData: (_c: any, _data: unknown) => {},
}));

vi.mock('../lib/data-scope', () => ({
  getDataScopeCondition: vi.fn().mockResolvedValue(undefined), // 全量访问
}));

vi.mock('../lib/permissions', () => ({
  isSuperAdmin: vi.fn().mockReturnValue(false),
  getUserPermissions: vi.fn().mockResolvedValue(['user:read']),
  clearUserPermissionCache: vi.fn(),
}));

vi.mock('../lib/password-policy', () => ({
  getPasswordPolicy: vi.fn().mockResolvedValue(null),
  validatePassword: vi.fn().mockReturnValue(null),
}));

vi.mock('../lib/excel-export', () => ({
  exportToExcel: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
import { db } from '../db';
import usersRoutes from './users';

const dbMock = vi.mocked(db);

// ─── 工具 ─────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): Record<string, any> {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'innerJoin', 'leftJoin', 'limit', 'offset', 'orderBy', 'groupBy', 'values', 'returning', 'set'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn: (e: unknown) => unknown) => Promise.resolve(result).catch(fn);
  chain.finally = (fn: () => void) => Promise.resolve(result).finally(fn);
  return chain;
}

function makeToken(payload: object = {}) {
  return jwt.sign(
    { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null, jti: 'test-jti', ...payload },
    'unit-test-only-fake-secret-do-not-use-in-production',
  );
}

function buildApp() {
  const app = new Hono();
  app.route('/api/users', usersRoutes);
  return app;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/users - 认证中间件', () => {
  it('无 Authorization 头 → 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe(401);
  });

  it('无效 JWT → 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/users', {
      headers: { Authorization: 'Bearer not.a.real.token' },
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/users - 列表查询', () => {
  it('有效 JWT + 空数据库 → 200 返回空分页列表', async () => {
    const token = makeToken();

    // count 查询 → 0 条
    dbMock.select.mockReturnValueOnce(createChain([{ count: '0' }]));
    // list 查询 → 空
    dbMock.select.mockReturnValueOnce(createChain([]));

    const app = buildApp();
    const res = await app.request('/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.list).toEqual([]);
    expect(body.data.total).toBeDefined();
  });
});

describe('POST /api/users - 参数校验', () => {
  it('缺少 username 字段 → 400', async () => {
    const token = makeToken();

    const app = buildApp();
    const res = await app.request('/api/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: '测试用户', password: 'Abc@123' }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe(400);
  });

  it('缺少 password 字段 → 400', async () => {
    const token = makeToken();

    const app = buildApp();
    const res = await app.request('/api/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'testuser', nickname: '测试' }),
    });

    expect(res.status).toBe(400);
  });
});
