/**
 * 支付风控运营路由（/api/payment/risk）。
 * 拦截/命中留痕列表、人工审核队列（放行/拒绝）。规则 CRUD 见 /api/payment/risk-rules。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentRiskOpsContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  approveRiskReview,
  findRiskReviewById,
  listRiskHits,
  listRiskReviews,
  rejectRiskReview,
} from '../../services/payment/payment-risk.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const hitsRoute = defineContractRoute(paymentRiskOpsContract.hits, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:list' })],
  handler: async (c) => c.json(okBody(await listRiskHits(c.req.valid('query'))), 200),
});

const reviewsRoute = defineContractRoute(paymentRiskOpsContract.reviews, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:list' })],
  handler: async (c) => c.json(okBody(await listRiskReviews(c.req.valid('query'))), 200),
});

const approveRoute = defineContractRoute(paymentRiskOpsContract.approveReview, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:review', audit: { description: '风控审核放行', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await findRiskReviewById(id));
    return c.json(okBody(await approveRiskReview(id, c.req.valid('json').remark), '已放行'), 200);
  },
});

const rejectRoute = defineContractRoute(paymentRiskOpsContract.rejectReview, {
  middleware: [authMiddleware, guard({ permission: 'payment:risk:review', audit: { description: '风控审核拒绝', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await findRiskReviewById(id));
    return c.json(okBody(await rejectRiskReview(id, c.req.valid('json').remark), '已拒绝'), 200);
  },
});

router.openapiRoutes([hitsRoute, reviewsRoute, approveRoute, rejectRoute] as const);

export default router;
