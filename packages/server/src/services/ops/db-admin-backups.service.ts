import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateDbBackupInput, DbBackupListQueryInput } from '@zenith/shared/ops';
import { db } from '../../db';
import { dbBackups } from '../../db/schema';
import { createDrizzleExportBackup, createPgDumpBackup } from '../../lib/db-backup';
import { formatDateTime, formatFileTimestamp, formatNullableDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';

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

export async function listDbBackups(q: DbBackupListQueryInput) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const conditions = [];
  if (q.status) conditions.push(eq(dbBackups.status, q.status));
  if (q.type) conditions.push(eq(dbBackups.type, q.type));
  const where = and(...conditions);
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
  const result = await db.delete(dbBackups).where(eq(dbBackups.id, id)).returning({ id: dbBackups.id });
  if (result.length === 0) throw new HTTPException(404, { message: '备份记录不存在' });
}

export async function getDbBackupBeforeAudit(id: number) {
  const row = await db.query.dbBackups.findFirst({
    where: eq(dbBackups.id, id),
    with: { createdByUser: { columns: { nickname: true } } },
  });
  return row ? mapDbBackup(row) : null;
}
