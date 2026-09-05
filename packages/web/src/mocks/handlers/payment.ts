import {
  PAYMENT_METHOD_CHANNEL,
  paymentChannelContract,
  paymentNotifyLogContract,
  paymentOrderContract,
  paymentRefundContract,
  paymentStatsContract,
  type PaymentChannelConfig,
  type PaymentOrder,
  type PaymentRefund,
  type PaymentTrendPoint,
} from '@zenith/shared/payment';
import {
  mockPaymentChannels,
  getNextPaymentChannelId,
  mockPaymentOrders,
  getNextPaymentOrderId,
  mockPaymentRefunds,
  getNextPaymentRefundId,
  mockPaymentLogs,
} from '@/mocks/data/payment';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime, mockDateTimeOffset, mockDate } from '@/mocks/utils/date';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { recordMockPaymentSucceeded, recordMockRefundSucceeded } from './payment-ext';

interface MockRefundIdempotencyRecord {
  requestHash: string;
  result: { refundNo: string; status: PaymentRefund['status'] };
}

const refundIdempotencyRecords = new Map<string, MockRefundIdempotencyRecord>();

function refundRequestHash(values: { refundAmount: number; reason?: string }): string {
  return JSON.stringify({ refundAmount: values.refundAmount, reason: values.reason?.trim() || null });
}

/** Demo 模式的支付应用 → 商户配置绑定（应用 1 / 2 走微信主商户，应用 3 走支付宝沙箱） */
function demoChannelConfigId(applicationId: number): number | null {
  if (applicationId === 3) return 2;
  if (applicationId === 1 || applicationId === 2) return 1;
  return null;
}

export const paymentHandlers = [
  // ── 统计 ──
  mock(paymentStatsContract.stats, ({ ok }) => {
    const isPaid = (s: string) => s === 'success' || s === 'refunding' || s === 'refunded';
    const paid = mockPaymentOrders.filter((o) => isPaid(o.status));
    const totalAmount = paid.reduce((s, o) => s + o.amount, 0);
    const successRefunds = mockPaymentRefunds.filter((r) => r.status === 'success');
    const refundAmount = successRefunds.reduce((s, r) => s + r.refundAmount, 0);
    const orderCount = mockPaymentOrders.length;
    const successCount = paid.length;
    const byChannel = ['wechat', 'alipay']
      .map((channel) => {
        const list = mockPaymentOrders.filter((o) => o.channel === channel);
        const amount = list.filter((o) => isPaid(o.status)).reduce((s, o) => s + o.amount, 0);
        return { channel, count: list.length, amount };
      })
      .filter((c) => c.count > 0);
    const statusMap = new Map<string, number>();
    for (const o of mockPaymentOrders) statusMap.set(o.status, (statusMap.get(o.status) ?? 0) + 1);
    const byPayMethodMap = new Map<string, { count: number; amount: number }>();
    for (const o of mockPaymentOrders) {
      const cur = byPayMethodMap.get(o.payMethod) ?? { count: 0, amount: 0 };
      cur.count += 1;
      if (isPaid(o.status)) cur.amount += o.amount;
      byPayMethodMap.set(o.payMethod, cur);
    }
    const byBizTypeMap = new Map<string, { count: number; amount: number }>();
    for (const o of mockPaymentOrders) {
      if (!isPaid(o.status)) continue;
      const cur = byBizTypeMap.get(o.bizType) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += o.amount;
      byBizTypeMap.set(o.bizType, cur);
    }
    const round1 = (n: number) => Math.round(n * 10) / 10;
    return ok({
      totalAmount,
      todayAmount: 0,
      todayCount: 0,
      orderCount,
      successCount,
      refundAmount,
      refundCount: successRefunds.length,
      successRate: orderCount > 0 ? round1((successCount / orderCount) * 100) : 0,
      refundRate: totalAmount > 0 ? round1((refundAmount / totalAmount) * 100) : 0,
      avgAmount: successCount > 0 ? Math.round(totalAmount / successCount) : 0,
      byChannel,
      byStatus: [...statusMap].map(([status, count]) => ({ status, count })),
      byPayMethod: [...byPayMethodMap].map(([payMethod, v]) => ({ payMethod, ...v })),
      byBizType: [...byBizTypeMap].map(([bizType, v]) => ({ bizType, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    });
  }),

  // ── 收款趋势（Demo 模式生成确定性合成数据，便于图表演示）──
  mock(paymentStatsContract.trend, ({ query, ok }) => {
    const days = query.days ?? 30;
    const data: PaymentTrendPoint[] = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (days - 1 - i));
      const seed = (d.getDate() * 13 + d.getMonth() * 7 + 3) % 17;
      const count = 3 + (seed % 8);
      const amount = count * (3900 + (seed % 5) * 1500);
      const refundAmount = seed % 6 === 0 ? Math.round(amount * 0.12) : 0;
      return { date: mockDate(d), amount, count, refundAmount };
    });
    return ok(data);
  }),

  // ── 渠道配置 ──
  mock(paymentChannelContract.channelsAll, ({ ok }) => ok(mockPaymentChannels)),
  mock(paymentChannelContract.channelOperationLookup, ({ ok }) => ok(
    mockPaymentChannels
      .filter((config) => config.status === 'enabled')
      .map(({ id, name, channel, sandbox }) => ({ id, name, channel, sandbox })),
  )),
  mock(paymentChannelContract.channels, ({ query, ok, paginate }) => {
    const filtered = mockPaymentChannels.filter(
      (c) => (!query.keyword || c.name.includes(query.keyword)) && (!query.channel || c.channel === query.channel) && (!query.status || c.status === query.status),
    );
    return ok(paginate(filtered));
  }),
  mock(paymentChannelContract.channelDetail, ({ params, ok }) => {
    const c = mockPaymentChannels.find((x) => x.id === params.id);
    return c ? ok(c) : notFound('不存在');
  }),
  mock(paymentChannelContract.createChannel, ({ body, ok }) => {
    const now = mockDateTime();
    const item: PaymentChannelConfig = {
      id: getNextPaymentChannelId(),
      name: body.name,
      channel: body.channel,
      status: body.status,
      isDefault: body.isDefault,
      sandbox: body.sandbox,
      notifyUrl: body.notifyUrl ?? null,
      wechatAppId: body.wechatAppId ?? null,
      wechatMchId: body.wechatMchId ?? null,
      wechatSerialNo: body.wechatSerialNo ?? null,
      wechatPlatformCert: body.wechatPlatformCert ?? null,
      hasWechatApiV3Key: Boolean(body.wechatApiV3Key),
      hasWechatPrivateKey: Boolean(body.wechatPrivateKey),
      alipayAppId: body.alipayAppId ?? null,
      alipaySellerId: body.alipaySellerId ?? null,
      alipayPublicKey: body.alipayPublicKey ?? null,
      alipaySignType: body.alipaySignType,
      alipayGateway: body.alipayGateway ?? null,
      hasAlipayPrivateKey: Boolean(body.alipayPrivateKey),
      unionpayMerId: body.unionpayMerId ?? null,
      unionpayCertId: body.unionpayCertId ?? null,
      unionpayPublicKey: body.unionpayPublicKey ?? null,
      unionpayGateway: body.unionpayGateway ?? null,
      hasUnionpayPrivateKey: Boolean(body.unionpayPrivateKey),
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockPaymentChannels.push(item);
    return ok(item, '创建成功');
  }),
  mock(paymentChannelContract.updateChannel, ({ params, body, ok }) => {
    const c = mockPaymentChannels.find((x) => x.id === params.id);
    if (!c) return notFound('不存在');
    const { wechatApiV3Key, wechatPrivateKey, alipayPrivateKey, unionpayPrivateKey, ...fields } = body;
    Object.assign(c, fields, { updatedAt: mockDateTime() });
    if (unionpayPrivateKey) c.hasUnionpayPrivateKey = true;
    if (wechatApiV3Key) c.hasWechatApiV3Key = true;
    if (wechatPrivateKey) c.hasWechatPrivateKey = true;
    if (alipayPrivateKey) c.hasAlipayPrivateKey = true;
    return ok(c, '更新成功');
  }),
  mock(paymentChannelContract.removeChannel, ({ params, ok }) => {
    const i = mockPaymentChannels.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('不存在');
    mockPaymentChannels.splice(i, 1);
    return ok(null, '删除成功');
  }),

  // 渠道连通性测试（Demo 模式模拟 50ms 探测延迟，返回成功）
  mock(paymentChannelContract.testChannel, ({ params, ok }) => {
    const c = mockPaymentChannels.find((x) => x.id === params.id);
    if (!c) return notFound('渠道配置不存在');
    return ok({ success: true, message: '连通性测试通过（演示模式）', latencyMs: 48 }, '操作成功');
  }),

  // 设为默认渠道（同渠道互斥）
  mock(paymentChannelContract.setDefaultChannel, ({ params, ok }) => {
    const target = mockPaymentChannels.find((x) => x.id === params.id);
    if (!target) return notFound('渠道配置不存在');
    const now = mockDateTime();
    for (const c of mockPaymentChannels) {
      if (c.channel === target.channel) c.isDefault = c.id === target.id;
    }
    target.status = 'enabled';
    target.updatedAt = now;
    return ok(target, '已设为默认');
  }),

  // ── 支付订单 ──
  mock(paymentOrderContract.orders, ({ query, ok, paginate }) => {
    const filtered = mockPaymentOrders.filter(
      (o) =>
        (!query.keyword || o.orderNo.includes(query.keyword) || o.subject.includes(query.keyword)) &&
        (!query.channel || o.channel === query.channel) &&
        (!query.status || o.status === query.status) &&
        (!query.bizType || o.bizType === query.bizType) &&
        (!query.payMethod || o.payMethod === query.payMethod) &&
        (query.minAmount == null || o.amount >= query.minAmount) &&
        (query.maxAmount == null || o.amount <= query.maxAmount) &&
        (!query.startTime || o.createdAt >= query.startTime) &&
        (!query.endTime || o.createdAt <= query.endTime),
    );
    return ok(paginate(filtered));
  }),
  mock(paymentOrderContract.createOrder, ({ body, ok }) => {
    const channel = PAYMENT_METHOD_CHANNEL[body.payMethod];
    const expectedConfigId = demoChannelConfigId(body.applicationId);
    if (!expectedConfigId || mockPaymentChannels.find((config) => config.id === expectedConfigId)?.channel !== channel) {
      return badRequest('支付应用未绑定所选支付方式对应的商户配置');
    }
    const orderNo = `PAY${Date.now()}`;
    const now = mockDateTime();
    const order: PaymentOrder = {
      id: getNextPaymentOrderId(), orderNo, outTradeNo: orderNo, channelTradeNo: null, bizType: body.bizType, bizId: body.bizId,
      subject: body.subject, body: body.body ?? null, amount: body.amount, currency: body.currency, channel, channelConfigId: expectedConfigId, appId: body.applicationId,
      payMethod: body.payMethod, status: 'paying', userId: body.userId ?? 1, openId: body.openId ?? null, clientIp: '127.0.0.1', departmentId: null,
      paidAmount: null, feeAmount: null, netAmount: null, paidAt: null, expiredAt: mockDateTimeOffset(body.expireMinutes * 60 * 1000), errorMessage: null, version: 0, createdAt: now, updatedAt: now,
    };
    mockPaymentOrders.unshift(order);
    const payParams = {
      orderNo,
      channel,
      payMethod: body.payMethod,
      codeUrl: channel === 'wechat' ? `weixin://wxpay/bizpayurl?pr=${orderNo}` : undefined,
      payUrl: channel === 'alipay' ? `https://openapi.alipaydev.com/gateway.do?out_trade_no=${orderNo}` : undefined,
    };
    return ok({ orderNo, payParams }, '下单成功');
  }),
  mock(paymentOrderContract.orderByNo, ({ params, ok }) => {
    const o = mockPaymentOrders.find((x) => x.orderNo === params.orderNo);
    return o ? ok(o) : notFound('不存在');
  }),
  mock(paymentOrderContract.orderDetail, ({ params, ok }) => {
    const o = mockPaymentOrders.find((x) => x.id === params.id);
    return o ? ok(o) : notFound('不存在');
  }),
  mock(paymentRefundContract.orderRefunds, ({ params, ok }) => {
    const order = mockPaymentOrders.find((x) => x.id === params.id);
    if (!order) return notFound('订单不存在');
    const refunds = mockPaymentRefunds.filter((r) => r.orderId === order.id).sort((a, b) => b.id - a.id);
    return ok(refunds);
  }),
  mock(paymentOrderContract.queryOrder, ({ params, ok }) => {
    const o = mockPaymentOrders.find((x) => x.id === params.id);
    if (!o) return notFound('不存在');
    if (o.status === 'paying') {
      o.status = 'success';
      o.paidAmount = o.amount;
      o.paidAt = mockDateTime();
      o.version += 1;
      o.updatedAt = mockDateTime();
      recordMockPaymentSucceeded(o);
    }
    return ok(o, '已同步');
  }),
  mock(paymentOrderContract.closeOrder, ({ params, ok }) => {
    const o = mockPaymentOrders.find((x) => x.id === params.id);
    if (!o) return notFound('不存在');
    o.status = 'closed';
    o.version += 1;
    o.updatedAt = mockDateTime();
    return ok(null, '订单已关闭');
  }),

  // ── 退款 ──
  mock(paymentRefundContract.createRefund, ({ headers, body, ok }) => {
    const idempotencyKey = headers['x-idempotency-key'];
    const order = mockPaymentOrders.find((o) => o.orderNo === body.orderNo);
    if (!order) return notFound('订单不存在');
    const cacheKey = `${order.orderNo}:${idempotencyKey}`;
    const requestHash = refundRequestHash(body);
    const existing = refundIdempotencyRecords.get(cacheKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return conflict('该幂等键已用于不同的退款请求', { status: 409 });
      }
      return ok(existing.result, '退款已发起');
    }
    const refundNo = `REF${Date.now()}`;
    const now = mockDateTime();
    const refund: PaymentRefund = {
      id: getNextPaymentRefundId(), refundNo, outRefundNo: refundNo, orderNo: order.orderNo, orderId: order.id, channelRefundNo: `5000${Date.now()}`,
      channel: order.channel, refundAmount: body.refundAmount, totalAmount: order.amount, reason: body.reason ?? null, status: 'success', approvalStatus: 'none',
      operatorId: 1, refundedAt: now, errorMessage: null, version: 0, createdAt: now, updatedAt: now,
    };
    mockPaymentRefunds.unshift(refund);
    order.status = body.refundAmount >= order.amount ? 'refunded' : 'success';
    order.version += 1;
    order.updatedAt = now;
    recordMockRefundSucceeded(refund);
    const result = { refundNo, status: refund.status };
    refundIdempotencyRecords.set(cacheKey, { requestHash, result });
    return ok(result, '退款已发起');
  }),
  mock(paymentRefundContract.refunds, ({ query, ok, paginate }) => {
    const filtered = mockPaymentRefunds.filter(
      (r) =>
        (!query.keyword || r.refundNo.includes(query.keyword) || r.orderNo.includes(query.keyword)) &&
        (!query.channel || r.channel === query.channel) &&
        (!query.status || r.status === query.status) &&
        (!query.approvalStatus || r.approvalStatus === query.approvalStatus) &&
        (!query.startTime || r.createdAt >= query.startTime) &&
        (!query.endTime || r.createdAt <= query.endTime),
    );
    return ok(paginate(filtered));
  }),
  // 退款查单同步（Demo 模式将处理中退款置为成功）
  mock(paymentRefundContract.queryRefund, ({ params, ok }) => {
    const r = mockPaymentRefunds.find((x) => x.id === params.id);
    if (!r) return notFound('退款记录不存在');
    if (r.status === 'processing' || r.status === 'pending') {
      r.status = 'success';
      r.refundedAt = mockDateTime();
      r.version += 1;
      r.updatedAt = mockDateTime();
      const order = mockPaymentOrders.find((o) => o.orderNo === r.orderNo);
      if (order) {
        order.status = r.refundAmount >= order.amount ? 'refunded' : 'success';
        order.version += 1;
      }
      recordMockRefundSucceeded(r);
    }
    return ok(r, '已同步');
  }),
  mock(paymentRefundContract.refundDetail, ({ params, ok }) => {
    const r = mockPaymentRefunds.find((x) => x.id === params.id);
    return r ? ok(r) : notFound('不存在');
  }),
  // ── 回调日志 ──
  mock(paymentNotifyLogContract.logs, ({ query, ok, paginate }) => {
    const filtered = mockPaymentLogs.filter(
      (l) =>
        (!query.keyword || (l.orderNo ?? '').includes(query.keyword)) &&
        (!query.channel || l.channel === query.channel) &&
        (!query.scene || l.scene === query.scene) &&
        (query.signatureValid == null || l.signatureValid === query.signatureValid) &&
        (!query.startTime || l.createdAt >= query.startTime) &&
        (!query.endTime || l.createdAt <= query.endTime),
    );
    return ok(paginate(filtered));
  }),
];
