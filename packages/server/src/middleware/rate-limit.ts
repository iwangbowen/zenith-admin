import { rateLimiter, RedisStore } from 'hono-rate-limiter';
import type { MiddlewareHandler } from 'hono';
import redis from '../lib/redis';
import { config } from '../config';

// ioredis → hono-rate-limiter RedisClient 适配器
// ioredis 的 evalsha 签名为 (sha1, numkeys, ...keys, ...args)，需要拍平传递
const ioredisAdapter = {
  scriptLoad(script: string): Promise<string> {
    return redis.script('LOAD', script) as Promise<string>;
  },
  evalsha<TArgs extends unknown[], TData = unknown>(
    sha1: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData> {
    return redis.evalsha(
      sha1,
      keys.length,
      ...(keys as string[]),
      ...(args as string[]),
    ) as Promise<TData>;
  },
  decr(key: string): Promise<number> {
    return redis.decr(key);
  },
  del(key: string): Promise<number> {
    return redis.del(key) as Promise<number>;
  },
};

const rateLimitStore = new RedisStore({
  client: ioredisAdapter,
  prefix: `${config.redis.keyPrefix}rl:`,
});

/** 从请求头或 IP 取 key，优先信任反代头 */
const ipKey = (c: Parameters<MiddlewareHandler>[0]) =>
  c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
  c.req.header('x-real-ip') ??
  '0.0.0.0';

/**
 * 认证接口（登录）：15 分钟内最多 10 次
 * 防止暴力破解密码
 */
export const authRateLimit: MiddlewareHandler = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: ipKey,
  store: rateLimitStore,
  handler: (c) =>
    c.json({ code: 429, message: '登录尝试过于频繁，请 15 分钟后再试', data: null }, 429),
});

/**
 * 验证码接口：1 分钟内最多 30 次
 * 防止验证码接口被高频刷取
 */
export const captchaRateLimit: MiddlewareHandler = rateLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: ipKey,
  store: rateLimitStore,
  handler: (c) =>
    c.json({ code: 429, message: '验证码请求过于频繁，请稍后再试', data: null }, 429),
});

/**
 * 敏感操作（注册 / 忘记密码 / 重置密码）：1 小时内最多 5 次
 * 防止账号枚举与滥用注册
 */
export const sensitiveRateLimit: MiddlewareHandler = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: ipKey,
  store: rateLimitStore,
  handler: (c) =>
    c.json({ code: 429, message: '操作过于频繁，请 1 小时后重试', data: null }, 429),
});
