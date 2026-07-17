import redis from '../redis';
import { config } from '../../config';
import dayjs from 'dayjs';
import logger from '../logger';

const QUOTA_PREFIX = `${config.redis.keyPrefix}ai:quota:`;
/** 计数保留 2 天（自然日配额，跨日自动重置） */
const TTL_SECONDS = 2 * 24 * 60 * 60;

function quotaKey(userId: number): string {
  return `${QUOTA_PREFIX}${userId}:${dayjs().format('YYYY-MM-DD')}`;
}

/** 当前用户今日已用 token 数（读取失败按 0 处理，不阻塞对话） */
export async function getDailyTokensUsed(userId: number): Promise<number> {
  try {
    const val = await redis.get(quotaKey(userId));
    return Number(val) || 0;
  } catch (err) {
    logger.warn('[ai-quota] read failed', err);
    return 0;
  }
}

/** 累加当前用户今日 token 用量（fire-and-forget） */
export function addDailyTokensUsed(userId: number, tokens: number): void {
  if (tokens <= 0) return;
  void redis
    .multi()
    .incrby(quotaKey(userId), tokens)
    .expire(quotaKey(userId), TTL_SECONDS)
    .exec()
    .catch((err) => logger.warn('[ai-quota] incr failed', err));
}
