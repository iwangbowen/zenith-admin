import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { DbBackupItemDTO } from '../lib/openapi-dtos';
import { createBackupSchema } from '@zenith/shared';
import { listDbBackups, createDbBackup, deleteDbBackup } from '../services/db-backups.service';

const backups = new OpenAPIHono({ defaultHook: validationHook });

const BackupCreated = z.object({ id: z.number(), name: z.string(), status: z.string() });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['DbBackups'], summary: '数据库备份列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-backup:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        status: z.enum(['pending', 'running', 'success', 'failed']).optional(),
        type: z.enum(['pg_dump', 'drizzle_export']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(DbBackupItemDTO, '备份列表') },
  }),
  handler: async (c) => c.json(okBody(await listDbBackups(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['DbBackups'], summary: '创建数据库备份',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-backup:create', audit: { description: '创建数据库备份', module: '数据库备份' } })] as const,
    request: { body: { content: jsonContent(createBackupSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(BackupCreated, '备份任务已创建') },
  }),
  handler: async (c) => c.json(okBody(await createDbBackup(c.req.valid('json')), '备份任务已创建'), 200),
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['DbBackups'], summary: '删除数据库备份记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:db-backup:delete', audit: { description: '删除数据库备份', module: '数据库备份' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteDbBackup(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

backups.openapiRoutes([listRoute, createRouteDef, deleteRouteDef] as const);

export default backups;
