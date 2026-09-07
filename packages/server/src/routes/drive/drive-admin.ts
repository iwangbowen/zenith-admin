import { OpenAPIHono } from '@hono/zod-openapi';
import { driveAdminContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask } from '../../lib/task-center';
import { listDriveActivitiesForAdmin } from '../../services/drive/drive-activity.service';
import { getDriveAdminStats } from '../../services/drive/drive-admin.service';
import { createLegalHold, decideQuotaRequest, listLegalHolds, listQuotaRequestsForAdmin, releaseLegalHold } from '../../services/drive/drive-governance.service';
import { createOpenAppGrant, getOpenAppGrantBeforeAudit, listOpenAppGrants, removeOpenAppGrant } from '../../services/drive/drive-open.service';
import { adminRevokeDriveShareLink, getShareLinkBeforeAudit, listShareAccessLogsForAdmin, listShareLinksForAdmin } from '../../services/drive/drive-share.service';
import { adminUpdateDriveSpace, createDepartmentSpace, deleteDriveSpace, ensureDriveSpaceExists, listDriveSpacesForAdmin } from '../../services/drive/drive-spaces.service';
import { submitRecalcUsageTask, submitReindexTask } from '../../services/drive/drive-tasks.service';
import { handoffDriveSpace } from '../../services/drive/drive-handoff.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const AUDIT = { module: '企业网盘' } as const;

const statsRoute = defineContractRoute(driveAdminContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:stats:view' })],
  handler: async (c) => c.json(okBody(await getDriveAdminStats()), 200),
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

const handoffRoute = defineContractRoute(driveAdminContract.handoff, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:edit', audit: { module: '企业网盘', description: '空间交接' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await handoffDriveSpace(id, c.req.valid('json')), '空间已交接'), 200);
  },
});

// ─── 治理：外链访问日志 / 法律保留 / 扩容审批 / 开放应用授权 ────────────────────

const shareAccessLogsRoute = defineContractRoute(driveAdminContract.shareAccessLogs, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:link:list' })],
  handler: async (c) => c.json(okBody(await listShareAccessLogsForAdmin(c.req.valid('query'))), 200),
});

const legalHoldsRoute = defineContractRoute(driveAdminContract.legalHolds, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:list' })],
  handler: async (c) => c.json(okBody(await listLegalHolds(c.req.valid('query'))), 200),
});

const createLegalHoldRoute = defineContractRoute(driveAdminContract.createLegalHold, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:legal-hold:edit', audit: { description: '设置网盘法律保留', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await createLegalHold(c.req.valid('json')), '已设置法律保留'), 200),
});

const releaseLegalHoldRoute = defineContractRoute(driveAdminContract.releaseLegalHold, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:legal-hold:edit', audit: { description: '解除网盘法律保留', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await releaseLegalHold(c.req.valid('param').id, c.req.valid('json')), '已解除法律保留'), 200),
});

const quotaRequestsRoute = defineContractRoute(driveAdminContract.quotaRequests, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:list' })],
  handler: async (c) => c.json(okBody(await listQuotaRequestsForAdmin(c.req.valid('query'))), 200),
});

const decideQuotaRequestRoute = defineContractRoute(driveAdminContract.decideQuotaRequest, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:quota:approve', audit: { description: '审批网盘扩容申请', ...AUDIT } })],
  handler: async (c) => {
    const body = c.req.valid('json');
    return c.json(okBody(await decideQuotaRequest(c.req.valid('param').id, body), body.approve ? '已通过并写入配额' : '已拒绝'), 200);
  },
});

const openGrantsRoute = defineContractRoute(driveAdminContract.openGrants, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:space:list' })],
  handler: async (c) => c.json(okBody(await listOpenAppGrants(c.req.valid('query'))), 200),
});

const createOpenGrantRoute = defineContractRoute(driveAdminContract.createOpenGrant, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:open-grant:edit', audit: { description: '授权开放应用访问网盘空间', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await createOpenAppGrant(c.req.valid('json')), '已授权'), 200),
});

const removeOpenGrantRoute = defineContractRoute(driveAdminContract.removeOpenGrant, {
  middleware: [authMiddleware, guard({ permission: 'drive:admin:open-grant:edit', audit: { description: '撤销开放应用的网盘空间授权', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOpenAppGrantBeforeAudit(id));
    await removeOpenAppGrant(id);
    return c.json(okBody(null, '已撤销授权'), 200);
  },
});

// 静态 /spaces/department、/spaces/recalc 先于动态 /spaces/{id}
router.openapiRoutes([
  statsRoute,
  spacesRoute, createDepartmentSpaceRoute, recalcRoute, updateSpaceRoute, deleteSpaceRoute, reindexRoute,
  shareLinksRoute, revokeShareLinkRoute, shareAccessLogsRoute, activitiesRoute, handoffRoute,
  legalHoldsRoute, createLegalHoldRoute, releaseLegalHoldRoute,
  quotaRequestsRoute, decideQuotaRequestRoute,
  openGrantsRoute, createOpenGrantRoute, removeOpenGrantRoute,
] as const);

export default router;
