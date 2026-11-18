// ─── 实例迁移 ───
import { workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { preflightMigration, migrateInstance, batchMigrate, listMigrations } from '../../../services/workflow/workflow-migrations.service';

export const migratePreflightRoute = defineContractRoute(workflowInstanceOpsContract.migratePreflight, {
  handler: async (c) => c.json(okBody(await preflightMigration(c.req.valid('param').id)), 200),
});

export const migrateRoute = defineContractRoute(workflowInstanceOpsContract.migrate, {
  handler: async (c) => {
    await migrateInstance(c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(null, '迁移成功'), 200);
  },
});

export const migrationsRoute = defineContractRoute(workflowInstanceOpsContract.migrations, {
  handler: async (c) => c.json(okBody(await listMigrations(c.req.valid('param').id)), 200),
});

export const migrateBatchRoute = defineContractRoute(workflowInstanceOpsContract.migrateBatch, {
  handler: async (c) => {
    const r = await batchMigrate(c.req.valid('param').definitionId);
    return c.json(okBody(null, `批量迁移完成：${r.migrated}/${r.total}，失败 ${r.failed.length}`), 200);
  },
});
