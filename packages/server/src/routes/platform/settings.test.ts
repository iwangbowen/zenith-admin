/**
 * /api/settings 路由装配测试。
 *
 * 覆盖要点：
 *  1. 13 个模块各注册 GET + PUT 字面量路径，与契约 fullPath 一致
 *  2. /public 匿名可达；/me、模块端点无凭证 → 401
 *  3. PUT 请求体：缺字段 → 400；完整文档 → 交给 saveSettings 并返回信封
 *  4. guard 按注册表拿到模块的 feature / 权限 / 审计元数据
 *
 * Mock 策略：lib/settings 全部 mock（不测数据行为）；authMiddleware 真实实现 + 测试 JWT；guard 记录入参后直通。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { contextStorage } from 'hono/context-storage';
import { SETTINGS_MODULES, SETTINGS_MODULE_KEYS, settingsGetOp, settingsUpdateOp } from '@zenith/shared/settings';

const { guardCalls } = vi.hoisted(() => ({ guardCalls: [] as unknown[] }));

vi.mock('../../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
    jwtRefreshSecret: 'unit-test-only-fake-refresh-secret',
    multiTenantMode: false,
    licenseMode: 'off',
    redis: { keyPrefix: 'test:' },
    settings: { cacheTtlMs: 30_000 },
    log: { level: 'silent', dir: 'logs', maxFiles: '30d' },
  },
}));

vi.mock('../../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { from: () => chain, leftJoin: () => chain, where: () => chain, limit: async () => [{ username: 'admin', status: 'enabled', tenantId: null, tenantStatus: null, tenantExpireAt: null }] };
  return { db: { select: () => chain }, pgClient: { listen: vi.fn() } };
});

vi.mock('../../lib/session-manager', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  touchSession: vi.fn().mockResolvedValue(true),
  registerSession: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

vi.mock('../../middleware/guard', () => ({
  guard: (opts: unknown) => {
    guardCalls.push(opts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (_c: any, next: () => Promise<void>) => next();
  },
  setAuditBeforeData: vi.fn(),
}));

vi.mock('../../lib/settings', () => ({
  listSettingsModules: vi.fn(async () => []),
  getPublicSettings: vi.fn(async () => ({ auth: {}, identitySecurity: {} })),
  getMySettings: vi.fn(async () => ({ auth: {}, identitySecurity: {}, ui: {} })),
  getSettingsEnvelope: vi.fn(async (module: string) => ({
    module, scope: 'platform', tenantId: null, version: 2,
    effective: {}, inherited: {}, overriddenPaths: [], updatedAt: null,
  })),
  saveSettings: vi.fn(async (module: string, _user: unknown, input: { version: number }) => ({
    module, scope: 'platform', tenantId: null, version: input.version + 1,
    effective: {}, inherited: {}, overriddenPaths: [], updatedAt: null,
  })),
}));

import settingsRoutes from './settings';
import { getSettingsEnvelope, saveSettings } from '../../lib/settings';

async function token() {
  return sign({ userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null, jti: 'j1', exp: Math.floor(Date.now() / 1000) + 600 }, 'unit-test-only-fake-secret-do-not-use-in-production');
}

function buildApp() {
  const app = new Hono();
  app.use('*', contextStorage());
  app.route('/api/settings', settingsRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings routes', () => {
  it('每个模块的 GET / PUT 都已注册（与契约 fullPath 一致），无凭证 → 401', async () => {
    const app = buildApp();
    for (const module of SETTINGS_MODULE_KEYS) {
      const get = settingsGetOp(module);
      const put = settingsUpdateOp(module);
      expect((await app.request(get.fullPath)).status).toBe(401);
      expect((await app.request(put.fullPath, { method: 'PUT' })).status).toBe(401);
    }
    expect((await app.request('/api/settings/me')).status).toBe(401);
    expect((await app.request('/api/settings')).status).toBe(401);
  });

  it('/public 匿名可达', async () => {
    const res = await buildApp().request('/api/settings/public?tenantCode=acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: 0, data: { auth: {}, identitySecurity: {} } });
  });

  it('GET 模块端点返回信封', async () => {
    const res = await buildApp().request('/api/settings/identity-security', { headers: { Authorization: `Bearer ${await token()}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: 0, data: { module: 'identitySecurity', version: 2 } });
    expect(getSettingsEnvelope).toHaveBeenCalledWith('identitySecurity');
  });

  it('PUT 缺字段 → 400；完整文档 → 保存并返回新版本', async () => {
    const app = buildApp();
    const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
    const bad = await app.request('/api/settings/ui', { method: 'PUT', headers, body: JSON.stringify({ version: 2, data: { quickChatEnabled: true } }) });
    expect(bad.status).toBe(400);
    expect(saveSettings).not.toHaveBeenCalled();

    const full = SETTINGS_MODULES.ui.schema.parse({});
    const ok = await app.request('/api/settings/ui', { method: 'PUT', headers, body: JSON.stringify({ version: 2, data: { ...full, quickChatEnabled: true } }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ code: 0, data: { module: 'ui', version: 3 } });
    expect(saveSettings).toHaveBeenCalledWith('ui', expect.objectContaining({ userId: 1 }), { version: 2, data: { ...full, quickChatEnabled: true } });

    const unknownKey = await app.request('/api/settings/ui', { method: 'PUT', headers, body: JSON.stringify({ version: 2, data: { ...full, extra: 1 } }) });
    expect(unknownKey.status).toBe(400);
  });

  it('guard 从注册表取 feature / 权限 / 审计元数据', () => {
    const driveWrite = guardCalls.find((g) => (g as { audit?: { description?: string } }).audit?.description === '更新「企业网盘」设置');
    expect(driveWrite).toMatchObject({ feature: 'drive', permission: 'drive:setting:edit', audit: { module: '系统设置' } });
    const ipRead = guardCalls.find((g) => (g as { permission?: string; audit?: unknown }).permission === 'system:ip-access:view' && !(g as { audit?: unknown }).audit);
    expect(ipRead).toMatchObject({ feature: undefined, permission: 'system:ip-access:view' });
  });
});
