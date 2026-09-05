import { OpenAPIHono } from '@hono/zod-openapi';
import { reportEnvironmentContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  createReportEnvironment,
  createReportEnvironmentPromotion,
  deleteReportEnvironment,
  listReportEnvironmentPromotions,
  listReportEnvironments,
  transitionReportEnvironmentPromotion,
  updateReportEnvironment,
} from '../../services/report/report-governance.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(reportEnvironmentContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:list' })],
  handler: async (c) => c.json(okBody(await listReportEnvironments()), 200),
});

const createRoute_ = defineContractRoute(reportEnvironmentContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:create', audit: { module: '报表环境治理', description: '创建报表环境' } })],
  handler: async (c) => c.json(okBody(await createReportEnvironment(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportEnvironmentContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:update', audit: { module: '报表环境治理', description: '更新报表环境' } })],
  handler: async (c) => c.json(okBody(await updateReportEnvironment(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteRoute_ = defineContractRoute(reportEnvironmentContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:delete', audit: { module: '报表环境治理', description: '删除报表环境' } })],
  handler: async (c) => {
    await deleteReportEnvironment(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listPromotionsRoute = defineContractRoute(reportEnvironmentContract.promotions, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:promote' })],
  handler: async (c) => c.json(okBody(await listReportEnvironmentPromotions(c.req.valid('query'))), 200),
});

const createPromotionRoute = defineContractRoute(reportEnvironmentContract.createPromotion, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:promote', audit: { module: '报表环境治理', description: '创建资源发布' } })],
  handler: async (c) => c.json(okBody(await createReportEnvironmentPromotion(c.req.valid('json')), '创建成功'), 200),
});

const transitionPromotionRoute = defineContractRoute(reportEnvironmentContract.transitionPromotion, {
  middleware: [authMiddleware, guard({ permission: 'report:environment:promote', audit: { module: '报表环境治理', description: '变更资源发布状态' } })],
  handler: async (c) => c.json(okBody(await transitionReportEnvironmentPromotion(c.req.valid('param').id, c.req.valid('json')), '操作成功'), 200),
});

router.openapiRoutes([
  listPromotionsRoute, createPromotionRoute, transitionPromotionRoute,
  listRoute, createRoute_, updateRoute_, deleteRoute_,
] as const);

export default router;
