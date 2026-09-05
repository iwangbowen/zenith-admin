import { OpenAPIHono } from '@hono/zod-openapi';
import { dbBackupContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listDbBackups, createDbBackup, deleteDbBackup, getDbBackupBeforeAudit } from '../../services/ops/db-backups.service';

const backups = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(dbBackupContract.list, {
  middleware: [authMiddleware, guard({ permission: 'system:db-backup:list' })],
  handler: async (c) => c.json(okBody(await listDbBackups(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(dbBackupContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:db-backup:create', audit: { description: '创建数据库备份', module: '数据库备份' } })],
  handler: async (c) => c.json(okBody(await createDbBackup(c.req.valid('json')), '备份任务已创建'), 200),
});

const deleteRouteDef = defineContractRoute(dbBackupContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:db-backup:delete', audit: { description: '删除数据库备份', module: '数据库备份' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getDbBackupBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDbBackup(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

backups.openapiRoutes([listRoute, createRouteDef, deleteRouteDef] as const);

export default backups;
