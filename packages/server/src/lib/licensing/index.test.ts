import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { LicenseFeatureKey, LicenseMode } from '@zenith/shared/licensing';
import { memberMarketingContract } from '@zenith/shared/marketing';

const state = vi.hoisted(() => ({
  config: { licenseMode: 'required' as LicenseMode, licenseIssuerPublicKey: '' },
  snapshot: {
    features: new Set<LicenseFeatureKey>(),
    restricted: false,
    licenseRowId: 7,
  },
  readSnapshot: vi.fn(),
  denied: vi.fn(),
}));

// 只替换部署状态读取；请求链使用真实 License 模式判断和中间件。
vi.mock('../../config', () => ({ config: state.config }));
vi.mock('./snapshot', () => ({
  getLicenseSnapshot: state.readSnapshot,
  logFeatureDeniedThrottled: state.denied,
  invalidateLicenseSnapshot: vi.fn(),
  evaluatePayloadStatus: vi.fn(),
}));
vi.mock('./installation', () => ({ ensureInstallation: vi.fn(), readLicenseEpoch: vi.fn(), bumpLicenseEpoch: vi.fn() }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn() }));
vi.mock('../../middleware/guard', () => ({ guard: vi.fn() }));
vi.mock('../../middleware/platform-admin', () => ({ platformAdminOnly: vi.fn() }));
vi.mock('../data-mask/boundary', () => ({ withDataMasking: (_op: unknown, handler: unknown) => handler }));

import { assertFeatureEnabled, isFeatureEnabled, licenseFeatureGate } from './index';
import { defineContractRoute } from '../contract-route';
import { errBody, okBody, validationHook } from '../openapi-schemas';

beforeEach(() => {
  vi.clearAllMocks();
  state.config.licenseMode = 'required';
  state.snapshot.features = new Set();
  state.snapshot.restricted = false;
  state.readSnapshot.mockResolvedValue(state.snapshot);
});

function featureApp(feature: LicenseFeatureKey) {
  const app = new Hono();
  const handler = vi.fn((c: Parameters<MiddlewareHandler>[0]) => c.json(okBody(null), 200));
  app.get('/feature', licenseFeatureGate(feature), handler);
  return { app, handler };
}

describe('License 功能门控运行时', () => {
  it.each(['growth', 'iot'] as const)('required：缺少 %s 授权返回 403，授予后允许执行业务', async (feature) => {
    const { app, handler } = featureApp(feature);
    const denied = await app.request('/feature');
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain(feature === 'growth' ? '运营中心' : 'IoT 设备');
    expect(handler).not.toHaveBeenCalled();

    state.snapshot.features.add(feature);
    expect((await app.request('/feature')).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('required：失效 License 即使包含功能也拒绝', async () => {
    state.snapshot.features.add('iot');
    state.snapshot.restricted = true;
    expect(await isFeatureEnabled('iot')).toBe(false);
    await expect(assertFeatureEnabled('iot')).rejects.toMatchObject({ status: 403 });
  });

  it('off：无需读取 License 快照即可放行', async () => {
    state.config.licenseMode = 'off';
    const { app, handler } = featureApp('growth');
    expect((await app.request('/feature')).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(state.readSnapshot).not.toHaveBeenCalled();
    expect(state.denied).not.toHaveBeenCalled();
  });

  it('warn：缺少授权仍放行并记录功能拒绝，已授权不记录', async () => {
    state.config.licenseMode = 'warn';
    const { app } = featureApp('iot');
    expect((await app.request('/feature')).status).toBe(200);
    expect(state.denied).toHaveBeenCalledExactlyOnceWith('iot', 7);
    state.snapshot.features.add('iot');
    state.denied.mockClear();
    expect((await app.request('/feature')).status).toBe(200);
    expect(state.denied).not.toHaveBeenCalled();
  });
});

function memberMarketingApp() {
  const router = new OpenAPIHono({ defaultHook: validationHook });
  const authenticated = vi.fn();
  const handled = vi.fn();
  const credential: MiddlewareHandler = async (c, next) => {
    if (c.req.header('authorization') !== 'Bearer member-test-token') return c.json(errBody('会员登录已失效', 401), 401);
    authenticated();
    await next();
  };
  router.openapiRoutes([defineContractRoute(memberMarketingContract.myRecords, {
    middleware: [credential],
    handler: async (c) => {
      handled();
      return c.json(okBody([]), 200);
    },
  })] as const);
  const app = new OpenAPIHono();
  // 刻意不加域挂载门控：确保会员契约自身仍执行授权。
  app.route(memberMarketingContract.basePath, router);
  return { app, authenticated, handled };
}

describe('会员营销契约授权', () => {
  const path = '/api/member/marketing/campaigns/1/my-records';
  const headers = { authorization: 'Bearer member-test-token' };

  it('required：先认证会员，再拒绝未授权运营中心；启用后允许调用', async () => {
    const { app, authenticated, handled } = memberMarketingApp();
    expect((await app.request(path)).status).toBe(401);
    expect(state.readSnapshot).not.toHaveBeenCalled();
    expect(authenticated).not.toHaveBeenCalled();
    expect((await app.request(path, { headers })).status).toBe(403);
    expect(authenticated).toHaveBeenCalledOnce();
    expect(handled).not.toHaveBeenCalled();

    state.snapshot.features.add('growth');
    const allowed = await app.request(path, { headers });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(okBody([]));
    expect(handled).toHaveBeenCalledOnce();
  });

  it.each(['off', 'warn'] as const)('%s：会员认证通过后按部署模式放行', async (mode) => {
    state.config.licenseMode = mode;
    const { app, handled } = memberMarketingApp();
    expect((await app.request(path, { headers })).status).toBe(200);
    expect(handled).toHaveBeenCalledOnce();
    if (mode === 'off') expect(state.readSnapshot).not.toHaveBeenCalled();
    else expect(state.denied).toHaveBeenCalledExactlyOnceWith('growth', 7);
  });
});
