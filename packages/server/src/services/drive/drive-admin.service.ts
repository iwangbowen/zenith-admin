import { eq, gte, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { DriveAdminStats, DriveSpaceType } from '@zenith/shared/drive';
import { readSnapshot } from '../../db';
import { driveActivities, driveFileVersions, driveNodes, driveShareLinks, driveSpaces } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, startOfToday } from '../../lib/datetime';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { effectiveQuotaBytes, getDriveSettings } from './drive-settings.service';

function categoryExpr() {
  return sql<string>`case
    when ${driveNodes.mimeType} like 'image/%' then 'image'
    when ${driveNodes.mimeType} like 'video/%' then 'video'
    when ${driveNodes.mimeType} like 'audio/%' then 'audio'
    when ${driveNodes.mimeType} = 'application/pdf' then 'pdf'
    when ${driveNodes.mimeType} like '%word%' or ${driveNodes.mimeType} like '%spreadsheet%' or ${driveNodes.mimeType} like '%presentation%' or ${driveNodes.mimeType} like '%excel%' or ${driveNodes.mimeType} like '%powerpoint%' then 'office'
    when ${driveNodes.mimeType} like 'text/%' or ${driveNodes.mimeType} in ('application/json', 'application/xml') then 'text'
    when ${driveNodes.mimeType} like '%zip%' or ${driveNodes.mimeType} like '%rar%' or ${driveNodes.mimeType} like '%7z%' or ${driveNodes.mimeType} like '%tar%' or ${driveNodes.mimeType} like '%gzip%' then 'archive'
    else 'other' end`;
}

/** 管理端统计（同一快照内取数保证互相一致） */
export async function getDriveAdminStats(): Promise<DriveAdminStats> {
  const user = currentUser();
  const settings = await getDriveSettings();
  const spaceTenant = tenantCondition(driveSpaces, user);
  const nodeTenant = tenantCondition(driveNodes, user);
  const todayStart = startOfToday();
  const weekAgo = new Date(todayStart.getTime() - 6 * 86_400_000);

  return readSnapshot(async (tx) => {
    const [spaceRows, nodeAgg, recycleAgg, versionAgg, shareCount, todayUploads, todayDownloads, topSpaces, typeRows, trendRows] = await Promise.all([
      tx.select({ type: driveSpaces.type, count: sql<number>`count(*)::int` }).from(driveSpaces).where(spaceTenant).groupBy(driveSpaces.type),
      tx.select({
        files: sql<number>`count(*) filter (where ${driveNodes.type} = 'file')::int`,
        folders: sql<number>`count(*) filter (where ${driveNodes.type} = 'folder')::int`,
        bytes: sql<number>`coalesce(sum(${driveNodes.size}) filter (where ${driveNodes.type} = 'file'), 0)::bigint`,
      }).from(driveNodes).where(buildWhere(isNull(driveNodes.deletedAt), nodeTenant)),
      tx.select({ bytes: sql<number>`coalesce(sum(${driveNodes.size}), 0)::bigint` }).from(driveNodes)
        .where(buildWhere(isNotNull(driveNodes.deletedAt), eq(driveNodes.type, 'file'), nodeTenant)),
      tx.select({ bytes: sql<number>`coalesce(sum(${driveFileVersions.size}), 0)::bigint` }).from(driveFileVersions)
        .innerJoin(driveNodes, eq(driveNodes.id, driveFileVersions.nodeId))
        .where(buildWhere(ne(driveFileVersions.version, driveNodes.currentVersion), nodeTenant)),
      tx.$count(driveShareLinks, buildWhere(
        isNull(driveShareLinks.revokedAt), eq(driveShareLinks.enabled, true),
        sql`(${driveShareLinks.expireAt} is null or ${driveShareLinks.expireAt} > now())`,
        tenantCondition(driveShareLinks, user),
      )),
      tx.$count(driveActivities, buildWhere(eq(driveActivities.action, 'upload'), gte(driveActivities.createdAt, todayStart), tenantCondition(driveActivities, user))),
      tx.$count(driveActivities, buildWhere(eq(driveActivities.action, 'download'), gte(driveActivities.createdAt, todayStart), tenantCondition(driveActivities, user))),
      tx.select().from(driveSpaces).where(spaceTenant).orderBy(sql`${driveSpaces.usedBytes} desc`).limit(10),
      tx.select({ category: categoryExpr(), count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${driveNodes.size}), 0)::bigint` })
        .from(driveNodes).where(buildWhere(eq(driveNodes.type, 'file'), isNull(driveNodes.deletedAt), nodeTenant)).groupBy(categoryExpr()),
      tx.select({
        day: sql<string>`to_char(${driveActivities.createdAt}, 'YYYY-MM-DD')`,
        uploads: sql<number>`count(*) filter (where ${driveActivities.action} = 'upload')::int`,
        downloads: sql<number>`count(*) filter (where ${driveActivities.action} = 'download')::int`,
      }).from(driveActivities)
        .where(buildWhere(gte(driveActivities.createdAt, weekAgo), tenantCondition(driveActivities, user)))
        .groupBy(sql`to_char(${driveActivities.createdAt}, 'YYYY-MM-DD')`),
    ]);
    const byType: Record<DriveSpaceType, number> = { personal: 0, department: 0, team: 0 };
    for (const r of spaceRows) byType[r.type] = r.count;
    const trendMap = new Map(trendRows.map((r) => [r.day, r]));
    const dailyTrend: DriveAdminStats['dailyTrend'] = [];
    for (let i = 0; i < 7; i++) {
      const day = formatDateTime(new Date(weekAgo.getTime() + i * 86_400_000)).slice(0, 10);
      const row = trendMap.get(day);
      dailyTrend.push({ date: day, uploads: row?.uploads ?? 0, downloads: row?.downloads ?? 0 });
    }
    return {
      spaceCount: spaceRows.reduce((s, r) => s + r.count, 0),
      spaceCountByType: byType,
      fileCount: nodeAgg[0]?.files ?? 0,
      folderCount: nodeAgg[0]?.folders ?? 0,
      totalBytes: Number(nodeAgg[0]?.bytes ?? 0),
      recycleBytes: Number(recycleAgg[0]?.bytes ?? 0),
      versionBytes: Number(versionAgg[0]?.bytes ?? 0),
      activeShareLinks: shareCount,
      todayUploads,
      todayDownloads,
      topSpaces: topSpaces.map((s) => ({ id: s.id, name: s.name, type: s.type, usedBytes: s.usedBytes, quotaBytes: effectiveQuotaBytes(settings, s) })),
      typeDistribution: typeRows.map((r) => ({ category: r.category, count: r.count, bytes: Number(r.bytes) })),
      dailyTrend,
    };
  });
}

