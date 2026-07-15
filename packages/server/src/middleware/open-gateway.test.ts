/**
 * 开放 API 网关中间件单测（AppKey 鉴权 + HMAC 验签 + 防重放 + 套餐限流）。
 *
 * 覆盖要点：
 *  1. openSignatureAuth：缺 AppKey / AppKey 无效 401、应用禁用 403、
 *     免签应用直接放行、签名头缺失 401、时间戳过期 401（±300s 防重放）、
 *     nonce 重放 401、签名不匹配 401、合法签名放行并注入 openApp
 *  2. openRateLimit：QPS / 日 / 月配额超限 429（附事件），未超限放行，Redis 故障策略可配置
 *
 * Mock 策略：open-gateway.service / rate-plans.service / redis / config / logger /
 * open-event-bus mock；签名用真实 lib/open-signature 生成（与网关同源算法）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../config', () => ({
  config: {
    redis: { keyPrefix: 'test:' },
    openPlatform: { rateLimitFailClosed: true, gatewayRequireApproval: false },
    trustedProxyCidrs: [],
  },
}));

vi.mock('../lib/redis', () => ({
  default: { set: vi.fn(), incr: vi.fn(), expire: vi.fn() },
}));

vi.mock('../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/open-event-bus', () => ({
  openEventBus: { emit: vi.fn(), on: vi.fn() },
}));

vi.mock('../services/open-platform/open-gateway.service', () => ({
  getOpenApiApp: vi.fn(),
  recordOpenApiCall: vi.fn(),
}));

vi.mock('../services/open-platform/rate-plans.service', () => ({
  getRatePlanRowById: vi.fn(),
  getDefaultRatePlanRow: vi.fn(),
}));

vi.mock('../services/open-platform/open-quota-alerts.service', () => ({
  maybeSendQuotaWarning: vi.fn().mockResolvedValue(undefined),
}));

import redis from '../lib/redis';
import { config } from '../config';
import { openEventBus } from '../lib/open-event-bus';
import { getOpenApiApp } from '../services/open-platform/open-gateway.service';
import { getRatePlanRowById, getDefaultRatePlanRow } from '../services/open-platform/rate-plans.service';
import { maybeSendQuotaWarning } from '../services/open-platform/open-quota-alerts.service';
import { signRequest } from '../lib/open-signature';
import { openSignatureAuth, openRateLimit } from './open-gateway';

const redisMock = vi.mocked(redis);
const getAppMock = vi.mocked(getOpenApiApp);
const planByIdMock = vi.mocked(getRatePlanRowById);
const defaultPlanMock = vi.mocked(getDefaultRatePlanRow);
const quotaWarningMock = vi.mocked(maybeSendQuotaWarning);

const SECRET = 'app-signing-secret';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeApp(overrides: Record<string, unknown> = {}): any {
  return {
    clientId: 'ak_test_1',
    name: '测试应用',
    status: 'enabled',
    signEnabled: false,
    signingSecrets: [SECRET],
    ratePlanId: null,
    allowedScopes: [],
    ipAllowlist: [],
    environment: 'production',
    reviewStatus: 'approved',
    ...overrides,
  };
}

function buildAuthApp() {
  const app = new Hono();
  app.post('/open/api/v1/echo', openSignatureAuth, (c) => c.json({ code: 0, message: 'success', data: c.get('openApp').clientId }));
  return app;
}

/** 生成带合法签名的请求头（与网关同源算法） */
function signedHeaders(body: string, overrides: Record<string, string> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce-abc';
  const { signature } = signRequest(SECRET, {
    method: 'POST',
    path: '/open/api/v1/echo',
    query: '',
    timestamp,
    nonce,
    body,
  });
  return {
    'X-App-Key': 'ak_test_1',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  redisMock.set.mockResolvedValue('OK');
  redisMock.incr.mockResolvedValue(1);
  redisMock.expire.mockResolvedValue(1);
  quotaWarningMock.mockResolvedValue(undefined);
  config.openPlatform.rateLimitFailClosed = true;
  config.openPlatform.gatewayRequireApproval = false;
});

describe('openSignatureAuth - AppKey 鉴权', () => {
  it('缺少 X-App-Key → 401', async () => {
    const res = await buildAuthApp().request('/open/api/v1/echo', { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe(401);
  });

  it('AppKey 无效 → 401', async () => {
    getAppMock.mockResolvedValue(null);
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_bad' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('AppKey 无效');
  });

  it('应用已禁用 → 403', async () => {
    getAppMock.mockResolvedValue(makeApp({ status: 'disabled' }));
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1' },
    });
    expect(res.status).toBe(403);
  });

  it('免签应用（signEnabled=false）直接放行并注入 openApp', async () => {
    getAppMock.mockResolvedValue(makeApp());
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBe('ak_test_1');
  });

  it('来源 IP 不在应用白名单 → 403', async () => {
    getAppMock.mockResolvedValue(makeApp({ ipAllowlist: ['10.0.0.0/8'] }));
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain('IP');
  });

  it('来源 IP 命中应用白名单 → 放行', async () => {
    getAppMock.mockResolvedValue(makeApp({ ipAllowlist: ['127.0.0.1/32'] }));
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1' },
    });
    expect(res.status).toBe(200);
  });

  it('开启审核门禁后未通过应用 → 403', async () => {
    config.openPlatform.gatewayRequireApproval = true;
    getAppMock.mockResolvedValue(makeApp({ reviewStatus: 'pending' }));
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1' },
    });
    expect(res.status).toBe(403);
  });

  it('审核门禁开启时沙箱应用仍可用于接入调试', async () => {
    config.openPlatform.gatewayRequireApproval = true;
    getAppMock.mockResolvedValue(makeApp({ environment: 'sandbox', reviewStatus: 'draft' }));
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('openSignatureAuth - HMAC 验签（signEnabled）', () => {
  beforeEach(() => {
    getAppMock.mockResolvedValue(makeApp({ signEnabled: true }));
  });

  it('缺少签名三要素请求头 → 401', async () => {
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: { 'X-App-Key': 'ak_test_1', 'X-Timestamp': '123' }, // 缺 nonce/signature
    });
    expect(res.status).toBe(401);
  });

  it('时间戳超出 ±300s 窗口 → 401 防重放', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: signedHeaders('', { 'X-Timestamp': stale }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('签名时间戳已过期');
  });

  it('应用未配置签名密钥 → 401', async () => {
    getAppMock.mockResolvedValue(makeApp({ signEnabled: true, signingSecrets: [] }));
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: signedHeaders(''),
    });
    expect(res.status).toBe(401);
  });

  it('nonce 重放（Redis SET NX 未抢到）→ 401', async () => {
    redisMock.set.mockResolvedValue(null);
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: signedHeaders(''),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('重复请求（nonce 已使用）');
  });

  it('签名不匹配（body 被篡改）→ 401', async () => {
    const headers = signedHeaders('{"a":1}');
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers,
      body: '{"a":2}', // 篡改
    });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('签名校验失败');
  });

  it('合法签名（含 body）→ 放行', async () => {
    const body = '{"hello":"world"}';
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: signedHeaders(body),
      body,
    });
    expect(res.status).toBe(200);
    // nonce 已按窗口 2 倍 TTL 落防重放标记
    expect(redisMock.set).toHaveBeenCalledWith('test:opennonce:ak_test_1:nonce-abc', '1', 'EX', 600, 'NX');
  });

  it('密钥轮换宽限期内可使用上一版本密钥验签', async () => {
    getAppMock.mockResolvedValue(makeApp({ signEnabled: true, signingSecrets: ['new-secret', SECRET] }));
    const body = '{"hello":"rotation"}';
    const res = await buildAuthApp().request('/open/api/v1/echo', {
      method: 'POST',
      headers: signedHeaders(body),
      body,
    });
    expect(res.status).toBe(200);
  });
});

describe('openRateLimit - 套餐配额', () => {
  function buildLimitApp(app: ReturnType<typeof makeApp> | null = makeApp({ ratePlanId: 9 })) {
    const hono = new Hono();
    hono.use('*', async (c, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (app) c.set('openApp' as any, app);
      await next();
    });
    hono.get('/open/api/v1/echo', openRateLimit, (c) => c.json({ code: 0, message: 'success', data: null }));
    return hono;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makePlan(overrides: Record<string, unknown> = {}): any {
    return { id: 9, code: 'basic', status: 'enabled', qpsLimit: 0, dailyQuota: 0, monthlyQuota: 0, ...overrides };
  }

  it('未注入 openApp（未走鉴权）→ 放行', async () => {
    const res = await buildLimitApp(null).request('/open/api/v1/echo');
    expect(res.status).toBe(200);
    expect(planByIdMock).not.toHaveBeenCalled();
  });

  it('无可用套餐 → 放行', async () => {
    planByIdMock.mockResolvedValue(null);
    const res = await buildLimitApp().request('/open/api/v1/echo');
    expect(res.status).toBe(200);
  });

  it('沙箱应用不消耗生产配额', async () => {
    const res = await buildLimitApp(makeApp({ ratePlanId: 9, environment: 'sandbox' })).request('/open/api/v1/echo');
    expect(res.status).toBe(200);
    expect(planByIdMock).not.toHaveBeenCalled();
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('未绑定套餐时使用默认套餐', async () => {
    defaultPlanMock.mockResolvedValue(makePlan());
    const res = await buildLimitApp(makeApp({ ratePlanId: null })).request('/open/api/v1/echo');
    expect(res.status).toBe(200);
    expect(defaultPlanMock).toHaveBeenCalled();
  });

  it('QPS 超限 → 429 + Retry-After + 发出配额事件', async () => {
    planByIdMock.mockResolvedValue(makePlan({ qpsLimit: 5 }));
    redisMock.incr.mockResolvedValue(6);
    const res = await buildLimitApp().request('/open/api/v1/echo');

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect(openEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'app.quota.exceeded', data: expect.objectContaining({ limit: 'qps' }) }),
    );
  });

  it('日配额超限 → 429', async () => {
    planByIdMock.mockResolvedValue(makePlan({ dailyQuota: 1000 }));
    redisMock.incr.mockResolvedValue(1001);
    const res = await buildLimitApp().request('/open/api/v1/echo');
    expect(res.status).toBe(429);
    expect((await res.json()).message).toContain('每日调用配额');
  });

  it('月配额超限 → 429', async () => {
    planByIdMock.mockResolvedValue(makePlan({ monthlyQuota: 10000 }));
    redisMock.incr.mockResolvedValue(10001);
    const res = await buildLimitApp().request('/open/api/v1/echo');
    expect(res.status).toBe(429);
    expect((await res.json()).message).toContain('每月调用配额');
  });

  it('各配额均未超限 → 放行', async () => {
    planByIdMock.mockResolvedValue(makePlan({ qpsLimit: 10, dailyQuota: 1000, monthlyQuota: 10000 }));
    redisMock.incr.mockResolvedValue(1);
    const res = await buildLimitApp().request('/open/api/v1/echo');
    expect(res.status).toBe(200);
  });

  it('Redis 故障且 fail-close 开启 → 503', async () => {
    planByIdMock.mockResolvedValue(makePlan({ qpsLimit: 10 }));
    redisMock.incr.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await buildLimitApp().request('/open/api/v1/echo');
    expect(res.status).toBe(503);
  });

  it('Redis 故障且 fail-close 关闭 → 放行', async () => {
    config.openPlatform.rateLimitFailClosed = false;
    planByIdMock.mockResolvedValue(makePlan({ qpsLimit: 10 }));
    redisMock.incr.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await buildLimitApp().request('/open/api/v1/echo');
    expect(res.status).toBe(200);
  });
});
