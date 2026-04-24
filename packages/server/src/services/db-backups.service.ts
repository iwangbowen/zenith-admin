import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db';
import { dbBackups } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { createPgDumpBackup, createDrizzleExportBackup } from '../lib/db-backup';
import logger from '../lib/logger';
import { currentUser } from '../lib/context';
import { AppError } from '../lib/errors';

export interface ListDbBackupsQuery {
  page?: number;
  pageSize?: number;
  status?: 'pending' | 'running' | 'success' | 'failed';
  type?: 'pg_dump' | 'drizzle_export';
}

export async function listDbBackups(q: ListDbBackupsQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const conditions = [];
  if (q.status) conditions.push(eq(dbBackups.status, q.status));
  if (q.type) conditions.push(eq(dbBackups.type, q.type));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(dbBackups, where),
    db.query.dbBackups.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true } } },
      orderBy: desc(dbBackups.createdAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return {
    list: rows.map(({ createdByUser, startedAt, completedAt, createdAt, ...rest }) => ({
      ...rest,
      createdByName: createdByUser?.nickname ?? null,
      startedAt: startedAt?.toISOString() || null,
      completedAt: completedAt?.toISOString() || null,
      createdAt: createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

export async function createDbBackup(input: { type: 'pg_dump' | 'drizzle_export'; name?: string }) {
  const user = currentUser();
  const { type, name } = input;
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backupName = name || `${type}-${timestamp}`;
  const [backup] = await db.insert(dbBackups).values({
    name: backupName,
    type,
    status: 'pending',
    createdBy: user.userId,
  }).returning();
  const runBackup = type === 'pg_dump' ? createPgDumpBackup : createDrizzleExportBackup;
  runBackup(backup.id).catch((err) => {
    logger.error(`备份任务 ${backup.id} 失败`, err);
  });
  return { id: backup.id, name: backupName, status: 'pending' as const };
}

export async function deleteDbBackup(id: number) {
  if (!id) throw new AppError('无效 ID', 400);
  const result = await db.delete(dbBackups).where(eq(dbBackups.id, id)).returning();
  if (result.length === 0) throw new AppError('备份记录不存在', 404);
}
