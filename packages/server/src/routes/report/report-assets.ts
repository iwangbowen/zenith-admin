import { OpenAPIHono } from '@hono/zod-openapi';
import { reportAssetContract, reportResourceTypeSchema } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  applyReportAssetTemplate,
  cloneReportAssetTemplate,
  createReportAssetTemplate,
  createReportDeprecationNotice,
  deleteReportAssetTemplate,
  deleteReportDeprecationNotice,
  getReportAssetTemplate,
  getReportAssetUsageSummary,
  getReportAssetUsageTrend,
  listInactiveReportAssets,
  listReportAssetCatalog,
  listReportAssetTemplates,
  listReportDeprecationNotices,
  listTopReportAssets,
  publishReportDeprecationNotice,
  updateReportAssetTemplate,
  updateReportDeprecationNotice,
} from '../../services/report/report-asset.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const catalogRoute = defineContractRoute(reportAssetContract.catalog, {
  middleware: [authMiddleware, guard({ permission: 'report:asset:list' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    const parsedTypes = query.types?.split(',').map((item) => reportResourceTypeSchema.safeParse(item.trim()))
      .filter((item) => item.success).map((item) => item.data);
    return c.json(okBody(await listReportAssetCatalog({ ...query, types: parsedTypes })), 200);
  },
});

const usageSummaryRoute = defineContractRoute(reportAssetContract.usage, {
  middleware: [authMiddleware, guard({ permission: 'report:asset:usage' })],
  handler: async (c) => {
    const params = c.req.valid('param');
    return c.json(okBody(await getReportAssetUsageSummary(params.resourceType, params.id, c.req.valid('query').days)), 200);
  },
});

const topAssetsRoute = defineContractRoute(reportAssetContract.topAssets, {
  middleware: [authMiddleware, guard({ permission: 'report:asset:usage' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listTopReportAssets(query.days, query.limit)), 200);
  },
});

const inactiveAssetsRoute = defineContractRoute(reportAssetContract.inactiveAssets, {
  middleware: [authMiddleware, guard({ permission: 'report:asset:usage' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listInactiveReportAssets(query.days, query.page, query.pageSize)), 200);
  },
});

const usageTrendRoute = defineContractRoute(reportAssetContract.usageTrend, {
  middleware: [authMiddleware, guard({ permission: 'report:asset:usage' })],
  handler: async (c) => c.json(okBody(await getReportAssetUsageTrend(c.req.valid('query'))), 200),
});

const listNoticesRoute = defineContractRoute(reportAssetContract.deprecations, {
  middleware: [authMiddleware, guard({ permission: 'report:deprecation:list' })],
  handler: async (c) => c.json(okBody(await listReportDeprecationNotices(c.req.valid('query'))), 200),
});

const createNoticeRoute = defineContractRoute(reportAssetContract.createDeprecation, {
  middleware: [authMiddleware, guard({ permission: 'report:deprecation:create', audit: { module: '报表资产', description: '创建弃用公告' } })],
  handler: async (c) => c.json(okBody(await createReportDeprecationNotice(c.req.valid('json')), '创建成功'), 200),
});

const updateNoticeRoute = defineContractRoute(reportAssetContract.updateDeprecation, {
  middleware: [authMiddleware, guard({ permission: 'report:deprecation:update', audit: { module: '报表资产', description: '更新弃用公告' } })],
  handler: async (c) => c.json(okBody(await updateReportDeprecationNotice(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const publishNoticeRoute = defineContractRoute(reportAssetContract.publishDeprecation, {
  middleware: [authMiddleware, guard({ permission: 'report:deprecation:publish', audit: { module: '报表资产', description: '发布或撤销弃用公告' } })],
  handler: async (c) => c.json(okBody(await publishReportDeprecationNotice(
    c.req.valid('param').id,
    c.req.valid('json').publish,
  ), '操作成功'), 200),
});

const deleteNoticeRoute = defineContractRoute(reportAssetContract.removeDeprecation, {
  middleware: [authMiddleware, guard({ permission: 'report:deprecation:delete', audit: { module: '报表资产', description: '删除弃用公告' } })],
  handler: async (c) => {
    await deleteReportDeprecationNotice(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listTemplatesRoute = defineContractRoute(reportAssetContract.templates, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:list' })],
  handler: async (c) => c.json(okBody(await listReportAssetTemplates(c.req.valid('query'))), 200),
});

const getTemplateRoute = defineContractRoute(reportAssetContract.templateDetail, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:list' })],
  handler: async (c) => c.json(okBody(await getReportAssetTemplate(c.req.valid('param').id)), 200),
});

const createTemplateRoute = defineContractRoute(reportAssetContract.createTemplate, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:create', audit: { module: '报表资产', description: '创建资产模板' } })],
  handler: async (c) => c.json(okBody(await createReportAssetTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateTemplateRoute = defineContractRoute(reportAssetContract.updateTemplate, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:update', audit: { module: '报表资产', description: '更新资产模板' } })],
  handler: async (c) => c.json(okBody(await updateReportAssetTemplate(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const cloneTemplateRoute = defineContractRoute(reportAssetContract.cloneTemplate, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:create', audit: { module: '报表资产', description: '克隆资产模板' } })],
  handler: async (c) => c.json(okBody(await cloneReportAssetTemplate(c.req.valid('param').id, c.req.valid('json')), '克隆成功'), 200),
});

const applyTemplateRoute = defineContractRoute(reportAssetContract.applyTemplate, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:apply', audit: { module: '报表资产', description: '应用资产模板' } })],
  handler: async (c) => c.json(okBody(await applyReportAssetTemplate(c.req.valid('param').id, c.req.valid('json')), '应用成功'), 200),
});

const deleteTemplateRoute = defineContractRoute(reportAssetContract.removeTemplate, {
  middleware: [authMiddleware, guard({ permission: 'report:asset-template:delete', audit: { module: '报表资产', description: '删除资产模板' } })],
  handler: async (c) => {
    await deleteReportAssetTemplate(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  catalogRoute, usageSummaryRoute, topAssetsRoute, inactiveAssetsRoute, usageTrendRoute,
  listNoticesRoute, createNoticeRoute, updateNoticeRoute, publishNoticeRoute, deleteNoticeRoute,
  listTemplatesRoute, getTemplateRoute, createTemplateRoute, updateTemplateRoute,
  cloneTemplateRoute, applyTemplateRoute, deleteTemplateRoute,
] as const);

export default router;
