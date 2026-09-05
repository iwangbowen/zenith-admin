/**
 * 交易投诉/争议管理路由（/api/payment/disputes）。
 * 工单列表/详情/统计、商户回复、完结、投诉退款（复用退款审批链路）、模拟投诉（演示）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentDisputeContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  ensureDispute,
  getDisputeDetail,
  getDisputeStats,
  listDisputes,
  refundDispute,
  replyDispute,
  resolveDispute,
  simulateDispute,
} from '../../services/payment/payment-dispute.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentDisputeContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:dispute:list' })],
  handler: async (c) => c.json(okBody(await listDisputes(c.req.valid('query'))), 200),
});

const statsRoute = defineContractRoute(paymentDisputeContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'payment:dispute:list' })],
  handler: async (c) => c.json(okBody(await getDisputeStats()), 200),
});

const detailRoute = defineContractRoute(paymentDisputeContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:dispute:list' })],
  handler: async (c) => c.json(okBody(await getDisputeDetail(c.req.valid('param').id)), 200),
});

const replyRoute = defineContractRoute(paymentDisputeContract.reply, {
  middleware: [authMiddleware, guard({ permission: 'payment:dispute:handle', audit: { description: '回复投诉', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await replyDispute(id, c.req.valid('json').content), '回复成功'), 200);
  },
});

const resolveRoute = defineContractRoute(paymentDisputeContract.resolve, {
  middleware: [authMiddleware, guard({ permission: 'payment:dispute:handle', audit: { description: '完结投诉', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await resolveDispute(id, c.req.valid('json').remark), '已完结'), 200);
  },
});

const refundRoute = defineContractRoute(paymentDisputeContract.refund, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:dispute:handle', audit: { description: '投诉退款', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDispute(id));
    return c.json(okBody(await refundDispute(id, c.req.valid('json')), '退款已发起'), 200);
  },
});

const simulateRoute = defineContractRoute(paymentDisputeContract.simulate, {
  middleware: [authMiddleware, guard({ permission: 'payment:dispute:handle', audit: { description: '模拟投诉', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await simulateDispute(c.req.valid('json').orderNo), '模拟投诉已生成'), 200),
});

router.openapiRoutes([listRoute, statsRoute, detailRoute, replyRoute, resolveRoute, refundRoute, simulateRoute] as const);

export default router;
