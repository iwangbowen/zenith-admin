/**
 * 幂等控制中间件
 *
 * 提供两种工作模式（优先级：客户端 Token > 请求指纹）：
 *
 * **模式 1 — 客户端 Token（X-Idempotency-Key 头）**
 *   客户端在发起请求前自行生成唯一 key（通常是 UUID），放在请求头中。
 *   服务端首次处理后将结果缓存，TTL 内再次提交同一 key 直接拒绝（或将来可返回缓存结果）。
 *   适合：支付创单、工单提交等需要客户端显式保证的场景。
 *
 * **模式 2 — 服务端自动指纹（自动兜底）**
 *   服务端根据 (userId | ip) + method + pathname + body-hash 计算 SHA-256 指纹。
 *   TTL 内若同一指纹再次到达，直接拒绝。
 *   适合：普通表单防重复提交，无需前端改造。
 *
 * 用法（在 createRoute 的 middleware 数组中声明）：
 *
 * ```ts
 * import { idempotencyGuard } from '../middleware/idempotency';
 *
 * const route = createRoute({
 *   method: 'post',
 *   path: '/orders',
 *   middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
 *   ...
 * });
 * ```
 */

import crypto from 'node:crypto';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import redis from '../lib/redis';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import { currentUser } from '../lib/context';
import logger from '../lib/logger';

/** idempotency Redis key 前缀，与其他 key 命名空间隔离 */
const IDEMPOTENCY_PREFIX = `${config.redis.keyPrefix}idempotency:`;

export interface IdempotencyOptions {
  /**
   * 幂等窗口时长（秒）。
   * - 模式 1（客户端 Token）：建议 30～300s，覆盖整个业务操作周期。
   * - 模式 2（自动指纹）：建议 5～15s，仅防止双击/网络重试。
   * @default 10
   */
  ttlSeconds?: number;

  /**
   * 被拦截时返回的错误提示。
   * @default '请勿重复提交'
   */
  message?: string;

  /**
   * 是否在没有 X-Idempotency-Key 时自动降级为指纹模式。
   * 设为 false 则仅在客户端提供 key 时才做幂等检查（接口无 key 则直接放行）。
   * @default true
   */
  autoFingerprint?: boolean;
}

interface CachedResponse {
  status: number;
  contentType: string | null;
  body: string;
}

/**
 * 计算请求体的 SHA-256 指纹（hex 截断为 16 字符）。
 * 对空/无 body 的请求返回固定字符串 'nobody'。
 */
async function hashBody(c: Context): Promise<string> {
  try {
    // 克隆后读，避免消耗原始流导致后续 handler 取不到 body
    const cloned = c.req.raw.clone();
    const text = await cloned.text();
    if (!text) return 'nobody';
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  } catch {
    return 'nobody';
  }
}

/**
 * 幂等控制 Hono 中间件工厂函数。
 *
 * @example
 * // 防止 10 秒内重复提交（自动指纹模式）
 * middleware: [authMiddleware, idempotencyGuard()] as const
 *
 * @example
 * // 要求客户端携带 X-Idempotency-Key，不做自动指纹兜底
 * middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 60, autoFingerprint: false })] as const
 */
export function idempotencyGuard(options: IdempotencyOptions = {}) {
  const {
    ttlSeconds = 10,
    message = '请勿重复提交',
    autoFingerprint = true,
  } = options;

  return createMiddleware(async (c, next) => {
    // --- 确定幂等 key ---
    let idempotencyKey: string | null = null;
    let keySource: 'header' | 'fingerprint' = 'fingerprint';

    const clientKey = c.req.header('x-idempotency-key');
    if (clientKey) {
      // 模式 1：客户端 Token（最大 128 字符，防止 key 注入攻击）
      idempotencyKey = clientKey.slice(0, 128);
      keySource = 'header';
    } else if (autoFingerprint) {
      // 模式 2：服务端自动指纹
      let identity: string;
      try {
        const user = currentUser();
        identity = user ? `u${user.userId}` : c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0';
      } catch {
        identity = '0.0.0.0';
      }
      const method = c.req.method;
      const path = new URL(c.req.url).pathname;
      const bodyHash = await hashBody(c);
      const raw = `${identity}|${method}|${path}|${bodyHash}`;
      idempotencyKey = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
      keySource = 'fingerprint';
    }

    // 若无 key（autoFingerprint=false 且客户端未提供），直接放行
    if (!idempotencyKey) {
      return next();
    }

    const redisKey = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;

    try {
      const existing = await redis.get(redisKey);
      if (existing) {
        try {
          const cached = JSON.parse(existing) as CachedResponse | { state?: string };
          if ('body' in cached && typeof cached.body === 'string') {
            logger.info(`[Idempotency] 返回缓存响应 source=${keySource} key=${idempotencyKey.slice(0, 8)}...`);
            return new Response(cached.body, {
              status: cached.status,
              headers: cached.contentType ? { 'Content-Type': cached.contentType } : undefined,
            });
          }
        } catch {
          // fall through to duplicate rejection for legacy/simple markers
        }
        logger.warn(`[Idempotency] 重复提交拦截 source=${keySource} key=${idempotencyKey.slice(0, 8)}...`);
        return c.json(errBody(message, 429), 429);
      }

      // SET NX EX —— 原子性：仅当 key 不存在时设置，确保并发安全
      const result = await redis.set(redisKey, JSON.stringify({ state: 'processing' }), 'EX', ttlSeconds, 'NX');

      if (result === null) {
        // key 已存在 → 重复请求
        logger.warn(`[Idempotency] 重复提交拦截 source=${keySource} key=${idempotencyKey.slice(0, 8)}...`);
        return c.json(errBody(message, 429), 429);
      }

      // 首次请求，继续处理；成功 JSON 响应缓存给相同幂等 key 的网络重试。
      await next();
      const res = c.res;
      const contentType = res.headers.get('Content-Type');
      if (res.status >= 200 && res.status < 300 && contentType?.includes('application/json')) {
        const body = await res.clone().text();
        await redis.set(redisKey, JSON.stringify({ status: res.status, contentType, body } satisfies CachedResponse), 'EX', ttlSeconds);
      }
      return;
    } catch (err) {
      // Redis 不可用时降级放行（可观测，不阻断业务）
      logger.error(`[Idempotency] Redis 检查失败，降级放行: ${(err as Error).message}`);
      return next();
    }
  });
}
