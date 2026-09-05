import {
  paymentOpsContract,
  paymentReconContract,
  paymentRefundContract,
  type PaymentChannel,
  type PaymentOpsHealth,
  type PaymentOutboxEvent,
  type PaymentReconBatch,
  type PaymentReconItem,
  type PaymentReconResult,
  type PaymentReconSource,
} from '@zenith/shared/payment';
import { PAYMENT_MOCK_SEED_TIME, mockPaymentChannels, mockPaymentOrders, mockPaymentRefunds } from '@/mocks/data/payment';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { recordMockSystemJournal } from './payment-journals';

const SEED = PAYMENT_MOCK_SEED_TIME;

const yuanToCent = (n: number) => Math.round(n);

// ─── 对账中心 ───────────────────────────────────────────────────────────────
const reconBatches: PaymentReconBatch[] = [
  { id: 1, batchNo: 'RECON1700000000001', channel: 'wechat', appId: 1, channelConfigId: 1, currency: 'CNY', billDate: '2024-01-01', source: 'manual_upload', status: 'done', localCount: 3, localAmount: 16800, channelCount: 3, channelAmount: 16700, matchedCount: 2, diffCount: 1, remark: '演示批次', createdAt: SEED, updatedAt: SEED },
];
const reconItemsByBatch: Record<number, PaymentReconItem[]> = {
  1: [
    { id: 1, batchId: 1, orderNo: 'PAY1700000000001', channelTradeNo: '4200001234567890', localAmount: 9900, channelAmount: 9900, localStatus: 'success', channelStatus: 'SUCCESS', result: 'matched', handleStatus: null, handleRemark: null, handledAt: null, remark: null, createdAt: SEED },
    { id: 2, batchId: 1, orderNo: 'PAY1700000000003', channelTradeNo: '4200009876543210', localAmount: 1900, channelAmount: 1900, localStatus: 'refunded', channelStatus: 'SUCCESS', result: 'matched', handleStatus: null, handleRemark: null, handledAt: null, remark: null, createdAt: SEED },
    { id: 3, batchId: 1, orderNo: 'PAY1700000000004', channelTradeNo: '4200005555666677', localAmount: 5000, channelAmount: 4900, localStatus: 'success', channelStatus: 'SUCCESS', result: 'amount_diff', handleStatus: 'pending', handleRemark: null, handledAt: null, remark: null, createdAt: SEED },
  ],
};
let nextBatchId = 2;
let nextItemId = 4;

function sampleBill(channel: PaymentChannel): string {
  const lines = ['订单号,渠道交易号,金额(分),状态'];
  for (const o of mockPaymentOrders) {
    if (o.channel === channel && (o.status === 'success' || o.status === 'refunding' || o.status === 'refunded')) {
      lines.push(`${o.orderNo},${o.channelTradeNo ?? ''},${o.paidAmount ?? o.amount},SUCCESS`);
    }
  }
  return lines.join('\n');
}

/** 解析账单并与本地订单比对，生成批次 + 明细（供手动上传与自动拉取两个入口复用）。 */
function createBatchFromBill(applicationId: number, channel: PaymentChannel, channelConfigId: number, currency: string, billDate: string, billText: string, remark: string | null, source: PaymentReconSource): PaymentReconBatch {
  const channelRecords = new Map<string, { amount: number; tradeNo?: string }>();
  for (const raw of billText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 3 || /^(订单号|order)/i.test(cols[0])) continue;
    const amt = Number(cols[2]);
    if (Number.isFinite(amt)) channelRecords.set(cols[0], { amount: yuanToCent(amt), tradeNo: cols[1] });
  }
  const localMap = new Map(
    mockPaymentOrders
      .filter((o) => o.appId === applicationId && o.channel === channel && o.channelConfigId === channelConfigId && o.currency === currency && (o.status === 'success' || o.status === 'refunding' || o.status === 'refunded'))
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
    items.push({ id: nextItemId++, batchId: nextBatchId, orderNo, channelTradeNo: ch?.tradeNo ?? local?.tradeNo ?? null, localAmount: local?.amount ?? null, channelAmount: ch?.amount ?? null, localStatus: local?.status ?? null, channelStatus: ch ? 'SUCCESS' : null, result, handleStatus: result === 'matched' ? null : 'pending', handleRemark: null, handledAt: null, remark: null, createdAt: mockDateTime() });
  }
  const batch: PaymentReconBatch = {
    id: nextBatchId, batchNo: `RECON${Date.now()}`, channel,
    appId: applicationId,
    channelConfigId, currency, billDate, source, status: 'done',
    localCount: localMap.size, localAmount, channelCount: channelRecords.size, channelAmount,
    matchedCount: matched, diffCount: items.length - matched, remark, createdAt: mockDateTime(), updatedAt: mockDateTime(),
  };
  reconBatches.push(batch);
  reconItemsByBatch[nextBatchId] = items;
  nextBatchId++;
  return batch;
}

const reconHandlers = [
  mock(paymentReconContract.list, ({ query, ok, paginate }) => {
    const filtered = reconBatches.filter((b) => (!query.channel || b.channel === query.channel) && (!query.status || b.status === query.status));
    return ok(paginate([...filtered].reverse()));
  }),
  mock(paymentReconContract.sampleBill, ({ query, ok }) => ok({ billText: sampleBill(query.channel) })),
  mock(paymentReconContract.create, ({ body, ok }) => {
    const config = mockPaymentChannels.find((item) => item.id === body.channelConfigId && item.channel === body.channel && item.status === 'enabled');
    if (!config) return badRequest('所选商户配置不存在或未启用');
    const appHasConfig = mockPaymentOrders.some((order) => order.appId === body.applicationId && order.channelConfigId === body.channelConfigId);
    if (!appHasConfig) return badRequest('支付应用未绑定所选商户配置');
    const batch = createBatchFromBill(body.applicationId, body.channel, body.channelConfigId, body.currency, body.billDate, body.billText, body.remark ?? null, 'manual_upload');
    return ok(batch, '对账完成');
  }),
  mock(paymentReconContract.auto, ({ body, ok }) => {
    const config = mockPaymentChannels.find((item) => item.channel === body.channel && item.status === 'enabled' && item.isDefault)
      ?? mockPaymentChannels.find((item) => item.channel === body.channel && item.status === 'enabled');
    if (!config) return badRequest('该渠道没有启用的商户配置');
    const applicationId = mockPaymentOrders.find((order) => order.channelConfigId === config.id)?.appId;
    if (!applicationId) return badRequest('该商户配置没有可用支付应用');
    const batch = createBatchFromBill(applicationId, body.channel, config.id, body.currency, body.billDate, sampleBill(body.channel), '自动对账（沙箱模拟账单）', 'sandbox_generated');
    return ok(batch, '对账完成');
  }),
  mock(paymentReconContract.detail, ({ params, ok }) => {
    const b = reconBatches.find((x) => x.id === params.id);
    return b ? ok(b) : notFound('对账批次不存在');
  }),
  mock(paymentReconContract.items, ({ params, query, ok, paginate }) => {
    const items = (reconItemsByBatch[params.id] ?? []).filter((i) => (!query.result || i.result === query.result) && (!query.handleStatus || i.handleStatus === query.handleStatus));
    return ok(paginate(items));
  }),
  mock(paymentReconContract.handleItem, ({ params, body, ok }) => {
    const remark = body.remark.trim();
    if (!remark) return badRequest('处理备注不能为空');
    for (const items of Object.values(reconItemsByBatch)) {
      const item = items.find((i) => i.id === params.id);
      if (item) {
        if (item.handleStatus !== 'pending') return badRequest('该差异已被处理，请刷新后查看');
        const batch = reconBatches.find((candidate) => candidate.id === item.batchId);
        if (body.action === 'adjusted' && batch?.source !== 'provider_download') {
          return conflict('仅渠道下载账单可直接调账；人工上传和沙箱模拟账单只能挂账或忽略', { status: 409 });
        }
        const hasAdjustmentAmount = item.result === 'channel_only'
          ? item.channelAmount != null && item.channelAmount > 0
          : item.result === 'local_only'
            ? item.localAmount != null && item.localAmount > 0
            : item.result === 'amount_diff' && item.localAmount != null && item.channelAmount != null && item.localAmount !== item.channelAmount;
        if (body.action === 'adjusted' && !hasAdjustmentAmount) {
          return badRequest('该差异无法计算明确调账金额，请选择挂账或忽略');
        }
        item.handleStatus = body.action;
        item.handleRemark = remark;
        item.handledAt = mockDateTime();
        return ok(item, '处理成功');
      }
    }
    return notFound('对账明细不存在');
  }),
  mock(paymentReconContract.remove, ({ params, ok }) => {
    const i = reconBatches.findIndex((x) => x.id === params.id);
    if (i === -1) return notFound('对账批次不存在');
    reconBatches.splice(i, 1);
    delete reconItemsByBatch[params.id];
    return ok(null, '删除成功');
  }),
];

// ─── 支付事件（Outbox / 运营排障）────────────────────────────────────────────
const outboxEvents: PaymentOutboxEvent[] = [
  { id: 1, type: 'payment.succeeded', orderNo: 'PAY1700000000001', status: 'done', attempts: 1, lastError: null, createdAt: SEED, processedAt: SEED },
  { id: 2, type: 'refund.succeeded', orderNo: 'PAY1700000000003', status: 'done', attempts: 1, lastError: null, createdAt: SEED, processedAt: SEED },
  { id: 3, type: 'payment.succeeded', orderNo: 'PAY1700000000099', status: 'failed', attempts: 3, lastError: '业务订阅者处理超时', createdAt: SEED, processedAt: null },
];
let nextEventId = 4;

type MockPaymentEventType = 'payment.succeeded' | 'refund.succeeded' | 'payment.closed' | 'payment.failed' | 'refund.failed';

function recordMockOutboxEvent(eventType: MockPaymentEventType, orderNo: string) {
  if (outboxEvents.some((e) => e.type === eventType && e.orderNo === orderNo)) return;
  const now = mockDateTime();
  outboxEvents.unshift({ id: nextEventId++, type: eventType, orderNo, status: 'done', attempts: 1, lastError: null, createdAt: now, processedAt: now });
}

export function recordMockPaymentSucceeded(order: typeof mockPaymentOrders[number]) {
  const amount = order.paidAmount ?? order.amount;
  const fee = Math.min(Math.round(amount * 0.006), amount);
  order.feeAmount = fee;
  order.netAmount = amount - fee;
  recordMockSystemJournal({
    sourceType: 'payment.capture',
    sourceId: order.orderNo,
    description: `支付收款 ${order.orderNo}`,
    appId: order.appId,
    channelConfigId: order.channelConfigId,
    currency: order.currency,
    lines: [
      { accountCode: 'provider_clearing', debitAmount: String(amount), memo: '渠道应收增加' },
      { accountCode: 'merchant_available', creditAmount: String(amount), memo: '商户可用余额增加' },
    ],
  });
  if (fee > 0) {
    recordMockSystemJournal({
      sourceType: 'payment.fee',
      sourceId: order.orderNo,
      description: `支付手续费 ${order.orderNo}`,
      appId: order.appId,
      channelConfigId: order.channelConfigId,
      currency: order.currency,
      lines: [
        { accountCode: 'merchant_available', debitAmount: String(fee), memo: '扣减商户可用余额' },
        { accountCode: 'platform_fee', creditAmount: String(fee), memo: '确认平台手续费' },
      ],
    });
  }
  recordMockOutboxEvent('payment.succeeded', order.orderNo);
}

export function recordMockRefundSucceeded(refund: typeof mockPaymentRefunds[number]) {
  const order = mockPaymentOrders.find((o) => o.orderNo === refund.orderNo);
  if (!order) return;
  recordMockSystemJournal({
    sourceType: 'payment.refund',
    sourceId: refund.refundNo,
    description: `支付退款 ${refund.refundNo}`,
    appId: order.appId,
    channelConfigId: order.channelConfigId,
    currency: order.currency,
    lines: [
      { accountCode: 'merchant_available', debitAmount: String(refund.refundAmount), memo: '商户可用余额减少' },
      { accountCode: 'provider_clearing', creditAmount: String(refund.refundAmount), memo: '渠道应收减少' },
    ],
  });
  recordMockOutboxEvent('refund.succeeded', refund.orderNo);
}

const MOCK_OPS_HEALTH: PaymentOpsHealth = {
  outboxPending: 2,
  outboxFailed: 1,
  webhookPending: 3,
  webhookFailed24h: 1,
  sharingProcessing: 1,
  transferProcessing: 1,
  reconPendingDiff: 1,
};

const opsHandlers = [
  mock(paymentOpsContract.health, ({ ok }) => ok(MOCK_OPS_HEALTH)),
  mock(paymentOpsContract.events, ({ query, ok, paginate }) => {
    const filtered = outboxEvents.filter((e) => (!query.status || e.status === query.status) && (!query.type || e.type === query.type) && (!query.keyword || e.orderNo.includes(query.keyword)));
    return ok(paginate([...filtered].reverse()));
  }),
  mock(paymentOpsContract.redispatchEvent, ({ params, ok }) => {
    const e = outboxEvents.find((x) => x.id === params.id);
    if (!e) return notFound('事件不存在');
    if (e.type === 'payment.succeeded') {
      const order = mockPaymentOrders.find((o) => o.orderNo === e.orderNo);
      if (order) recordMockPaymentSucceeded(order);
    } else if (e.type === 'refund.succeeded') {
      const refund = mockPaymentRefunds.find((r) => r.orderNo === e.orderNo && r.status === 'success');
      if (refund) recordMockRefundSucceeded(refund);
    }
    e.status = 'done';
    e.attempts += 1;
    e.lastError = null;
    e.processedAt = mockDateTime();
    return ok(e, '已重投');
  }),
  mock(paymentOpsContract.simulateOrderPaid, ({ params, ok }) => {
    const o = mockPaymentOrders.find((x) => x.id === params.id);
    if (!o) return notFound('支付订单不存在');
    if (o.status !== 'pending' && o.status !== 'paying') return badRequest('仅待支付/支付中订单可模拟支付');
    o.status = 'success';
    o.paidAmount = o.amount;
    o.paidAt = mockDateTime();
    o.version += 1;
    o.updatedAt = mockDateTime();
    recordMockPaymentSucceeded(o);
    return ok(o, '已模拟支付成功');
  }),
];

// ─── 退款审批（approve / reject）──────────────────────────────────────────────
const refundApprovalHandlers = [
  mock(paymentRefundContract.approveRefund, ({ params, body, ok }) => {
    const r = mockPaymentRefunds.find((x) => x.id === params.id);
    if (!r) return notFound('退款记录不存在');
    if (r.approvalStatus !== 'pending') return badRequest('该退款单无需审批或已处理');
    r.approvalStatus = 'approved';
    r.approverId = 1;
    r.approvedAt = mockDateTime();
    r.approvalRemark = body.remark ?? null;
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
    return ok({ refundNo: r.refundNo, status: 'success' }, '已审批通过');
  }),
  mock(paymentRefundContract.rejectRefund, ({ params, body, ok }) => {
    const r = mockPaymentRefunds.find((x) => x.id === params.id);
    if (!r) return notFound('退款记录不存在');
    if (r.approvalStatus !== 'pending') return badRequest('该退款单无需审批或已处理');
    r.approvalStatus = 'rejected';
    r.approverId = 1;
    r.approvedAt = mockDateTime();
    r.approvalRemark = body.remark;
    r.status = 'failed';
    r.errorMessage = '退款审批被驳回';
    r.version += 1;
    r.updatedAt = mockDateTime();
    return ok(null, '已驳回');
  }),
];

export const paymentExtHandlers = [
  ...reconHandlers,
  ...opsHandlers,
  ...refundApprovalHandlers,
];
