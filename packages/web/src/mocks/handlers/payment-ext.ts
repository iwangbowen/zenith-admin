import { http, HttpResponse } from 'msw';
import { PAYMENT_MOCK_SEED_TIME, mockPaymentOrders, mockPaymentRefunds } from '@/mocks/data/payment';
import { mockDateTime } from '@/mocks/utils/date';
import type {
  PaymentChannel,
  PaymentReconBatch,
  PaymentReconItem,
  PaymentReconResult,
  PaymentWebhookEndpoint,
  PaymentWebhookDelivery,
  PaymentLedgerEntry,
  PaymentOutboxEvent,
} from '@zenith/shared';

const SEED = PAYMENT_MOCK_SEED_TIME;

function paginate<T>(list: T[], url: URL) {
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize };
}
const ok = (data: unknown, message = 'ok') => HttpResponse.json({ code: 0, message, data });
const notFound = (message = '不存在') => HttpResponse.json({ code: 404, message, data: null });
const yuanToCent = (n: number) => Math.round(n);

// ─── 对账中心 ───────────────────────────────────────────────────────────────
const reconBatches: PaymentReconBatch[] = [
  { id: 1, batchNo: 'RECON1700000000001', channel: 'wechat', billDate: '2024-01-01', status: 'done', localCount: 2, localAmount: 11800, channelCount: 2, channelAmount: 11800, matchedCount: 2, diffCount: 0, remark: '演示批次', createdAt: SEED, updatedAt: SEED },
];
const reconItemsByBatch: Record<number, PaymentReconItem[]> = {
  1: [
    { id: 1, batchId: 1, orderNo: 'PAY1700000000001', channelTradeNo: '4200001234567890', localAmount: 9900, channelAmount: 9900, localStatus: 'success', channelStatus: 'SUCCESS', result: 'matched', remark: null, createdAt: SEED },
    { id: 2, batchId: 1, orderNo: 'PAY1700000000003', channelTradeNo: '4200009876543210', localAmount: 1900, channelAmount: 1900, localStatus: 'refunded', channelStatus: 'SUCCESS', result: 'matched', remark: null, createdAt: SEED },
  ],
};
let nextBatchId = 2;
let nextItemId = 3;

function sampleBill(channel: PaymentChannel): string {
  const lines = ['订单号,渠道交易号,金额(分),状态'];
  for (const o of mockPaymentOrders) {
    if (o.channel === channel && (o.status === 'success' || o.status === 'refunding' || o.status === 'refunded')) {
      lines.push(`${o.orderNo},${o.channelTradeNo ?? ''},${o.paidAmount ?? o.amount},SUCCESS`);
    }
  }
  return lines.join('\n');
}

const reconHandlers = [
  http.get('/api/payment/recon/batches', ({ request }) => {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = reconBatches.filter((b) => (!channel || b.channel === channel) && (!status || b.status === status));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.get('/api/payment/recon/sample-bill', ({ request }) => {
    const url = new URL(request.url);
    return ok({ billText: sampleBill((url.searchParams.get('channel') as PaymentChannel) ?? 'wechat') });
  }),
  http.post('/api/payment/recon/batches', async ({ request }) => {
    const body = (await request.json()) as { channel: PaymentChannel; billDate: string; billText: string; remark?: string };
    const channelRecords = new Map<string, { amount: number; tradeNo?: string }>();
    for (const raw of body.billText.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const cols = line.split(',').map((c) => c.trim());
      if (cols.length < 3 || /^(订单号|order)/i.test(cols[0])) continue;
      const amt = Number(cols[2]);
      if (Number.isFinite(amt)) channelRecords.set(cols[0], { amount: yuanToCent(amt), tradeNo: cols[1] });
    }
    const localMap = new Map(
      mockPaymentOrders
        .filter((o) => o.channel === body.channel && (o.status === 'success' || o.status === 'refunding' || o.status === 'refunded'))
        .map((o) => [o.orderNo, { amount: o.paidAmount ?? o.amount, status: o.status, tradeNo: o.channelTradeNo }]),
    );
    const items: PaymentReconItem[] = [];
    let matched = 0;
    let localAmount = 0;
    let channelAmount = 0;
    for (const orderNo of new Set([...localMap.keys(), ...channelRecords.keys()])) {
      const local = localMap.get(orderNo);
      const ch = channelRecords.get(orderNo);
      if (local) localAmount += local.amount;
      if (ch) channelAmount += ch.amount;
      let result: PaymentReconResult;
      if (local && ch) result = local.amount === ch.amount ? 'matched' : 'amount_diff';
      else if (local) result = 'local_only';
      else result = 'channel_only';
      if (result === 'matched') matched++;
      items.push({ id: nextItemId++, batchId: nextBatchId, orderNo, channelTradeNo: ch?.tradeNo ?? local?.tradeNo ?? null, localAmount: local?.amount ?? null, channelAmount: ch?.amount ?? null, localStatus: local?.status ?? null, channelStatus: ch ? 'SUCCESS' : null, result, remark: null, createdAt: mockDateTime() });
    }
    const batch: PaymentReconBatch = {
      id: nextBatchId, batchNo: `RECON${Date.now()}`, channel: body.channel, billDate: body.billDate, status: 'done',
      localCount: localMap.size, localAmount, channelCount: channelRecords.size, channelAmount,
      matchedCount: matched, diffCount: items.length - matched, remark: body.remark ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    reconBatches.push(batch);
    reconItemsByBatch[nextBatchId] = items;
    nextBatchId++;
    return ok(batch, '对账完成');
  }),
  http.get('/api/payment/recon/batches/:id', ({ params }) => {
    const b = reconBatches.find((x) => x.id === Number(params.id));
    return b ? ok(b) : notFound('对账批次不存在');
  }),
  http.get('/api/payment/recon/batches/:id/items', ({ params, request }) => {
    const url = new URL(request.url);
    const result = url.searchParams.get('result') ?? '';
    const items = (reconItemsByBatch[Number(params.id)] ?? []).filter((i) => !result || i.result === result);
    return ok(paginate(items, url));
  }),
  http.delete('/api/payment/recon/batches/:id', ({ params }) => {
    const i = reconBatches.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('对账批次不存在');
    reconBatches.splice(i, 1);
    delete reconItemsByBatch[Number(params.id)];
    return ok(null, '删除成功');
  }),
];

// ─── 业务方 Webhook ───────────────────────────────────────────────────────────
const endpoints: PaymentWebhookEndpoint[] = [
  { id: 1, name: '会员系统回调', url: 'https://biz.demo.dev/api/payment/callback', bizType: 'membership', events: ['payment.succeeded', 'refund.succeeded'], status: 'enabled', hasSecret: true, remark: '演示端点', createdAt: SEED, updatedAt: SEED },
  { id: 2, name: '订单系统回调', url: 'https://order.demo.dev/hooks/pay', bizType: null, events: [], status: 'enabled', hasSecret: false, remark: '全事件全业务', createdAt: SEED, updatedAt: SEED },
];
let nextEndpointId = 3;
const deliveries: PaymentWebhookDelivery[] = [
  { id: 1, endpointId: 1, endpointName: '会员系统回调', eventType: 'payment.succeeded', orderNo: 'PAY1700000000001', payload: '{"type":"payment.succeeded","orderNo":"PAY1700000000001","amount":9900}', status: 'success', attempts: 1, httpStatus: 200, responseBody: 'OK', lastError: null, createdAt: SEED, updatedAt: SEED },
  { id: 2, endpointId: 1, endpointName: '会员系统回调', eventType: 'refund.succeeded', orderNo: 'PAY1700000000003', payload: '{"type":"refund.succeeded","orderNo":"PAY1700000000003"}', status: 'failed', attempts: 3, httpStatus: 500, responseBody: 'Internal Error', lastError: 'HTTP 500', createdAt: SEED, updatedAt: SEED },
];

const webhookHandlers = [
  http.get('/api/payment/webhooks/endpoints', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const filtered = endpoints.filter((e) => (!keyword || e.name.includes(keyword)) && (!status || e.status === status));
    return ok(paginate(filtered, url));
  }),
  http.post('/api/payment/webhooks/endpoints', async ({ request }) => {
    const b = (await request.json()) as Partial<PaymentWebhookEndpoint> & { secret?: string };
    const now = mockDateTime();
    const item: PaymentWebhookEndpoint = { id: nextEndpointId++, name: b.name ?? '', url: b.url ?? '', bizType: b.bizType ?? null, events: b.events ?? [], status: b.status ?? 'enabled', hasSecret: Boolean(b.secret), remark: b.remark ?? null, createdAt: now, updatedAt: now };
    endpoints.push(item);
    return ok(item, '创建成功');
  }),
  http.get('/api/payment/webhooks/deliveries', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? '';
    const endpointId = url.searchParams.get('endpointId') ?? '';
    const keyword = url.searchParams.get('keyword') ?? '';
    const filtered = deliveries.filter((d) => (!status || d.status === status) && (!endpointId || d.endpointId === Number(endpointId)) && (!keyword || (d.orderNo ?? '').includes(keyword)));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.post('/api/payment/webhooks/deliveries/:id/redeliver', ({ params }) => {
    const d = deliveries.find((x) => x.id === Number(params.id));
    if (!d) return notFound('投递记录不存在');
    d.status = 'success';
    d.attempts += 1;
    d.httpStatus = 200;
    d.responseBody = 'OK';
    d.lastError = null;
    d.updatedAt = mockDateTime();
    return ok(d, '已重投');
  }),
  http.get('/api/payment/webhooks/endpoints/:id', ({ params }) => {
    const e = endpoints.find((x) => x.id === Number(params.id));
    return e ? ok(e) : notFound('Webhook 端点不存在');
  }),
  http.put('/api/payment/webhooks/endpoints/:id', async ({ params, request }) => {
    const e = endpoints.find((x) => x.id === Number(params.id));
    if (!e) return notFound('Webhook 端点不存在');
    const b = (await request.json()) as Partial<PaymentWebhookEndpoint> & { secret?: string };
    Object.assign(e, { name: b.name ?? e.name, url: b.url ?? e.url, bizType: b.bizType ?? e.bizType, events: b.events ?? e.events, status: b.status ?? e.status, remark: b.remark ?? e.remark, hasSecret: b.secret ? true : e.hasSecret, updatedAt: mockDateTime() });
    return ok(e, '更新成功');
  }),
  http.delete('/api/payment/webhooks/endpoints/:id', ({ params }) => {
    const i = endpoints.findIndex((x) => x.id === Number(params.id));
    if (i === -1) return notFound('Webhook 端点不存在');
    endpoints.splice(i, 1);
    return ok(null, '删除成功');
  }),
];

// ─── 资金流水台账 ─────────────────────────────────────────────────────────────
const ledgerEntries: PaymentLedgerEntry[] = [
  { id: 1, entryNo: 'LED1700000000001', direction: 'in', type: 'payment', amount: 9900, orderNo: 'PAY1700000000001', refundNo: null, channel: 'wechat', bizType: 'membership', remark: '支付收款', createdAt: SEED },
  { id: 2, entryNo: 'LED1700000000002', direction: 'in', type: 'payment', amount: 1900, orderNo: 'PAY1700000000003', refundNo: null, channel: 'wechat', bizType: 'membership', remark: '支付收款', createdAt: SEED },
  { id: 3, entryNo: 'LED1700000000003', direction: 'out', type: 'refund', amount: 1900, orderNo: 'PAY1700000000003', refundNo: 'REF1700000000003', channel: 'wechat', bizType: 'membership', remark: '退款支出', createdAt: SEED },
];

function filterLedger(url: URL) {
  const keyword = url.searchParams.get('keyword') ?? '';
  const direction = url.searchParams.get('direction') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const channel = url.searchParams.get('channel') ?? '';
  return ledgerEntries.filter((e) => (!keyword || (e.orderNo ?? '').includes(keyword)) && (!direction || e.direction === direction) && (!type || e.type === type) && (!channel || e.channel === channel));
}

const ledgerHandlers = [
  http.get('/api/payment/ledger/entries', ({ request }) => ok(paginate([...filterLedger(new URL(request.url))].reverse(), new URL(request.url)))),
  http.get('/api/payment/ledger/summary', ({ request }) => {
    const list = filterLedger(new URL(request.url));
    const inAmount = list.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
    const outAmount = list.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
    return ok({ inAmount, outAmount, netAmount: inAmount - outAmount, count: list.length });
  }),
];

// ─── 支付事件（Outbox / 运营排障）────────────────────────────────────────────
const outboxEvents: PaymentOutboxEvent[] = [
  { id: 1, type: 'payment.succeeded', orderNo: 'PAY1700000000001', status: 'done', attempts: 1, lastError: null, createdAt: SEED, processedAt: SEED },
  { id: 2, type: 'refund.succeeded', orderNo: 'PAY1700000000003', status: 'done', attempts: 1, lastError: null, createdAt: SEED, processedAt: SEED },
  { id: 3, type: 'payment.succeeded', orderNo: 'PAY1700000000099', status: 'failed', attempts: 3, lastError: '业务订阅者处理超时', createdAt: SEED, processedAt: null },
];

const opsHandlers = [
  http.get('/api/payment/ops/events', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const keyword = url.searchParams.get('keyword') ?? '';
    const filtered = outboxEvents.filter((e) => (!status || e.status === status) && (!type || e.type === type) && (!keyword || e.orderNo.includes(keyword)));
    return ok(paginate([...filtered].reverse(), url));
  }),
  http.post('/api/payment/ops/events/:id/redispatch', ({ params }) => {
    const e = outboxEvents.find((x) => x.id === Number(params.id));
    if (!e) return notFound('事件不存在');
    e.status = 'done';
    e.attempts += 1;
    e.lastError = null;
    e.processedAt = mockDateTime();
    return ok(e, '已重投');
  }),
  http.post('/api/payment/ops/orders/:id/simulate-paid', ({ params }) => {
    const o = mockPaymentOrders.find((x) => x.id === Number(params.id));
    if (!o) return notFound('支付订单不存在');
    if (o.status !== 'pending' && o.status !== 'paying') return HttpResponse.json({ code: 400, message: '仅待支付/支付中订单可模拟支付', data: null });
    o.status = 'success';
    o.paidAmount = o.amount;
    o.paidAt = mockDateTime();
    o.updatedAt = mockDateTime();
    return ok(o, '已模拟支付成功');
  }),
];

// ─── 退款审批（approve / reject）──────────────────────────────────────────────
const refundApprovalHandlers = [
  http.post('/api/payment/refunds/:id/approve', ({ params }) => {
    const r = mockPaymentRefunds.find((x) => x.id === Number(params.id));
    if (!r) return notFound('退款记录不存在');
    if (r.approvalStatus !== 'pending') return HttpResponse.json({ code: 400, message: '该退款单无需审批或已处理', data: null });
    r.approvalStatus = 'approved';
    r.approverId = 1;
    r.approvedAt = mockDateTime();
    r.status = 'success';
    r.refundedAt = mockDateTime();
    r.updatedAt = mockDateTime();
    const order = mockPaymentOrders.find((o) => o.orderNo === r.orderNo);
    if (order) order.status = r.refundAmount >= order.amount ? 'refunded' : 'success';
    return ok({ refundNo: r.refundNo, status: 'success' }, '已审批通过');
  }),
  http.post('/api/payment/refunds/:id/reject', async ({ params, request }) => {
    const r = mockPaymentRefunds.find((x) => x.id === Number(params.id));
    if (!r) return notFound('退款记录不存在');
    if (r.approvalStatus !== 'pending') return HttpResponse.json({ code: 400, message: '该退款单无需审批或已处理', data: null });
    const body = (await request.json().catch(() => ({}))) as { remark?: string };
    r.approvalStatus = 'rejected';
    r.approverId = 1;
    r.approvedAt = mockDateTime();
    r.approvalRemark = body.remark ?? null;
    r.status = 'failed';
    r.errorMessage = '退款审批被驳回';
    r.updatedAt = mockDateTime();
    return ok(null, '已驳回');
  }),
];

export const paymentExtHandlers = [
  ...reconHandlers,
  ...webhookHandlers,
  ...ledgerHandlers,
  ...opsHandlers,
  ...refundApprovalHandlers,
];
