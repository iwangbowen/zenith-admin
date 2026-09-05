import { OpenAPIHono, z } from '@hono/zod-openapi';
import { reportDashboardContract, reportDashboardRevisionConflictSchema, type ReportWidget } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  DashboardRevisionConflictError,
  batchSetDashboardStatus,
  cloneDashboard,
  createDashboard,
  deleteDashboard,
  ensureDashboardExists,
  getDashboard,
  getDashboardData,
  listDashboardLookup,
  listDashboards,
  resolveDashboardSnapshotForMode,
  updateDashboardDraft,
} from '../../services/report/report-dashboard.service';
import { offlineDashboard, publishDashboard } from '../../services/report/report-ops.service';
import { recordReportAssetUsage } from '../../services/report/report-asset-usage.service';
import { resolveReportResource } from '../../services/report/report-resource.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 乐观锁冲突：HTTP 409，data 携带当前修订号与最新仪表盘 */
export const dashboardConflictResponse = {
  409: {
    content: jsonContent(z.object({
      code: z.literal(409),
      message: z.string(),
      data: reportDashboardRevisionConflictSchema,
    })),
    description: '版本冲突',
  },
} as const;

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportDashboardContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await listDashboards(c.req.valid('query'))), 200),
});

const lookupRoute = defineContractRoute(reportDashboardContract.lookup, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await listDashboardLookup(c.req.valid('query'))), 200),
});

const batchRoute = defineContractRoute(reportDashboardContract.batch, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => {
    const body = c.req.valid('json');
    const list = await Promise.all(body.ids.map((id) => getDashboard(id, {
      mode: body.mode ?? 'auto',
      allowOfflinePublished: true,
    })));
    return c.json(okBody(list), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportDashboardContract.batchStatus, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '批量更新报表仪表盘状态', module: '报表仪表盘' } })],
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDashboardStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个仪表盘状态`), 200);
  },
});

const dataRoute = defineContractRoute(reportDashboardContract.data, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const mode = c.req.valid('query').mode ?? 'auto';
    const dash = await ensureDashboardExists(id);
    const snapshot = await resolveDashboardSnapshotForMode(dash, mode, { allowOfflinePublished: true });
    const data = await getDashboardData(
      (snapshot.widgets ?? []) as ReportWidget[],
      (body.filters ?? {}) as Record<string, unknown>,
      body.limit,
      body.widgetQueries,
      id,
    );
    return c.json(okBody(data), 200);
  },
});

const getOneRoute = defineContractRoute(reportDashboardContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  responses: notFound,
  handler: async (c) => {
    const dashboard = await getDashboard(c.req.valid('param').id, {
      mode: c.req.valid('query').mode ?? 'auto',
      allowOfflinePublished: true,
    });
    const resource = await resolveReportResource('dashboard', dashboard.id);
    await recordReportAssetUsage({
      tenantId: resource.tenantId,
      resourceType: 'dashboard',
      resourceId: dashboard.id,
      action: 'view',
      scene: 'dashboard_detail',
    });
    return c.json(okBody(dashboard), 200);
  },
});

const createRoute_ = defineContractRoute(reportDashboardContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:create', audit: { description: '创建报表仪表盘', module: '报表仪表盘' } })],
  handler: async (c) => c.json(okBody(await createDashboard(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportDashboardContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '保存仪表盘草稿', module: '报表仪表盘' } })],
  responses: { ...notFound, ...dashboardConflictResponse },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await updateDashboardDraft(id, c.req.valid('json')), '更新成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

const publishRoute = defineContractRoute(reportDashboardContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '发布报表仪表盘', module: '报表仪表盘' } })],
  responses: dashboardConflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await publishDashboard(id, c.req.valid('json')), '发布成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

const offlineRoute = defineContractRoute(reportDashboardContract.offline, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '下线报表仪表盘', module: '报表仪表盘' } })],
  responses: dashboardConflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    try {
      return c.json(okBody(await offlineDashboard(id, c.req.valid('json')), '下线成功'), 200);
    } catch (err) {
      if (err instanceof DashboardRevisionConflictError) {
        return c.json({
          ...errBody(err.message, 409),
          data: { currentRevision: err.currentRevision, dashboard: err.currentDashboard },
        }, 409);
      }
      throw err;
    }
  },
});

const deleteRoute_ = defineContractRoute(reportDashboardContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:delete', audit: { description: '删除报表仪表盘', module: '报表仪表盘' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    await deleteDashboard(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const cloneRoute = defineContractRoute(reportDashboardContract.clone, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:create', audit: { description: '复制报表仪表盘', module: '报表仪表盘' } })],
  handler: async (c) => c.json(okBody(await cloneDashboard(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

router.openapiRoutes([
  listRoute,
  lookupRoute,
  batchRoute,
  batchStatusRoute,
  dataRoute,
  getOneRoute,
  createRoute_,
  updateRoute_,
  publishRoute,
  offlineRoute,
  deleteRoute_,
  cloneRoute,
] as const);

export default router;
