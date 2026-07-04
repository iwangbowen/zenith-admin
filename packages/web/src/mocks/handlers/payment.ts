import { http, HttpResponse } from 'msw';
import {
  mockPaymentChannels,
  getNextPaymentChannelId,
  mockPaymentOrders,
  getNextPaymentOrderId,
  mockPaymentRefunds,
  getNextPaymentRefundId,
  mockPaymentLogs,
} from '@/mocks/data/payment';
import { mockDateTime, mockDateTimeOffset, mockDate } from '@/mocks/utils/date';
import { paginate } from '@/mocks/utils/handlers';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared';
import type { PaymentChannelConfig, PaymentMethod, PaymentOrder, PaymentRefund } from '@zenith/shared';
import { recordMockPaymentSucceeded, recordMockRefundSucceeded } from './payment-ext';

export const paymentHandlers = [
  // ── 统计 ──
  http.get('/api/payment/stats', () => {
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
    const round1 = (n: number) => Math.round(n * 10) / 10;
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
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
      },
    });
  }),

  // ── 收款趋势（Demo 模式生成确定性合成数据，便于图表演示）──
  http.get('/api/payment/trend', ({ request }) => {
    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
    const data = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (days - 1 - i));
      const seed = (d.getDate() * 13 + d.getMonth() * 7 + 3) % 17;
      const count = 3 + (seed % 8);
      const amount = count * (3900 + (seed % 5) * 1500);
      const refundAmount = seed % 6 === 0 ? Math.round(amount * 0.12) : 0;
      return { date: mockDate(d), amount, count, refundAmount };
    });
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // ── 渠道配置 ──
  http.get('/api/payment/channels/all', () => HttpResponse.json({ code: 0, message: 'ok', data: mockPaymentChannels })),
  http.get('/api/payment/channels', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = mockPaymentChannels.filter(
      (c) => (!keyword || c.name.includes(keyword)) && (!channel || c.channel === channel) && (!status || c.status === status),
    );
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(filtered, url) });
  }),
  http.get('/api/payment/channels/:id', ({ params }) => {
    const c = mockPaymentChannels.find((x) => x.id === Number(params.id));
    return c ? HttpResponse.json({ code: 0, message: 'ok', data: c }) : HttpResponse.json({ code: 404, message: '不存在', data: null });
  }),
  http.post('/api/payment/channels', async ({ request }) => {
    const body = (await request.json()) as Partial<PaymentChannelConfig> & { wechatApiV3Key?: string; wechatPrivateKey?: string; alipayPrivateKey?: string; unionpayPrivateKey?: string };
    const now = mockDateTime();
    const item: PaymentChannelConfig = {
      id: getNextPaymentChannelId(),
      name: body.name ?? '',
      channel: body.channel ?? 'wechat',
      status: body.status ?? 'enabled',
      isDefault: body.isDefault ?? false,
      sandbox: body.sandbox ?? false,
      notifyUrl: body.notifyUrl ?? null,
      wechatAppId: body.wechatAppId ?? null,
      wechatMchId: body.wechatMchId ?? null,
      wechatSerialNo: body.wechatSerialNo ?? null,
      wechatPlatformCert: body.wechatPlatformCert ?? null,
      hasWechatApiV3Key: Boolean(body.wechatApiV3Key),
      hasWechatPrivateKey: Boolean(body.wechatPrivateKey),
      alipayAppId: body.alipayAppId ?? null,
      alipayPublicKey: body.alipayPublicKey ?? null,
      alipaySignType: body.alipaySignType ?? 'RSA2',
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
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),
  http.put('/api/payment/channels/:id', async ({ params, request }) => {
    const c = mockPaymentChannels.find((x) => x.id === Number(params.id));
    if (!c) return HttpResponse.json({ code: 404, message: '不存在', data: null });
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(c, body, { updatedAt: mockDateTime() });
    if (body.unionpayPrivateKey) c.hasUnionpayPrivateKey = true;
    if (body.wechatApiV3Key) c.hasWechatApiV3Key = true;
    if (body.wechatPrivateKey) c.hasWechatPrivateKey = true;
    if (body.alipayPrivateKey) c.hasAlipayPrivateKey = true;
    return HttpResponse.json({ code: 0, message: '更新成功', data: c });
  }),
  http.delete('/api/payment/channels/:id', ({ params }) => {
    const i = mockPaymentChannels.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null });
    mockPaymentChannels.splice(i, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 渠道连通性测试（Demo 模式模拟 50ms 探测延迟，返回成功）
  http.post('/api/payment/channels/:id/test', ({ params }) => {
    const c = mockPaymentChannels.find((x) => x.id === Number(params.id));
    if (!c) return HttpResponse.json({ code: 404, message: '渠道配置不存在', data: null });
    return HttpResponse.json({ code: 0, message: '操作成功', data: { success: true, message: '连通性测试通过（演示模式）', latencyMs: 48 } });
  }),

  // 设为默认渠道（同渠道互斥）
  http.post('/api/payment/channels/:id/default', ({ params }) => {
    const target = mockPaymentChannels.find((x) => x.id === Number(params.id));
    if (!target) return HttpResponse.json({ code: 404, message: '渠道配置不存在', data: null });
    const now = mockDateTime();
    for (const c of mockPaymentChannels) {
      if (c.channel === target.channel) c.isDefault = c.id === target.id;
    }
    target.status = 'enabled';
    target.updatedAt = now;
    return HttpResponse.json({ code: 0, message: '已设为默认', data: target });
  }),

  // ── 支付订单 ──
  http.get('/api/payment/orders', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const bizType = url.searchParams.get('bizType') ?? '';
    const payMethod = url.searchParams.get('payMethod') ?? '';
    const minAmount = url.searchParams.get('minAmount');
    const maxAmount = url.searchParams.get('maxAmount');
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    const filtered = mockPaymentOrders.filter(
      (o) =>
        (!keyword || o.orderNo.includes(keyword) || o.subject.includes(keyword)) &&
        (!channel || o.channel === channel) &&
        (!status || o.status === status) &&
        (!bizType || o.bizType === bizType) &&
        (!payMethod || o.payMethod === payMethod) &&
        (minAmount == null || o.amount >= Number(minAmount)) &&
        (maxAmount == null || o.amount <= Number(maxAmount)) &&
        (!startTime || o.createdAt >= startTime) &&
        (!endTime || o.createdAt <= endTime),
    );
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(filtered, url) });
  }),
  http.post('/api/payment/orders', async ({ request }) => {
    const body = (await request.json()) as { bizType: string; bizId: string; subject: string; amount: number; payMethod: PaymentMethod; openId?: string };
    const channel = PAYMENT_METHOD_CHANNEL[body.payMethod];
    const orderNo = `PAY${Date.now()}`;
    const now = mockDateTime();
    const order: PaymentOrder = {
      id: getNextPaymentOrderId(), orderNo, outTradeNo: orderNo, channelTradeNo: null, bizType: body.bizType, bizId: body.bizId,
      subject: body.subject, body: null, amount: body.amount, currency: 'CNY', channel, channelConfigId: channel === 'wechat' ? 1 : 2,
      payMethod: body.payMethod, status: 'paying', userId: 1, openId: body.openId ?? null, clientIp: '127.0.0.1', departmentId: null,
      paidAmount: null, paidAt: null, expiredAt: mockDateTimeOffset(30 * 60 * 1000), errorMessage: null, createdAt: now, updatedAt: now,
    };
    mockPaymentOrders.unshift(order);
    const payParams = {
      orderNo,
      channel,
      payMethod: body.payMethod,
      codeUrl: channel === 'wechat' ? `weixin://wxpay/bizpayurl?pr=${orderNo}` : undefined,
      payUrl: channel === 'alipay' ? `https://openapi.alipaydev.com/gateway.do?out_trade_no=${orderNo}` : undefined,
    };
    return HttpResponse.json({ code: 0, message: '下单成功', data: { orderNo, payParams } });
  }),
  http.get('/api/payment/orders/by-no/:orderNo', ({ params }) => {
    const o = mockPaymentOrders.find((x) => x.orderNo === String(params.orderNo));
    return o ? HttpResponse.json({ code: 0, message: 'ok', data: o }) : HttpResponse.json({ code: 404, message: '不存在', data: null });
  }),
  http.get('/api/payment/orders/:id', ({ params }) => {
    const o = mockPaymentOrders.find((x) => x.id === Number(params.id));
    return o ? HttpResponse.json({ code: 0, message: 'ok', data: o }) : HttpResponse.json({ code: 404, message: '不存在', data: null });
  }),
  http.get('/api/payment/orders/:id/refunds', ({ params }) => {
    const order = mockPaymentOrders.find((x) => x.id === Number(params.id));
    if (!order) return HttpResponse.json({ code: 404, message: '订单不存在', data: null });
    const refunds = mockPaymentRefunds.filter((r) => r.orderId === order.id).sort((a, b) => b.id - a.id);
    return HttpResponse.json({ code: 0, message: 'ok', data: refunds });
  }),
  http.post('/api/payment/orders/:id/query', ({ params }) => {
    const o = mockPaymentOrders.find((x) => x.id === Number(params.id));
    if (!o) return HttpResponse.json({ code: 404, message: '不存在', data: null });
    if (o.status === 'paying') {
      o.status = 'success';
      o.paidAmount = o.amount;
      o.paidAt = mockDateTime();
      o.updatedAt = mockDateTime();
      recordMockPaymentSucceeded(o);
    }
    return HttpResponse.json({ code: 0, message: '已同步', data: o });
  }),
  http.post('/api/payment/orders/:id/close', ({ params }) => {
    const o = mockPaymentOrders.find((x) => x.id === Number(params.id));
    if (!o) return HttpResponse.json({ code: 404, message: '不存在', data: null });
    o.status = 'closed';
    o.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '订单已关闭', data: null });
  }),

  // ── 退款 ──
  http.post('/api/payment/refunds', async ({ request }) => {
    const body = (await request.json()) as { orderNo: string; refundAmount: number; reason?: string };
    const order = mockPaymentOrders.find((o) => o.orderNo === body.orderNo);
    if (!order) return HttpResponse.json({ code: 404, message: '订单不存在', data: null });
    const refundNo = `REF${Date.now()}`;
    const now = mockDateTime();
    const refund: PaymentRefund = {
      id: getNextPaymentRefundId(), refundNo, outRefundNo: refundNo, orderNo: order.orderNo, orderId: order.id, channelRefundNo: `5000${Date.now()}`,
      channel: order.channel, refundAmount: body.refundAmount, totalAmount: order.amount, reason: body.reason ?? null, status: 'success', approvalStatus: 'none',
      operatorId: 1, refundedAt: now, errorMessage: null, createdAt: now, updatedAt: now,
    };
    mockPaymentRefunds.unshift(refund);
    order.status = body.refundAmount >= order.amount ? 'refunded' : 'success';
    order.updatedAt = now;
    recordMockRefundSucceeded(refund);
    return HttpResponse.json({ code: 0, message: '退款已发起', data: { refundNo, status: 'success' } });
  }),
  http.get('/api/payment/refunds', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    const filtered = mockPaymentRefunds.filter(
      (r) =>
        (!keyword || r.refundNo.includes(keyword) || r.orderNo.includes(keyword)) &&
        (!channel || r.channel === channel) &&
        (!status || r.status === status) &&
        (!startTime || r.createdAt >= startTime) &&
        (!endTime || r.createdAt <= endTime),
    );
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(filtered, url) });
  }),
  // 退款查单同步（Demo 模式将处理中退款置为成功）
  http.post('/api/payment/refunds/:id/query', ({ params }) => {
    const r = mockPaymentRefunds.find((x) => x.id === Number(params.id));
    if (!r) return HttpResponse.json({ code: 404, message: '退款记录不存在', data: null });
    if (r.status === 'processing' || r.status === 'pending') {
      r.status = 'success';
      r.refundedAt = mockDateTime();
      r.updatedAt = mockDateTime();
      const order = mockPaymentOrders.find((o) => o.orderNo === r.orderNo);
      if (order) order.status = r.refundAmount >= order.amount ? 'refunded' : 'success';
      recordMockRefundSucceeded(r);
    }
    return HttpResponse.json({ code: 0, message: '已同步', data: r });
  }),
  http.get('/api/payment/refunds/:id', ({ params }) => {
    const r = mockPaymentRefunds.find((x) => x.id === Number(params.id));
    return r ? HttpResponse.json({ code: 0, message: 'ok', data: r }) : HttpResponse.json({ code: 404, message: '不存在', data: null });
  }),

  // ── 回调日志 ──
  http.get('/api/payment/logs', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const scene = url.searchParams.get('scene') ?? '';
    const signatureValid = url.searchParams.get('signatureValid');
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    const filtered = mockPaymentLogs.filter(
      (l) =>
        (!keyword || (l.orderNo ?? '').includes(keyword)) &&
        (!channel || l.channel === channel) &&
        (!scene || l.scene === scene) &&
        (signatureValid == null || l.signatureValid === (signatureValid === 'true')) &&
        (!startTime || l.createdAt >= startTime) &&
        (!endTime || l.createdAt <= endTime),
    );
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(filtered, url) });
  }),
];
