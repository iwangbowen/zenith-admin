import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, desc, sql, and } from 'drizzle-orm';
import { db } from '../db';
import { dbBackups, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createPgDumpBackup, createDrizzleExportBackup } from '../lib/db-backup';
import logger from '../lib/logger';
import { apiResponse, ErrorResponse, MessageResponse, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

import { createBackupSchema } from '@zenith/shared';

const backups = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });
backups.use('*', authMiddleware);

// ─── Schemas ───────────────────────────────────────────────────────────────
const BackupItem = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.enum(['pg_dump', 'drizzle_export']),
    fileId: z.number().nullable().optional(),
    fileSize: z.number().nullable().optional(),
    status: z.enum(['pending', 'running', 'success', 'failed']),
    tables: z.unknown().nullable().optional(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    durationMs: z.number().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    createdBy: z.number().nullable().optional(),
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .passthrough()
  .openapi('DbBackupItem');

const BackupCreated = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
});

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['DbBackups'],
  summary: '数据库备份列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:db-backup:list' })] as const,
  request: {
    query: z.object({
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
      status: z.enum(['pending', 'running', 'success', 'failed']).optional(),
      type: z.enum(['pg_dump', 'drizzle_export']).optional(),
    }),
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(paginatedResponse(BackupItem)), description: '备份列表' },
  },
});

backups.openapi(listRoute, async (c) => {
  const q = c.req.valid('query');
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;

  const conditions = [];
  if (q.status) conditions.push(eq(dbBackups.status, q.status));
  if (q.type) conditions.push(eq(dbBackups.type, q.type));
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

  return c.json(
    {
      code: 0 as const,
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
    },
    200,
  );
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['DbBackups'],
  summary: '创建数据库备份',
  security: [{ BearerAuth: [] }],
  middleware: [
    guard({
      permission: 'system:db-backup:create',
      audit: { description: '创建数据库备份', module: '数据库备份' },
    }),
  ] as const,
  request: {
    body: { content: jsonContent(createBackupSchema), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(BackupCreated)), description: '备份任务已创建' },
  },
});

backups.openapi(createRouteDef, async (c) => {
  const payload = c.get('user');
  const { type, name } = c.req.valid('json');
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

  const runBackup = type === 'pg_dump' ? createPgDumpBackup : createDrizzleExportBackup;
  runBackup(backup.id).catch((err) => {
    logger.error(`备份任务 ${backup.id} 失败`, err);
  });

  return c.json(
    {
      code: 0 as const,
      message: '备份任务已创建',
      data: { id: backup.id, name: backupName, status: 'pending' },
    },
    200,
  );
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['DbBackups'],
  summary: '删除数据库备份记录',
  security: [{ BearerAuth: [] }],
  middleware: [
    guard({
      permission: 'system:db-backup:delete',
      audit: { description: '删除数据库备份', module: '数据库备份' },
    }),
  ] as const,
  request: {
    params: z.object({ id: z.coerce.number() }),
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '已删除' },
    400: { content: jsonContent(ErrorResponse), description: '无效 ID' },
    404: { content: jsonContent(ErrorResponse), description: '备份记录不存在' },
  },
});

backups.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  if (!id) return c.json({ code: 400, message: '无效 ID', data: null }, 400);

  const result = await db.delete(dbBackups).where(eq(dbBackups.id, id)).returning();
  if (result.length === 0) {
    return c.json({ code: 404, message: '备份记录不存在', data: null }, 404);
  }

  return c.json({ code: 0 as const, message: '已删除', data: null }, 200);
});

export default backups;
