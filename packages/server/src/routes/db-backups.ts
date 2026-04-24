import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { dbBackups } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createPgDumpBackup, createDrizzleExportBackup } from '../lib/db-backup';
import logger from '../lib/logger';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody } from '../lib/openapi-schemas';
import { DbBackupItemDTO as BackupItem } from '../lib/openapi-dtos';

import { createBackupSchema } from '@zenith/shared';

const backups = new OpenAPIHono({ defaultHook: validationHook });

// ─── Schemas ───────────────────────────────────────────────────────────────
const BackupCreated = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
});

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['DbBackups'],
    summary: '数据库备份列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-backup:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        status: z.enum(['pending', 'running', 'success', 'failed']).optional(),
        type: z.enum(['pg_dump', 'drizzle_export']).optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(BackupItem, '备份列表'),
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const page = Number(q.page) || 1;
    const pageSize = Number(q.pageSize) || 10;

    const conditions = [];
    if (q.status) conditions.push(eq(dbBackups.status, q.status));
    if (q.type) conditions.push(eq(dbBackups.type, q.type));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [count, rows] = await Promise.all([
      db.$count(dbBackups, where),
      db.query.dbBackups.findMany({
        where,
        with: { createdByUser: { columns: { nickname: true } } },
        orderBy: desc(dbBackups.createdAt),
        limit: pageSize,
        offset: pageOffset(page, pageSize),
      }),
    ]);

    return c.json(
      okBody({
        list: rows.map(({ createdByUser, startedAt, completedAt, createdAt, ...rest }) => ({
          ...rest,
          createdByName: createdByUser?.nickname ?? null,
          startedAt: startedAt?.toISOString() || null,
          completedAt: completedAt?.toISOString() || null,
          createdAt: createdAt.toISOString(),
        })),
        total: count,
        page,
        pageSize,
      }),
      200,
    );
  },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['DbBackups'],
    summary: '创建数据库备份',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
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
      ...ok(BackupCreated, '备份任务已创建'),
    },
  }),
  handler: async (c) => {
    const payload = c.get('user');
    const { type, name } = c.req.valid('json');
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
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
      okBody({ id: backup.id, name: backupName, status: 'pending' }, '备份任务已创建'),
      200,
    );
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['DbBackups'],
    summary: '删除数据库备份记录',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({
        permission: 'system:db-backup:delete',
        audit: { description: '删除数据库备份', module: '数据库备份' },
      }),
    ] as const,
    request: {
      params: IdParam,
    },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已删除'),
      400: { content: jsonContent(ErrorResponse), description: '无效 ID' },
      404: { content: jsonContent(ErrorResponse), description: '备份记录不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    if (!id) return c.json(errBody('无效 ID'), 400);

    const result = await db.delete(dbBackups).where(eq(dbBackups.id, id)).returning();
    if (result.length === 0) {
      return c.json(errBody('备份记录不存在', 404), 404);
    }

    return c.json(okBody(null, '已删除'), 200);
  },
});

backups.openapiRoutes([listRoute, createRouteDef, deleteRoute] as const);

export default backups;
