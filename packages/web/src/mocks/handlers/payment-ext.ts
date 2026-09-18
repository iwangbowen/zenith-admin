import {
  paymentOpsContract,
  paymentReconContract,
  paymentRefundContract,
  type PaymentOpsHealth,
  type PaymentOutboxEvent,
  type PaymentReconAdjustment,
  type PaymentReconCase,
  type PaymentReconCaseEvent,
  type PaymentReconSummary,
  type PaymentReconRun,
  type PaymentStatement,
  type PaymentStatementEntry,
  type PaymentStatementPeriod,
} from '@zenith/shared/payment';
import { PAYMENT_MOCK_SEED_TIME, mockPaymentChannels, mockPaymentOrders, mockPaymentRefunds } from '@/mocks/data/payment';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { recordMockSystemJournal } from './payment-journals';
import { filterByKeyword, matchesFilter } from '@/mocks/utils/filter';

const SEED = PAYMENT_MOCK_SEED_TIME;
const now = () => mockDateTime();
const period = (id: number, status: PaymentStatementPeriod['status'] = 'ready'): PaymentStatementPeriod => ({ id, accountId: 1, billDate: '2026-09-17', type: 'trade', currency: 'CNY', status, nextAttemptAt: null, deadlineAt: '2026-09-19 00:00:00', lastError: null, currentStatementId: id, taskId: null, generation: 0, completedAt: now(), tenantId: null, createdBy: 1, updatedBy: 1, createdAt: SEED, updatedAt: SEED });
const periods: PaymentStatementPeriod[] = [period(1), period(2, 'failed')];
const statements: PaymentStatement[] = [{ id: 1, periodId: 1, version: 1, source: 'provider_download', contentHash: 'a'.repeat(64), parserVersion: 'mock/1', status: 'validated', summary: { count: 2 }, verification: { verified: true }, tenantId: null, createdBy: 1, updatedBy: 1, createdAt: SEED, updatedAt: SEED }];
const entries: PaymentStatementEntry[] = [{ id: 1, statementId: 1, entryKey: 'PAY1700000000001', type: 'payment', merchantOrderNo: 'PAY1700000000001', merchantRefundNo: null, providerTransactionId: '4200001234567890', providerRefundId: null, reference: null, currency: 'CNY', amount: '9900', direction: 'in', status: 'success', occurredAt: SEED, applicationId: 1, raw: {}, lineNo: 2, feeAmount: '0', netAmount: '9900', balance: null, createdAt: SEED, tenantId: null }];
const runs: PaymentReconRun[] = [];
const cases: PaymentReconCase[] = [{ id: 1, accountId: 1, periodId: 1, caseKey: 'payment:merchant:PAY1700000000004', entryKey: 'PAY1700000000004', type: 'amount_diff', stage: 'trade', status: 'open', version: 1, lastRunId: 0, applicationId: 1, orderId: 4, refundId: null, localAmount: '5000', channelAmount: '4900', currency: 'CNY', evidence: { source: 'provider_download' }, assignedTo: null, dueAt: '2026-09-20 00:00:00', resolution: null, tenantId: null, createdBy: 1, updatedBy: 1, createdAt: SEED, updatedAt: SEED }];
const caseEvents: PaymentReconCaseEvent[] = [];
const adjustments: PaymentReconAdjustment[] = [];
const summary: PaymentReconSummary = { expectedPeriods: 0, waitingPeriods: 0, readyPeriods: 1, failedPeriods: 1, openCases: 1, suspendedCases: 0, overdueCases: 0, pendingAdjustments: 0, unmatchedBankEntries: 0, unmatchedSettlementEntries: 0, differenceAmounts: [{ currency: 'CNY', amount: '100' }] };
const tasks: Array<{ id: number; title: string; taskType: string; status: 'pending' | 'running' | 'completed' | 'failed' }> = [];
let nextId = 20;
const asyncTask = (taskType: string, title: string) => { const task = { id: nextId++, title, taskType, status: 'completed' as const }; tasks.unshift(task); return { id: task.id, taskType, title, module: '支付中心', status: task.status, payload: {}, totalCount: 1, processedCount: 1, failedCount: 0, progressNote: null, result: {}, errorMessage: null, cancelRequested: false, attempts: 1, maxAttempts: 3, retryDelayMs: 5000, nextRunAt: null, createdBy: 1, createdByName: 'admin', tenantId: null, traceId: null, startedAt: now(), completedAt: now(), createdAt: now(), updatedAt: now() }; };
const paginate = <T,>(list: T[], page: number, pageSize: number) => ({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
const reconHandlers = [
  mock(paymentReconContract.list, ({ query, ok }) => ok(paginate(periods.filter((p) => (!query.accountId || p.accountId === query.accountId) && (!query.status || p.status === query.status) && (!query.type || p.type === query.type)), query.page, query.pageSize))),
  mock(paymentReconContract.detail, ({ params, ok }) => ok(requireItem(periods, params.id, '账期不存在'))),
  mock(paymentReconContract.submit, ({ body, ok }) => ok(asyncTask('payment-statement-download', `获取 ${body.billDate} 渠道账单`))),
  mock(paymentReconContract.retry, ({ params, ok }) => ok(asyncTask('payment-statement-download', `重试账期 #${params.id}`))),
  mock(paymentReconContract.importBill, ({ body, ok }) => ok(asyncTask('payment-statement-import', `导入 ${body.filename}`))),
  mock(paymentReconContract.statements, ({ params, ok }) => ok(statements.filter((s) => s.periodId === params.id))),
  mock(paymentReconContract.statement, ({ params, ok }) => { const s = requireItem(statements, params.id, '账单不存在'); return ok({ ...s, files: [{ id: 1, statementId: s.id, filename: 'statement.csv', mimeType: 'text/csv', sha256: s.contentHash, providerHash: null, byteLength: 640, createdAt: SEED }] }); }),
  mock(paymentReconContract.entries, ({ params, query, ok }) => ok(paginate(entries.filter((e) => e.statementId === params.id && (!query.type || e.type === query.type)), query.page, query.pageSize))),
  mock(paymentReconContract.reconcile, ({ params, ok }) => ok(asyncTask('payment-reconcile', `核对账单 #${params.id}`))),
  mock(paymentReconContract.runs, ({ query, ok }) => ok(paginate(runs.filter((r) => !query.status || r.status === query.status), query.page, query.pageSize))),
  mock(paymentReconContract.cases, ({ query, ok }) => ok(paginate(cases.filter((item) => (!query.accountId || item.accountId === query.accountId) && (!query.status || item.status === query.status) && (!query.type || item.type === query.type)), query.page, query.pageSize))),
  mock(paymentReconContract.caseDetail, ({ params, ok }) => { const item = requireItem(cases, params.id, '差异案件不存在'); return ok({ ...item, events: caseEvents.filter((event) => event.caseId === item.id), adjustments: adjustments.filter((a) => a.caseId === item.id) }); }),
  mock(paymentReconContract.handleCase, ({ params, body, ok }) => { const item = requireItem(cases, params.id, '差异案件不存在'); if (item.version !== body.expectedVersion) return badRequest('案件已经变化，请刷新后操作'); item.status = body.action === 'investigate' ? 'investigating' : body.action === 'suspend' ? 'suspended' : body.action === 'ignore' ? 'ignored' : 'open'; item.version += 1; item.resolution = body.remark; caseEvents.push({ id: nextId++, caseId: item.id, action: body.action, actorId: 1, remark: body.remark, before: {}, after: { status: item.status }, createdAt: now(), tenantId: null }); return ok(item); }),
  mock(paymentReconContract.compensate, ({ params, ok }) => ok(asyncTask('payment-recon-compensate', `补偿案件 #${params.id}`))),
  mock(paymentReconContract.adjustments, ({ query, ok }) => ok(paginate(adjustments.filter((item) => !query.caseId || item.caseId === query.caseId), query.page, query.pageSize))),
  mock(paymentReconContract.createAdjustment, ({ params, body, ok }) => { const item: PaymentReconAdjustment = { id: nextId++, caseId: params.id, caseVersion: 1, applicationId: body.applicationId, channelConfigId: body.channelConfigId, amount: body.amount, direction: body.direction, reason: body.reason, evidence: {}, status: 'draft', workflowInstanceId: null, journalId: null, reversalOfId: null, applicantId: 1, approverId: null, approvedAt: null, executedAt: null, tenantId: null, createdBy: 1, updatedBy: 1, createdAt: now(), updatedAt: now() }; adjustments.unshift(item); return ok(item); }),
  mock(paymentReconContract.submitAdjustment, ({ params, ok }) => { const item = requireItem(adjustments, params.id, '调整单不存在'); item.status = 'pending'; return ok(item); }),
  mock(paymentReconContract.executeAdjustment, ({ params, ok }) => { const item = requireItem(adjustments, params.id, '调整单不存在'); item.status = 'executed'; item.journalId = nextId++; item.executedAt = now(); return ok(item); }),
  mock(paymentReconContract.reverseAdjustment, ({ params, body, ok }) => { const item = requireItem(adjustments, params.id, '调整单不存在'); const reversal: PaymentReconAdjustment = { ...item, id: nextId++, status: 'draft', reason: body.reason, reversalOfId: item.id, journalId: null, executedAt: null, createdAt: now(), updatedAt: now() }; adjustments.unshift(reversal); return ok(reversal); }),
  mock(paymentReconContract.workflowPreview, ({ ok }) => ok({ definition: null, nodes: [] })),
  mock(paymentReconContract.workflowContext, ({ ok }) => ok({ instance: null, previousInstances: [] })),
  mock(paymentReconContract.approvalDetail, ({ params, ok }) => ok(requireItem(adjustments, params.id, '调整单不存在'))),
  mock(paymentReconContract.matchBank, ({ body, ok }) => ok(body.allocations.map((item) => ({ id: nextId++, ...item, accountId: body.accountId, tenantId: null, createdBy: 1, updatedBy: 1, createdAt: now(), updatedAt: now() }))),
  mock(paymentReconContract.summary, ({ ok }) => ok(summary)),
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
    const filtered = filterByKeyword(outboxEvents, query.keyword, [(e) => e.orderNo])
      .filter((e) => matchesFilter(e.status, query.status) && matchesFilter(e.type, query.type));
    return ok(paginate([...filtered].reverse()));
  }),
  mock(paymentOpsContract.redispatchEvent, ({ params, ok }) => {
    const e = requireItem(outboxEvents, params.id, '事件不存在');
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
    const o = requireItem(mockPaymentOrders, params.id, '支付订单不存在');
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
    const r = requireItem(mockPaymentRefunds, params.id, '退款记录不存在');
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
    const r = requireItem(mockPaymentRefunds, params.id, '退款记录不存在');
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

