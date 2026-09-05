import { OpenAPIHono } from '@hono/zod-openapi';
import { reportMetricContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  collectReportMetricRefs,
  createReportMetric,
  deleteReportMetric,
  deprecateReportMetric,
  evaluateReportMetric,
  getReportMetric,
  listReportMetricLookup,
  listReportMetrics,
  publishReportMetric,
  updateReportMetric,
} from '../../services/report/report-metric.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const conflict = { 409: { content: jsonContent(ErrorResponse), description: '版本冲突' } } as const;

const listRoute = defineContractRoute(reportMetricContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:list' })],
  handler: async (c) => c.json(okBody(await listReportMetrics(c.req.valid('query'))), 200),
});

const lookupRoute = defineContractRoute(reportMetricContract.lookup, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:list' })],
  handler: async (c) => c.json(okBody(await listReportMetricLookup(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(reportMetricContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:list' })],
  handler: async (c) => c.json(okBody(await getReportMetric(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(reportMetricContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:create', audit: { module: '报表指标', description: '创建指标' } })],
  handler: async (c) => c.json(okBody(await createReportMetric(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportMetricContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:update', audit: { module: '报表指标', description: '更新指标' } })],
  responses: conflict,
  handler: async (c) => c.json(okBody(await updateReportMetric(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const evaluateRoute = defineContractRoute(reportMetricContract.evaluate, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:evaluate' })],
  handler: async (c) => c.json(okBody(await evaluateReportMetric(c.req.valid('param').id, c.req.valid('json').params)), 200),
});

const publishRoute = defineContractRoute(reportMetricContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:publish', audit: { module: '报表指标', description: '发布指标' } })],
  responses: conflict,
  handler: async (c) => c.json(okBody(await publishReportMetric(c.req.valid('param').id, c.req.valid('json')), '发布成功'), 200),
});

const deprecateRoute = defineContractRoute(reportMetricContract.deprecate, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:publish', audit: { module: '报表指标', description: '废弃指标' } })],
  responses: conflict,
  handler: async (c) => c.json(okBody(await deprecateReportMetric(c.req.valid('param').id, c.req.valid('json')), '废弃成功'), 200),
});

const refsRoute = defineContractRoute(reportMetricContract.refs, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:list' })],
  handler: async (c) => c.json(okBody(await collectReportMetricRefs(c.req.valid('param').id)), 200),
});

const deleteRoute_ = defineContractRoute(reportMetricContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:metric:delete', audit: { module: '报表指标', description: '删除指标' } })],
  handler: async (c) => {
    await deleteReportMetric(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  listRoute, lookupRoute, getRoute, createRoute_, updateRoute_, evaluateRoute,
  publishRoute, deprecateRoute, refsRoute, deleteRoute_,
] as const);

export default router;
