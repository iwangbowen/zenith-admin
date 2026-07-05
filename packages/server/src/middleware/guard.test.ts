/**
 * guard 统一路由守卫中间件单测（权限强制执行点，安全关键）。
 *
 * 覆盖要点：
 *  1. 无配置 → 直接放行
 *  2. 权限校验：超管绕过（不查权限表）、单权限命中/未命中、数组权限「满足其一」语义
 *  3. 未命中 → 403 { code: 403, message: '权限不足' }，且不写审计日志
 *  4. 审计日志：异步写入 operation_logs（description/method/path/responseCode/requestBody）
 *  5. 审计写库失败不影响主响应
 *
 * Mock 策略：db / permissions / ip-location / request-helpers / config 全部 mock，
 * 用 Hono 内存 app + 前置中间件注入 c.set('user', ...)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';

vi.mock('../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret',
    multiTenantMode: false,
    redis: { keyPrefix: 'test:' },
    log: { level: 'silent', dir: 'logs', maxFiles: '30d' },
  },
}));

vi.mock('../db', () => ({
  db: { insert: vi.fn() },
}));

vi.mock('../lib/permissions', () => ({
  isSuperAdmin: vi.fn().mockReturnValue(false),
  getUserPermissions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/ip-location', () => ({
  lookupIpLocation: vi.fn().mockReturnValue('内网地址'),
}));

vi.mock('../lib/request-helpers', () => ({
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  parseUserAgent: vi.fn().mockReturnValue({ browser: 'Chrome 120', os: 'Windows 11' }),
}));

import { db } from '../db';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { guard } from './guard';

const dbMock = vi.mocked(db);
const isSuperAdminMock = vi.mocked(isSuperAdmin);
const getUserPermissionsMock = vi.mocked(getUserPermissions);

const insertValues = vi.fn().mockResolvedValue(undefined);

function buildApp(guardOpts: Parameters<typeof guard>[0]) {
  const app = new Hono();
  app.use('*', contextStorage());
  app.use('*', async (c, next) => {
    c.set('user', { userId: 1, username: 'alice', roles: ['user'], tenantId: null, jti: 'j1' });
    await next();
  });
  app.post('/target', guard(guardOpts), (c) => c.json({ code: 0, message: 'success', data: { ok: true } }));
  app.get('/target', guard(guardOpts), (c) => c.json({ code: 0, message: 'success', data: { ok: true } }));
  return app;
}

/** 等待 setImmediate 派发的异步审计写入完成 */
async function flushAudit() {
  await vi.waitFor(() => expect(insertValues).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  insertValues.mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dbMock.insert as any).mockReturnValue({ values: insertValues });
  isSuperAdminMock.mockReturnValue(false);
  getUserPermissionsMock.mockResolvedValue([]);
});

describe('guard - 无配置', () => {
  it('不配置 permission/audit 时直接放行', async () => {
    const res = await buildApp({}).request('/target');
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe(0);
    expect(getUserPermissionsMock).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe('guard - 权限校验', () => {
  it('超管绕过权限校验，且不查询用户权限', async () => {
    isSuperAdminMock.mockReturnValue(true);
    const res = await buildApp({ permission: 'user:delete' }).request('/target');
    expect(res.status).toBe(200);
    expect(getUserPermissionsMock).not.toHaveBeenCalled();
  });

  it('拥有所需权限 → 放行', async () => {
    getUserPermissionsMock.mockResolvedValue(['user:list', 'user:create']);
    const res = await buildApp({ permission: 'user:list' }).request('/target');
    expect(res.status).toBe(200);
  });

  it('缺少所需权限 → 403 权限不足', async () => {
    getUserPermissionsMock.mockResolvedValue(['user:list']);
    const res = await buildApp({ permission: 'user:delete' }).request('/target');
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body).toEqual({ code: 403, message: '权限不足', data: null });
  });

  it('数组权限满足其一即放行', async () => {
    getUserPermissionsMock.mockResolvedValue(['user:export']);
    const res = await buildApp({ permission: ['user:list', 'user:export'] }).request('/target');
    expect(res.status).toBe(200);
  });

  it('数组权限全部未命中 → 403', async () => {
    getUserPermissionsMock.mockResolvedValue(['other:read']);
    const res = await buildApp({ permission: ['user:list', 'user:export'] }).request('/target');
    expect(res.status).toBe(403);
  });

  it('权限拒绝时不写审计日志（守卫顺序：权限先于审计）', async () => {
    getUserPermissionsMock.mockResolvedValue([]);
    const res = await buildApp({
      permission: 'user:delete',
      audit: { description: '删除用户', module: '用户管理' },
    }).request('/target');
    expect(res.status).toBe(403);
    // 等待可能的 setImmediate 回调派发
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe('guard - 审计日志', () => {
  it('响应正常返回，并异步写入操作日志（含用户/方法/路径/响应码）', async () => {
    const res = await buildApp({ audit: { description: '创建用户', module: '用户管理' } }).request('/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob' }),
    });
    expect(res.status).toBe(200);

    await flushAudit();
    const logged = insertValues.mock.calls[0][0];
    expect(logged).toMatchObject({
      userId: 1,
      username: 'alice',
      module: '用户管理',
      description: '创建用户',
      method: 'POST',
      path: '/target',
      responseCode: 200,
      ip: '127.0.0.1',
    });
    expect(logged.requestBody).toContain('bob');
    expect(logged.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('recordBody: false 时不记录请求体', async () => {
    const res = await buildApp({ audit: { description: '上传文件', recordBody: false } }).request('/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'raw-file-content' }),
    });
    expect(res.status).toBe(200);

    await flushAudit();
    expect(insertValues.mock.calls[0][0].requestBody).toBeNull();
  });

  it('成功响应的 data 被记录为操作后快照（afterData）', async () => {
    const res = await buildApp({ audit: { description: '创建用户' } }).request('/target', { method: 'POST' });
    expect(res.status).toBe(200);

    await flushAudit();
    const logged = insertValues.mock.calls[0][0];
    expect(logged.afterData).toBe(JSON.stringify({ ok: true }));
  });

  it('审计写库失败不影响主响应（静默吞错）', async () => {
    insertValues.mockRejectedValue(new Error('db down'));
    const res = await buildApp({ audit: { description: '创建用户' } }).request('/target', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe(0);
    await vi.waitFor(() => expect(insertValues).toHaveBeenCalled());
  });

  it('GET 请求（无 JSON body）审计不记录请求体且不报错', async () => {
    const res = await buildApp({ audit: { description: '查询列表' } }).request('/target');
    expect(res.status).toBe(200);

    await flushAudit();
    expect(insertValues.mock.calls[0][0].requestBody).toBeNull();
  });
});
