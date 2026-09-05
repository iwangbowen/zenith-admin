import { OpenAPIHono } from '@hono/zod-openapi';
import { reportQueryCapacityContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  createReportQueryQuota,
  deleteReportQueryQuota,
  getReportQueryCostStats,
  getReportQueryCostTrend,
  getReportQueryQuota,
  getReportQueryQuotaUsage,
  listReportQueryCostLogs,
  listReportQueryQuotas,
  resetReportQueryQuotaUsage,
  updateReportQueryQuota,
} from '../../services/report/report-query-capacity.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listQuotasRoute = defineContractRoute(reportQueryCapacityContract.quotas, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:list' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listReportQueryQuotas(query.page, query.pageSize)), 200);
  },
});

const getQuotaRoute = defineContractRoute(reportQueryCapacityContract.quotaDetail, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:list' })],
  handler: async (c) => c.json(okBody(await getReportQueryQuota(c.req.valid('param').id)), 200),
});

const createQuotaRoute = defineContractRoute(reportQueryCapacityContract.createQuota, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:create', audit: { module: '报表查询容量', description: '创建查询配额' } })],
  handler: async (c) => c.json(okBody(await createReportQueryQuota(c.req.valid('json')), '创建成功'), 200),
});

const updateQuotaRoute = defineContractRoute(reportQueryCapacityContract.updateQuota, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:update', audit: { module: '报表查询容量', description: '更新查询配额' } })],
  handler: async (c) => c.json(okBody(await updateReportQueryQuota(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteQuotaRoute = defineContractRoute(reportQueryCapacityContract.removeQuota, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:delete', audit: { module: '报表查询容量', description: '删除查询配额' } })],
  handler: async (c) => {
    await deleteReportQueryQuota(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const quotaUsageRoute = defineContractRoute(reportQueryCapacityContract.quotaUsage, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:list' })],
  handler: async (c) => c.json(okBody(await getReportQueryQuotaUsage(
    c.req.valid('param').id,
    c.req.valid('query').scopeDate,
  )), 200),
});

const resetQuotaRoute = defineContractRoute(reportQueryCapacityContract.resetQuota, {
  middleware: [authMiddleware, guard({ permission: 'report:query-quota:update', audit: { module: '报表查询容量', description: '重置查询配额用量' } })],
  handler: async (c) => {
    await resetReportQueryQuotaUsage(c.req.valid('param').id, c.req.valid('json').scopeDate);
    return c.json(okBody(null, '重置成功'), 200);
  },
});

const costLogsRoute = defineContractRoute(reportQueryCapacityContract.costLogs, {
  middleware: [authMiddleware, guard({ permission: 'report:query-cost:list' })],
  handler: async (c) => c.json(okBody(await listReportQueryCostLogs(c.req.valid('query'))), 200),
});

const costStatsRoute = defineContractRoute(reportQueryCapacityContract.costStats, {
  middleware: [authMiddleware, guard({ permission: 'report:query-cost:list' })],
  handler: async (c) => c.json(okBody(await getReportQueryCostStats(c.req.valid('query'))), 200),
});

const costTrendRoute = defineContractRoute(reportQueryCapacityContract.costTrend, {
  middleware: [authMiddleware, guard({ permission: 'report:query-cost:list' })],
  handler: async (c) => c.json(okBody(await getReportQueryCostTrend(c.req.valid('query'))), 200),
});

router.openapiRoutes([
  listQuotasRoute, getQuotaRoute, createQuotaRoute, updateQuotaRoute, deleteQuotaRoute,
  quotaUsageRoute, resetQuotaRoute, costLogsRoute, costStatsRoute, costTrendRoute,
] as const);

export default router;
