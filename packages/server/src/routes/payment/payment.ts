import { OpenAPIHono } from '@hono/zod-openapi';
import {
  paymentChannelContract,
  paymentNotifyLogContract,
  paymentOrderContract,
  paymentRefundContract,
  paymentStatsContract,
} from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getClientIp } from '../../lib/request-helpers';
import {
  listAllChannelConfigs,
  listChannelConfigLookup,
  listChannelConfigs,
  getChannelConfig,
  createChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  setChannelAsDefault,
} from '../../services/payment/payment-channels.service';
import {
  listOrders,
  getOrderDetail,
  getOrderDetailByNo,
  createPayment,
  refreshOrderById,
  closeOrderById,
  listOrderRefunds,
  refund,
  listRefunds,
  getRefundDetail,
  refreshRefundById,
  approveRefund,
  rejectRefund,
  listNotifyLogs,
  testChannelConnectivity,
} from '../../services/payment/payment.service';
import { getPaymentStats, getPaymentTrend } from '../../services/payment/payment-stats.service';

const paymentRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 统计 ─────────────────────────────────────────────────────────────────────
const statsRoute = defineContractRoute(paymentStatsContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list' })],
  handler: async (c) => c.json(okBody(await getPaymentStats()), 200),
});

const trendRoute = defineContractRoute(paymentStatsContract.trend, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list' })],
  handler: async (c) => c.json(okBody(await getPaymentTrend(c.req.valid('query').days)), 200),
});

// ─── 渠道配置 ───────────────────────────────────────────────────────────────────
const channelLookupRoute = defineContractRoute(paymentChannelContract.channelOperationLookup, {
  middleware: [authMiddleware, guard({ permission: [
    'payment:channel:list',
    'payment:settlement:list',
    'payment:recon:list',
    'payment:ledger:list',
    'payment:ledger:account:create',
    'payment:ledger:post',
    'payment:ledger:reverse',
    'payment:ledger:reserve',
  ] })],
  handler: async (c) => c.json(okBody(await listChannelConfigLookup()), 200),
});

const channelsAllRoute = defineContractRoute(paymentChannelContract.channelsAll, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })],
  handler: async (c) => c.json(okBody(await listAllChannelConfigs()), 200),
});

const channelsListRoute = defineContractRoute(paymentChannelContract.channels, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })],
  handler: async (c) => c.json(okBody(await listChannelConfigs(c.req.valid('query'))), 200),
});

const channelGetRoute = defineContractRoute(paymentChannelContract.channelDetail, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:list' })],
  handler: async (c) => c.json(okBody(await getChannelConfig(c.req.valid('param').id)), 200),
});

const channelCreateRoute = defineContractRoute(paymentChannelContract.createChannel, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:create', audit: { description: '创建支付渠道', module: '支付中心', recordBody: false } })],
  handler: async (c) => c.json(okBody(await createChannelConfig(c.req.valid('json')), '创建成功'), 200),
});

const channelUpdateRoute = defineContractRoute(paymentChannelContract.updateChannel, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:update', audit: { description: '更新支付渠道', module: '支付中心', recordBody: false } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    return c.json(okBody(await updateChannelConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const channelDeleteRoute = defineContractRoute(paymentChannelContract.removeChannel, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:delete', audit: { description: '删除支付渠道', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    await deleteChannelConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const channelTestRoute = defineContractRoute(paymentChannelContract.testChannel, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:update' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await testChannelConnectivity(id);
    return c.json(okBody(result), 200);
  },
});

const channelSetDefaultRoute = defineContractRoute(paymentChannelContract.setDefaultChannel, {
  middleware: [authMiddleware, guard({ permission: 'payment:channel:update', audit: { description: '设为默认支付渠道', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    return c.json(okBody(await setChannelAsDefault(id), '已设为默认'), 200);
  },
});

// ─── 支付订单 ─────────────────────────────────────────────────────────────
const ordersListRoute = defineContractRoute(paymentOrderContract.orders, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list' })],
  handler: async (c) => c.json(okBody(await listOrders(c.req.valid('query'))), 200),
});

const orderCreateRoute = defineContractRoute(paymentOrderContract.createOrder, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 15, message: '下单处理中，请勿重复提交' }), guard({ permission: 'payment:order:create', audit: { description: '发起支付下单', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await createPayment({
    ...c.req.valid('json'),
    clientIp: getClientIp(c),
    idempotencyKey: c.req.header('x-idempotency-key'),
  }), '下单成功'), 200),
});

const orderGetByNoRoute = defineContractRoute(paymentOrderContract.orderByNo, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list' })],
  handler: async (c) => c.json(okBody(await getOrderDetailByNo(c.req.valid('param').orderNo)), 200),
});

const orderGetRoute = defineContractRoute(paymentOrderContract.orderDetail, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list' })],
  handler: async (c) => c.json(okBody(await getOrderDetail(c.req.valid('param').id)), 200),
});

const orderRefundsRoute = defineContractRoute(paymentRefundContract.orderRefunds, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list' }), guard({ permission: ['payment:refund:list', 'payment:order:refund'] })],
  handler: async (c) => c.json(okBody(await listOrderRefunds(c.req.valid('param').id)), 200),
});

const orderQueryRoute = defineContractRoute(paymentOrderContract.queryOrder, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:list', audit: { description: '主动同步支付订单状态', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    return c.json(okBody(await refreshOrderById(id), '已同步'), 200);
  },
});

const orderCloseRoute = defineContractRoute(paymentOrderContract.closeOrder, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:close', audit: { description: '关闭支付订单', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    await closeOrderById(id);
    setAuditAfterData(c, await getOrderDetail(id));
    return c.json(okBody(null, '订单已关闭'), 200);
  },
});

// ─── 退款 ───────────────────────────────────────────────────────────────────────
const refundCreateRoute = defineContractRoute(paymentRefundContract.createRefund, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 15, message: '退款处理中，请勿重复提交' }), guard({ permission: 'payment:order:refund', audit: { description: '发起退款', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await refund({
    ...c.req.valid('json'),
    idempotencyKey: c.req.valid('header')['x-idempotency-key'],
  }), '退款已发起'), 200),
});

const refundsListRoute = defineContractRoute(paymentRefundContract.refunds, {
  middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })],
  handler: async (c) => c.json(okBody(await listRefunds(c.req.valid('query'))), 200),
});

const refundGetRoute = defineContractRoute(paymentRefundContract.refundDetail, {
  middleware: [authMiddleware, guard({ permission: 'payment:refund:list' })],
  handler: async (c) => c.json(okBody(await getRefundDetail(c.req.valid('param').id)), 200),
});

const refundQueryRoute = defineContractRoute(paymentRefundContract.queryRefund, {
  middleware: [authMiddleware, guard({ permission: 'payment:refund:list', audit: { description: '主动同步退款状态', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRefundDetail(id));
    return c.json(okBody(await refreshRefundById(id), '已同步'), 200);
  },
});

const refundApproveRoute = defineContractRoute(paymentRefundContract.approveRefund, {
  middleware: [authMiddleware, guard({ permission: 'payment:refund:approve', audit: { description: '审批通过退款', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRefundDetail(id));
    const result = await approveRefund(id, c.req.valid('json').remark);
    setAuditAfterData(c, await getRefundDetail(id));
    return c.json(okBody(result, '已审批通过'), 200);
  },
});

const refundRejectRoute = defineContractRoute(paymentRefundContract.rejectRefund, {
  middleware: [authMiddleware, guard({ permission: 'payment:refund:approve', audit: { description: '驳回退款', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRefundDetail(id));
    await rejectRefund(id, c.req.valid('json').remark);
    setAuditAfterData(c, await getRefundDetail(id));
    return c.json(okBody(null, '已驳回'), 200);
  },
});

// ─── 回调日志 ─────────────────────────────────────────────────────────────────────
const logsListRoute = defineContractRoute(paymentNotifyLogContract.logs, {
  middleware: [authMiddleware, guard({ permission: 'payment:log:list' })],
  handler: async (c) => c.json(okBody(await listNotifyLogs(c.req.valid('query'))), 200),
});

// 注册顺序即匹配顺序：静态段（/channels/all、/orders/by-no）必须早于同级动态段（/{id}）
paymentRouter.openapiRoutes([
  statsRoute,
  trendRoute,
  channelLookupRoute,
  channelsAllRoute,
  channelsListRoute,
  channelGetRoute,
  channelCreateRoute,
  channelUpdateRoute,
  channelDeleteRoute,
  channelTestRoute,
  channelSetDefaultRoute,
] as const);

paymentRouter.openapiRoutes([
  ordersListRoute,
  orderCreateRoute,
  orderGetByNoRoute,
  orderGetRoute,
  orderRefundsRoute,
  orderQueryRoute,
  orderCloseRoute,
] as const);

paymentRouter.openapiRoutes([
  refundCreateRoute,
  refundsListRoute,
  refundGetRoute,
  refundQueryRoute,
  refundApproveRoute,
  refundRejectRoute,
  logsListRoute,
] as const);

export default paymentRouter;
