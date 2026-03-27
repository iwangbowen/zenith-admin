import { Hono } from 'hono';
import { eq, desc, sql, and } from 'drizzle-orm';
import { db } from '../db';
import { dbBackups, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createBackupSchema } from '@zenith/shared';
import { createPgDumpBackup, createDrizzleExportBackup } from '../lib/db-backup';
import logger from '../lib/logger';

const backups = new Hono<{ Variables: { user: JwtPayload } }>();
backups.use('*', authMiddleware);

// ─── 备份列表 ─────────────────────────────────────────────────────────
backups.get('/', guard({ permission: 'system:db-backup:list' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const status = c.req.query('status') as string | undefined;
  const type = c.req.query('type') as string | undefined;

  const conditions = [];
  if (status) conditions.push(eq(dbBackups.status, status as 'pending' | 'running' | 'success' | 'failed'));
  if (type) conditions.push(eq(dbBackups.type, type as 'pg_dump' | 'drizzle_export'));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(dbBackups)
    .where(where);

  const rows = await db
    .select({
      id: dbBackups.id,
      name: dbBackups.name,
      type: dbBackups.type,
      fileId: dbBackups.fileId,
      fileSize: dbBackups.fileSize,
      status: dbBackups.status,
      tables: dbBackups.tables,
      startedAt: dbBackups.startedAt,
      completedAt: dbBackups.completedAt,
      durationMs: dbBackups.durationMs,
      errorMessage: dbBackups.errorMessage,
      createdBy: dbBackups.createdBy,
      createdByName: users.nickname,
      createdAt: dbBackups.createdAt,
    })
    .from(dbBackups)
    .leftJoin(users, eq(dbBackups.createdBy, users.id))
    .where(where)
    .orderBy(desc(dbBackups.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({
        ...r,
        startedAt: r.startedAt?.toISOString() || null,
        completedAt: r.completedAt?.toISOString() || null,
        createdAt: r.createdAt.toISOString(),
      })),
      total: count,
      page,
      pageSize,
    },
  });
});

// ─── 创建备份 ─────────────────────────────────────────────────────────
backups.post('/', guard({ permission: 'system:db-backup:create', audit: { description: '创建数据库备份', module: '数据库备份' } }), async (c) => {
  const payload = c.get('user') as JwtPayload;
  const body = await c.req.json();
  const result = createBackupSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }

  const { type, name } = result.data;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = name || `${type}-${timestamp}`;

  const [backup] = await db
    .insert(dbBackups)
    .values({
      name: backupName,
      type,
      status: 'pending',
      createdBy: payload.userId,
    })
    .returning();

  // 异步执行备份
  const runBackup = type === 'pg_dump' ? createPgDumpBackup : createDrizzleExportBackup;
  runBackup(backup.id).catch((err) => {
    logger.error(`备份任务 ${backup.id} 失败`, err);
  });

  return c.json({
    code: 0,
    message: '备份任务已创建',
    data: { id: backup.id, name: backupName, status: 'pending' },
  });
});

// ─── 删除备份记录 ─────────────────────────────────────────────────────
backups.delete('/:id', guard({ permission: 'system:db-backup:delete', audit: { description: '删除数据库备份', module: '数据库备份' } }), async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ code: 400, message: '无效 ID', data: null }, 400);

  const result = await db.delete(dbBackups).where(eq(dbBackups.id, id)).returning();
  if (result.length === 0) {
    return c.json({ code: 404, message: '备份记录不存在', data: null }, 404);
  }

  return c.json({ code: 0, message: '已删除', data: null });
});

export default backups;
