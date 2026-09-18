import dayjs from 'dayjs';
import { asc, eq, gte, inArray, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { isPlainObject, type BodyOf } from '@zenith/shared/core';
import { PAYMENT_STATEMENT_ENTRY_TYPES, paymentBankMatchSchema, paymentReconContract, signedReconciliationAmount, type PaymentBankMatch, type ReconciliationDifference, type ReconciliationEntry } from '@zenith/shared/payment';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { paymentBankMatches, paymentJournalLines, paymentJournals, paymentLedgerAccounts, paymentOrders,
  paymentRefunds, paymentSettlementBatches, paymentSharingOrders, paymentSharingReversals, paymentTransfers,
  paymentStatementEntries, paymentStatementPeriods, paymentStatements, paymentReconCaseEvents, paymentReconCases, paymentReconRuns, paymentReconAdjustments,
  type PaymentBankMatchRow, type PaymentStatementEntryRow, type PaymentStatementPeriodRow } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { buildWhere } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { pickEntity } from '../../lib/entity-map';
import { currentUser } from '../../lib/context';
import { assertReconWriteScope, reconJson, requireReconAccount } from './payment-recon-common';

// Preauthorization freezes are claims on held funds, not movements in the provider's cash balance.
const NON_CASH_SOURCES = ['payment.preauth.freeze', 'payment.preauth.release', 'payment.preauth.release-remainder'];
const refundOrder = alias(paymentOrders, 'fund_refund_order');

function fundDateBounds(billDate: string, timezone: string) {
  return { start: dayjs.tz(`${billDate} 00:00:00`, timezone).toDate(), end: dayjs.tz(`${dayjs(billDate).add(1, 'day').format('YYYY-MM-DD')} 00:00:00`, timezone).toDate() };
}

/** Journal cash movements across every application sharing this provider account. */
export async function loadFundFacts(executor: DbExecutor, period: PaymentStatementPeriodRow, timezone: string): Promise<ReconciliationEntry[]> {
  const { start, end } = fundDateBounds(period.billDate, timezone);
  const rows = await executor.select({
    journalId: paymentJournals.id, journalNo: paymentJournals.journalNo, sourceType: paymentJournals.sourceType, sourceId: paymentJournals.sourceId,
    applicationId: paymentJournals.appId, postedAt: paymentJournals.postedAt, lineId: paymentJournalLines.id,
    debit: paymentJournalLines.debitAmount, credit: paymentJournalLines.creditAmount,
    orderId: paymentOrders.id, merchantOrderNo: paymentOrders.outTradeNo, providerTransactionId: paymentOrders.channelTradeNo,
    refundId: paymentRefunds.id, merchantRefundNo: paymentRefunds.outRefundNo, providerRefundId: paymentRefunds.channelRefundNo,
    refundOrderId: refundOrder.id, refundMerchantOrderNo: refundOrder.outTradeNo, refundProviderTransactionId: refundOrder.channelTradeNo,
    settlementReference: paymentSettlementBatches.payoutReference,
    transferReference: paymentTransfers.channelTransferNo, sharingReference: paymentSharingOrders.channelSharingNo,
    reversalReference: paymentSharingReversals.channelReversalNo,
    adjustmentId: paymentReconAdjustments.id, adjustmentEvidence: paymentReconAdjustments.evidence,
  }).from(paymentJournalLines)
    .innerJoin(paymentJournals, eq(paymentJournals.id, paymentJournalLines.journalId))
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .leftJoin(paymentOrders, buildWhere(eq(paymentOrders.orderNo, paymentJournals.sourceId), eq(paymentOrders.channelAccountId, period.accountId), exactTenantCondition(paymentOrders.tenantId, period.tenantId)))
    .leftJoin(paymentRefunds, buildWhere(eq(paymentRefunds.refundNo, paymentJournals.sourceId), eq(paymentRefunds.channelAccountId, period.accountId), exactTenantCondition(paymentRefunds.tenantId, period.tenantId)))
    .leftJoin(refundOrder, buildWhere(eq(refundOrder.id, paymentRefunds.orderId), eq(refundOrder.channelAccountId, period.accountId), exactTenantCondition(refundOrder.tenantId, period.tenantId)))
    .leftJoin(paymentSettlementBatches, buildWhere(eq(paymentSettlementBatches.batchNo, paymentJournals.sourceId), eq(paymentSettlementBatches.channelAccountId, period.accountId), exactTenantCondition(paymentSettlementBatches.tenantId, period.tenantId)))
    .leftJoin(paymentTransfers, buildWhere(eq(paymentTransfers.transferNo, paymentJournals.sourceId), eq(paymentTransfers.channelAccountId, period.accountId), exactTenantCondition(paymentTransfers.tenantId, period.tenantId)))
    .leftJoin(paymentSharingOrders, buildWhere(eq(paymentSharingOrders.sharingNo, paymentJournals.sourceId), exactTenantCondition(paymentSharingOrders.tenantId, period.tenantId)))
    .leftJoin(paymentSharingReversals, buildWhere(eq(paymentSharingReversals.reversalNo, paymentJournals.sourceId), exactTenantCondition(paymentSharingReversals.tenantId, period.tenantId)))
    .leftJoin(paymentReconAdjustments, buildWhere(eq(paymentReconAdjustments.journalId, paymentJournals.id), exactTenantCondition(paymentReconAdjustments.tenantId, period.tenantId)))
    .where(buildWhere(eq(paymentJournals.channelAccountId, period.accountId), exactTenantCondition(paymentJournals.tenantId, period.tenantId), eq(paymentJournals.currency, period.currency),
      eq(paymentLedgerAccounts.channelAccountId, period.accountId), exactTenantCondition(paymentLedgerAccounts.tenantId, period.tenantId), eq(paymentLedgerAccounts.currency, period.currency),
      eq(paymentLedgerAccounts.code, 'provider_clearing'), notInArray(paymentJournals.sourceType, NON_CASH_SOURCES), gte(paymentJournals.postedAt, start), lt(paymentJournals.postedAt, end)))
    .orderBy(asc(paymentJournals.id), asc(paymentJournalLines.id)).limit(100_001);
  if (rows.length > 100_000) throw new HTTPException(413, { message: '单账期资金流水超过十万条，请按渠道子账户拆分' });
  const journals = new Map<number, { row: typeof rows[number]; amount: bigint; lineIds: number[] }>();
  for (const row of rows) {
    const journal = journals.get(row.journalId) ?? { row, amount: 0n, lineIds: [] };
    journal.amount += row.debit - row.credit;
    journal.lineIds.push(row.lineId);
    journals.set(row.journalId, journal);
  }
  const facts = [...journals.values()].filter(({ amount }) => amount !== 0n).map(({ row, amount, lineIds }): ReconciliationEntry => {
    const type: ReconciliationEntry['type'] = ['payment.capture', 'payment.preauth.capture'].includes(row.sourceType) ? 'payment'
      : row.sourceType === 'payment.refund' ? 'refund'
        : row.sourceType === 'settlement.paid' ? 'settlement'
          : ['payment.transfer', 'payment.sharing', 'payment.sharing_reversal'].includes(row.sourceType) ? 'transfer'
            : row.sourceType.startsWith('provider.fee') ? 'fee' : 'adjustment';
    const reference = type === 'settlement' ? row.settlementReference || row.sourceId
      : type === 'transfer' ? row.transferReference || row.sharingReference || row.reversalReference || row.sourceId : row.sourceId;
    const result: ReconciliationEntry = {
      entryKey: `journal:${row.journalId}`, type, accountId: period.accountId, currency: period.currency,
      amount: (amount < 0n ? -amount : amount).toString(), direction: amount < 0n ? 'out' : 'in', status: 'success',
      occurredAt: formatDateTime(row.postedAt), applicationId: row.applicationId,
      orderId: row.orderId ?? row.refundOrderId, refundId: row.refundId,
      merchantOrderNo: row.merchantOrderNo ?? row.refundMerchantOrderNo, merchantRefundNo: row.merchantRefundNo,
      providerTransactionId: row.providerTransactionId ?? row.refundProviderTransactionId, providerRefundId: row.providerRefundId,
      reference: type === 'payment' || type === 'refund' ? undefined : reference,
      feeAmount: type === 'fee' ? (-amount).toString() : undefined,
      raw: { journalId: row.journalId, journalNo: row.journalNo, sourceType: row.sourceType, sourceId: row.sourceId, lineIds },
    };
    const adjustmentCase = row.adjustmentEvidence && isPlainObject(row.adjustmentEvidence.case) ? row.adjustmentEvidence.case : null;
    const adjustmentCaseEvidence = adjustmentCase && isPlainObject(adjustmentCase.evidence) ? adjustmentCase.evidence : null;
    const provider = adjustmentCaseEvidence && isPlainObject(adjustmentCaseEvidence.provider) ? adjustmentCaseEvidence.provider : null;
    const originalLocal = adjustmentCaseEvidence && isPlainObject(adjustmentCaseEvidence.local) ? adjustmentCaseEvidence.local : null;
    const originalRaw = originalLocal && isPlainObject(originalLocal.raw) ? originalLocal.raw : null;
    if (provider && typeof provider.type === 'string' && (PAYMENT_STATEMENT_ENTRY_TYPES as readonly string[]).includes(provider.type)) {
      result.type = provider.type as ReconciliationEntry['type'];
      for (const field of ['merchantOrderNo', 'merchantRefundNo', 'providerTransactionId', 'providerRefundId', 'reference'] as const) {
        result[field] = typeof provider[field] === 'string' ? provider[field] : undefined;
      }
      result.raw = { ...result.raw, adjustmentId: row.adjustmentId, adjustmentOriginalJournalId: originalRaw?.journalId ?? null };
    }
    return result;
  });
  return applyFundFactAdjustments(facts);
}

/** A correction and its reversal change the linked fact's net amount; they never create duplicate identities. */
export function applyFundFactAdjustments(entries: readonly ReconciliationEntry[]): ReconciliationEntry[] {
  const facts = new Map<number, ReconciliationEntry>();
  const others: ReconciliationEntry[] = [];
  for (const entry of entries) {
    if (typeof entry.raw?.journalId === 'number' && entry.raw.adjustmentId == null) facts.set(entry.raw.journalId, { ...entry, raw: { ...entry.raw } });
    else others.push(entry);
  }
  const orphaned: ReconciliationEntry[] = [];
  const orphanTargets = new Map<number, ReconciliationEntry>();
  for (const entry of others) {
    const originalId = entry.raw?.adjustmentOriginalJournalId;
    const original = typeof originalId === 'number' ? facts.get(originalId) ?? orphanTargets.get(originalId) : undefined;
    if (!original) {
      const copy = { ...entry, raw: { ...entry.raw } };
      orphaned.push(copy);
      if (typeof originalId === 'number') orphanTargets.set(originalId, copy);
      continue;
    }
    const total = signedReconciliationAmount(original.amount, original.direction) + signedReconciliationAmount(entry.amount, entry.direction);
    original.amount = (total < 0n ? -total : total).toString(); original.direction = total < 0n ? 'out' : 'in';
    const adjustmentJournalIds = Array.isArray(original.raw?.adjustmentJournalIds) ? original.raw.adjustmentJournalIds : [];
    original.raw = { ...original.raw, adjustmentJournalIds: [...adjustmentJournalIds, entry.raw?.journalId] };
    if (original.type === 'fee') original.feeAmount = (-total).toString();
  }
  return [...facts.values(), ...orphaned].filter((entry) => BigInt(entry.amount) !== 0n);
}

/** Freeze with the run if used for opening/closing balance comparisons. */
export async function loadFundBalanceSnapshot(executor: DbExecutor, period: PaymentStatementPeriodRow, timezone: string) {
  const { start, end } = fundDateBounds(period.billDate, timezone);
  const [row] = await executor.select({
    opening: sql<string>`coalesce(sum(case when ${paymentJournals.postedAt} < ${start} then ${paymentJournalLines.debitAmount} - ${paymentJournalLines.creditAmount} else 0 end), 0)::text`,
    closing: sql<string>`coalesce(sum(${paymentJournalLines.debitAmount} - ${paymentJournalLines.creditAmount}), 0)::text`,
  }).from(paymentJournalLines).innerJoin(paymentJournals, eq(paymentJournals.id, paymentJournalLines.journalId))
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .where(buildWhere(eq(paymentJournals.channelAccountId, period.accountId), exactTenantCondition(paymentJournals.tenantId, period.tenantId), eq(paymentJournals.currency, period.currency),
      eq(paymentLedgerAccounts.channelAccountId, period.accountId), exactTenantCondition(paymentLedgerAccounts.tenantId, period.tenantId), eq(paymentLedgerAccounts.code, 'provider_clearing'),
      notInArray(paymentJournals.sourceType, NON_CASH_SOURCES), lt(paymentJournals.postedAt, end)));
  return { opening: row?.opening ?? '0', closing: row?.closing ?? '0' };
}

/** Validate each balance transition, and optionally the frozen Journal opening/closing balances. */
export function balanceDifference(entries: readonly ReconciliationEntry[], expected?: { opening: string; closing: string }): ReconciliationDifference[] {
  if (!entries.length || !entries.some((entry) => entry.balance != null)) return [];
  const rowLine = (entry: ReconciliationEntry) => Number(entry.raw?.lineNo ?? (entry as ReconciliationEntry & { lineNo?: number }).lineNo ?? 0);
  const ordered = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || rowLine(a) - rowLine(b));
  const differences: ReconciliationDifference[] = [];
  const append = (entry: ReconciliationEntry, label: string, actual: string | null, calculated: string | null) => {
    differences.push({ caseKey: `balance:${label}`, entryKey: entry.entryKey, type: 'balance_diff', currency: entry.currency,
      localAmount: calculated, channelAmount: actual, local: null, provider: entry,
      evidence: { kind: label, expectedBalance: calculated, actualBalance: actual, provider: entry } });
  };
  let previous: bigint | null = null;
  for (const [index, entry] of ordered.entries()) {
    if (entry.balance == null) { append(entry, `missing:${entry.entryKey}`, null, null); previous = null; continue; }
    const delta = signedReconciliationAmount(entry.amount, entry.direction);
    const actual = BigInt(entry.balance);
    if (index === 0 && expected && actual - delta !== BigInt(expected.opening)) append(entry, 'opening', (actual - delta).toString(), expected.opening);
    if (previous !== null && actual !== previous + delta) append(entry, `transition:${entry.entryKey}`, entry.balance, (previous + delta).toString());
    previous = actual;
  }
  const last = ordered.at(-1)!;
  if (expected && last.balance != null && BigInt(last.balance) !== BigInt(expected.closing)) append(last, 'closing', last.balance, expected.closing);
  return differences;
}

type BankFactRow = Pick<PaymentStatementEntryRow, 'id' | 'entryKey' | 'type' | 'reference' | 'currency' | 'amount' | 'direction' | 'status' | 'occurredAt' | 'applicationId'>;
type Allocation = Pick<PaymentBankMatchRow, 'id' | 'bankEntryId' | 'settlementEntryId' | 'amount'>;
const bankEntryColumns = {
  id: paymentStatementEntries.id, entryKey: paymentStatementEntries.entryKey, type: paymentStatementEntries.type,
  reference: paymentStatementEntries.reference, currency: paymentStatementEntries.currency, amount: paymentStatementEntries.amount,
  direction: paymentStatementEntries.direction, status: paymentStatementEntries.status,
  occurredAt: paymentStatementEntries.occurredAt, applicationId: paymentStatementEntries.applicationId,
};

/** Only explicit allocations establish bank receipt facts; a matching text reference alone proves nothing. */
export function bankFactsFromAllocations(bankEntries: readonly BankFactRow[], settlements: readonly BankFactRow[], allocations: readonly Allocation[], accountId: number): ReconciliationEntry[] {
  const result: ReconciliationEntry[] = [];
  const byBank = new Map<number, Allocation[]>();
  const settlementAmounts = new Map<number, bigint>();
  for (const allocation of allocations) {
    const matches = byBank.get(allocation.bankEntryId) ?? [];
    matches.push(allocation); byBank.set(allocation.bankEntryId, matches);
    settlementAmounts.set(allocation.settlementEntryId, (settlementAmounts.get(allocation.settlementEntryId) ?? 0n) + allocation.amount);
  }
  for (const bank of bankEntries) {
    const matches = byBank.get(bank.id) ?? [];
    if (!matches.length) continue;
    const amount = matches.reduce((total, row) => total + row.amount, 0n);
    result.push({ entryKey: bank.entryKey, type: 'settlement', reference: bank.reference, currency: bank.currency,
      amount: amount.toString(), direction: 'in', status: 'success', occurredAt: formatDateTime(bank.occurredAt), accountId,
      raw: { bankEntryId: bank.id, allocationIds: matches.map((row) => row.id), settlementEntryIds: matches.map((row) => row.settlementEntryId) } });
  }
  for (const settlement of settlements) {
    const allocated = settlementAmounts.get(settlement.id) ?? 0n;
    if (allocated >= settlement.amount) continue;
    result.push({ entryKey: `unallocated-settlement:${settlement.id}`, type: 'settlement', reference: `unallocated-settlement:${settlement.id}`,
      amount: (settlement.amount - allocated).toString(), direction: 'in', status: 'success', currency: settlement.currency,
      occurredAt: formatDateTime(settlement.occurredAt), accountId, applicationId: settlement.applicationId,
      raw: { settlementEntryId: settlement.id, settlementReference: settlement.reference, amount: settlement.amount.toString(), allocated: allocated.toString() } });
  }
  return result;
}

export async function loadBankFacts(executor: DbExecutor, period: PaymentStatementPeriodRow): Promise<ReconciliationEntry[]> {
  if (!period.currentStatementId) return [];
  const bankEntries = await executor.select(bankEntryColumns).from(paymentStatementEntries)
    .where(buildWhere(eq(paymentStatementEntries.statementId, period.currentStatementId), exactTenantCondition(paymentStatementEntries.tenantId, period.tenantId),
      eq(paymentStatementEntries.type, 'settlement'), eq(paymentStatementEntries.direction, 'in'), eq(paymentStatementEntries.status, 'success')));
  const settlements = await executor.select(bankEntryColumns).from(paymentStatementEntries)
    .innerJoin(paymentStatements, eq(paymentStatements.id, paymentStatementEntries.statementId))
    .innerJoin(paymentStatementPeriods, eq(paymentStatementPeriods.id, paymentStatements.periodId))
    .where(buildWhere(eq(paymentStatementPeriods.accountId, period.accountId), exactTenantCondition(paymentStatementPeriods.tenantId, period.tenantId),
      eq(paymentStatementPeriods.currency, period.currency), inArray(paymentStatementPeriods.type, ['trade', 'fund']), lte(paymentStatementPeriods.billDate, period.billDate),
      eq(paymentStatementPeriods.currentStatementId, paymentStatements.id), eq(paymentStatements.status, 'validated'),
      exactTenantCondition(paymentStatementEntries.tenantId, period.tenantId), eq(paymentStatementEntries.type, 'settlement'), eq(paymentStatementEntries.direction, 'out'), eq(paymentStatementEntries.status, 'success')))
    .orderBy(asc(paymentStatementEntries.id)).limit(100_001);
  if (settlements.length + bankEntries.length > 100_000) throw new HTTPException(413, { message: '待核验银行与结算流水超过十万条' });
  const bankIds = executor.select({ id: paymentStatementEntries.id }).from(paymentStatementEntries)
    .where(buildWhere(eq(paymentStatementEntries.statementId, period.currentStatementId), exactTenantCondition(paymentStatementEntries.tenantId, period.tenantId)));
  const settlementIds = executor.select({ id: paymentStatementEntries.id }).from(paymentStatementEntries)
    .innerJoin(paymentStatements, eq(paymentStatements.id, paymentStatementEntries.statementId))
    .innerJoin(paymentStatementPeriods, eq(paymentStatementPeriods.id, paymentStatements.periodId))
    .where(buildWhere(eq(paymentStatementPeriods.accountId, period.accountId), exactTenantCondition(paymentStatementPeriods.tenantId, period.tenantId), eq(paymentStatementPeriods.currency, period.currency),
      inArray(paymentStatementPeriods.type, ['trade', 'fund']), lte(paymentStatementPeriods.billDate, period.billDate), eq(paymentStatementPeriods.currentStatementId, paymentStatements.id),
      eq(paymentStatements.status, 'validated'), eq(paymentStatementEntries.type, 'settlement'), eq(paymentStatementEntries.direction, 'out'), eq(paymentStatementEntries.status, 'success')));
  const allocations = await executor.select({ id: paymentBankMatches.id, bankEntryId: paymentBankMatches.bankEntryId, settlementEntryId: paymentBankMatches.settlementEntryId, amount: paymentBankMatches.amount })
    .from(paymentBankMatches).where(buildWhere(eq(paymentBankMatches.accountId, period.accountId), exactTenantCondition(paymentBankMatches.tenantId, period.tenantId),
      or(inArray(paymentBankMatches.bankEntryId, bankIds), inArray(paymentBankMatches.settlementEntryId, settlementIds)))).limit(1_000_001);
  if (allocations.length > 1_000_000) throw new HTTPException(413, { message: '单次银行核对的分配记录超过一百万条，请拆分账期' });
  return bankFactsFromAllocations(bankEntries, settlements, allocations, period.accountId);
}

type BankAllocationInput = BodyOf<typeof paymentReconContract.matchBank>['allocations'][number];

/** Called after locking all referenced entries, so no concurrent allocation can exceed either side. */
export function validateBankAllocationAmounts(entries: readonly Pick<PaymentStatementEntryRow, 'id' | 'amount'>[], existing: readonly Allocation[], proposed: readonly BankAllocationInput[]) {
  const capacities = new Map(entries.map((entry) => [entry.id, entry.amount]));
  const used = new Map<number, bigint>();
  const pairs = new Map(existing.map((allocation) => [`${allocation.bankEntryId}:${allocation.settlementEntryId}`, allocation.amount]));
  for (const allocation of existing) {
    used.set(allocation.bankEntryId, (used.get(allocation.bankEntryId) ?? 0n) + allocation.amount);
    used.set(allocation.settlementEntryId, (used.get(allocation.settlementEntryId) ?? 0n) + allocation.amount);
  }
  const additions: BankAllocationInput[] = [];
  for (const allocation of proposed) {
    const amount = BigInt(allocation.amount);
    if (amount <= 0n || allocation.bankEntryId === allocation.settlementEntryId) throw new HTTPException(400, { message: '银行分配金额及两端流水无效' });
    const pair = `${allocation.bankEntryId}:${allocation.settlementEntryId}`;
    if (pairs.has(pair)) {
      if (pairs.get(pair) !== amount) throw new HTTPException(409, { message: '该银行与结算流水已按不同金额分配，不能修改已归档分配' });
      continue;
    }
    for (const id of [allocation.bankEntryId, allocation.settlementEntryId]) {
      const capacity = capacities.get(id);
      const next = (used.get(id) ?? 0n) + amount;
      if (capacity === undefined || next > capacity) throw new HTTPException(409, { message: '分配金额超过银行到账或渠道结算的剩余金额' });
      used.set(id, next);
    }
    pairs.set(pair, amount); additions.push(allocation);
  }
  return additions;
}

/** Publication must already hold the owning period lock. Allocated versions are immutable. */
export async function assertStatementNotAllocated(executor: DbExecutor, statementId: number, tenantId: number | null): Promise<void> {
  const ids = executor.select({ id: paymentStatementEntries.id }).from(paymentStatementEntries)
    .where(buildWhere(eq(paymentStatementEntries.statementId, statementId), exactTenantCondition(paymentStatementEntries.tenantId, tenantId)));
  const [match] = await executor.select({ id: paymentBankMatches.id }).from(paymentBankMatches)
    .where(buildWhere(exactTenantCondition(paymentBankMatches.tenantId, tenantId), or(inArray(paymentBankMatches.bankEntryId, ids), inArray(paymentBankMatches.settlementEntryId, ids)))).limit(1);
  if (match) throw new HTTPException(409, { message: '此账单已关联银行到账，禁止替换证据版本；请先通过独立更正流程处理分配' });
}

export async function matchBankEntries(input: BodyOf<typeof paymentReconContract.matchBank>): Promise<PaymentBankMatch[]> {
  const account = await requireReconAccount(input.accountId);
  assertReconWriteScope(account.tenantId);
  const { persistReconTask, enqueueCommitted } = await import('./payment-recon-tasks');
  const ids = [...new Set(input.allocations.flatMap((allocation) => [allocation.bankEntryId, allocation.settlementEntryId]))].sort((a, b) => a - b);
  const result = await db.transaction(async (tx) => {
    const refs = await tx.select({ entryId: paymentStatementEntries.id, statementId: paymentStatements.id, periodId: paymentStatementPeriods.id })
      .from(paymentStatementEntries).innerJoin(paymentStatements, eq(paymentStatements.id, paymentStatementEntries.statementId))
      .innerJoin(paymentStatementPeriods, eq(paymentStatementPeriods.id, paymentStatements.periodId))
      .where(buildWhere(inArray(paymentStatementEntries.id, ids), eq(paymentStatementPeriods.accountId, account.id),
        exactTenantCondition(paymentStatementPeriods.tenantId, account.tenantId), exactTenantCondition(paymentStatementEntries.tenantId, account.tenantId)));
    if (refs.length !== ids.length) throw new HTTPException(404, { message: '银行或结算流水不存在或不属于当前渠道账户' });
    const periodIds = [...new Set(refs.map((row) => row.periodId))].sort((a, b) => a - b);
    const periods = await tx.select().from(paymentStatementPeriods).where(buildWhere(inArray(paymentStatementPeriods.id, periodIds), exactTenantCondition(paymentStatementPeriods.tenantId, account.tenantId)))
      .orderBy(asc(paymentStatementPeriods.id)).for('update');
    const locked = await tx.select({ ...bankEntryColumns, statementId: paymentStatementEntries.statementId }).from(paymentStatementEntries)
      .where(buildWhere(inArray(paymentStatementEntries.id, ids), exactTenantCondition(paymentStatementEntries.tenantId, account.tenantId))).orderBy(asc(paymentStatementEntries.id)).for('update');
    const statementIds = [...new Set(refs.map((row) => row.statementId))];
    const statements = await tx.select({ id: paymentStatements.id, status: paymentStatements.status }).from(paymentStatements)
      .where(buildWhere(inArray(paymentStatements.id, statementIds), exactTenantCondition(paymentStatements.tenantId, account.tenantId)));
    const byEntry = new Map(locked.map((entry) => [entry.id, entry]));
    const byStatement = new Map(statements.map((statement) => [statement.id, statement]));
    const byPeriod = new Map(periods.map((period) => [period.id, period]));
    const periodOfEntry = new Map(refs.map((ref) => [ref.entryId, requireRow(byPeriod.get(ref.periodId), '账期不存在')]));
    const bankStatements = new Set<number>();
    for (const allocation of input.allocations) {
      const bank = requireRow(byEntry.get(allocation.bankEntryId), '银行流水不存在');
      const settlement = requireRow(byEntry.get(allocation.settlementEntryId), '结算流水不存在');
      const bankPeriod = requireRow(periodOfEntry.get(bank.id), '银行账期不存在');
      const settlementPeriod = requireRow(periodOfEntry.get(settlement.id), '结算账期不存在');
      for (const [entry, period] of [[bank, bankPeriod], [settlement, settlementPeriod]] as const) {
        if (period.currentStatementId !== entry.statementId || byStatement.get(entry.statementId)?.status !== 'validated') throw new HTTPException(409, { message: '只允许分配当前已校验账单版本的流水' });
        if (entry.currency !== period.currency) throw new HTTPException(409, { message: '流水与账期币种不一致' });
      }
      if (bankPeriod.type !== 'bank' || !['trade', 'fund'].includes(settlementPeriod.type) || bank.type !== 'settlement' || settlement.type !== 'settlement'
        || bank.direction !== 'in' || settlement.direction !== 'out' || bank.status !== 'success' || settlement.status !== 'success') {
        throw new HTTPException(400, { message: '只能将成功的银行到账收入与渠道结算支出关联' });
      }
      if (bank.currency !== settlement.currency) throw new HTTPException(400, { message: '银行到账与渠道结算币种必须一致' });
      bankStatements.add(bank.statementId);
    }
    const existing = await tx.select().from(paymentBankMatches).where(buildWhere(eq(paymentBankMatches.accountId, account.id), exactTenantCondition(paymentBankMatches.tenantId, account.tenantId),
      or(inArray(paymentBankMatches.bankEntryId, ids), inArray(paymentBankMatches.settlementEntryId, ids))));
    const additions = validateBankAllocationAmounts(locked, existing, input.allocations);
    if (additions.length) {
      const [active] = await tx.select({ id: paymentReconRuns.id }).from(paymentReconRuns)
        .where(buildWhere(inArray(paymentReconRuns.statementId, [...bankStatements]), exactTenantCondition(paymentReconRuns.tenantId, account.tenantId), inArray(paymentReconRuns.status, ['pending', 'running']))).limit(1);
      if (active) throw new HTTPException(409, { message: '银行账单正在核对，请等待本次核对完成后分配到账' });
    }
    const inserted = additions.length ? await tx.insert(paymentBankMatches).values(additions.map((allocation) => ({ ...allocation, amount: BigInt(allocation.amount), accountId: account.id, tenantId: account.tenantId }))).returning() : [];
    const pairSet = new Set(input.allocations.map((allocation) => `${allocation.bankEntryId}:${allocation.settlementEntryId}`));
    if (inserted.length) {
      const cases = await tx.select({ id: paymentReconCases.id }).from(paymentReconCases).where(buildWhere(inArray(paymentReconCases.periodId, periodIds), eq(paymentReconCases.stage, 'bank'), exactTenantCondition(paymentReconCases.tenantId, account.tenantId)));
      if (cases.length) await tx.insert(paymentReconCaseEvents).values(cases.map((entry) => ({ caseId: entry.id, action: 'bank_allocated', actorId: currentUser().userId,
        remark: '银行到账与渠道结算已追加分配，等待重新核对', after: reconJson({ allocations: inserted }), tenantId: account.tenantId })));
    }
    const taskIds: number[] = [];
    if (inserted.length) for (const statementId of bankStatements) {
      const task = await persistReconTask(tx, statementId, account.tenantId, true);
      taskIds.push(task.id);
    }
    return { matches: [...existing, ...inserted].filter((allocation) => pairSet.has(`${allocation.bankEntryId}:${allocation.settlementEntryId}`)), taskIds };
  });
  for (const taskId of result.taskIds) await enqueueCommitted(taskId);
  return result.matches.map((row) => pickEntity(paymentBankMatchSchema, row, { amount: row.amount.toString() }));
}
