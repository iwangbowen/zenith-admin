// ─── 实例迁移（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { commonErrorResponses, ok, okMsg, IdParam, okBody } from '../../../lib/openapi-schemas';
import { preflightMigration, migrateInstance, batchMigrate, listMigrations } from '../../../services/workflow/workflow-migrations.service';
import { WorkflowMigrationPreflightDTO, WorkflowInstanceMigrationDTO } from '../../../lib/openapi-dtos';

export const migratePreflightRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/migrate/preflight', tags: ['WorkflowInstances'], summary: '实例迁移预检',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowMigrationPreflightDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await preflightMigration(c.req.valid('param').id)), 200),
});

export const migrateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/migrate', tags: ['WorkflowInstances'], summary: '迁移实例到最新版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '迁移流程实例', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('迁移成功') },
  }),
  handler: async (c) => { await migrateInstance(c.req.valid('param').id); return c.json(okBody(null, '迁移成功'), 200); },
});

export const migrationsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/migrations', tags: ['WorkflowInstances'], summary: '实例迁移记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowInstanceMigrationDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMigrations(c.req.valid('param').id)), 200),
});

export const migrateBatchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/migrate/batch/{definitionId}', tags: ['WorkflowInstances'], summary: '批量迁移定义下运行实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '批量迁移流程实例', module: '工作流管理' } })] as const,
    request: { params: z.object({ definitionId: z.coerce.number().int() }) },
    responses: { ...commonErrorResponses, ...okMsg('批量迁移完成') },
  }),
  handler: async (c) => { const r = await batchMigrate(c.req.valid('param').definitionId); return c.json(okBody(null, `批量迁移完成：${r.migrated}/${r.total}，失败 ${r.failed.length}`), 200); },
});
