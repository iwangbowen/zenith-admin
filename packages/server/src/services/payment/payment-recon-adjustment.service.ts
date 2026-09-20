import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import { isPlainObject, type SubjectRef } from '@zenith/shared/core';
import {
  PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, createPaymentReconAdjustmentSchema, paymentReconAdjustmentSchema,
  reversePaymentReconAdjustmentSchema, submitPaymentReconAdjustmentSchema,
  PAYMENT_LEDGER_ACCOUNT_CODES, type PaymentLedgerAccountCode,
} from '@zenith/shared/payment';
import { db } from '../../db';
import {
  paymentApps, paymentChannelAccounts, paymentChannelConfigs, paymentJournalLines, paymentJournals, paymentLedgerAccounts,
  paymentOrders, paymentReconAdjustments, paymentReconCaseEvents, paymentReconCases, paymentRefunds,
  paymentStatementPeriods, paymentStatements, workflowDefinitions, workflowInstances, workflowJobs, workflowTasks,
  type PaymentReconAdjustmentRow, type PaymentReconCaseRow,
} from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentUser, hasPermission } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pickEntity } from '../../lib/entity-map';
import { getSettings } from '../../lib/settings';
import logger from '../../lib/logger';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { onWorkflowResult, startWorkflowForBiz } from '../../lib/workflow-biz-bridge';
import { getBusinessWorkflowContext, previewBusinessWorkflow, requireBusinessApprovalInstance } from '../workflow/workflow-business-context.service';
import { postSystemJournalWithin, type PostSystemPaymentJournalInput } from './payment-journal.service';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { assertReconWriteScope, reconJson, reconNotificationPolicy, requireReconCase } from './payment-recon-common';
import { assertIndependentReconApproval, assertReconAdjustmentAmount, reconEvidenceHash } from './payment-recon-adjustment-policy';

const mapAdjustment = (row: PaymentReconAdjustmentRow) => pickEntity(paymentReconAdjustmentSchema, row, { amount: row.amount.toString() });
const adjustmentWhere = (id: number, tenantId: number | null) => and(eq(paymentReconAdjustments.id, id), exactTenantCondition(paymentReconAdjustments.tenantId, tenantId));

function reconCaseSubjectRefs(record: Pick<PaymentReconCaseRow, 'orderId' | 'refundId'>): SubjectRef[] {
  return [
    ...(record.orderId == null ? [] : [{ type: 'payment.order', key: String(record.orderId), role: 'primary' as const }]),
    ...(record.refundId == null ? [] : [{ type: 'payment.refund', key: String(record.refundId), role: 'related' as const }]),
  ];
}

async function requireAdjustment(id: number) {
  const [row] = await db.select().from(paymentReconAdjustments).where(and(eq(paymentReconAdjustments.id, id), tenantCondition(paymentReconAdjustments, currentUser()))).limit(1);
  return requireRow(row, '对账调整单不存在');
}

async function lockCase(tx: DbExecutor, id: number, tenantId: number | null) {
  const [candidate] = await tx.select({ periodId: paymentReconCases.periodId }).from(paymentReconCases).where(and(eq(paymentReconCases.id, id), exactTenantCondition(paymentReconCases.tenantId, tenantId))).limit(1);
  requireRow(candidate, '差异案件不存在');
  await tx.select({ id: paymentStatementPeriods.id }).from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, candidate.periodId), exactTenantCondition(paymentStatementPeriods.tenantId, tenantId))).for('update').limit(1);
  const [row] = await tx.select().from(paymentReconCases).where(and(eq(paymentReconCases.id, id), exactTenantCondition(paymentReconCases.tenantId, tenantId))).for('update').limit(1);
  return requireRow(row, '差异案件不存在');
}

/** Keep every referenced fact locked until posting; paid/refunded status repair uses these same rows. */
async function currentFacts(tx: DbExecutor, record: PaymentReconCaseRow) {
  if (record.applicationId == null) throw new HTTPException(400, { message: '调整缺少可锁定、可审计的本地交易依据' });
  if (!record.orderId && record.stage === 'fund') {
    const local = isPlainObject(record.evidence.local) ? record.evidence.local : {};
    const raw = isPlainObject(local.raw) ? local.raw : {};
    if (typeof raw.journalId !== 'number') throw new HTTPException(400, { message: '渠道资金差异缺少原始资金凭证' });
    const [journal] = await tx.select().from(paymentJournals).where(and(eq(paymentJournals.id, raw.journalId), eq(paymentJournals.channelAccountId, record.accountId), eq(paymentJournals.appId, record.applicationId), eq(paymentJournals.currency, record.currency), exactTenantCondition(paymentJournals.tenantId, record.tenantId))).for('update').limit(1);
    requireRow(journal, '资金差异的原始凭证作用域不一致', 409);
    const lines = await tx.select({ id: paymentJournalLines.id, accountCode: paymentLedgerAccounts.code, debit: paymentJournalLines.debitAmount, credit: paymentJournalLines.creditAmount }).from(paymentJournalLines).innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId)).where(eq(paymentJournalLines.journalId, journal.id)).orderBy(asc(paymentJournalLines.lineNo));
    const counterparts = [...new Set(lines.filter((line) => line.accountCode !== 'provider_clearing').map((line) => line.accountCode))];
    if (!lines.some((line) => line.accountCode === 'provider_clearing') || counterparts.length !== 1) throw new HTTPException(400, { message: '原凭证含多个资金对方科目，不能以单一差额自动推断调整分录' });
    const reversals = await tx.select({ id: paymentJournals.id, hash: paymentJournals.requestHash }).from(paymentJournals).where(eq(paymentJournals.reversalOfJournalId, journal.id)).orderBy(asc(paymentJournals.id));
    if (journal.reversalOfJournalId != null || reversals.length > 0) throw new HTTPException(409, { message: '原资金凭证已冲正，请重新核对当前资金事实' });
    return reconJson({ journal: { id: journal.id, requestHash: journal.requestHash, sourceType: journal.sourceType, sourceId: journal.sourceId }, lines, reversals, counterAccountCode: counterparts[0] });
  }
  if (!record.orderId) throw new HTTPException(400, { message: '调整缺少关联的本地支付订单' });
  const [order] = await tx.select().from(paymentOrders).where(and(eq(paymentOrders.id, record.orderId), exactTenantCondition(paymentOrders.tenantId, record.tenantId))).for('update').limit(1);
  requireRow(order, '关联支付订单不存在', 409);
  if (order.channelAccountId !== record.accountId || order.appId !== record.applicationId || order.currency !== record.currency) throw new HTTPException(409, { message: '交易的账户、应用或币种与案件不一致' });
  const [refund] = record.refundId ? await tx.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, record.refundId), eq(paymentRefunds.orderId, order.id), exactTenantCondition(paymentRefunds.tenantId, record.tenantId))).for('update').limit(1) : [];
  if (record.refundId && !refund) throw new HTTPException(409, { message: '关联退款不存在' });
  if (refund ? refund.status !== 'success' : !['success', 'refunding', 'refunded'].includes(order.status)) throw new HTTPException(409, { message: '交易状态尚未确认，必须先查单补偿，不能以调账代替确认' });
  const sourceId = refund?.refundNo ?? order.orderNo;
  const journals = await tx.select({ id: paymentJournals.id, hash: paymentJournals.requestHash, sourceType: paymentJournals.sourceType, reversalOfJournalId: paymentJournals.reversalOfJournalId }).from(paymentJournals)
    .where(and(eq(paymentJournals.channelAccountId, record.accountId), eq(paymentJournals.appId, record.applicationId), eq(paymentJournals.sourceId, sourceId), exactTenantCondition(paymentJournals.tenantId, record.tenantId))).orderBy(asc(paymentJournals.id));
  const captureType = refund ? 'payment.refund' : 'payment.capture';
  if (!journals.some((j) => j.sourceType === captureType || (!refund && j.sourceType === 'payment.preauth.capture'))) throw new HTTPException(409, { message: '原交易尚未完整入账，请先恢复原业务凭证后重新核对' });
  const reversalRows = journals.length ? await tx.select({ id: paymentJournals.id, hash: paymentJournals.requestHash, reversalOfJournalId: paymentJournals.reversalOfJournalId }).from(paymentJournals).where(inArray(paymentJournals.reversalOfJournalId, journals.map((j) => j.id))).orderBy(asc(paymentJournals.id)) : [];
  if (reversalRows.length > 0) throw new HTTPException(409, { message: '原交易已有资金冲正，请重新核对' });
  return reconJson({ order: { id: order.id, version: order.version, status: order.status, amount: order.amount, paidAmount: order.paidAmount, feeAmount: order.feeAmount, netAmount: order.netAmount, channelTradeNo: order.channelTradeNo }, refund: refund ? { id: refund.id, version: refund.version, status: refund.status, amount: refund.refundAmount, channelRefundNo: refund.channelRefundNo } : null, journals, reversals: reversalRows });
}

async function authoritativeEvidence(tx: DbExecutor, record: PaymentReconCaseRow, input: z.output<typeof createPaymentReconAdjustmentSchema>) {
  assertReconAdjustmentAmount(record, input);
  const statementId = record.evidence.statementId;
  if (typeof statementId !== 'number') throw new HTTPException(409, { message: '案件没有已归档的渠道证据' });
  const [period] = await tx.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, record.periodId), exactTenantCondition(paymentStatementPeriods.tenantId, record.tenantId))).for('share').limit(1);
  const [statement] = await tx.select().from(paymentStatements).where(and(eq(paymentStatements.id, statementId), exactTenantCondition(paymentStatements.tenantId, record.tenantId))).for('share').limit(1);
  if (!statement || !period || statement.source !== 'provider_download' || statement.status !== 'validated' || period.currentStatementId !== statement.id || statement.periodId !== period.id || period.accountId !== record.accountId) throw new HTTPException(409, { message: '仅当前校验通过的真实渠道账单可作为调账依据；人工导入、沙箱和旧版本不可调账' });
  const [account] = await tx.select().from(paymentChannelAccounts).where(and(eq(paymentChannelAccounts.id, record.accountId), exactTenantCondition(paymentChannelAccounts.tenantId, record.tenantId))).limit(1);
  if (!account || account.environment !== 'production') throw new HTTPException(400, { message: '沙箱账户不可进行真实资金调整' });
  const [config] = await tx.select().from(paymentChannelConfigs).where(and(eq(paymentChannelConfigs.id, input.channelConfigId), eq(paymentChannelConfigs.channelAccountId, record.accountId), exactTenantCondition(paymentChannelConfigs.tenantId, record.tenantId))).limit(1);
  const [app] = await tx.select().from(paymentApps).where(and(eq(paymentApps.id, input.applicationId), exactTenantCondition(paymentApps.tenantId, record.tenantId))).limit(1);
  if (!config || config.status !== 'enabled' || !app || app.status !== 'enabled') throw new HTTPException(400, { message: '调整应用或渠道配置不存在、已停用或与案件账户不一致' });
  const boundId = config.channel === 'wechat' ? app.wechatConfigId : config.channel === 'alipay' ? app.alipayConfigId : app.unionpayConfigId;
  const [bound] = boundId ? await tx.select({ accountId: paymentChannelConfigs.channelAccountId }).from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, boundId)).limit(1) : [];
  if (bound?.accountId !== record.accountId) throw new HTTPException(400, { message: '应用没有绑定案件渠道账户' });
  const facts = await currentFacts(tx, record);
  const local = isPlainObject(record.evidence.local) ? record.evidence.local : null;
  const raw = local && isPlainObject(local.raw) ? local.raw : null;
  const fact = record.refundId ? facts.refund : facts.order;
  const matches = record.orderId ? isPlainObject(fact) && raw?.version === fact.version : isPlainObject(facts.journal) && raw?.journalId === facts.journal.id;
  if (!matches) throw new HTTPException(409, { message: '本地交易已变化，请重新核对后再申请调整' });
  return reconJson({ case: record, statementId: statement.id, statementHash: statement.contentHash, statementVersion: statement.version, facts, factsHash: reconEvidenceHash(facts) });
}

export async function createReconAdjustment(caseId: number, input: z.output<typeof createPaymentReconAdjustmentSchema>) {
  const visible = await requireReconCase(caseId);
  assertReconWriteScope(visible.tenantId);
  try {
    const row = await db.transaction(async (tx) => {
      const record = await lockCase(tx, caseId, visible.tenantId);
      const evidence = await authoritativeEvidence(tx, record, input);
      const stale = await tx.select().from(paymentReconAdjustments).where(and(eq(paymentReconAdjustments.caseId, caseId), isNull(paymentReconAdjustments.reversalOfId), inArray(paymentReconAdjustments.status, ['draft', 'pending', 'approved']))).for('update');
      for (const previous of stale) {
        if (previous.caseVersion === record.version) continue;
        await tx.update(paymentReconAdjustments).set({ status: 'rejected', evidence: { ...previous.evidence, invalidation: '差异版本已变化，由新申请替代' } }).where(eq(paymentReconAdjustments.id, previous.id));
        await tx.insert(paymentReconCaseEvents).values({ caseId, action: 'adjustment.invalidated', actorId: currentUser().userId, remark: '差异版本已变化，原调整不得执行', before: reconJson(mapAdjustment(previous)), tenantId: record.tenantId });
      }
      const [created] = await tx.insert(paymentReconAdjustments).values({ caseId, caseVersion: record.version, applicationId: input.applicationId, channelConfigId: input.channelConfigId, amount: BigInt(input.amount), direction: input.direction, reason: input.reason, evidence, applicantId: currentUser().userId, tenantId: record.tenantId }).returning();
      await tx.insert(paymentReconCaseEvents).values({ caseId, action: 'adjustment.created', actorId: currentUser().userId, remark: input.reason, after: reconJson(mapAdjustment(created)), tenantId: record.tenantId });
      return created;
    });
    return mapAdjustment(row);
  } catch (error) { rethrowPgUniqueViolation(error, '该案件已有待处理或已执行调整；请先处理现有调整单'); }
}

function workflowVariables(snapshot: ReturnType<typeof mapAdjustment>) {
  return { amount: snapshot.amount, direction: snapshot.direction, applicationId: snapshot.applicationId, caseId: snapshot.caseId, isReversal: snapshot.reversalOfId != null, adjustmentSnapshot: snapshot };
}

async function validatedPreview(row: PaymentReconAdjustmentRow, definitionId: number) {
  const settings = await getSettings('payment', { tenantId: row.tenantId });
  if (settings.reconApprovalDefinitionId != null && settings.reconApprovalDefinitionId !== definitionId) throw new HTTPException(400, { message: '必须使用支付设置绑定的调账审批流程' });
  const [definition] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, definitionId), exactTenantCondition(workflowDefinitions.tenantId, row.tenantId))).limit(1);
  if (!definition || definition.formType !== 'external' || (!isPlainObject(definition.customForm) || definition.customForm.viewComponent !== 'payment/PaymentReconAdjustmentApprovalView')) throw new HTTPException(400, { message: '请选择支付调账专用 external 审批流程' });
  const preview = await previewBusinessWorkflow(definitionId, workflowVariables(mapAdjustment(row)));
  const flow = preview.definition?.flowData;
  if (!flow || flow.settings?.allowResubmit !== false) throw new HTTPException(400, { message: '调账流程必须关闭实例内重提，调整资料只能按冻结轮次审批' });
  const humanNodes = preview.nodes.filter((node) => node.nodeType === 'approve' || node.nodeType === 'handler');
  if (!humanNodes.length || humanNodes.some((node) => node.approvers.length === 0 || node.approvers.some((person) => person.id === row.applicantId))) throw new HTTPException(400, { message: '调账流程必须明确配置申请人之外的人工审批人，不能为空或自动通过' });
  if (flow.nodes.some((node) => ['approve', 'handler'].includes(node.data.type) && (node.data.approvalType === 'autoApprove' || node.data.approveMethod === 'auto'))) throw new HTTPException(400, { message: '调账流程不允许自动通过审批节点' });
  return preview;
}

export async function previewReconAdjustmentWorkflow(id: number, input: z.output<typeof submitPaymentReconAdjustmentSchema>) {
  const row = await requireAdjustment(id);
  assertReconWriteScope(row.tenantId);
  return validatedPreview(row, input.definitionId);
}

/** On retries the exact stored submission snapshot is reused, even if the process crashed before linking the instance. */
export async function submitReconAdjustment(id: number, input: z.output<typeof submitPaymentReconAdjustmentSchema>) {
  const row = await requireAdjustment(id);
  assertReconWriteScope(row.tenantId);
  if (row.applicantId !== currentUser().userId) throw new HTTPException(403, { message: '只有申请人本人可提交调整单' });
  if (!['draft', 'pending'].includes(row.status)) return mapAdjustment(row);
  await validatedPreview(row, input.definitionId);
  const claimed = await db.transaction(async (tx) => {
    const record = await lockCase(tx, row.caseId, row.tenantId);
    const [fresh] = await tx.select().from(paymentReconAdjustments).where(adjustmentWhere(id, row.tenantId)).for('update').limit(1);
    requireRow(fresh, '调整单不存在');
    if (fresh.status !== 'draft') {
      if (fresh.status === 'pending' && fresh.evidence.approvalDefinitionId !== input.definitionId) throw new HTTPException(409, { message: '调整单已使用其他审批定义提交' });
      return fresh;
    }
    await assertFrozenEvidence(tx, fresh, record);
    const snapshot = mapAdjustment({ ...fresh, status: 'pending' });
    const evidence = { ...fresh.evidence, submissionSnapshot: snapshot, submissionHash: reconEvidenceHash(snapshot), approvalDefinitionId: input.definitionId };
    const [updated] = await tx.update(paymentReconAdjustments).set({ status: 'pending', evidence }).where(adjustmentWhere(id, row.tenantId)).returning();
    await tx.insert(paymentReconCaseEvents).values({ caseId: row.caseId, action: 'adjustment.submitted', actorId: currentUser().userId, after: reconJson(snapshot), tenantId: row.tenantId });
    return updated;
  });
  if (claimed.status !== 'pending') return mapAdjustment(claimed);
  const snapshot = paymentReconAdjustmentSchema.parse(claimed.evidence.submissionSnapshot);
  const instance = await startWorkflowForBiz({ definitionId: input.definitionId, title: `${claimed.reversalOfId ? '冲正' : '对账调整'} #${id} · ${claimed.amount.toString()} 分`, bizType: PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, bizId: id, variables: workflowVariables(snapshot) });
  await db.update(paymentReconAdjustments).set({ workflowInstanceId: instance.id }).where(and(adjustmentWhere(id, row.tenantId), eq(paymentReconAdjustments.status, 'pending'), isNull(paymentReconAdjustments.workflowInstanceId)));
  await syncAdjustmentWorkflow(id, row.tenantId, instance.id);
  return mapAdjustment(await requireAdjustment(id));
}

async function assertFrozenEvidence(tx: DbExecutor, row: PaymentReconAdjustmentRow, record: PaymentReconCaseRow) {
  if (row.caseVersion !== record.version) throw new HTTPException(409, { message: '差异版本已变化，当前审批证据失效，请重新核对并申请' });
  if (row.reversalOfId != null) {
    const [original] = await tx.select().from(paymentReconAdjustments).where(adjustmentWhere(row.reversalOfId, row.tenantId)).for('update').limit(1);
    if (!original || original.status !== 'executed' || !original.journalId || original.caseId !== row.caseId || original.applicationId !== row.applicationId || original.amount !== row.amount || original.direction === row.direction || original.journalId !== row.evidence.originalJournalId) throw new HTTPException(409, { message: '原调整已变化或已冲正，本冲正依据无效' });
    return;
  }
  const evidence = await authoritativeEvidence(tx, record, { amount: row.amount.toString(), direction: row.direction, applicationId: row.applicationId, channelConfigId: row.channelConfigId, reason: row.reason });
  if (evidence.statementHash !== row.evidence.statementHash || evidence.statementId !== row.evidence.statementId || evidence.factsHash !== row.evidence.factsHash) throw new HTTPException(409, { message: '渠道或本地资金事实已变化，可能已有查单补偿，请重新核对' });
}

/** Approved task actors come from the durable workflow outbox, never from assignee labels or automatic terminal status. */
async function humanApprovalProof(tx: DbExecutor, row: PaymentReconAdjustmentRow, instanceId: number) {
  const tasks = await tx.select().from(workflowTasks).where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'approved'), inArray(workflowTasks.nodeType, ['approve', 'handler']))).orderBy(asc(workflowTasks.id));
  if (!tasks.length || tasks.some((task) => !task.assigneeId || !task.actionAt || task.assigneeId === row.applicantId)) throw new HTTPException(409, { message: '审批未提供独立人工决定，禁止资金过账' });
  const jobs = await tx.select({ payload: workflowJobs.payload }).from(workflowJobs).where(and(eq(workflowJobs.instanceId, instanceId), eq(workflowJobs.jobType, 'event_dispatch')));
  return tasks.map((task) => {
    const event = jobs.map((job) => isPlainObject(job.payload) && isPlainObject(job.payload.event) ? job.payload.event : null).find((event) => event?.type === 'task.approved' && isPlainObject(event.task) && event.task.id === task.id);
    const actorId = event && isPlainObject(event.actor) ? event.actor.userId : null;
    if (typeof actorId !== 'number') throw new HTTPException(409, { message: '审批缺少持久化操作人证据，禁止过账' });
    assertIndependentReconApproval(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, row.applicantId, actorId);
    return { taskId: task.id, actorId, eventId: event!.eventId, nodeKey: task.nodeKey };
  });
}

async function syncAdjustmentWorkflow(id: number, tenantId: number | null, instanceId: number) {
  await db.transaction(async (tx) => {
    const [candidate] = await tx.select({ caseId: paymentReconAdjustments.caseId }).from(paymentReconAdjustments).where(adjustmentWhere(id, tenantId)).limit(1);
    if (!candidate) return;
    await lockCase(tx, candidate.caseId, tenantId);
    const [row] = await tx.select().from(paymentReconAdjustments).where(adjustmentWhere(id, tenantId)).for('update').limit(1);
    if (!row || row.status !== 'pending' || (row.workflowInstanceId != null && row.workflowInstanceId !== instanceId)) return;
    const [instance] = await tx.select().from(workflowInstances).where(and(eq(workflowInstances.id, instanceId), exactTenantCondition(workflowInstances.tenantId, tenantId))).limit(1);
    if (!instance || instance.bizType !== PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE || instance.bizId !== String(id) || instance.initiatorId !== row.applicantId || instance.definitionId !== row.evidence.approvalDefinitionId) return;
    const data = isPlainObject(instance.formData) ? instance.formData : {};
    if (reconEvidenceHash(data.adjustmentSnapshot) !== row.evidence.submissionHash) throw new HTTPException(409, { message: '审批资料与冻结调整不一致' });
    if (!['approved', 'rejected', 'withdrawn', 'cancelled'].includes(instance.status)) {
      if (row.workflowInstanceId == null) await tx.update(paymentReconAdjustments).set({ workflowInstanceId: instance.id }).where(adjustmentWhere(id, tenantId));
      return;
    }
    let proofs: Awaited<ReturnType<typeof humanApprovalProof>> = [];
    let approvalFailure: string | null = null;
    if (instance.status === 'approved') {
      try { proofs = await humanApprovalProof(tx, row, instance.id); }
      catch (error) {
        if (!(error instanceof HTTPException)) throw error;
        approvalFailure = error.message;
      }
    }
    const approverId = proofs.at(-1)?.actorId ?? null;
    const [updated] = await tx.update(paymentReconAdjustments).set({ status: instance.status === 'approved' && !approvalFailure ? 'approved' : 'rejected', workflowInstanceId: instance.id, approverId, approvedAt: approverId ? new Date() : null, evidence: { ...row.evidence, approvalProof: proofs, approvalFailure } }).where(adjustmentWhere(id, tenantId)).returning();
    await tx.insert(paymentReconCaseEvents).values({ caseId: row.caseId, action: `adjustment.${updated.status}`, actorId: approverId, remark: approvalFailure ?? `审批实例 #${instance.id}：${instance.status}`, before: reconJson(mapAdjustment(row)), after: reconJson(mapAdjustment(updated)), tenantId });
  });
}

export async function executeReconAdjustment(id: number) {
  const row = await requireAdjustment(id);
  assertReconWriteScope(row.tenantId);
  const policy = await reconNotificationPolicy(row.tenantId, row.applicantId);
  try { return await executeAdjustmentInternal(id, policy); }
  catch (error) {
    const message = error instanceof HTTPException ? error.message : '调整执行失败，请查看异常日志';
    try {
      await db.transaction(async (tx) => {
        const [record] = await tx.select({ orderId: paymentReconCases.orderId, refundId: paymentReconCases.refundId })
          .from(paymentReconCases).where(and(eq(paymentReconCases.id, row.caseId), exactTenantCondition(paymentReconCases.tenantId, row.tenantId))).limit(1);
        await tx.insert(paymentReconCaseEvents).values({ caseId: row.caseId, action: 'adjustment.execution_failed', actorId: currentUser().userId, remark: message, after: { adjustmentId: id }, tenantId: row.tenantId });
        await notifyWithin(tx, 'payment.recon.adjustment_failed', { tenantId: row.tenantId, recipients: policy.recipients,
          subjectRefs: record ? reconCaseSubjectRefs(record) : [],
          vars: { adjustmentId: id, caseId: row.caseId, message }, dedupeKey: `recon-adjustment-failed:${id}:${reconEvidenceHash(message).slice(0, 24)}`, link: `/payment/recon?caseId=${row.caseId}` });
      });
    } catch (notificationError) { logger.error('[payment-recon-adjustment] failed to record execution failure', { adjustmentId: id, notificationError }); }
    throw error;
  }
}

async function executeAdjustmentInternal(id: number, policy: Awaited<ReturnType<typeof reconNotificationPolicy>>) {
  let visible = await requireAdjustment(id);
  assertReconWriteScope(visible.tenantId);
  if (visible.status === 'executed' || visible.status === 'reversed') return mapAdjustment(visible);
  if (visible.workflowInstanceId) { await syncAdjustmentWorkflow(id, visible.tenantId, visible.workflowInstanceId); visible = await requireAdjustment(id); }
  if (visible.status !== 'approved') throw new HTTPException(409, { message: '调整尚未完成独立人工审批' });
  const result = await db.transaction(async (tx) => {
    const record = await lockCase(tx, visible.caseId, visible.tenantId);
    const [row] = await tx.select().from(paymentReconAdjustments).where(adjustmentWhere(id, visible.tenantId)).for('update').limit(1);
    requireRow(row, '调整单不存在');
    if (row.status === 'executed' || row.status === 'reversed') return row;
    if (row.status !== 'approved' || row.approverId == null || !Array.isArray(row.evidence.approvalProof) || row.evidence.approvalProof.length === 0) throw new HTTPException(409, { message: '独立审批证据不完整' });
    assertIndependentReconApproval(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, row.applicantId, row.approverId);
    const [instance] = await tx.select().from(workflowInstances).where(and(eq(workflowInstances.id, row.workflowInstanceId!), exactTenantCondition(workflowInstances.tenantId, row.tenantId))).for('share').limit(1);
    if (!instance || instance.status !== 'approved' || instance.bizType !== PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE || instance.bizId !== String(row.id) || !isPlainObject(instance.formData) || reconEvidenceHash(instance.formData.adjustmentSnapshot) !== row.evidence.submissionHash) throw new HTTPException(409, { message: '审批轮次或冻结资料已变化' });
    await assertFrozenEvidence(tx, row, record);
    const amount = row.amount.toString();
    const facts = isPlainObject(row.evidence.facts) ? row.evidence.facts : {};
    const counterAccountCode = typeof facts.counterAccountCode === 'string' && PAYMENT_LEDGER_ACCOUNT_CODES.includes(facts.counterAccountCode as PaymentLedgerAccountCode) ? facts.counterAccountCode as PaymentLedgerAccountCode : 'merchant_available';
    let lines: PostSystemPaymentJournalInput['lines'] = row.direction === 'in'
      ? [{ accountCode: 'provider_clearing', debitAmount: amount }, { accountCode: counterAccountCode, creditAmount: amount }]
      : [{ accountCode: counterAccountCode, debitAmount: amount }, { accountCode: 'provider_clearing', creditAmount: amount }];
    let reversalOfJournalId: number | undefined;
    if (row.reversalOfId != null) {
      reversalOfJournalId = Number(row.evidence.originalJournalId);
      const originalLines = await tx.select({ code: paymentLedgerAccounts.code, debit: paymentJournalLines.debitAmount, credit: paymentJournalLines.creditAmount }).from(paymentJournalLines).innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId)).where(eq(paymentJournalLines.journalId, reversalOfJournalId)).orderBy(asc(paymentJournalLines.lineNo));
      lines = originalLines.map((line) => ({ accountCode: line.code, debitAmount: line.credit.toString(), creditAmount: line.debit.toString() }));
    }
    const journalId = await postSystemJournalWithin(tx, { tenantId: row.tenantId, operatorId: currentUser().userId, appId: row.applicationId, channelConfigId: row.channelConfigId, currency: record.currency, sourceType: row.reversalOfId ? 'recon.adjust.reversal' : 'recon.adjust', sourceId: String(row.id), description: `对账${row.reversalOfId ? '冲正' : '调整'} #${row.id}：${row.reason}`.slice(0, 512), lines, reversalOfJournalId });
    const [updated] = await tx.update(paymentReconAdjustments).set({ status: 'executed', journalId, executedAt: new Date() }).where(adjustmentWhere(id, row.tenantId)).returning();
    if (row.reversalOfId) await tx.update(paymentReconAdjustments).set({ status: 'reversed' }).where(adjustmentWhere(row.reversalOfId, row.tenantId));
    const [updatedCase] = await tx.update(paymentReconCases).set({ status: row.reversalOfId ? 'open' : 'resolved', resolution: row.reversalOfId ? `调整 #${row.reversalOfId} 已冲正，需重新核对` : `调整 #${row.id} 已经独立审批并过账凭证 #${journalId}`, version: sql`${paymentReconCases.version} + 1` }).where(eq(paymentReconCases.id, record.id)).returning();
    await tx.insert(paymentReconCaseEvents).values({ caseId: row.caseId, action: row.reversalOfId ? 'adjustment.reversed' : 'adjustment.executed', actorId: currentUser().userId, remark: row.reason, before: reconJson(record), after: reconJson({ adjustment: mapAdjustment(updated), case: updatedCase, journalId }), tenantId: row.tenantId });
    await notifyWithin(tx, 'payment.adjustment.executed', { tenantId: row.tenantId, recipients: policy.recipients,
      subjectRefs: reconCaseSubjectRefs(record),
      vars: { adjustmentId: row.id, amount, currency: record.currency }, dedupeKey: `recon-adjustment-executed:${row.id}`, link: `/payment/recon?caseId=${row.caseId}` });
    return updated;
  });
  return mapAdjustment(result);
}

export async function reverseReconAdjustment(id: number, input: z.output<typeof reversePaymentReconAdjustmentSchema>) {
  const visible = await requireAdjustment(id);
  assertReconWriteScope(visible.tenantId);
  try {
    const row = await db.transaction(async (tx) => {
      const record = await lockCase(tx, visible.caseId, visible.tenantId);
      const [original] = await tx.select().from(paymentReconAdjustments).where(adjustmentWhere(id, visible.tenantId)).for('update').limit(1);
      if (!original || original.status !== 'executed' || original.reversalOfId != null || original.journalId == null) throw new HTTPException(400, { message: '仅已执行的原始调整可申请审批冲正' });
      const [created] = await tx.insert(paymentReconAdjustments).values({ caseId: original.caseId, caseVersion: record.version, applicationId: original.applicationId, channelConfigId: original.channelConfigId, amount: original.amount, direction: original.direction === 'in' ? 'out' : 'in', reason: input.reason, evidence: reconJson({ case: record, originalAdjustment: mapAdjustment(original), originalJournalId: original.journalId }), reversalOfId: original.id, applicantId: currentUser().userId, tenantId: original.tenantId }).returning();
      await tx.insert(paymentReconCaseEvents).values({ caseId: record.id, action: 'adjustment.reversal_requested', actorId: currentUser().userId, remark: input.reason, after: reconJson(mapAdjustment(created)), tenantId: original.tenantId });
      return created;
    });
    return mapAdjustment(row);
  } catch (error) { rethrowPgUniqueViolation(error, '原调整已经有冲正申请'); }
}

export async function getReconAdjustmentWorkflowContext(id: number, instanceId?: number) {
  const row = await requireAdjustment(id);
  if (!await hasPermission('payment:recon:list') && row.applicantId !== currentUser().userId) await requireBusinessApprovalInstance(instanceId ?? row.workflowInstanceId ?? 0, PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, String(id));
  if (instanceId != null) await requireBusinessApprovalInstance(instanceId, PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, String(id));
  if (row.status === 'pending' && row.workflowInstanceId) await syncAdjustmentWorkflow(row.id, row.tenantId, row.workflowInstanceId);
  return getBusinessWorkflowContext(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, String(id), row.workflowInstanceId, instanceId);
}

export async function getReconAdjustmentApprovalDetail(id: number, instanceId: number) {
  const instance = await requireBusinessApprovalInstance(instanceId, PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, String(id));
  const row = await requireAdjustment(id);
  if (instance.tenantId !== row.tenantId) throw new HTTPException(404, { message: '审批资料不属于当前租户' });
  const data = isPlainObject(instance.formData) ? instance.formData : {};
  const snapshot = paymentReconAdjustmentSchema.safeParse(data.adjustmentSnapshot);
  if (!snapshot.success || snapshot.data.id !== row.id || reconEvidenceHash(snapshot.data) !== row.evidence.submissionHash) throw new HTTPException(409, { message: '该轮审批缺少完整的冻结调整资料' });
  return { ...snapshot.data, workflowInstanceId: instanceId };
}

let registered = false;
export function registerReconAdjustmentSubscribers() {
  if (registered) return;
  registered = true;
  const sync = async (instance: { id: number; bizId?: string | null; tenantId?: number | null }) => {
    const id = Number(instance.bizId);
    if (Number.isSafeInteger(id) && id > 0) await syncAdjustmentWorkflow(id, instance.tenantId ?? null, instance.id);
  };
  onWorkflowResult(PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, { onCreated: sync, onApproved: sync, onRejected: sync, onWithdrawn: sync });
}
