import { OpenAPIHono } from '@hono/zod-openapi';
import { driveAdminContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask } from '../../lib/task-center';
import { listDriveActivitiesForAdmin } from '../../services/drive/drive-activity.service';
import { getDriveAdminStats } from '../../services/drive/drive-admin.service';
import { getDriveSettings, updateDriveSettings } from '../../services/drive/drive-settings.service';
import { adminRevokeDriveShareLink, getShareLinkBeforeAudit, listShareLinksForAdmin } from '../../services/drive/drive-share.service';
import { adminUpdateDriveSpace, createDepartmentSpace, deleteDriveSpace, ensureDriveSpaceExists, listDriveSpacesForAdmin } from '../../services/drive/drive-spaces.service';
import { submitRecalcUsageTask, submitReindexTask } from '../../services/drive/drive-tasks.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const AUDIT = { module: '企业网盘' } as const;

const statsRoute = defineContractRoute(driveAdminContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:stats:view' })],
  handler: async (c) => c.json(okBody(await getDriveAdminStats()), 200),
});

const settingsRoute = defineContractRoute(driveAdminContract.settings, {
  middleware: [authMiddleware, guard({ permission: 'drive:setting:view' })],
  handler: async (c) => c.json(okBody(await getDriveSettings()), 200),
});

const saveSettingsRoute = defineContractRoute(driveAdminContract.saveSettings, {
  middleware: [authMiddleware, guard({ permission: 'drive:setting:edit', audit: { description: '保存网盘设置', ...AUDIT } })],
  handler: async (c) => {
    setAuditBeforeData(c, await getDriveSettings());
    return c.json(okBody(await updateDriveSettings(c.req.valid('json')), '已保存'), 200);
  },
});

const spacesRoute = defineContractRoute(driveAdminContract.spaces, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:list' })],
  handler: async (c) => c.json(okBody(await listDriveSpacesForAdmin(c.req.valid('query'))), 200),
});

const createDepartmentSpaceRoute = defineContractRoute(driveAdminContract.createDepartmentSpace, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:edit', audit: { description: '创建部门网盘空间', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await createDepartmentSpace(c.req.valid('json')), '创建成功'), 200),
});

const updateSpaceRoute = defineContractRoute(driveAdminContract.updateSpace, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:edit', audit: { description: '治理网盘空间', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await adminUpdateDriveSpace(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteSpaceRoute = defineContractRoute(driveAdminContract.removeSpace, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:delete', audit: { description: '删除网盘空间', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    await deleteDriveSpace(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const recalcRoute = defineContractRoute(driveAdminContract.recalcUsage, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:edit', audit: { description: '重算网盘容量', ...AUDIT } })],
  handler: async (c) => {
    const task = await submitRecalcUsageTask(c.req.valid('json').spaceId);
    return c.json(okBody(mapAsyncTask(task), '任务已提交'), 200);
  },
});

const reindexRoute = defineContractRoute(driveAdminContract.reindex, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:edit', audit: { description: '补建网盘索引', ...AUDIT } })],
  handler: async (c) => {
    const task = await submitReindexTask(c.req.valid('json').spaceId);
    return c.json(okBody(mapAsyncTask(task), '任务已提交'), 200);
  },
});

const shareLinksRoute = defineContractRoute(driveAdminContract.shareLinks, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:link:list' })],
  handler: async (c) => c.json(okBody(await listShareLinksForAdmin(c.req.valid('query'))), 200),
});

const revokeShareLinkRoute = defineContractRoute(driveAdminContract.revokeShareLink, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:link:revoke', audit: { description: '管理员撤销网盘外链', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getShareLinkBeforeAudit(id));
    await adminRevokeDriveShareLink(id);
    setAuditAfterData(c, await getShareLinkBeforeAudit(id));
    return c.json(okBody(null, '已撤销'), 200);
  },
});

const activitiesRoute = defineContractRoute(driveAdminContract.activities, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:activity:list' })],
  handler: async (c) => c.json(okBody(await listDriveActivitiesForAdmin(c.req.valid('query'))), 200),
});

// 静态 /spaces/department、/spaces/recalc 先于动态 /spaces/{id}
router.openapiRoutes([
  statsRoute, settingsRoute, saveSettingsRoute,
  spacesRoute, createDepartmentSpaceRoute, recalcRoute, updateSpaceRoute, deleteSpaceRoute, reindexRoute,
  shareLinksRoute, revokeShareLinkRoute, activitiesRoute,
] as const);

export default router;
