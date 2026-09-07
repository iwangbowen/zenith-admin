import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { driveActivities, driveShareAccessLogs, driveShareLinks } from '../../db/schema';
import logger from '../../lib/logger';
import { registerSystemRecurringJob } from '../../lib/pg-boss-scheduler';
import { notify } from '../messaging/notification-outbox.service';
import { resolveUserNames } from './drive-common';
import { resolveDriveAdminUserIds } from './drive-governance.service';
import { getDriveSettings } from './drive-settings.service';

/**
 * 异常行为告警（内置规则，无外部依赖）：
 * - 批量下载：同一用户 / 同一 IP 在窗口内下载次数 ≥ 阈值；
 * - 外链爆破：同一 IP / 同一外链在窗口内被拒绝次数（密码错误 / 过期 / IP 拦截）≥ 阈值。
 * 每 5 分钟扫描一次最近一个窗口；幂等由 dedupeKey（规则 + 主体 + 窗口桶）保证，同一主体每窗口只告警一次。
 */

interface AlertHit {
  kind: string;
  subjectKey: string;
  subject: string;
  count: number;
  detail: string;
  tenantId: number | null;
}

async function scanBulkDownloads(since: Date, threshold: number): Promise<AlertHit[]> {
  const base = and(eq(driveActivities.action, 'download'), gte(driveActivities.createdAt, since));
  const [byActor, byIp] = await Promise.all([
    db.select({ actorId: driveActivities.actorId, tenantId: driveActivities.tenantId, count: sql<number>`count(*)::int` })
      .from(driveActivities).where(and(base, isNotNull(driveActivities.actorId)))
      .groupBy(driveActivities.actorId, driveActivities.tenantId).having(sql`count(*) >= ${threshold}`),
    db.select({ clientIp: driveActivities.clientIp, tenantId: driveActivities.tenantId, count: sql<number>`count(*)::int` })
      .from(driveActivities).where(and(base, isNotNull(driveActivities.clientIp)))
      .groupBy(driveActivities.clientIp, driveActivities.tenantId).having(sql`count(*) >= ${threshold}`),
  ]);
  const names = await resolveUserNames(byActor.map((r) => r.actorId));
  return [
    ...byActor.map((r) => ({
      kind: '短时批量下载', subjectKey: `user:${r.actorId}`, subject: `用户「${names.get(r.actorId!) ?? r.actorId}」`,
      count: r.count, detail: '下载', tenantId: r.tenantId ?? null,
    })),
    ...byIp.map((r) => ({
      kind: '短时批量下载', subjectKey: `ip:${r.clientIp}`, subject: `IP ${r.clientIp}`,
      count: r.count, detail: '下载', tenantId: r.tenantId ?? null,
    })),
  ];
}

async function scanShareBruteForce(since: Date, threshold: number): Promise<AlertHit[]> {
  const base = and(eq(driveShareAccessLogs.ok, false), gte(driveShareAccessLogs.createdAt, since));
  const [byIp, byShare] = await Promise.all([
    db.select({ clientIp: driveShareAccessLogs.clientIp, count: sql<number>`count(*)::int` })
      .from(driveShareAccessLogs).where(and(base, isNotNull(driveShareAccessLogs.clientIp)))
      .groupBy(driveShareAccessLogs.clientIp).having(sql`count(*) >= ${threshold}`),
    db.select({ shareId: driveShareAccessLogs.shareId, tenantId: driveShareLinks.tenantId, count: sql<number>`count(*)::int` })
      .from(driveShareAccessLogs).innerJoin(driveShareLinks, eq(driveShareLinks.id, driveShareAccessLogs.shareId))
      .where(base).groupBy(driveShareAccessLogs.shareId, driveShareLinks.tenantId).having(sql`count(*) >= ${threshold}`),
  ]);
  return [
    ...byIp.map((r) => ({
      kind: '外链爆破', subjectKey: `ip:${r.clientIp}`, subject: `IP ${r.clientIp}`,
      count: r.count, detail: '外链访问被拒绝', tenantId: null,
    })),
    ...byShare.map((r) => ({
      kind: '外链爆破', subjectKey: `share:${r.shareId}`, subject: `外链 #${r.shareId}`,
      count: r.count, detail: '访问被拒绝', tenantId: r.tenantId ?? null,
    })),
  ];
}

export async function dispatchDriveSecurityAlerts(): Promise<{ alerts: number }> {
  // 全局扫描：阈值取平台值（租户覆盖对告警规则不生效，设置项说明已注明）
  const settings = await getDriveSettings({ tenantId: null });
  const windowMinutes = settings.alertWindowMinutes;
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const hits: AlertHit[] = [];
  if (settings.alertBulkDownloadCount > 0) hits.push(...await scanBulkDownloads(since, settings.alertBulkDownloadCount));
  if (settings.alertShareFailureCount > 0) hits.push(...await scanShareBruteForce(since, settings.alertShareFailureCount));
  if (hits.length === 0) return { alerts: 0 };

  const bucket = Math.floor(Date.now() / (windowMinutes * 60_000));
  const adminCache = new Map<number | null, number[]>();
  let alerts = 0;
  for (const hit of hits) {
    try {
      let admins = adminCache.get(hit.tenantId);
      if (!admins) {
        admins = await resolveDriveAdminUserIds(hit.tenantId);
        adminCache.set(hit.tenantId, admins);
      }
      if (admins.length === 0) continue;
      await notify('drive.security.alert', {
        recipients: admins.map((id) => ({ type: 'user' as const, id })),
        vars: { kind: hit.kind, subject: hit.subject, count: hit.count, windowMinutes, detail: hit.detail },
        tenantId: hit.tenantId,
        link: hit.kind === '外链爆破' ? '/drive/admin/governance?tab=logs' : '/drive/admin/activities?action=download',
        dedupeKey: `drive-alert:${hit.kind}:${hit.subjectKey}:${bucket}`,
      });
      alerts += 1;
    } catch (err) {
      logger.warn({ err, hit }, 'drive: 异常行为告警发送失败');
    }
  }
  return { alerts };
}

export async function registerDriveSecurityAlertJob(): Promise<void> {
  await registerSystemRecurringJob({
    name: 'drive-security-alerts', title: '网盘异常行为告警', module: '企业网盘',
    cronExpression: '*/5 * * * *', allowManualRun: true,
    run: async () => {
      const result = await dispatchDriveSecurityAlerts();
      return `本轮触发告警 ${result.alerts} 条`;
    },
  });
}
