import { rateLimiter, RedisStore } from 'hono-rate-limiter';
import type { MiddlewareHandler, Context } from 'hono';
import redis from '../lib/redis';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import logger from '../lib/logger';
import { db } from '../db';
import { rateLimitRules } from '../db/schema';
import { currentUser } from '../lib/context';

export type RateLimitName = 'auth' | 'captcha' | 'sensitive';
export type RateLimitKeyType = 'ip' | 'user' | 'ip_path';

export interface RuleConfig {
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: RateLimitKeyType;
  enabled: boolean;
  blockedMessage: string | null;
}

const DEFAULTS: Record<RateLimitName, RuleConfig> = {
  auth:      { name: 'auth',      description: '登录接口限流',          windowMs: 3 * 60 * 1000,      limit: 20, keyType: 'ip', enabled: true, blockedMessage: '登录尝试过于频繁，请 3 分钟后再试' },
  captcha:   { name: 'captcha',   description: '验证码接口限流',        windowMs: 60 * 1000,          limit: 30, keyType: 'ip', enabled: true, blockedMessage: '验证码请求过于频繁，请稍后再试' },
  sensitive: { name: 'sensitive', description: '敏感操作（注册/重置）限流', windowMs: 60 * 60 * 1000,  limit: 5,  keyType: 'ip', enabled: true, blockedMessage: '操作过于频繁，请 1 小时后重试' },
};

const ruleCache = new Map<string, RuleConfig>(Object.entries(DEFAULTS));
const compiledLimiters = new Map<string, MiddlewareHandler>();

const RL_PREFIX = `${config.redis.keyPrefix}rl:`;
const STATS_PREFIX = `${config.redis.keyPrefix}rlstats:`;
const STATS_TTL = 7 * 24 * 60 * 60;

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
      ...keys,
      ...(args as string[]),
    ) as Promise<TData>;
  },
  decr(key: string): Promise<number> {
    return redis.decr(key);
  },
  del(key: string): Promise<number> {
    return redis.del(key);
  },
};

const rateLimitStore = new RedisStore({
  client: ioredisAdapter,
  prefix: RL_PREFIX,
});

function makeKeyGen(rule: RuleConfig): (c: Context) => string {
  if (rule.keyType === 'user') {
    return (c) => {
      try {
        const u = currentUser();
        return u?.userId ? `u:${u.userId}` : getClientIp(c);
      } catch {
        return getClientIp(c);
      }
    };
  }
  if (rule.keyType === 'ip_path') {
    return (c) => `${getClientIp(c)}|${c.req.path}`;
  }
  return (c) => getClientIp(c);
}

function buildLimiter(rule: RuleConfig): MiddlewareHandler {
  const keyGen = makeKeyGen(rule);
  return rateLimiter({
    windowMs: rule.windowMs,
    limit: rule.limit,
    keyGenerator: keyGen,
    store: rateLimitStore,
    handler: async (c) => {
      const key = keyGen(c);
      try {
        const blockedKey = `${STATS_PREFIX}${rule.name}:blocked`;
        const recentKey = `${STATS_PREFIX}${rule.name}:recent`;
        const ts = Date.now();
        await redis
          .multi()
          .incr(blockedKey)
          .expire(blockedKey, STATS_TTL)
          .zadd(recentKey, ts, `${ts}|${key}|${c.req.path}`)
          .zremrangebyrank(recentKey, 0, -201)
          .expire(recentKey, STATS_TTL)
          .exec();
      } catch (err) {
        logger.warn('[rate-limit] stats record failed', err);
      }
      return c.json(errBody(rule.blockedMessage ?? '请求过于频繁，请稍后再试', 429), 429);
    },
  });
}

function rebuildAll(): void {
  compiledLimiters.clear();
  for (const rule of ruleCache.values()) {
    compiledLimiters.set(rule.name, buildLimiter(rule));
  }
}
rebuildAll();

function makeNamed(name: RateLimitName): MiddlewareHandler {
  return async (c, next) => {
    const rule = ruleCache.get(name);
    if (!rule?.enabled) return next();
    try {
      const k = `${STATS_PREFIX}${name}:hit`;
      await redis.multi().incr(k).expire(k, STATS_TTL).exec();
    } catch {
      /* ignore stats failure */
    }
    const limiter = compiledLimiters.get(name);
    if (!limiter) return next();
    return limiter(c, next);
  };
}

export const authRateLimit: MiddlewareHandler = makeNamed('auth');
export const captchaRateLimit: MiddlewareHandler = makeNamed('captcha');
export const sensitiveRateLimit: MiddlewareHandler = makeNamed('sensitive');

/** 从数据库加载规则到内存缓存并重建限流器 */
export async function refreshRateLimitRules(): Promise<void> {
  try {
    const rows = await db.select().from(rateLimitRules);
    const next = new Map<string, RuleConfig>(Object.entries(DEFAULTS));
    for (const r of rows) {
      next.set(r.name, {
        name: r.name,
        description: r.description,
        windowMs: r.windowMs,
        limit: r.limit,
        keyType: r.keyType,
        enabled: r.enabled,
        blockedMessage: r.blockedMessage,
      });
    }
    ruleCache.clear();
    for (const [k, v] of next) ruleCache.set(k, v);
    rebuildAll();
    logger.info(`[rate-limit] reloaded ${rows.length} rule(s) from DB`);
  } catch (err) {
    logger.warn('[rate-limit] DB load failed, using defaults', err);
  }
}

/** 服务启动时调用，预热规则缓存 */
export async function bootstrapRateLimitRules(): Promise<void> {
  await refreshRateLimitRules();
}

/** 当前缓存中的所有规则配置 */
export function listRuleConfigs(): RuleConfig[] {
  return [...ruleCache.values()];
}

/** 解封某个 key（清除该 key 在 rate-limit Redis 中的计数窗口） */
export async function unblockRateLimitKey(name: string, key: string): Promise<boolean> {
  const n = await redis.del(`${RL_PREFIX}${key}`);
  try {
    const recentKey = `${STATS_PREFIX}${name}:recent`;
    const members = await redis.zrange(recentKey, 0, -1);
    const toRemove = members.filter((m) => m.split('|')[1] === key);
    if (toRemove.length > 0) await redis.zrem(recentKey, ...toRemove);
  } catch {
    /* ignore */
  }
  return n > 0;
}

export const RATE_LIMIT_KEYS = {
  rlPrefix: RL_PREFIX,
  statsPrefix: STATS_PREFIX,
} as const;
