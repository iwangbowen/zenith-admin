import { OpenAPIHono } from '@hono/zod-openapi';
import {
  paymentChannelContract,
  paymentNotifyLogContract,
  paymentOrderContract,
  paymentRefundContract,
  paymentStatsContract,
} from '@zenith/shared/payment';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
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
  getNotifyLog,
  testChannelConnectivity,
} from '../../services/payment/payment.service';
import { getPaymentStats, getPaymentTrend } from '../../services/payment/payment-stats.service';

const paymentRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 统计 ─────────────────────────────────────────────────────────────────────
const statsRoute = defineContractRoute(paymentStatsContract.stats, {
  handler: async (c) => c.json(okBody(await getPaymentStats()), 200),
});

const trendRoute = defineContractRoute(paymentStatsContract.trend, {
  handler: async (c) => c.json(okBody(await getPaymentTrend(c.req.valid('query').days)), 200),
});

// ─── 渠道配置 ───────────────────────────────────────────────────────────────────
const channelLookupRoute = defineContractRoute(paymentChannelContract.channelOperationLookup, {
  handler: async (c) => c.json(okBody(await listChannelConfigLookup()), 200),
});

const channelsAllRoute = defineContractRoute(paymentChannelContract.channelsAll, {
  handler: async (c) => c.json(okBody(await listAllChannelConfigs()), 200),
});

const channelsListRoute = defineContractRoute(paymentChannelContract.channels, {
  handler: async (c) => c.json(okBody(await listChannelConfigs(c.req.valid('query'))), 200),
});

const channelGetRoute = defineContractRoute(paymentChannelContract.channelDetail, {
  handler: async (c) => c.json(okBody(await getChannelConfig(c.req.valid('param').id)), 200),
});

const channelCreateRoute = defineContractRoute(paymentChannelContract.createChannel, {
  handler: async (c) => c.json(okBody(await createChannelConfig(c.req.valid('json')), '创建成功'), 200),
});

const channelUpdateRoute = defineContractRoute(paymentChannelContract.updateChannel, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    return c.json(okBody(await updateChannelConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const channelDeleteRoute = defineContractRoute(paymentChannelContract.removeChannel, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    await deleteChannelConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const channelTestRoute = defineContractRoute(paymentChannelContract.testChannel, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await testChannelConnectivity(id);
    return c.json(okBody(result), 200);
  },
});

const channelSetDefaultRoute = defineContractRoute(paymentChannelContract.setDefaultChannel, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelConfig(id));
    return c.json(okBody(await setChannelAsDefault(id), '已设为默认'), 200);
  },
});

// ─── 支付订单 ─────────────────────────────────────────────────────────────
const ordersListRoute = defineContractRoute(paymentOrderContract.orders, {
  handler: async (c) => c.json(okBody(await listOrders(c.req.valid('query'))), 200),
});

const orderCreateRoute = defineContractRoute(paymentOrderContract.createOrder, {
  middleware: [idempotencyGuard({ ttlSeconds: 15, message: '下单处理中，请勿重复提交' })],
  handler: async (c) => {
    const result = await createPayment({
      ...c.req.valid('json'),
      clientIp: getClientIp(c),
      idempotencyKey: c.req.header('x-idempotency-key'),
    });
    return c.json(okBody(result, '下单成功'), 200);
  },
});

const orderGetByNoRoute = defineContractRoute(paymentOrderContract.orderByNo, {
  handler: async (c) => c.json(okBody(await getOrderDetailByNo(c.req.valid('param').orderNo)), 200),
});

const orderGetRoute = defineContractRoute(paymentOrderContract.orderDetail, {
  handler: async (c) => c.json(okBody(await getOrderDetail(c.req.valid('param').id)), 200),
});

const orderRefundsRoute = defineContractRoute(paymentRefundContract.orderRefunds, {
  handler: async (c) => c.json(okBody(await listOrderRefunds(c.req.valid('param').id)), 200),
});

const orderQueryRoute = defineContractRoute(paymentOrderContract.queryOrder, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOrderDetail(id));
    return c.json(okBody(await refreshOrderById(id), '已同步'), 200);
  },
});

const orderCloseRoute = defineContractRoute(paymentOrderContract.closeOrder, {
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
  middleware: [idempotencyGuard({ ttlSeconds: 15, message: '退款处理中，请勿重复提交' })],
  handler: async (c) => {
    const result = await refund({
      ...c.req.valid('json'),
      idempotencyKey: c.req.valid('header')['x-idempotency-key'],
    });
    return c.json(okBody(result, '退款已发起'), 200);
  },
});

const refundsListRoute = defineContractRoute(paymentRefundContract.refunds, {
  handler: async (c) => c.json(okBody(await listRefunds(c.req.valid('query'))), 200),
});

const refundGetRoute = defineContractRoute(paymentRefundContract.refundDetail, {
  handler: async (c) => c.json(okBody(await getRefundDetail(c.req.valid('param').id)), 200),
});

const refundQueryRoute = defineContractRoute(paymentRefundContract.queryRefund, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const refundRow = await getRefundDetail(id);
    setAuditBeforeData(c, refundRow);
    return c.json(okBody(await refreshRefundById(id), '已同步'), 200);
  },
});

const refundApproveRoute = defineContractRoute(paymentRefundContract.approveRefund, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const refundRow = await getRefundDetail(id);
    setAuditBeforeData(c, refundRow);
    const result = await approveRefund(id, c.req.valid('json').remark);
    setAuditAfterData(c, await getRefundDetail(id));
    return c.json(okBody(result, '已审批通过'), 200);
  },
});

const refundRejectRoute = defineContractRoute(paymentRefundContract.rejectRefund, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const refundRow = await getRefundDetail(id);
    setAuditBeforeData(c, refundRow);
    await rejectRefund(id, c.req.valid('json').remark);
    setAuditAfterData(c, await getRefundDetail(id));
    return c.json(okBody(null, '已驳回'), 200);
  },
});

// ─── 回调日志 ─────────────────────────────────────────────────────────────────────
const logsListRoute = defineContractRoute(paymentNotifyLogContract.logs, {
  handler: async (c) => c.json(okBody(await listNotifyLogs(c.req.valid('query'))), 200),
});
const logDetailRoute = defineContractRoute(paymentNotifyLogContract.logDetail, {
  handler: async (c) => c.json(okBody(await getNotifyLog(c.req.valid('param').id)), 200),
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
  logDetailRoute,
] as const);

export default paymentRouter;
