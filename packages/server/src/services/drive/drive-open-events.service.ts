import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DRIVE_ACTIVITY_OPEN_EVENT, type DriveActivityAction } from '@zenith/shared/drive';
import { db } from '../../db';
import { appWebhookSubscriptions, driveActivities, driveNodes, driveShareLinks, driveSpaces } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { registerSystemQueueWorker, sendSystemJobAfter } from '../../lib/pg-boss-scheduler';
import { TtlCache } from '../../lib/ttl-cache';

/**
 * 网盘文件变更 → 开放平台事件。
 *
 * 动态写入与业务同事务；事件不能在事务内直接 emit（回滚会导致幽灵事件），因此经 pg-boss 延迟 2 秒投递：
 * worker 回读动态行，行不存在（事务回滚）即丢弃；存在则以「租户 + spaceId」为范围 emit，
 * Webhook 订阅侧再按开放应用的空间授权过滤（见 app-webhooks.service）。payload 只含元数据，不含内容与下载地址。
 */

const QUEUE = 'drive-open-events';
const EMIT_DELAY_MS = 2000;

type OpenEventJob = { activityId: number; createdAt: string };

/** 60 秒内缓存「是否存在订阅了 drive.* 事件的启用订阅」，无订阅时不产生队列作业 */
const subscriberCache = new TtlCache<string, boolean>(60_000);

async function hasDriveSubscribers(): Promise<boolean> {
  return subscriberCache.get('any', async () => {
    const [row] = await db.select({ id: appWebhookSubscriptions.id }).from(appWebhookSubscriptions)
      .where(and(eq(appWebhookSubscriptions.status, 'enabled'), sql`exists (select 1 from unnest(${appWebhookSubscriptions.events}) e where e like 'drive.%')`))
      .limit(1);
    return !!row;
  });
}

export function openEventForAction(action: DriveActivityAction) {
  return DRIVE_ACTIVITY_OPEN_EVENT[action];
}

/** 动态写入后调用（可在事务内）：仅在存在订阅者时排队，失败只记日志不阻断业务 */
export async function scheduleDriveOpenEvent(activityId: number, action: DriveActivityAction, createdAt: Date): Promise<void> {
  if (!openEventForAction(action)) return;
  try {
    if (!await hasDriveSubscribers()) return;
    await sendSystemJobAfter<OpenEventJob>(QUEUE, { activityId, createdAt: createdAt.toISOString() }, new Date(Date.now() + EMIT_DELAY_MS), {
      singletonKey: `drive-open-event:${activityId}`, retryLimit: 3, retryDelay: 30, expireInSeconds: 120,
    });
  } catch (err) {
    logger.warn({ err, activityId }, 'drive: 开放事件排队失败');
  }
}

async function emitDriveOpenEvent(job: OpenEventJob): Promise<string> {
  // 分区表按 created_at 定位分区，带上时间条件避免全分区扫描
  const createdAt = new Date(job.createdAt);
  const [activity] = await db.select().from(driveActivities).where(and(
    eq(driveActivities.id, job.activityId),
    gte(driveActivities.createdAt, new Date(createdAt.getTime() - 60_000)),
    lte(driveActivities.createdAt, new Date(createdAt.getTime() + 60_000)),
  )).limit(1);
  if (!activity) return '动态不存在（事务已回滚），跳过';
  const type = openEventForAction(activity.action);
  if (!type) return '动作不对外投递';
  const [space] = await db.select({ id: driveSpaces.id, name: driveSpaces.name, type: driveSpaces.type }).from(driveSpaces).where(eq(driveSpaces.id, activity.spaceId)).limit(1);
  const node = activity.nodeId
    ? (await db.select({
      id: driveNodes.id, parentId: driveNodes.parentId, type: driveNodes.type, name: driveNodes.name, extension: driveNodes.extension,
      mimeType: driveNodes.mimeType, size: driveNodes.size, contentHash: driveNodes.contentHash, currentVersion: driveNodes.currentVersion,
      deletedAt: driveNodes.deletedAt, updatedAt: driveNodes.updatedAt,
    }).from(driveNodes).where(eq(driveNodes.id, activity.nodeId)).limit(1))[0] ?? null
    : null;
  const share = activity.shareId
    ? (await db.select({ id: driveShareLinks.id, kind: driveShareLinks.kind, capabilities: driveShareLinks.capabilities, expireAt: driveShareLinks.expireAt, revokedAt: driveShareLinks.revokedAt })
      .from(driveShareLinks).where(inArray(driveShareLinks.id, [activity.shareId])).limit(1))[0] ?? null
    : null;
  openEventBus.emit({
    type,
    tenantId: activity.tenantId ?? null,
    scope: { spaceId: activity.spaceId },
    eventId: `drive-activity-${activity.id}`,
    data: {
      action: activity.action,
      occurredAt: formatDateTime(activity.createdAt),
      space: space ? { id: space.id, name: space.name, type: space.type } : { id: activity.spaceId, name: null, type: null },
      node: {
        id: activity.nodeId, name: activity.nodeName, type: activity.nodeType,
        parentId: node?.parentId ?? null, extension: node?.extension ?? null, mimeType: node?.mimeType ?? null,
        size: node?.size ?? null, contentHash: node?.contentHash ?? null, version: node?.currentVersion ?? null,
        deleted: node ? !!node.deletedAt : activity.action === 'purge',
        updatedAt: node ? formatDateTime(node.updatedAt) : null,
      },
      share: share ? { id: share.id, kind: share.kind, capabilities: share.capabilities, expireAt: share.expireAt ? formatDateTime(share.expireAt) : null, revoked: !!share.revokedAt } : null,
      actorId: activity.actorId ?? null,
      detail: activity.detail ?? null,
    },
  });
  return `已投递 ${type}`;
}

export async function registerDriveOpenEventWorker(): Promise<void> {
  await registerSystemQueueWorker<OpenEventJob>({
    name: QUEUE, title: '网盘开放事件外推', module: '企业网盘',
    description: '文件变更动态 → 开放平台 Webhook 事件（按应用的空间授权过滤）',
    queueOptions: { retryLimit: 3, retryDelay: 30, expireInSeconds: 120 },
    handler: emitDriveOpenEvent,
  });
}
