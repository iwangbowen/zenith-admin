/**
 * 幂等控制中间件单测（防重复提交，支付/创单安全关键）。
 *
 * 覆盖要点：
 *  1. 客户端 Token 模式（X-Idempotency-Key）：首次放行 + SET NX、重复提交 429、
 *     成功 JSON 响应缓存 + 网络重试返回缓存响应
 *  2. 自动指纹模式：同用户同请求体 429、key 长度截断（128）
 *  3. autoFingerprint=false 且无 header → 直接放行（不触 Redis）
 *  4. 并发竞争：GET 未命中但 SET NX 失败 → 429
 *  5. Redis 故障降级放行（不阻断业务）
 *  6. 非 2xx 响应不缓存
 *
 * Mock 策略：redis / config / context / logger 全部 mock。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../config', () => ({
  config: { redis: { keyPrefix: 'test:' } },
}));

vi.mock('../lib/redis', () => ({
  default: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('../lib/context', () => ({
  currentUser: vi.fn().mockReturnValue({ userId: 1, username: 'alice' }),
}));

vi.mock('../lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import redis from '../lib/redis';
import { currentUser } from '../lib/context';
import { idempotencyGuard, type IdempotencyOptions } from './idempotency';

const redisMock = vi.mocked(redis);

function buildApp(opts: IdempotencyOptions = {}, status = 200) {
  const app = new Hono();
  const handler = vi.fn();
  app.post('/orders', idempotencyGuard(opts), (c) => {
    handler();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json({ code: 0, message: 'success', data: { orderNo: 'PO-1' } }, status as any);
  });
  return { app, handler };
}

function post(app: Hono, headers: Record<string, string> = {}, body = '{"amount":100}') {
  return app.request('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentUser).mockReturnValue({ userId: 1, username: 'alice' } as ReturnType<typeof currentUser>);
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
});

describe('idempotencyGuard - 客户端 Token 模式', () => {
  it('首次请求放行并以 header key 做 SET NX', async () => {
    const { app, handler } = buildApp({ ttlSeconds: 60 });
    const res = await post(app, { 'X-Idempotency-Key': 'client-key-123' });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // 第一次 set：processing 占位（SET NX EX）
    expect(redisMock.set).toHaveBeenCalledWith(
      'test:idempotency:client-key-123',
      expect.stringContaining('processing'),
      'EX',
      60,
      'NX',
    );
  });

  it('处理中重复提交（GET 命中 processing 占位）→ 429 不执行 handler', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ state: 'processing' }));
    const { app, handler } = buildApp({ message: '订单处理中，请勿重复提交' });
    const res = await post(app, { 'X-Idempotency-Key': 'client-key-123' });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toEqual({ code: 429, message: '订单处理中，请勿重复提交', data: null });
    expect(handler).not.toHaveBeenCalled();
  });

  it('成功 JSON 响应写入缓存（第二次 set）', async () => {
    const { app } = buildApp({ ttlSeconds: 30 });
    await post(app, { 'X-Idempotency-Key': 'k1' });

    expect(redisMock.set).toHaveBeenCalledTimes(2);
    const [key, value, , ttl] = redisMock.set.mock.calls[1];
    expect(key).toBe('test:idempotency:k1');
    expect(ttl).toBe(30);
    const cached = JSON.parse(value as string);
    expect(cached.status).toBe(200);
    expect(cached.body).toContain('PO-1');
  });

  it('网络重试命中已缓存响应 → 直接返回缓存 body/status，不执行 handler', async () => {
    redisMock.get.mockResolvedValue(
      JSON.stringify({ status: 200, contentType: 'application/json', body: '{"code":0,"data":{"orderNo":"PO-1"}}' }),
    );
    const { app, handler } = buildApp();
    const res = await post(app, { 'X-Idempotency-Key': 'k1' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.orderNo).toBe('PO-1');
    expect(handler).not.toHaveBeenCalled();
  });

  it('超长客户端 key 截断为 128 字符（防 key 注入撑爆 Redis）', async () => {
    const { app } = buildApp();
    await post(app, { 'X-Idempotency-Key': 'x'.repeat(300) });

    const key = redisMock.set.mock.calls[0][0] as string;
    expect(key).toBe(`test:idempotency:${'x'.repeat(128)}`);
  });

  it('非 2xx 响应不缓存（仅 processing 占位，无第二次 set）', async () => {
    const { app } = buildApp({}, 400);
    await post(app, { 'X-Idempotency-Key': 'k-fail' });

    expect(redisMock.set).toHaveBeenCalledTimes(1);
  });
});

describe('idempotencyGuard - 自动指纹模式', () => {
  it('无 header 时按用户+方法+路径+body 指纹拦截重复', async () => {
    const { app, handler } = buildApp();
    const res1 = await post(app);
    expect(res1.status).toBe(200);

    const fingerprintKey = redisMock.set.mock.calls[0][0] as string;
    expect(fingerprintKey).toMatch(/^test:idempotency:[0-9a-f]{32}$/);

    // 第二次相同请求：SET NX 返回 null → 429
    redisMock.set.mockResolvedValueOnce(null);
    const res2 = await post(app);
    expect(res2.status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('不同请求体产生不同指纹', async () => {
    const { app } = buildApp();
    await post(app, {}, '{"amount":100}');
    await post(app, {}, '{"amount":200}');

    const key1 = redisMock.set.mock.calls[0][0];
    const key2 = redisMock.set.mock.calls[2][0]; // 每次成功请求 set 两次（占位 + 缓存）
    expect(key1).not.toBe(key2);
  });

  it('未登录（currentUser 抛错）时退化为 IP 指纹，不抛异常', async () => {
    vi.mocked(currentUser).mockImplementation(() => {
      throw new Error('no context');
    });
    const { app } = buildApp();
    const res = await post(app, { 'X-Forwarded-For': '1.2.3.4' });
    expect(res.status).toBe(200);
  });

  it('autoFingerprint=false 且无 header → 直接放行，不触 Redis', async () => {
    const { app, handler } = buildApp({ autoFingerprint: false });
    const res = await post(app);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe('idempotencyGuard - 并发与容错', () => {
  it('GET 未命中但 SET NX 竞争失败 → 429（并发双击仅一次成功）', async () => {
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValueOnce(null); // NX 已被并发请求抢占
    const { app, handler } = buildApp();
    const res = await post(app, { 'X-Idempotency-Key': 'race-key' });

    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it('Redis 不可用 → 降级放行（不阻断业务）', async () => {
    redisMock.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const { app, handler } = buildApp();
    const res = await post(app, { 'X-Idempotency-Key': 'k1' });

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('缓存内容损坏（非 JSON）→ 按重复提交拒绝而非 500', async () => {
    redisMock.get.mockResolvedValue('corrupted-not-json');
    const { app } = buildApp();
    const res = await post(app, { 'X-Idempotency-Key': 'k1' });
    expect(res.status).toBe(429);
  });
});
