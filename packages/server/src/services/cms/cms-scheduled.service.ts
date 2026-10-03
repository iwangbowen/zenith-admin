import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { JOB_MONITOR_SCHEDULE_GRACE_MS, type JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { cmsContents, cmsContentWorkingCopies, cmsContentRevisions } from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { APP_TIME_ZONE, formatDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { offlineExpiredCmsContents, cancelExpiredTopContents } from './cms-contents.service';
import { publishCmsContent } from './cms-contents.service';
import { activateScheduledCmsReleases } from './cms-releases.service';
import { scheduleCmsExpiredDelivery } from './cms-delivery-expiry';

const LOCK_KEY = `${config.redis.keyPrefix}cms:scheduled-publish-lock`;
const LOCK_TTL_SECONDS = 300;

/** 修订快照保存业务墙上时间，沿用发布器的 APP_TIME_ZONE 解释，不能按数据库会话时区解析。 */
export function cmsContentScheduledTime() {
  return sql<Date>`((${cmsContentRevisions.snapshot}->>'scheduledAt')::timestamp AT TIME ZONE ${APP_TIME_ZONE})`;
}

export function cmsContentScheduledDueCondition(asOf: Date) {
  return and(
    sql`${cmsContentRevisions.snapshot}->>'scheduledAt' is not null`,
    sql`${cmsContentScheduledTime()} <= ${asOf.toISOString()}::timestamptz`,
    sql`${cmsContentWorkingCopies.publishedRevisionId} is distinct from ${cmsContentRevisions.id}`,
    isNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt),
  );
}

export async function getCmsContentScheduledHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const grace = new Date(now.getTime() - JOB_MONITOR_SCHEDULE_GRACE_MS);
  const [row] = await db.select({
    pending: sql<number>`count(*)::int`,
    stuck: sql<number>`count(*) filter (where ${cmsContentScheduledDueCondition(grace)})::int`,
    oldestPendingAgeSec: sql<number | null>`greatest(0, floor(${now.getTime() / 1000} - extract(epoch from min(${cmsContentScheduledTime()}))))::int`,
  }).from(cmsContentWorkingCopies)
    .innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
    .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.approvedRevisionId))
    .where(cmsContentScheduledDueCondition(now));
  return {
    counts: { pending: row?.pending ?? 0, running: 0, stuck: row?.stuck ?? 0, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: row?.pending ? row.oldestPendingAgeSec : null, failed1h: 0, issues: [],
  };
}

export async function listOverdueCmsContentScheduled(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId, title: cmsContentRevisions.title, status: cmsContentWorkingCopies.editorialStatus,
    scheduledAt: cmsContentScheduledTime().mapWith(cmsContentWorkingCopies.createdAt),
  }).from(cmsContentWorkingCopies)
    .innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
    .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.approvedRevisionId))
    .where(cmsContentScheduledDueCondition(new Date(now.getTime() - JOB_MONITOR_SCHEDULE_GRACE_MS)))
    .orderBy(asc(cmsContentScheduledTime()), asc(cmsContents.id)).limit(limit);
  return rows.map(row => ({
    source: 'scheduled-dispatch', refId: `cms-content:${row.id}`, title: row.title, status: row.status,
    startedAt: null, lastSeenAt: formatDateTime(row.scheduledAt), ageSec: Math.max(0, Math.floor((now.getTime() - row.scheduledAt.getTime()) / 1000)),
    nodeId: null, detail: '已审批修订的定时发布超过调度宽限期，尚未发布',
    drillDown: { path: `/cms/contents/edit?id=${row.id}&siteId=${row.siteId}`, label: '查看内容' },
  }));
}

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
    const activatedReleases = await activateScheduledCmsReleases();
    const due = await db.select({ id: cmsContents.id, title: cmsContentRevisions.title, revisionId: cmsContentRevisions.id, version: cmsContentWorkingCopies.version })
      .from(cmsContentWorkingCopies)
      .innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
      .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.approvedRevisionId))
      .where(cmsContentScheduledDueCondition(now)).limit(200);

    let published = 0;
    for (const row of due) {
      try {
        await publishCmsContent(row.id, { skipAccessCheck: true, scheduledAtBefore: now, revisionId: row.revisionId, expectedVersion: row.version });
        published += 1;
      } catch (err) {
        logger.error(`[CMS] 定时发布内容 ${row.id} 失败`, err);
      }
    }

    // 过期下线
    const expired = await offlineExpiredCmsContents(now);
    const expiryDeliveries = await scheduleCmsExpiredDelivery(now);

    // 置顶到期自动取消（刷新静态页恢复正常排序）
    const untopIds = await cancelExpiredTopContents(now).catch((err) => {
      logger.error('[CMS] 置顶到期取消失败', err);
      return [] as number[];
    });
    if (due.length === 0 && activatedReleases === 0 && expired.offlined.length === 0 && expired.blocked.length === 0 && untopIds.length === 0 && expiryDeliveries === 0) {
      return '无到期的定时发布/过期内容';
    }
    return `定时激活发布单 ${activatedReleases} 个，提交发布 ${published}/${due.length} 条，过期下线 ${expired.offlined.length} 条，部件引用阻塞 ${expired.blocked.length} 条，置顶到期取消 ${untopIds.length} 条，到期交付验证 ${expiryDeliveries} 项`;
  } finally {
    await redis.del(LOCK_KEY).catch(() => undefined);
  }
}
