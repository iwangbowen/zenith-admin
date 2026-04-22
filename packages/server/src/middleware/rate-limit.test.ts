/**
 * rate-limit 中间件单元测试
 *
 * 覆盖要点：
 *  1. authRateLimit    — rateLimiter 配置正确（windowMs=900000, limit=10）
 *  2. captchaRateLimit — rateLimiter 配置正确（windowMs=60000, limit=30）
 *  3. sensitiveRateLimit — rateLimiter 配置正确（windowMs=3600000, limit=5）
 *  4. handler 响应格式 — 返回 { code: 429, message: ..., data: null }
 *  5. keyGenerator — x-forwarded-for 优先，其次 x-real-ip，最后 fallback '0.0.0.0'
 *
 * Mock 策略：
 *  - hono-rate-limiter 全部 mock（RedisStore + rateLimiter）
 *  - ../lib/redis 和 ../config mock，避免真实连接
 *  - 捕获 rateLimiter 调用参数，直接测试 handler/keyGenerator 函数
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';

// ─── 捕获 rateLimiter 调用参数 ─────────────────────────────────────────────
// vi.mock() 会被 vitest 提升（hoist），所以共享状态必须用 vi.hoisted() 声明
const { capturedOpts } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capturedOpts: [] as any[],
}));

vi.mock('hono-rate-limiter', () => ({
  // RedisStore 必须是可 new 的构造函数（不能用箭头函数）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RedisStore: vi.fn(function(this: any, opts: any) { this._opts = opts; }),
  rateLimiter: vi.fn((opts: unknown) => {
    capturedOpts.push(opts);
    // 测试中返回一个直接透传的中间件（不实际计数）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (_c: any, next: () => Promise<void>) => next();
  }),
}));

vi.mock('../lib/redis', () => ({
  default: {
    script: vi.fn(),
    evalsha: vi.fn(),
    decr: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../config', () => ({
  config: {
    redis: { keyPrefix: 'test:' },
  },
}));

// ─── 导入被测模块（必须在 mock 声明之后） ────────────────────────────────────
import { authRateLimit, captchaRateLimit, sensitiveRateLimit } from './rate-limit';

// ─── 辅助：构造携带指定请求头的 Hono Context ─────────────────────────────────
async function makeContext(headers: Record<string, string> = {}) {
  let capturedC: unknown = null;
  const app = new Hono();
  app.get('/probe', (c) => {
    capturedC = c;
    return c.text('ok');
  });
  await app.request('/probe', { headers });
  return capturedC;
}

// ─── 辅助：直接调用某 opts 的 handler 函数 ──────────────────────────────────
async function callHandler(optsIndex: number) {
  const app = new Hono();
  app.get('/limit', async (c) => {
    // 直接调用捕获到的 handler 函数
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return capturedOpts[optsIndex].handler(c as any);
  });
  return app.request('/limit');
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────
describe('rate-limit 中间件', () => {
  beforeAll(() => {
    // 确保三个中间件都已被创建（模块加载时会调用三次 rateLimiter）
    expect(capturedOpts).toHaveLength(3);
  });

  // ─── rateLimiter 配置校验 ──────────────────────────────────────────────────
  describe('rateLimiter 配置', () => {
    it('authRateLimit — windowMs=15min, limit=10', () => {
      const opts = capturedOpts[0];
      expect(opts.windowMs).toBe(15 * 60 * 1000);
      expect(opts.limit).toBe(10);
    });

    it('captchaRateLimit — windowMs=1min, limit=30', () => {
      const opts = capturedOpts[1];
      expect(opts.windowMs).toBe(60 * 1000);
      expect(opts.limit).toBe(30);
    });

    it('sensitiveRateLimit — windowMs=1h, limit=5', () => {
      const opts = capturedOpts[2];
      expect(opts.windowMs).toBe(60 * 60 * 1000);
      expect(opts.limit).toBe(5);
    });

    it('RedisStore 使用正确的 prefix（test:rl:）', async () => {
      const { RedisStore } = vi.mocked(await import('hono-rate-limiter'));
      const call = vi.mocked(RedisStore).mock.calls[0][0] as { prefix: string };
      expect(call.prefix).toBe('test:rl:');
    });
  });

  // ─── handler 响应格式 ──────────────────────────────────────────────────────
  describe('handler 429 响应', () => {
    it('authRateLimit handler — HTTP 429 + code:429 + data:null', async () => {
      const res = await callHandler(0);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.code).toBe(429);
      expect(body.data).toBeNull();
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    });

    it('captchaRateLimit handler — HTTP 429 + code:429', async () => {
      const res = await callHandler(1);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.code).toBe(429);
      expect(body.data).toBeNull();
    });

    it('sensitiveRateLimit handler — HTTP 429 + code:429', async () => {
      const res = await callHandler(2);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.code).toBe(429);
      expect(body.data).toBeNull();
    });
  });

  // ─── keyGenerator IP 提取逻辑 ──────────────────────────────────────────────
  describe('keyGenerator IP 提取', () => {
    it('x-forwarded-for（取第一个值，去空格）', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await makeContext({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }) as any;
      const key = capturedOpts[0].keyGenerator(c);
      expect(key).toBe('10.0.0.1');
    });

    it('x-real-ip（无 x-forwarded-for 时回退）', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await makeContext({ 'x-real-ip': '192.168.1.100' }) as any;
      const key = capturedOpts[0].keyGenerator(c);
      expect(key).toBe('192.168.1.100');
    });

    it('fallback → "0.0.0.0"（无任何 IP 头）', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = await makeContext() as any;
      const key = capturedOpts[0].keyGenerator(c);
      expect(key).toBe('0.0.0.0');
    });

    it('x-forwarded-for 优先于 x-real-ip', async () => {
      const c = await makeContext({
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '9.9.9.9',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      const key = capturedOpts[0].keyGenerator(c);
      expect(key).toBe('1.2.3.4');
    });
  });

  // ─── 中间件透传验证（未超限正常放行） ──────────────────────────────────────
  describe('未超限时正常透传', () => {
    it('authRateLimit 放行请求，下游返回 200', async () => {
      const app = new Hono();
      app.use('/login', authRateLimit);
      app.post('/login', (c) => c.json({ code: 0, message: 'success', data: null }));
      const res = await app.request('/login', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('captchaRateLimit 放行请求，下游返回 200', async () => {
      const app = new Hono();
      app.use('/captcha', captchaRateLimit);
      app.get('/captcha', (c) => c.json({ code: 0, message: 'success', data: null }));
      const res = await app.request('/captcha');
      expect(res.status).toBe(200);
    });

    it('sensitiveRateLimit 放行请求，下游返回 200', async () => {
      const app = new Hono();
      app.use('/register', sensitiveRateLimit);
      app.post('/register', (c) => c.json({ code: 0, message: 'success', data: null }));
      const res = await app.request('/register', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });
});
