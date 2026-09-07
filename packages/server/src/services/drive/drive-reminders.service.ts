import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db';
import { driveNodePermissions, driveNodes, driveShareLinks } from '../../db/schema';
import logger from '../../lib/logger';
import { registerSystemRecurringJob } from '../../lib/pg-boss-scheduler';
import { notifyGrantExpiring, notifyShareExpiring } from './drive-notify.service';
import { getDriveSettings } from './drive-settings.service';

/**
 * 到期提醒：外链与用户临时授权在到期前 N 小时（设置 shareExpiryReminderHours）提醒一次。
 * 幂等由 notify() 的 dedupeKey（对象 id + 到期时间）保证：延长有效期后会再次提醒新的到期时间。
 */
/** 无请求上下文：按租户逐个读取设置（同一轮内缓存） */
function tenantSettingsReader() {
  const cache = new Map<number | null, Promise<Awaited<ReturnType<typeof getDriveSettings>>>>();
  return (tenantId: number | null) => {
    let pending = cache.get(tenantId);
    if (!pending) {
      pending = getDriveSettings({ tenantId });
      cache.set(tenantId, pending);
    }
    return pending;
  };
}

export async function dispatchDriveExpiryReminders(): Promise<{ shares: number; grants: number }> {
  const readSettings = tenantSettingsReader();
  // 先按平台最大提醒窗口粗筛，再逐条按所属租户的提醒小时数精确判定
  const now = new Date();
  const until = new Date(now.getTime() + 720 * 3_600_000);

  const shares = await db.select().from(driveShareLinks).where(and(
    eq(driveShareLinks.enabled, true), isNull(driveShareLinks.revokedAt),
    gt(driveShareLinks.expireAt, now), lte(driveShareLinks.expireAt, until),
  )).limit(500);
  const grants = await db.select().from(driveNodePermissions).where(and(
    eq(driveNodePermissions.subjectType, 'user'),
    gt(driveNodePermissions.expireAt, now), lte(driveNodePermissions.expireAt, until),
  )).limit(500);

  const nodeIds = [...new Set([...shares.map((s) => s.nodeId), ...grants.map((g) => g.nodeId)])];
  const nodes = nodeIds.length
    ? await db.select().from(driveNodes).where(and(inArray(driveNodes.id, nodeIds), isNull(driveNodes.deletedAt)))
    : [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const withinWindow = async (tenantId: number | null, expireAt: Date | null) => {
    if (!expireAt) return false;
    const hours = (await readSettings(tenantId)).shareExpiryReminderHours;
    return hours > 0 && expireAt.getTime() <= now.getTime() + hours * 3_600_000;
  };

  let shareCount = 0;
  for (const share of shares) {
    const node = nodeMap.get(share.nodeId);
    if (!node || !await withinWindow(share.tenantId ?? null, share.expireAt)) continue;
    try {
      await notifyShareExpiring(share, node);
      shareCount += 1;
    } catch (err) {
      logger.warn({ err, shareId: share.id }, 'drive: 外链到期提醒失败');
    }
  }
  let grantCount = 0;
  for (const grant of grants) {
    const node = nodeMap.get(grant.nodeId);
    if (!node || !grant.expireAt || !await withinWindow(grant.tenantId ?? null, grant.expireAt)) continue;
    try {
      await notifyGrantExpiring({ id: grant.id, subjectId: grant.subjectId, role: grant.role, expireAt: grant.expireAt, tenantId: grant.tenantId ?? null }, node);
      grantCount += 1;
    } catch (err) {
      logger.warn({ err, grantId: grant.id }, 'drive: 临时授权到期提醒失败');
    }
  }
  return { shares: shareCount, grants: grantCount };
}

export async function registerDriveExpiryReminderJob(): Promise<void> {
  await registerSystemRecurringJob({
    name: 'drive-expiry-reminders', title: '网盘外链 / 临时授权到期提醒', module: '企业网盘',
    cronExpression: '15 * * * *', allowManualRun: true,
    run: async () => {
      const result = await dispatchDriveExpiryReminders();
      return `已提醒外链 ${result.shares} 条、临时授权 ${result.grants} 条`;
    },
  });
}
