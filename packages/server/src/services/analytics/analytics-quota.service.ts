import redis from '../../lib/redis';
import { config } from '../../config';
import { formatDate, parseDateRangeEnd } from '../../lib/datetime';
import logger from '../../lib/logger';

const QUOTA_PREFIX = `${config.redis.keyPrefix}analytics:quota:`;
const FALLBACK_TTL_SECONDS = 25 * 60 * 60;

function todayKeySuffix(): string {
  return formatDate(new Date()).replace(/-/g, '');
}

function quotaKey(siteId: number): string {
  return `${QUOTA_PREFIX}${siteId}:${todayKeySuffix()}`;
}

function secondsUntilTodayEndWithBuffer(): number {
  const end = parseDateRangeEnd(formatDate(new Date()));
  if (!end) return FALLBACK_TTL_SECONDS;
  const seconds = Math.ceil((end.getTime() - Date.now()) / 1000) + 60 * 60;
  return Math.max(seconds, 60 * 60);
}

export interface SiteQuotaCheckResult {
  allowed: boolean;
  current: number;
}

export async function checkAndConsumeSiteQuota(siteId: number, quota: number, count: number): Promise<SiteQuotaCheckResult> {
  if (count <= 0) return { allowed: true, current: 0 };
  const key = quotaKey(siteId);
  try {
    const current = await redis.incrby(key, count);
    if (current === count) await redis.expire(key, secondsUntilTodayEndWithBuffer());
    if (current > quota) {
      const rolledBack = await redis.decrby(key, count);
      return { allowed: false, current: Math.max(rolledBack, 0) };
    }
    return { allowed: true, current };
  } catch (err) {
    logger.warn('[analytics-quota] Redis quota check failed; fail-open', err);
    return { allowed: true, current: 0 };
  }
}

export async function getSiteQuotaUsage(siteIds: number[]): Promise<Map<number, number | null>> {
  const uniqueIds = Array.from(new Set(siteIds));
  const usage = new Map<number, number | null>();
  if (uniqueIds.length === 0) return usage;
  try {
    const values = await redis.mget(uniqueIds.map(quotaKey));
    uniqueIds.forEach((siteId, index) => {
      const value = values[index];
      usage.set(siteId, value ? Number(value) || 0 : 0);
    });
  } catch (err) {
    logger.warn('[analytics-quota] Redis quota usage read failed', err);
    uniqueIds.forEach((siteId) => usage.set(siteId, null));
  }
  return usage;
}

export async function refundSiteQuota(siteId: number, count: number): Promise<void> {
  if (count <= 0) return;
  try {
    await redis.decrby(quotaKey(siteId), count);
  } catch (err) {
    logger.warn('[analytics-quota] Redis quota refund failed', err);
  }
}
