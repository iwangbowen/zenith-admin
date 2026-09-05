// ─── 实例迁移 ───
import { workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { preflightMigration, migrateInstance, batchMigrate, listMigrations } from '../../../services/workflow/workflow-migrations.service';

export const migratePreflightRoute = defineContractRoute(workflowInstanceOpsContract.migratePreflight, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate' })] as const,
  handler: async (c) => c.json(okBody(await preflightMigration(c.req.valid('param').id)), 200),
});

export const migrateRoute = defineContractRoute(workflowInstanceOpsContract.migrate, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '迁移流程实例', module: '工作流管理' } })] as const,
  handler: async (c) => {
    await migrateInstance(c.req.valid('param').id);
    return c.json(okBody(null, '迁移成功'), 200);
  },
});

export const migrationsRoute = defineContractRoute(workflowInstanceOpsContract.migrations, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
  handler: async (c) => c.json(okBody(await listMigrations(c.req.valid('param').id)), 200),
});

export const migrateBatchRoute = defineContractRoute(workflowInstanceOpsContract.migrateBatch, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '批量迁移流程实例', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const r = await batchMigrate(c.req.valid('param').definitionId);
    return c.json(okBody(null, `批量迁移完成：${r.migrated}/${r.total}，失败 ${r.failed.length}`), 200);
  },
});
