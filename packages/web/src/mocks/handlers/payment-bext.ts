import { http, HttpResponse } from 'msw';
import { PAYMENT_MOCK_SEED_TIME, getNextPaymentOrderId, mockPaymentOrders } from '@/mocks/data/payment';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_CHANNEL, SEED_PAYMENT_METHOD_CONFIGS } from '@zenith/shared';
import type {
  CreatePaymentResult,
  PaymentChannel,
  PaymentFeeRule,
  PaymentLink,
  PaymentLinkPublic,
  PaymentLinkStatus,
  PaymentMethod,
  PaymentMethodConfig,
  PaymentReportGroupBy,
  PaymentReportRow,
  PaymentRiskRule,
  PaymentSettlementBatch,
  PaymentSettlementStatus,
  PaymentSharingOrder,
  PaymentSharingReceiver,
} from '@zenith/shared';

const SEED = PAYMENT_MOCK_SEED_TIME;
const ok = (data: unknown, message = 'ok') => HttpResponse.json({ code: 0, message, data });
const notFound = (message = '不存在') => HttpResponse.json({ code: 404, message, data: null });
const badRequest = (message: string) => HttpResponse.json({ code: 400, message, data: null });

function paginate<T>(list: T[], url: URL) {
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize };
}

// ─── 费率规则 ─────────────────────────────────────────────────────────────────
const feeRules: PaymentFeeRule[] = [
  { id: 1, name: '微信标准费率', channel: 'wechat', payMethod: null, rateBps: 60, fixedFee: 0, minFee: null, maxFee: null, status: 'enabled', priority: 10, remark: '0.6%', createdAt: SEED, updatedAt: SEED },
  { id: 2, name: '支付宝标准费率', channel: 'alipay', payMethod: null, rateBps: 55, fixedFee: 0, minFee: null, maxFee: 5000, status: 'enabled', priority: 10, remark: '0.55%，封顶 50 元', createdAt: SEED, updatedAt: SEED },
];
let nextFeeId = 3;

const feeHandlers = [
  http.get('/api/payment/fee-rules', ({ request }) => {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = feeRules.filter((r) => (!channel || r.channel === channel) && (!status || r.status === status));
    return ok(paginate([...filtered].sort((a, b) => b.priority - a.priority), url));
  }),
  http.get('/api/payment/fee-rules/:id', ({ params }) => {
    const r = feeRules.find((x) => x.id === Number(params.id));
    return r ? ok(r) : notFound('费率规则不存在');
  }),
  http.post('/api/payment/fee-rules', async ({ request }) => {
    const b = (await request.json()) as Partial<PaymentFeeRule>;
    const now = mockDateTime();
    const item: PaymentFeeRule = {
      id: nextFeeId++, name: b.name ?? '', channel: (b.channel as PaymentChannel) ?? 'wechat', payMethod: (b.payMethod as PaymentMethod) ?? null,
      rateBps: b.rateBps ?? 0, fixedFee: b.fixedFee ?? 0, minFee: b.minFee ?? null, maxFee: b.maxFee ?? null,
      status: b.status ?? 'enabled', priority: b.priority ?? 0, remark: b.remark ?? null, createdAt: now, updatedAt: now,
    };
    feeRules.push(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/payment/fee-rules/:id', async ({ params, request }) => {
    const r = feeRules.find((x) => x.id === Number(params.id));
    if (!r) return notFound('费率规则不存在');
    const b = (await request.json()) as Partial<PaymentFeeRule>;
    Object.assign(r, b, { updatedAt: mockDateTime() });
    return ok(r, '更新成功');
  }),
  http.delete('/api/payment/fee-rules/:id', ({ params }) => {
    const i = feeRules.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('费率规则不存在');
    feeRules.splice(i, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 结算批次 ─────────────────────────────────────────────────────────────────
const settlements: PaymentSettlementBatch[] = [
  { id: 1, batchNo: 'SETTLE1700000000001', channel: 'wechat', periodStart: '2024-01-01', periodEnd: '2024-01-07', status: 'settled', orderCount: 12, grossAmount: 158800, feeAmount: 953, refundAmount: 1900, netAmount: 155947, settledAt: SEED, remark: '首周结算', createdAt: SEED, updatedAt: SEED },
  { id: 2, batchNo: 'SETTLE1700000000002', channel: 'alipay', periodStart: '2024-01-08', periodEnd: '2024-01-14', status: 'pending', orderCount: 8, grossAmount: 88800, feeAmount: 488, refundAmount: 0, netAmount: 88312, settledAt: null, remark: null, createdAt: SEED, updatedAt: SEED },
];
let nextSettlementId = 3;
const TRANSITIONS: Record<PaymentSettlementStatus, PaymentSettlementStatus[]> = { pending: ['settling', 'failed'], settling: ['settled', 'failed'], settled: [], failed: [] };

const settlementHandlers = [
  http.get('/api/payment/settlements', ({ request }) => {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = settlements.filter((s) => (!channel || s.channel === channel) && (!status || s.status === status));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.get('/api/payment/settlements/:id', ({ params }) => {
    const s = settlements.find((x) => x.id === Number(params.id));
    return s ? ok(s) : notFound('结算批次不存在');
  }),
  http.post('/api/payment/settlements/generate', async ({ request }) => {
    const b = (await request.json()) as { channel: PaymentChannel; periodStart: string; periodEnd: string; remark?: string };
    const paid = mockPaymentOrders.filter((o) => o.channel === b.channel && (o.status === 'success' || o.status === 'refunding' || o.status === 'refunded'));
    const gross = paid.reduce((s, o) => s + (o.paidAmount ?? o.amount), 0);
    const fee = Math.round(gross * 0.006);
    const item: PaymentSettlementBatch = {
      id: nextSettlementId++, batchNo: `SETTLE${Date.now()}`, channel: b.channel, periodStart: b.periodStart, periodEnd: b.periodEnd,
      status: 'pending', orderCount: paid.length, grossAmount: gross, feeAmount: fee, refundAmount: 0, netAmount: gross - fee,
      settledAt: null, remark: b.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    settlements.push(item);
    return ok(item, '生成成功');
  }),
  http.post('/api/payment/settlements/:id/status', async ({ params, request }) => {
    const s = settlements.find((x) => x.id === Number(params.id));
    if (!s) return notFound('结算批次不存在');
    const { status } = (await request.json()) as { status: PaymentSettlementStatus };
    if (!TRANSITIONS[s.status].includes(status)) return badRequest(`不允许从「${s.status}」流转到「${status}」`);
    s.status = status;
    if (status === 'settled') s.settledAt = mockDateTime();
    s.updatedAt = mockDateTime();
    return ok(s, '操作成功');
  }),
  http.delete('/api/payment/settlements/:id', ({ params }) => {
    const i = settlements.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('结算批次不存在');
    if (settlements[i].status === 'settling') return badRequest('结算中批次不可删除');
    settlements.splice(i, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 分账（接收方 + 分账单）────────────────────────────────────────────────────
const receivers: PaymentSharingReceiver[] = [
  { id: 1, name: '合作商户 A', receiverType: 'merchant', account: '1600000001', ratioBps: 1000, status: 'enabled', remark: '10% 分成', createdAt: SEED, updatedAt: SEED },
  { id: 2, name: '推广个人 B', receiverType: 'personal', account: 'oXYZ888', ratioBps: 500, status: 'enabled', remark: '5% 分成', createdAt: SEED, updatedAt: SEED },
];
let nextReceiverId = 3;
const sharingOrders: PaymentSharingOrder[] = [
  { id: 1, sharingNo: 'SHR1700000000001', orderNo: 'PAY1700000000001', receiverId: 1, receiverName: '合作商户 A', amount: 990, status: 'success', channelSharingNo: 'WXSHARE202401010001', finishedAt: SEED, remark: null, createdAt: SEED, updatedAt: SEED },
];
let nextSharingOrderId = 2;

const sharingHandlers = [
  http.get('/api/payment/sharing/receivers', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = receivers.filter((r) => (!keyword || r.name.includes(keyword)) && (!status || r.status === status));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.get('/api/payment/sharing/receivers/:id', ({ params }) => {
    const r = receivers.find((x) => x.id === Number(params.id));
    return r ? ok(r) : notFound('分账接收方不存在');
  }),
  http.post('/api/payment/sharing/receivers', async ({ request }) => {
    const b = (await request.json()) as Partial<PaymentSharingReceiver>;
    const now = mockDateTime();
    const item: PaymentSharingReceiver = {
      id: nextReceiverId++, name: b.name ?? '', receiverType: b.receiverType ?? 'merchant', account: b.account ?? '',
      ratioBps: b.ratioBps ?? null, status: b.status ?? 'enabled', remark: b.remark ?? null, createdAt: now, updatedAt: now,
    };
    receivers.push(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/payment/sharing/receivers/:id', async ({ params, request }) => {
    const r = receivers.find((x) => x.id === Number(params.id));
    if (!r) return notFound('分账接收方不存在');
    const b = (await request.json()) as Partial<PaymentSharingReceiver>;
    Object.assign(r, b, { updatedAt: mockDateTime() });
    return ok(r, '更新成功');
  }),
  http.delete('/api/payment/sharing/receivers/:id', ({ params }) => {
    const i = receivers.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('分账接收方不存在');
    receivers.splice(i, 1);
    return ok(null, '删除成功');
  }),
  http.get('/api/payment/sharing/orders', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = sharingOrders.filter((o) => (!keyword || o.orderNo.includes(keyword)) && (!status || o.status === status));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.post('/api/payment/sharing/orders', async ({ request }) => {
    const b = (await request.json()) as { orderNo: string; receiverId: number; amount?: number; remark?: string };
    const order = mockPaymentOrders.find((o) => o.orderNo === b.orderNo);
    if (!order) return notFound('支付订单不存在');
    if (!['success', 'refunding', 'refunded'].includes(order.status)) return badRequest('仅支付成功的订单可发起分账');
    const receiver = receivers.find((r) => r.id === b.receiverId);
    if (!receiver) return notFound('分账接收方不存在');
    if (receiver.status !== 'enabled') return badRequest('分账接收方已停用');
    const paid = order.paidAmount ?? order.amount;
    const amount = b.amount ?? (receiver.ratioBps != null ? Math.round((paid * receiver.ratioBps) / 10000) : 0);
    if (amount <= 0) return badRequest('分账金额必须大于 0');
    if (amount > paid) return badRequest('分账金额不能超过订单实付金额');
    const now = mockDateTime();
    const item: PaymentSharingOrder = {
      id: nextSharingOrderId++, sharingNo: `SHR${Date.now()}`, orderNo: b.orderNo, receiverId: receiver.id, receiverName: receiver.name,
      amount, status: 'success', channelSharingNo: `WXSHARE${Date.now()}`, finishedAt: now, remark: b.remark ?? null, createdAt: now, updatedAt: now,
    };
    sharingOrders.push(item);
    return ok(item, '分账已发起');
  }),
];

// ─── 支付链接 ─────────────────────────────────────────────────────────────────
const links: PaymentLink[] = [
  { id: 1, linkNo: 'LINK1700000000001', token: 'demotoken0000000000000000000001', subject: '会员年费收款', amount: 9900, payMethod: 'wechat_native', bizType: 'membership', maxUses: null, usedCount: 3, expiredAt: null, status: 'active', remark: '演示固定金额链接', createdAt: SEED, updatedAt: SEED },
  { id: 2, linkNo: 'LINK1700000000002', token: 'demotoken0000000000000000000002', subject: '自由打赏', amount: null, payMethod: null, bizType: 'general', maxUses: 100, usedCount: 12, expiredAt: null, status: 'active', remark: '用户自填金额', createdAt: SEED, updatedAt: SEED },
];
let nextLinkId = 3;
let nextLinkToken = 3;

function computeLinkStatus(l: PaymentLink): PaymentLinkStatus {
  if (l.status === 'disabled') return 'disabled';
  if (l.expiredAt && new Date(l.expiredAt).getTime() < Date.now()) return 'expired';
  if (l.maxUses != null && l.usedCount >= l.maxUses) return 'expired';
  return 'active';
}

const linkHandlers = [
  http.get('/api/payment/links', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = links.filter((l) => (!keyword || l.subject.includes(keyword)) && (!status || l.status === status));
    return ok(paginate([...filtered].reverse().map((l) => ({ ...l, status: computeLinkStatus(l) })), url));
  }),
  http.get('/api/payment/links/:id', ({ params }) => {
    const l = links.find((x) => x.id === Number(params.id));
    return l ? ok({ ...l, status: computeLinkStatus(l) }) : notFound('支付链接不存在');
  }),
  http.post('/api/payment/links', async ({ request }) => {
    const b = (await request.json()) as Partial<PaymentLink>;
    const now = mockDateTime();
    const item: PaymentLink = {
      id: nextLinkId++, linkNo: `LINK${Date.now()}`, token: `demotoken${String(nextLinkToken++).padStart(23, '0')}`,
      subject: b.subject ?? '', amount: b.amount ?? null, payMethod: (b.payMethod as PaymentMethod) ?? null, bizType: b.bizType ?? 'general',
      maxUses: b.maxUses ?? null, usedCount: 0, expiredAt: b.expiredAt ?? null, status: b.status === 'disabled' ? 'disabled' : 'active',
      remark: b.remark ?? null, createdAt: now, updatedAt: now,
    };
    links.push(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/payment/links/:id', async ({ params, request }) => {
    const l = links.find((x) => x.id === Number(params.id));
    if (!l) return notFound('支付链接不存在');
    const b = (await request.json()) as Partial<PaymentLink>;
    Object.assign(l, b, { updatedAt: mockDateTime() });
    return ok({ ...l, status: computeLinkStatus(l) }, '更新成功');
  }),
  http.delete('/api/payment/links/:id', ({ params }) => {
    const i = links.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('支付链接不存在');
    links.splice(i, 1);
    return ok(null, '删除成功');
  }),
  http.get('/api/public/payment/link/:token', ({ params }) => {
    const l = links.find((x) => x.token === String(params.token));
    if (!l) return notFound('支付链接不存在或已删除');
    const data: PaymentLinkPublic = {
      token: l.token,
      subject: l.subject,
      amount: l.amount,
      payMethod: l.payMethod,
      bizType: l.bizType,
      status: computeLinkStatus(l),
      expiredAt: l.expiredAt,
      remainingUses: l.maxUses != null ? Math.max(0, l.maxUses - l.usedCount) : null,
    };
    return ok(data);
  }),
  http.post('/api/public/payment/link/:token/pay', async ({ params, request }) => {
    const l = links.find((x) => x.token === String(params.token));
    if (!l) return notFound('支付链接不存在或已删除');
    const status = computeLinkStatus(l);
    if (status === 'disabled') return badRequest('该支付链接已停用');
    if (status === 'expired') return badRequest('该支付链接已过期或已达使用上限');
    const body = (await request.json()) as { amount?: number; payMethod?: PaymentMethod; openId?: string };
    const amount = l.amount ?? body.amount;
    if (!amount || amount <= 0) return badRequest('请输入有效的支付金额');
    const payMethod = l.payMethod ?? body.payMethod;
    if (!payMethod) return badRequest('请选择支付方式');
    if (!['wechat_native', 'wechat_h5', 'alipay_page', 'alipay_wap'].includes(payMethod)) return badRequest('该支付方式暂不支持在公开收款页发起');
    if (l.maxUses != null && l.usedCount >= l.maxUses) return badRequest('该支付链接已过期或已达使用上限');
    l.usedCount += 1;
    l.updatedAt = mockDateTime();
    const channel = PAYMENT_METHOD_CHANNEL[payMethod];
    const orderNo = `PAY${Date.now()}`;
    const now = mockDateTime();
    mockPaymentOrders.unshift({
      id: getNextPaymentOrderId(), orderNo, outTradeNo: orderNo, channelTradeNo: null, bizType: l.bizType, bizId: l.linkNo,
      subject: l.subject, body: null, amount, currency: 'CNY', channel, channelConfigId: channel === 'wechat' ? 1 : 2,
      payMethod, status: 'paying', userId: null, openId: body.openId ?? null, clientIp: '127.0.0.1', departmentId: null,
      paidAmount: null, paidAt: null, expiredAt: mockDateTimeOffset(30 * 60 * 1000), errorMessage: null, createdAt: now, updatedAt: now,
    });
    const payParams: CreatePaymentResult = {
      orderNo,
      channel,
      payMethod,
      codeUrl: channel === 'wechat' ? `weixin://wxpay/bizpayurl?pr=${orderNo}` : undefined,
      payUrl: channel === 'alipay' ? `https://openapi.alipaydev.com/gateway.do?out_trade_no=${orderNo}` : undefined,
    };
    return ok({ orderNo, payParams }, '下单成功');
  }),
];

// ─── 风控规则 ─────────────────────────────────────────────────────────────────
const riskRules: PaymentRiskRule[] = [
  { id: 1, name: '单笔大额拦截', scope: 'global', channel: null, bizType: null, singleLimit: 5000000, dailyLimit: null, dailyCountLimit: null, blocklist: [], status: 'enabled', remark: '单笔不超过 5 万元', createdAt: SEED, updatedAt: SEED },
  { id: 2, name: '会员业务限频', scope: 'bizType', channel: null, bizType: 'membership', singleLimit: null, dailyLimit: 2000000, dailyCountLimit: 50, blocklist: ['oBLOCK001'], status: 'enabled', remark: null, createdAt: SEED, updatedAt: SEED },
];
let nextRiskId = 3;

const riskHandlers = [
  http.get('/api/payment/risk-rules', ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = riskRules.filter((r) => (!scope || r.scope === scope) && (!status || r.status === status));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.get('/api/payment/risk-rules/:id', ({ params }) => {
    const r = riskRules.find((x) => x.id === Number(params.id));
    return r ? ok(r) : notFound('风控规则不存在');
  }),
  http.post('/api/payment/risk-rules', async ({ request }) => {
    const b = (await request.json()) as Partial<PaymentRiskRule>;
    const now = mockDateTime();
    const item: PaymentRiskRule = {
      id: nextRiskId++, name: b.name ?? '', scope: b.scope ?? 'global', channel: (b.channel as PaymentChannel) ?? null, bizType: b.bizType ?? null,
      singleLimit: b.singleLimit ?? null, dailyLimit: b.dailyLimit ?? null, dailyCountLimit: b.dailyCountLimit ?? null, blocklist: b.blocklist ?? [],
      status: b.status ?? 'enabled', remark: b.remark ?? null, createdAt: now, updatedAt: now,
    };
    riskRules.push(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/payment/risk-rules/:id', async ({ params, request }) => {
    const r = riskRules.find((x) => x.id === Number(params.id));
    if (!r) return notFound('风控规则不存在');
    const b = (await request.json()) as Partial<PaymentRiskRule>;
    Object.assign(r, b, { updatedAt: mockDateTime() });
    return ok(r, '更新成功');
  }),
  http.delete('/api/payment/risk-rules/:id', ({ params }) => {
    const i = riskRules.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('风控规则不存在');
    riskRules.splice(i, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 支付方式配置 ─────────────────────────────────────────────────────────────
const methodConfigs: PaymentMethodConfig[] = SEED_PAYMENT_METHOD_CONFIGS.map((m) => ({
  id: m.id, method: m.method as PaymentMethod, channel: m.channel as PaymentChannel, label: m.label, icon: m.icon, enabled: m.enabled, sort: m.sort, createdAt: SEED, updatedAt: SEED,
}));

const methodHandlers = [
  http.get('/api/payment/methods/enabled', () => ok(methodConfigs.filter((m) => m.enabled).sort((a, b) => a.sort - b.sort))),
  http.get('/api/payment/methods', () => ok([...methodConfigs].sort((a, b) => a.sort - b.sort))),
  http.get('/api/payment/methods/:id', ({ params }) => {
    const m = methodConfigs.find((x) => x.id === Number(params.id));
    return m ? ok(m) : notFound('支付方式配置不存在');
  }),
  http.put('/api/payment/methods/:id', async ({ params, request }) => {
    const m = methodConfigs.find((x) => x.id === Number(params.id));
    if (!m) return notFound('支付方式配置不存在');
    const b = (await request.json()) as Partial<PaymentMethodConfig>;
    Object.assign(m, b, { updatedAt: mockDateTime() });
    return ok(m, '更新成功');
  }),
];

// ─── 财务报表 ─────────────────────────────────────────────────────────────────
const reportHandlers = [
  http.get('/api/payment/reports/summary', ({ request }) => {
    const url = new URL(request.url);
    const groupBy = (url.searchParams.get('groupBy') as PaymentReportGroupBy) ?? 'bizType';
    const paid = mockPaymentOrders.filter((o) => o.status === 'success' || o.status === 'refunding' || o.status === 'refunded');
    const groups = new Map<string, { gross: number; count: number }>();
    for (const o of paid) {
      const key = groupBy === 'channel' ? o.channel : groupBy === 'day' ? (o.paidAt ?? o.createdAt).slice(0, 10) : o.bizType;
      const g = groups.get(key) ?? { gross: 0, count: 0 };
      g.gross += o.paidAmount ?? o.amount;
      g.count += 1;
      groups.set(key, g);
    }
    const rows: PaymentReportRow[] = [...groups.entries()].map(([key, g]) => {
      const fee = Math.round(g.gross * 0.006);
      const refund = 0;
      const label = groupBy === 'channel' ? (PAYMENT_CHANNEL_LABELS[key as PaymentChannel] ?? key) : key;
      return { key, label, gross: g.gross, fee, refund, net: g.gross - fee - refund, count: g.count };
    });
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return ok({
      groupBy,
      rows,
      totalGross: rows.reduce((s, r) => s + r.gross, 0),
      totalFee: rows.reduce((s, r) => s + r.fee, 0),
      totalRefund: rows.reduce((s, r) => s + r.refund, 0),
      totalNet: rows.reduce((s, r) => s + r.net, 0),
      totalCount: rows.reduce((s, r) => s + r.count, 0),
    });
  }),
];

export const paymentBExtHandlers = [
  ...feeHandlers,
  ...settlementHandlers,
  ...sharingHandlers,
  ...linkHandlers,
  ...riskHandlers,
  ...methodHandlers,
  ...reportHandlers,
];
