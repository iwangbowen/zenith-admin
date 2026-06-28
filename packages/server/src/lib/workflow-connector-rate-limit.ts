/**
 * 流程连接器调用限流（Redis 持久化，跨进程一致）。
 *
 * 滑动窗口日志（sliding-window log）：以 ZSET 记录窗口内每次调用的时间戳，
 * - 调用前剔除窗口外的旧记录，统计窗口内调用数；
 * - 未超 max → 放行并记一笔；超过 max → 拒绝（不占额），返回需等待秒数。
 *
 * 与熔断器（workflow-connector-breaker）并列：熔断保护「下游不健康时快速失败」，
 * 限流保护「自身不要把下游打挂」。两者相互独立，限流拒绝**不计入熔断失败**。
 *
 * Redis 故障时 **fail-open**（不阻断业务调用），限流仅作保护增强而非硬依赖。
 */
import redis from './redis';
import { config } from '../config';
import logger from './logger';

const PREFIX = `${config.redis.keyPrefix}wfconn:rl:`;
const rlKey = (id: number) => `${PREFIX}${id}`; // 单连接器一个 ZSET，member=时间戳-随机，score=毫秒时间戳

export interface RateLimitConfig {
  enabled: boolean;
  /** 时间窗（秒） */
  windowSec: number;
  /** 窗口内允许的最大调用次数（<=0 视为不限制） */
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 被限时建议等待秒数（放行时为 0） */
  retryAfterSec: number;
}

function effective(cfg: RateLimitConfig): boolean {
  return cfg.enabled && cfg.max > 0 && cfg.windowSec > 0;
}

/**
 * 调用前判定：滑动窗口内是否仍有配额。放行时占用一个名额，超限时拒绝且不占额。
 */
export async function rateLimitAcquire(id: number, cfg: RateLimitConfig): Promise<RateLimitDecision> {
  if (!effective(cfg)) return { allowed: true, retryAfterSec: 0 };
  const key = rlKey(id);
  const now = Date.now();
  const windowMs = Math.max(1, Math.floor(cfg.windowSec)) * 1000;
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const res = await redis
      .multi()
      .zremrangebyscore(key, 0, now - windowMs) // 清理窗口外旧记录
      .zadd(key, now, member)                    // 先占位
      .zcard(key)                                // 统计窗口内总数
      .pexpire(key, windowMs + 1000)             // 窗口 + 缓冲后自动过期
      .exec();
    const count = Number(res?.[2]?.[1] ?? 0);
    if (count > cfg.max) {
      // 超限：撤回刚占的位（不消耗配额），按最早记录计算需等待时间
      await redis.zrem(key, member);
      const earliest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = earliest.length >= 2 ? Number(earliest[1]) : now;
      const retryAfterMs = Math.max(0, oldestTs + windowMs - now);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (err) {
    logger.warn('[connector-rate-limit] acquire 判定失败，fail-open', { id, err });
    return { allowed: true, retryAfterSec: 0 };
  }
}

/** 清空限流计数（删除连接器 / 运维重置时调用）。 */
export async function rateLimitReset(id: number): Promise<void> {
  try {
    await redis.del(rlKey(id));
  } catch { /* ignore */ }
}
