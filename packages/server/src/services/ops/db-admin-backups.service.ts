import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { CreateDbBackupInput } from '@zenith/shared/ops';
import { dbAdminContract, dbBackupSchema } from '@zenith/shared/ops';
import { JOB_MONITOR_BACKUP_STUCK_MS, JOB_MONITOR_BACKUP_PENDING_STUCK_MS, type JobStuckItem } from '@zenith/shared/platform';
import { db } from '../../db';
import { dbBackups, managedFiles } from '../../db/schema';
import { createDrizzleExportBackup, createPgDumpBackup } from '../../lib/db-backup';
import { requireRow } from '../../lib/db-assert';
import { getRestrictedFileForRead } from '../files/files.service';
import { formatDateTime, formatFileTimestamp, formatNullableDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import { buildWhere } from '../../lib/where-helpers';
import { entityMapper } from '../../lib/entity-map';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';

type DbBackupWithCreator = typeof dbBackups.$inferSelect & { createdByUser: { nickname: string | null } | null };

const mapDbBackup = entityMapper(dbBackupSchema, (row: DbBackupWithCreator) => ({ createdByName: row.createdByUser?.nickname ?? null }));

export const DB_BACKUP_STUCK_MS = JOB_MONITOR_BACKUP_STUCK_MS;
export const DB_BACKUP_PENDING_STUCK_MS = JOB_MONITOR_BACKUP_PENDING_STUCK_MS;

export function stuckDbBackupCondition(asOf = new Date()) {
  return or(
    and(eq(dbBackups.status, 'pending'), lt(dbBackups.createdAt, new Date(asOf.getTime() - DB_BACKUP_PENDING_STUCK_MS))),
    and(eq(dbBackups.status, 'running'), lt(sql`coalesce(${dbBackups.startedAt}, ${dbBackups.createdAt})`, sql.param(new Date(asOf.getTime() - DB_BACKUP_STUCK_MS), dbBackups.createdAt))),
  );
}

export async function getDbBackupHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${dbBackups.status} = 'pending')::int`,
    running: sql<number>`count(*) filter (where ${dbBackups.status} = 'running')::int`,
    stuck: sql<number>`count(*) filter (where ${stuckDbBackupCondition(now)})::int`,
    failed24h: sql<number>`count(*) filter (where ${dbBackups.status} = 'failed' and ${dbBackups.completedAt} >= ${sql.param(since, dbBackups.createdAt)})::int`,
    succeeded24h: sql<number>`count(*) filter (where ${dbBackups.status} = 'success' and ${dbBackups.completedAt} >= ${sql.param(since, dbBackups.createdAt)})::int`,
    failed1h: sql<number>`count(*) filter (where ${dbBackups.status} = 'failed' and ${dbBackups.completedAt} >= ${sql.param(hour, dbBackups.createdAt)})::int`,
    oldestPendingAgeSec: sql<number | null>`floor(extract(epoch from (${sql.param(now, dbBackups.createdAt)}::timestamptz - min(${dbBackups.createdAt}) filter (where ${dbBackups.status} = 'pending'))))::int`,
  }).from(dbBackups).where(or(inArray(dbBackups.status, ['pending', 'running']), and(inArray(dbBackups.status, ['success', 'failed']), gte(dbBackups.completedAt, since))));
  return {
    counts: { pending: row?.pending ?? 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: row?.oldestPendingAgeSec ?? null, failed1h: row?.failed1h ?? 0,
    issues: (row?.failed24h ?? 0) > 0 ? [{ level: 'warn', message: `近 24 小时 ${row.failed24h} 次数据库备份失败` }] : [],
  };
}

export async function listStuckDbBackups(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({
    id: dbBackups.id, name: dbBackups.name, status: dbBackups.status, startedAt: dbBackups.startedAt,
    createdAt: dbBackups.createdAt, updatedAt: dbBackups.updatedAt, errorMessage: dbBackups.errorMessage,
  }).from(dbBackups).where(stuckDbBackupCondition(now)).orderBy(dbBackups.createdAt, dbBackups.id).limit(limit);
  return rows.map((row) => ({
    source: 'db-backup', refId: String(row.id), title: row.name, status: row.status,
    startedAt: formatNullableDateTime(row.startedAt), lastSeenAt: formatDateTime(row.updatedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - (row.startedAt ?? row.createdAt).getTime()) / 1000)),
    nodeId: null, detail: row.errorMessage,
    drillDown: { path: `/system/db-admin?tab=backups&status=${row.status}`, label: '查看备份记录' },
  }));
}

/** 仅结案卡死备份，条件由监控共用；正常执行和已结束记录不能人工覆盖。 */
export async function markDbBackupFailed(id: number) {
  const existing = requireRow(await db.query.dbBackups.findFirst({ where: eq(dbBackups.id, id), with: { createdByUser: { columns: { nickname: true } } } }), '备份记录不存在');
  const now = new Date();
  const [row] = await db.update(dbBackups).set({
    status: 'failed', errorMessage: '管理员手动标记卡死备份为失败', completedAt: now,
    durationMs: Math.min(2_147_483_647, Math.max(0, now.getTime() - (existing.startedAt ?? existing.createdAt).getTime())),
  }).where(and(eq(dbBackups.id, id), stuckDbBackupCondition(now))).returning();
  if (!row) throw new HTTPException(409, { message: '仅可标记等待超过十分钟或运行超过两小时且尚未结束的备份' });
  return mapDbBackup({ ...row, createdByUser: existing.createdByUser });
}

export async function listDbBackups(q: QueryOutputOf<typeof dbAdminContract.backups>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.status ? eq(dbBackups.status, q.status) : undefined,
    q.type ? eq(dbBackups.type, q.type) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(dbBackups, where),
    rows: () => db.query.dbBackups.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true } } },
      orderBy: desc(dbBackups.createdAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapDbBackup,
  });
}

/** 落记录后立即返回回执；备份产物在后台生成，状态由 lib/db-backup 的执行器回写 */
export async function createDbBackup(input: CreateDbBackupInput) {
  const { type, name } = input;
  const backupName = name || `${type}-${formatFileTimestamp()}`;
  const [backup] = await db.insert(dbBackups).values({ name: backupName, type, status: 'pending' }).returning();
  const runBackup = type === 'pg_dump' ? createPgDumpBackup : createDrizzleExportBackup;
  runBackup(backup.id).catch((err) => {
    logger.error(`备份任务 ${backup.id} 失败`, err);
  });
  return { id: backup.id, name: backupName, status: 'pending' as const };
}

export async function deleteDbBackup(id: number) {
  const result = await db.delete(dbBackups).where(eq(dbBackups.id, id)).returning({ id: dbBackups.id, fileId: dbBackups.fileId });
  if (result.length === 0) throw new HTTPException(404, { message: '备份记录不存在' });
  // 记录没了，产物也就不再可下载：置 orphan 交给文件 GC 在宽限期后回收（GC 只回收 restricted + refCount 0 的文件）
  const fileId = result[0].fileId;
  if (fileId) {
    await db.update(managedFiles)
      .set({ gcState: 'orphan', orphanedAt: new Date() })
      .where(eq(managedFiles.id, fileId));
  }
}

/**
 * 取备份产物用于下载。备份文件注册为 `restricted`，通用 `/files/{id}/content` 对它一律 404，
 * 只有带 `system:db-admin:view` 权限的本路由能读到。
 */
export async function getDbBackupFileForDownload(id: number) {
  const row = await db.query.dbBackups.findFirst({
    where: eq(dbBackups.id, id),
    columns: { id: true, fileId: true },
  });
  const backup = requireRow(row, '备份记录不存在');
  const fileId = requireRow(backup.fileId, '该备份没有关联文件（尚未完成或未配置默认存储）');
  return getRestrictedFileForRead(fileId);
}

export async function getDbBackupBeforeAudit(id: number) {
  const row = await db.query.dbBackups.findFirst({
    where: eq(dbBackups.id, id),
    with: { createdByUser: { columns: { nickname: true } } },
  });
  return row ? mapDbBackup(row) : null;
}
