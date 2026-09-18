import dayjs from 'dayjs';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_RECON_RULE_VERSION, reconcileEntries, type ReconciliationEntry } from '@zenith/shared/payment';
import { db, readSnapshot } from '../../db';
import type { DbExecutor } from '../../db/types';
import { paymentChannelAccounts, paymentStatementPeriods, paymentStatements, paymentStatementEntries, paymentReconRuns,
  paymentReconCases, paymentReconCaseEvents, paymentReconAdjustments, paymentOrders, paymentRefunds, asyncTasks, type PaymentStatementPeriodRow } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { currentUserOrNull } from '../../lib/context';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { TaskCancelledError, type TaskRunContext } from '../../lib/task-center';
import { reconJson, reconNotificationPolicy } from './payment-recon-common';
import { formatDateTime } from '../../lib/datetime';
import { loadFundFacts, loadBankFacts, loadFundBalanceSnapshot, balanceDifference } from './payment-recon-funds.service';

export function statementDateBounds(billDate: string, timezone: string) {
  const start = dayjs.tz(`${billDate} 00:00:00`, timezone);
  const nextDay = dayjs(billDate).add(1, 'day').format('YYYY-MM-DD');
  return { start: start.toDate(), end: dayjs.tz(`${nextDay} 00:00:00`, timezone).toDate() };
}

/** Account-wide facts include any referenced unknown order, plus successful facts in the business date. */
export async function loadTradeFacts(executor: DbExecutor, period: PaymentStatementPeriodRow, timezone: string, statementId?: number): Promise<ReconciliationEntry[]> {
  const { start, end } = statementDateBounds(period.billDate, timezone);
  const orderRefs = statementId ? executor.select({ no: paymentStatementEntries.merchantOrderNo }).from(paymentStatementEntries).where(eq(paymentStatementEntries.statementId, statementId)) : null;
  const providerRefs = statementId ? executor.select({ no: paymentStatementEntries.providerTransactionId }).from(paymentStatementEntries).where(eq(paymentStatementEntries.statementId, statementId)) : null;
  const refundRefs = statementId ? executor.select({ no: paymentStatementEntries.merchantRefundNo }).from(paymentStatementEntries).where(eq(paymentStatementEntries.statementId, statementId)) : null;
  const providerRefundRefs = statementId ? executor.select({ no: paymentStatementEntries.providerRefundId }).from(paymentStatementEntries).where(eq(paymentStatementEntries.statementId, statementId)) : null;
  const orders = await executor.select().from(paymentOrders).where(and(
    eq(paymentOrders.channelAccountId, period.accountId), exactTenantCondition(paymentOrders.tenantId, period.tenantId), eq(paymentOrders.currency, period.currency),
    or(and(gte(paymentOrders.paidAt, start), lt(paymentOrders.paidAt, end)),
      orderRefs ? inArray(paymentOrders.outTradeNo, orderRefs) : undefined,
      providerRefs ? inArray(paymentOrders.channelTradeNo, providerRefs) : undefined),
  ));
  const refunds = await executor.select({ refund: paymentRefunds, order: paymentOrders }).from(paymentRefunds)
    .innerJoin(paymentOrders, eq(paymentRefunds.orderId, paymentOrders.id)).where(and(
      eq(paymentRefunds.channelAccountId, period.accountId), exactTenantCondition(paymentRefunds.tenantId, period.tenantId),
      eq(paymentOrders.currency, period.currency), or(and(gte(paymentRefunds.refundedAt, start), lt(paymentRefunds.refundedAt, end)),
        refundRefs ? inArray(paymentRefunds.outRefundNo, refundRefs) : undefined,
        providerRefundRefs ? inArray(paymentRefunds.channelRefundNo, providerRefundRefs) : undefined),
    ));
  if (orders.length + refunds.length > 100_000) throw new HTTPException(413, { message: '单账期超过十万条，请按渠道子账户拆分账单' });
  // Referenced original payments outside this bill date locate refunds, but are not payment facts of this day.
  const paymentReferences = statementId ? await executor.select({ no: paymentStatementEntries.merchantOrderNo, provider: paymentStatementEntries.providerTransactionId })
    .from(paymentStatementEntries).where(and(eq(paymentStatementEntries.statementId, statementId), eq(paymentStatementEntries.type, 'payment'))) : [];
  const nos = new Set(paymentReferences.map((r) => r.no));
  const refs = new Set(paymentReferences.map((r) => r.provider));
  return [
    ...orders.filter((o) => (o.paidAt && o.paidAt >= start && o.paidAt < end) || nos.has(o.outTradeNo) || (o.channelTradeNo && refs.has(o.channelTradeNo))).map((o): ReconciliationEntry => ({
      entryKey: `payment:${o.outTradeNo}`, type: 'payment', merchantOrderNo: o.outTradeNo, providerTransactionId: o.channelTradeNo,
      amount: String(o.amount), currency: o.currency, direction: 'in', status: o.status,
      occurredAt: formatDateTime(o.paidAt ?? o.createdAt), applicationId: o.appId, orderId: o.id, accountId: period.accountId,
      raw: { version: o.version, orderNo: o.orderNo, paidAmount: o.paidAmount, paidAt: o.paidAt ? formatDateTime(o.paidAt) : null },
    })),
    ...refunds.map(({ refund: r, order: o }): ReconciliationEntry => ({
      entryKey: `refund:${r.outRefundNo}`, type: 'refund', merchantOrderNo: o.outTradeNo, merchantRefundNo: r.outRefundNo,
      providerTransactionId: o.channelTradeNo, providerRefundId: r.channelRefundNo, amount: String(r.refundAmount),
      currency: o.currency, direction: 'out', status: r.status, occurredAt: formatDateTime(r.refundedAt ?? r.createdAt),
      applicationId: o.appId, orderId: o.id, refundId: r.id, accountId: period.accountId,
      raw: { version: r.version, refundNo: r.refundNo, refundedAt: r.refundedAt ? formatDateTime(r.refundedAt) : null },
    })),
  ];
}

export async function executeReconRun(runId: number, tenantId: number | null, ctx: TaskRunContext) {
  const [run] = await db.select().from(paymentReconRuns).where(and(eq(paymentReconRuns.id, runId), exactTenantCondition(paymentReconRuns.tenantId, tenantId))).limit(1);
  requireRow(run, '核对运行不存在');
  if (run.status === 'completed') return { runId, matchedCount: run.matchedCount, diffCount: run.diffCount };
  const [statement] = await db.select().from(paymentStatements).where(and(eq(paymentStatements.id, run.statementId), exactTenantCondition(paymentStatements.tenantId, tenantId))).limit(1);
  requireRow(statement, '账单不存在');
  const [period] = await db.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, statement.periodId), exactTenantCondition(paymentStatementPeriods.tenantId, tenantId))).limit(1);
  requireRow(period, '账期不存在');
  if (statement.status !== 'validated' || period.currentStatementId !== statement.id) throw new HTTPException(409, { message: '只能核对当前已校验账单版本' });
  const [account] = await db.select().from(paymentChannelAccounts).where(and(eq(paymentChannelAccounts.id, period.accountId), exactTenantCondition(paymentChannelAccounts.tenantId, tenantId))).limit(1);
  requireRow(account, '渠道账户不存在');
  const policy = await reconNotificationPolicy(tenantId, run.createdBy ?? account.createdBy);
  if ((await ctx.progress({ note: '冻结本地事实快照', total: null })).cancelRequested) throw new TaskCancelledError('核对任务已取消');
  let local: ReconciliationEntry[];
  let snapshotContext: Record<string, any> = run.snapshotContext && typeof run.snapshotContext === 'object' ? run.snapshotContext : {};
  if (run.startedAt) {
    local = run.localSnapshot as ReconciliationEntry[];
  } else {
    const snapshot = await readSnapshot(async (tx) => {
      const facts = await (period.type === 'trade' ? loadTradeFacts(tx, period, account.billTimezone, statement.id)
        : period.type === 'fund' ? loadFundFacts(tx, period, account.billTimezone) : loadBankFacts(tx, period));
      const adjustments = await tx.select({ id: paymentReconAdjustments.id, caseId: paymentReconAdjustments.caseId,
        amount: paymentReconAdjustments.amount, direction: paymentReconAdjustments.direction, evidence: paymentReconAdjustments.evidence,
        journalId: paymentReconAdjustments.journalId }).from(paymentReconAdjustments)
        .innerJoin(paymentReconCases, eq(paymentReconCases.id, paymentReconAdjustments.caseId))
        .where(and(eq(paymentReconCases.periodId, period.id), eq(paymentReconAdjustments.status, 'executed'), exactTenantCondition(paymentReconAdjustments.tenantId, tenantId)));
      const cases = await tx.select({ id: paymentReconCases.id, version: paymentReconCases.version }).from(paymentReconCases).where(and(eq(paymentReconCases.periodId, period.id), exactTenantCondition(paymentReconCases.tenantId, tenantId)));
      return { facts, context: reconJson({ adjustments, cases, balance: period.type === 'fund' ? await loadFundBalanceSnapshot(tx, period, account.billTimezone) : null }) };
    });
    local = snapshot.facts; snapshotContext = snapshot.context;
    await db.update(paymentReconRuns).set({ status: 'running', startedAt: new Date(), localSnapshot: local.map(reconJson), snapshotContext, ruleVersion: PAYMENT_RECON_RULE_VERSION, error: null })
      .where(and(eq(paymentReconRuns.id, runId), exactTenantCondition(paymentReconRuns.tenantId, tenantId)));
  }
  const rows = await db.select().from(paymentStatementEntries).where(and(eq(paymentStatementEntries.statementId, statement.id), exactTenantCondition(paymentStatementEntries.tenantId, tenantId)));
  const provider: ReconciliationEntry[] = rows.map((r) => ({ ...r, amount: r.amount.toString(), feeAmount: r.feeAmount?.toString(),
    netAmount: r.netAmount?.toString(), balance: r.balance?.toString(), occurredAt: formatDateTime(r.occurredAt), accountId: period.accountId }));
  const compared = reconcileEntries(local, provider);
  if (period.type === 'fund') {
    const balance = snapshotContext.balance as { opening: string; closing: string } | null;
    const differences = balanceDifference(provider, balance ?? undefined);
    compared.differences.push(...differences);
    compared.totalCount += differences.length;
  }
  if ((await ctx.progress({ note: '保存核对结果和案件历史', total: compared.totalCount, processed: compared.totalCount })).cancelRequested) throw new TaskCancelledError('核对任务已取消');
  const result = await db.transaction(async (tx) => {
    // Serializes publication across revised bills, manual rechecks, and adjustment execution.
    const [lockedPeriod] = await tx.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, period.id), exactTenantCondition(paymentStatementPeriods.tenantId, tenantId))).for('update');
    if (lockedPeriod.currentStatementId !== statement.id) throw new HTTPException(409, { message: '核对期间账单版本发生变化，请核对新版账单' });
    const [lockedRun] = await tx.select().from(paymentReconRuns).where(eq(paymentReconRuns.id, runId)).for('update');
    if (lockedRun.status === 'completed') return { runId, matchedCount: lockedRun.matchedCount, diffCount: lockedRun.diffCount };
    const [ownedTask] = await tx.select({ status: asyncTasks.status, cancelRequested: asyncTasks.cancelRequested, attempts: asyncTasks.attempts }).from(asyncTasks).where(eq(asyncTasks.id, ctx.taskId)).for('share');
    if (lockedRun.taskId !== ctx.taskId || !ownedTask || ownedTask.status !== 'running' || ownedTask.cancelRequested || ownedTask.attempts !== ctx.attempt) throw new TaskCancelledError('核对任务已取消或由新执行器接管');
    const prior = await tx.select().from(paymentReconCases).where(and(eq(paymentReconCases.periodId, period.id), exactTenantCondition(paymentReconCases.tenantId, tenantId))).for('update');
    const frozenVersions = new Map(((snapshotContext.cases ?? []) as Array<{ id: number; version: number }>).map((item) => [item.id, item.version]));
    if (prior.some((item) => frozenVersions.has(item.id) && frozenVersions.get(item.id) !== item.version)) {
      throw new HTTPException(409, { message: '冻结快照后案件已有人工处理或调账，请重新核对以保留处置结果' });
    }
    const byKey = new Map(prior.map((r) => [r.caseKey, r]));
    const seen = new Set<string>();
    for (const difference of compared.differences) {
      const old = byKey.get(difference.caseKey);
      const evidence = reconJson({ ...difference.evidence, statementId: statement.id, statementVersion: statement.version,
        source: statement.source, ruleVersion: PAYMENT_RECON_RULE_VERSION });
      seen.add(difference.caseKey);
      const changed = !old || old.type !== difference.type || !isDeepStrictEqual(old.evidence, evidence);
      const posted = (snapshotContext.adjustments ?? []) as Array<{ caseId: number; amount: string; direction: string; evidence: { case?: { evidence?: Record<string, unknown> } }; journalId: number }>;
      const covered = old && posted.some((adjustment) => {
        const original = adjustment.evidence.case?.evidence;
        const delta = BigInt(difference.channelAmount ?? '0') - BigInt(difference.localAmount ?? '0');
        return adjustment.caseId === old.id && adjustment.journalId && original?.statementId === statement.id
          && isDeepStrictEqual(original.local, evidence.local) && isDeepStrictEqual(original.provider, evidence.provider)
          && (adjustment.direction === 'in' ? BigInt(adjustment.amount) : -BigInt(adjustment.amount)) === delta;
      });
      // An ignore decision only applies to its reviewed evidence; changed evidence needs a new decision.
      const status = covered ? 'resolved' as const : old?.status === 'ignored' && !changed ? 'ignored' as const
        : old?.status === 'resolved' || old?.status === 'ignored' || !old ? 'open' as const : old.status;
      const values = { type: difference.type, stage: period.type, status, lastRunId: runId,
        localAmount: difference.localAmount == null ? null : BigInt(difference.localAmount),
        channelAmount: difference.channelAmount == null ? null : BigInt(difference.channelAmount),
        currency: difference.currency, evidence, applicationId: difference.local?.applicationId ?? null,
        orderId: difference.local?.orderId ?? null, refundId: difference.local?.refundId ?? null };
      const [saved] = old ? await tx.update(paymentReconCases).set({ ...values, version: old.version + (changed || status !== old.status ? 1 : 0) }).where(eq(paymentReconCases.id, old.id)).returning()
        : await tx.insert(paymentReconCases).values({ ...values, accountId: period.accountId, periodId: period.id,
          caseKey: difference.caseKey, entryKey: difference.entryKey, tenantId, assignedTo: run.createdBy,
          dueAt: new Date(Date.now() + policy.settings.reconCaseSlaHours * 3_600_000) }).returning();
      if (changed || old?.status !== status) await tx.insert(paymentReconCaseEvents).values({ caseId: saved.id,
        action: old ? 'reconciled' : 'discovered', actorId: currentUserOrNull()?.userId ?? null,
        remark: `核对运行 #${runId}`, before: old ? reconJson(old) : null, after: reconJson(saved), tenantId });
    }
    for (const old of prior) {
      if (seen.has(old.caseKey) || old.status === 'resolved' || old.status === 'ignored') continue;
      const [resolved] = await tx.update(paymentReconCases).set({ status: 'resolved', resolution: `核对运行 #${runId} 差异已消除`,
        lastRunId: runId, version: old.version + 1 }).where(eq(paymentReconCases.id, old.id)).returning();
      await tx.insert(paymentReconCaseEvents).values({ caseId: old.id, action: 'resolved', before: reconJson(old), after: reconJson(resolved), tenantId });
    }
    await tx.update(paymentReconRuns).set({ status: 'completed', finishedAt: new Date(), matchedCount: compared.matchedCount,
      diffCount: compared.differences.length, totalCount: compared.totalCount, error: null }).where(eq(paymentReconRuns.id, runId));
    await tx.update(paymentStatementPeriods).set({ completedAt: new Date() }).where(eq(paymentStatementPeriods.id, period.id));
    if (compared.differences.length) await notifyWithin(tx, 'payment.recon.difference', {
      tenantId, recipients: policy.recipients, vars: { accountName: account.name, billDate: period.billDate, count: compared.differences.length },
      dedupeKey: `payment-recon-difference:${runId}`, link: `/payment/recon?periodId=${period.id}` });
    return { runId, matchedCount: compared.matchedCount, diffCount: compared.differences.length };
  });
  return result;
}
