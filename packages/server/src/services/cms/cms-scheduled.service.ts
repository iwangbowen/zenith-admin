import { and, lte, ne, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents } from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { offlineExpiredCmsContents, cancelExpiredTopContents, flushViewCountBuffer } from './cms-contents.service';
import { publishCmsContent } from './cms-contents.service';

const LOCK_KEY = `${config.redis.keyPrefix}cms:scheduled-publish-lock`;
const LOCK_TTL_SECONDS = 300;

/**
 * CMS 定时发布 + 过期下线（系统周期任务，每分钟执行）：
 * 1. 扫描 scheduledAt 到期且未发布的内容 → 自动发布 + 增量静态化 + 搜索引擎推送；
 * 2. 扫描 expireAt 到期的已发布内容 → 自动下线 + 刷新静态页。
 * Redis 排他锁防止多实例部署或上一轮未结束时重复执行。
 */
export async function publishScheduledCmsContents(): Promise<string> {
  const acquired = await redis.set(LOCK_KEY, String(Date.now()), 'EX', LOCK_TTL_SECONDS, 'NX');
  if (!acquired) return '上一轮定时发布仍在执行，本轮跳过';
  try {
    const now = new Date();
    const due = await db.select({ id: cmsContents.id, title: cmsContents.title })
      .from(cmsContents)
      .where(and(
        isNotNull(cmsContents.scheduledAt),
        lte(cmsContents.scheduledAt, now),
        ne(cmsContents.status, 'published'),
        isNull(cmsContents.deletedAt),
        isNull(cmsContents.lockedAt),
      ))
      .limit(200);

    let published = 0;
    for (const row of due) {
      try {
        await publishCmsContent(row.id, { skipAccessCheck: true, scheduledAtBefore: now });
        published += 1;
      } catch (err) {
        logger.error(`[CMS] 定时发布内容 ${row.id} 失败`, err);
      }
    }

    // 过期下线
    const expiredIds = await offlineExpiredCmsContents(now);

    // 置顶到期自动取消（刷新静态页恢复正常排序）
    const untopIds = await cancelExpiredTopContents(now).catch((err) => {
      logger.error('[CMS] 置顶到期取消失败', err);
      return [] as number[];
    });
    // 浏览计数缓冲落库
    const flushed = await flushViewCountBuffer().catch((err) => {
      logger.error('[CMS] 浏览计数落库失败', err);
      return 0;
    });

    if (due.length === 0 && expiredIds.length === 0 && untopIds.length === 0 && flushed === 0) return '无到期的定时发布/过期内容';
    return `定时发布 ${published}/${due.length} 条，过期下线 ${expiredIds.length} 条，置顶到期取消 ${untopIds.length} 条，浏览计数落库 ${flushed} 条`;
  } finally {
    await redis.del(LOCK_KEY).catch(() => undefined);
  }
}
