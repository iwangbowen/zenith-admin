/**
 * 流程连接器熔断器（Redis 持久化，跨进程一致）。
 *
 * 时间型熔断 + 单次半开试探：
 * - closed：正常放行；累计连续失败达 failureThreshold → 打开
 * - open：冷却 cooldownSec 内快速失败
 * - halfOpen：冷却结束后仅放行一次试探；成功 → 闭合，失败 → 重新打开
 *
 * Redis 故障时 **fail-open**（不阻断业务调用），熔断仅作保护增强而非硬依赖。
 */
import redis from './redis';
import { config } from '../config';
import logger from './logger';
import type { WorkflowConnectorBreakerState } from '@zenith/shared';

const PREFIX = `${config.redis.keyPrefix}wfconn:`;
const openKey = (id: number) => `${PREFIX}open:${id}`;       // 存在=熔断打开，TTL=cooldownSec
const failKey = (id: number) => `${PREFIX}fail:${id}`;       // 连续失败计数，滚动窗口
const wasOpenKey = (id: number) => `${PREFIX}wasopen:${id}`; // 半开探测标记（打开后保留，闭合时清除）
const halfKey = (id: number) => `${PREFIX}half:${id}`;       // 半开单次试探锁

export interface BreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  cooldownSec: number;
}

/** 调用前判定：是否放行 + 当前熔断态。熔断打开时快速失败。 */
export async function breakerAllow(id: number, cfg: BreakerConfig): Promise<{ allowed: boolean; state: WorkflowConnectorBreakerState }> {
  if (!cfg.enabled) return { allowed: true, state: 'closed' };
  try {
    if (await redis.exists(openKey(id))) return { allowed: false, state: 'open' };
    if (await redis.exists(wasOpenKey(id))) {
      // 冷却已过 → 半开：仅放行一次试探
      const trial = await redis.set(halfKey(id), '1', 'EX', 60, 'NX');
      return trial ? { allowed: true, state: 'halfOpen' } : { allowed: false, state: 'open' };
    }
    return { allowed: true, state: 'closed' };
  } catch (err) {
    logger.warn('[connector-breaker] allow 判定失败，fail-open', { id, err });
    return { allowed: true, state: 'closed' };
  }
}

/** 调用成功：闭合熔断（清空计数 / 标记 / 试探锁）。 */
export async function breakerSuccess(id: number): Promise<void> {
  try {
    await redis.del(failKey(id), wasOpenKey(id), halfKey(id));
  } catch { /* fail-open */ }
}

/** 调用失败：累计连续失败，达到阈值则打开熔断。 */
export async function breakerFailure(id: number, cfg: BreakerConfig): Promise<void> {
  if (!cfg.enabled) return;
  try {
    await redis.del(halfKey(id)); // 释放半开试探锁（试探失败 → 重新打开）
    const fails = await redis.incr(failKey(id));
    if (fails === 1) await redis.expire(failKey(id), Math.max(cfg.cooldownSec, 60));
    if (fails >= cfg.failureThreshold) {
      await redis.set(openKey(id), String(Date.now()), 'EX', cfg.cooldownSec);
      await redis.set(wasOpenKey(id), '1', 'EX', cfg.cooldownSec * 4);
    }
  } catch (err) {
    logger.warn('[connector-breaker] 记录失败异常', { id, err });
  }
}

/** 当前熔断态（仅用于展示）。 */
export async function breakerState(id: number, enabled: boolean): Promise<WorkflowConnectorBreakerState> {
  if (!enabled) return 'closed';
  try {
    if (await redis.exists(openKey(id))) return 'open';
    if (await redis.exists(wasOpenKey(id))) return 'halfOpen';
  } catch { /* fail-open */ }
  return 'closed';
}

/** 手动重置熔断（运维 / 删除连接器时清理）。 */
export async function breakerReset(id: number): Promise<void> {
  try {
    await redis.del(openKey(id), failKey(id), wasOpenKey(id), halfKey(id));
  } catch { /* ignore */ }
}
