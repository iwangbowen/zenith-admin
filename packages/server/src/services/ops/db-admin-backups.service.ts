import { desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { CreateDbBackupInput } from '@zenith/shared/ops';
import { dbAdminContract } from '@zenith/shared/ops';
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

type DbBackupWithCreator = typeof dbBackups.$inferSelect & { createdByUser: { nickname: string | null } | null };

function mapDbBackup({ createdByUser, startedAt, completedAt, createdAt, updatedAt, ...rest }: DbBackupWithCreator) {
  return {
    ...rest,
    createdByName: createdByUser?.nickname ?? null,
    startedAt: formatNullableDateTime(startedAt),
    completedAt: formatNullableDateTime(completedAt),
    createdAt: formatDateTime(createdAt),
    updatedAt: formatDateTime(updatedAt),
  };
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
