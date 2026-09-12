import type { QueryOutputOf } from '@zenith/shared/core';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_LEDGER_STANDARD_ACCOUNTS, type CreatePaymentFundReservationInput, type CreatePaymentLedgerAccountInput, type PaymentActiveReservationAmount, type PaymentFundReservation, type PaymentJournal, type PaymentJournalLine, type PaymentLedgerAccount, type PaymentLedgerAccountCode, type PostPaymentJournalInput, type TransitionPaymentFundReservationInput, paymentJournalContract } from '@zenith/shared/payment';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import { paymentApps, paymentChannelConfigs, paymentFundReservations, paymentJournalLines, paymentJournals, paymentLedgerAccounts, type PaymentFundReservationRow, type PaymentJournalRow, type PaymentLedgerAccountRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { runAsUser } from '../../lib/audit-context';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { isPgUniqueViolation, rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';

export interface PaymentMoneyScope {
  tenantId: number | null;
  appId: number;
  channelConfigId: number;
  currency: string;
}

interface JournalActor {
  tenantId: number | null;
  operatorId: number | null;
}

function mapLedgerAccount(row: PaymentLedgerAccountRow): PaymentLedgerAccount {
  return {
    id: row.id,
    accountNo: row.accountNo,
    name: row.name,
    code: row.code,
    normalBalance: row.normalBalance,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    status: row.status,
    ...formatTimestamps(row),
  };
}

function mapFundReservation(row: PaymentFundReservationRow): PaymentFundReservation {
  return {
    id: row.id,
    reservationNo: row.reservationNo,
    accountId: row.accountId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    amount: row.amount.toString(),
    status: row.status,
    version: row.version,
    reason: row.reason ?? null,
    finalizationReason: row.finalizationReason ?? null,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    expiresAt: formatNullableDateTime(row.expiresAt),
    finalizedAt: formatNullableDateTime(row.finalizedAt),
    ...formatTimestamps(row),
  };
}

async function assertScopeOwnership(executor: DbExecutor, scope: PaymentMoneyScope): Promise<void> {
  const tenantScopeForApp = exactTenantCondition(paymentApps.tenantId, scope.tenantId);
  const tenantScopeForConfig = exactTenantCondition(paymentChannelConfigs.tenantId, scope.tenantId);
  const [maybeApp] = await executor
    .select({
      id: paymentApps.id,
      wechatConfigId: paymentApps.wechatConfigId,
      alipayConfigId: paymentApps.alipayConfigId,
      unionpayConfigId: paymentApps.unionpayConfigId,
    })
    .from(paymentApps)
    .where(and(eq(paymentApps.id, scope.appId), tenantScopeForApp))
    .limit(1);
  const [maybeChannelConfig] = await executor
    .select({ id: paymentChannelConfigs.id, channel: paymentChannelConfigs.channel })
    .from(paymentChannelConfigs)
    .where(and(eq(paymentChannelConfigs.id, scope.channelConfigId), tenantScopeForConfig))
    .limit(1);
  const app = requireRow(maybeApp, '账务作用域中的支付应用不存在或租户不一致', 400);
  const channelConfig = requireRow(maybeChannelConfig, '账务作用域中的商户配置不存在或租户不一致', 400);
  const boundConfigId = channelConfig.channel === 'wechat'
    ? app.wechatConfigId
    : channelConfig.channel === 'alipay'
      ? app.alipayConfigId
      : app.unionpayConfigId;
  if (boundConfigId !== channelConfig.id) {
    throw new HTTPException(400, { message: '账务作用域中的商户配置未绑定到所选支付应用' });
  }
}

function accountScopeMatches(account: PaymentLedgerAccountRow, scope: PaymentMoneyScope): boolean {
  return (account.tenantId ?? null) === scope.tenantId
    && account.appId === scope.appId
    && account.channelConfigId === scope.channelConfigId
    && account.currency === scope.currency;
}

export type ListLedgerAccountsQuery = QueryOutputOf<typeof paymentJournalContract.accounts>;

export async function listLedgerAccounts(q: ListLedgerAccountsQuery) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [paymentLedgerAccounts.accountNo, paymentLedgerAccounts.name]),
    q.appId ? eq(paymentLedgerAccounts.appId, q.appId) : undefined,
    q.channelConfigId ? eq(paymentLedgerAccounts.channelConfigId, q.channelConfigId) : undefined,
    q.currency ? eq(paymentLedgerAccounts.currency, q.currency) : undefined,
    q.status ? eq(paymentLedgerAccounts.status, q.status) : undefined,
    tenantCondition(paymentLedgerAccounts, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentLedgerAccounts, where),
    rows: () => withPagination(db.select().from(paymentLedgerAccounts).where(where).orderBy(desc(paymentLedgerAccounts.id)).$dynamic(), page, pageSize),
    map: mapLedgerAccount,
  });
}

export async function createLedgerAccount(input: CreatePaymentLedgerAccountInput): Promise<PaymentLedgerAccount> {
  const user = currentUser();
  const scope: PaymentMoneyScope = {
    tenantId: requireTenantScopeId(user),
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
  };
  await assertScopeOwnership(db, scope);
  try {
    const [row] = await db.insert(paymentLedgerAccounts).values({
      accountNo: `PLA${randomUUID().replaceAll('-', '')}`,
      name: input.name,
      code: input.code,
      normalBalance: PAYMENT_LEDGER_STANDARD_ACCOUNTS[input.code].normalBalance,
      appId: scope.appId,
      channelConfigId: scope.channelConfigId,
      currency: scope.currency,
      status: 'enabled',
      tenantId: scope.tenantId,
    }).returning();
    return mapLedgerAccount(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同一账务作用域下该科目已存在');
  }
}

interface JournalLineWithAccount {
  journalId: number;
  id: number;
  lineNo: number;
  accountId: number;
  accountNo: string;
  accountName: string;
  debitAmount: bigint;
  creditAmount: bigint;
  memo: string | null;
}

async function loadJournalLines(journalIds: number[]): Promise<Map<number, PaymentJournalLine[]>> {
  if (journalIds.length === 0) return new Map();
  const rows: JournalLineWithAccount[] = await db
    .select({
      journalId: paymentJournalLines.journalId,
      id: paymentJournalLines.id,
      lineNo: paymentJournalLines.lineNo,
      accountId: paymentJournalLines.accountId,
      accountNo: paymentLedgerAccounts.accountNo,
      accountName: paymentLedgerAccounts.name,
      debitAmount: paymentJournalLines.debitAmount,
      creditAmount: paymentJournalLines.creditAmount,
      memo: paymentJournalLines.memo,
    })
    .from(paymentJournalLines)
    .innerJoin(paymentLedgerAccounts, eq(paymentLedgerAccounts.id, paymentJournalLines.accountId))
    .where(inArray(paymentJournalLines.journalId, journalIds))
    .orderBy(paymentJournalLines.journalId, paymentJournalLines.lineNo);
  const grouped = new Map<number, PaymentJournalLine[]>();
  for (const row of rows) {
    const lines = grouped.get(row.journalId) ?? [];
    lines.push({
      id: row.id,
      lineNo: row.lineNo,
      accountId: row.accountId,
      accountNo: row.accountNo,
      accountName: row.accountName,
      debitAmount: row.debitAmount.toString(),
      creditAmount: row.creditAmount.toString(),
      memo: row.memo ?? null,
    });
    grouped.set(row.journalId, lines);
  }
  return grouped;
}

/**
 * Return the child reversal journal for each original journal in the result.
 * Reversal links are stored on the child row, so this reverse lookup must be
 * performed explicitly for list/detail responses. Keep the caller's tenant
 * scope on the lookup to avoid exposing a cross-scope relationship.
 */
async function loadReversalMap(journalIds: number[], scope?: SQL): Promise<Map<number, number>> {
  if (journalIds.length === 0) return new Map();
  const rows = await db
    .select({ id: paymentJournals.id, reversalOfJournalId: paymentJournals.reversalOfJournalId })
    .from(paymentJournals)
    .where(and(inArray(paymentJournals.reversalOfJournalId, journalIds), scope));
  return new Map(
    rows.flatMap((row) => row.reversalOfJournalId == null ? [] : [[row.reversalOfJournalId, row.id] as const]),
  );
}

function mapJournal(row: PaymentJournalRow, lines: PaymentJournalLine[], reversedByJournalId?: number | null): PaymentJournal {
  return {
    id: row.id,
    journalNo: row.journalNo,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    description: row.description,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    reversalOfJournalId: row.reversalOfJournalId ?? null,
    reversedByJournalId: reversedByJournalId ?? null,
    operatorId: row.operatorId ?? null,
    postedAt: formatDateTime(row.postedAt),
    createdAt: formatDateTime(row.createdAt),
    lines,
  };
}

async function getJournalRow(id: number): Promise<PaymentJournalRow> {
  const [row] = await db
    .select()
    .from(paymentJournals)
    .where(and(eq(paymentJournals.id, id), tenantCondition(paymentJournals, currentUser())))
    .limit(1);
  requireRow(row, '资金凭证不存在');
  return row;
}

export async function getJournal(id: number): Promise<PaymentJournal> {
  const row = await getJournalRow(id);
  const tenantScope = tenantCondition(paymentJournals, currentUser());
  const [lines, reversalMap] = await Promise.all([
    loadJournalLines([row.id]),
    loadReversalMap([row.id], tenantScope),
  ]);
  return mapJournal(row, lines.get(row.id) ?? [], reversalMap.get(row.id));
}

export type ListJournalsQuery = QueryOutputOf<typeof paymentJournalContract.list>;

export async function listJournals(q: ListJournalsQuery) {
  const { page, pageSize } = q;
  const user = currentUser();
  const tenantScope = tenantCondition(paymentJournals, user);
  const where = buildWhere(
    ...dateRangeConditions(paymentJournals.postedAt, q.startTime, q.endTime),
    q.sourceType ? eq(paymentJournals.sourceType, q.sourceType) : undefined,
    q.appId ? eq(paymentJournals.appId, q.appId) : undefined,
    q.channelConfigId ? eq(paymentJournals.channelConfigId, q.channelConfigId) : undefined,
    q.currency ? eq(paymentJournals.currency, q.currency) : undefined,
    tenantScope,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentJournals, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(paymentJournals).where(where).orderBy(desc(paymentJournals.id)).$dynamic(), page, pageSize);
      const journalIds = rows.map((row) => row.id);
      const [lines, reversalMap] = await Promise.all([
        loadJournalLines(journalIds),
        loadReversalMap(journalIds, tenantScope),
      ]);
      return rows.map((row) => mapJournal(row, lines.get(row.id) ?? [], reversalMap.get(row.id)));
    },
  });
}

function journalRequestHash(input: PostPaymentJournalInput, reversalOfJournalId: number | null): string {
  return createHash('sha256').update(JSON.stringify({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
    reversalOfJournalId,
    lines: input.lines.map((line) => ({
      accountId: line.accountId,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      memo: line.memo ?? null,
    })),
  })).digest('hex');
}

function journalSourceWhere(scope: PaymentMoneyScope, sourceType: string, sourceId: string) {
  return and(
    exactTenantCondition(paymentJournals.tenantId, scope.tenantId),
    eq(paymentJournals.appId, scope.appId),
    eq(paymentJournals.channelConfigId, scope.channelConfigId),
    eq(paymentJournals.currency, scope.currency),
    eq(paymentJournals.sourceType, sourceType),
    eq(paymentJournals.sourceId, sourceId),
  );
}

/** 分录归一化（顺序行号、bigint 金额、空备注归 null）并校验借贷平衡：借贷相等且大于 0 */
function normalizeBalancedLines(lines: PostPaymentJournalInput['lines']) {
  const normalized = lines.map((line, index) => ({
    lineNo: index + 1,
    accountId: line.accountId,
    debitAmount: BigInt(line.debitAmount),
    creditAmount: BigInt(line.creditAmount),
    memo: line.memo ?? null,
  }));
  const debitTotal = normalized.reduce((total, line) => total + line.debitAmount, 0n);
  const creditTotal = normalized.reduce((total, line) => total + line.creditAmount, 0n);
  if (debitTotal <= 0n || debitTotal !== creditTotal) {
    throw new HTTPException(400, { message: '资金凭证借贷金额必须相等且大于 0' });
  }
  return normalized;
}

/**
 * 同一凭证来源（作用域 + sourceType + sourceId）已入账时的幂等判定：
 * 内容一致（requestHash 相同）返回已有凭证 id 供复用；不一致抛 409；尚未入账返回 undefined。
 */
async function findPostedJournalId(
  executor: DbExecutor,
  scope: PaymentMoneyScope,
  source: { sourceType: string; sourceId: string },
  requestHash: string,
): Promise<number | undefined> {
  const [existing] = await executor
    .select({ id: paymentJournals.id, requestHash: paymentJournals.requestHash })
    .from(paymentJournals)
    .where(journalSourceWhere(scope, source.sourceType, source.sourceId))
    .limit(1);
  if (!existing) return undefined;
  if (existing.requestHash !== requestHash) throw new HTTPException(409, { message: '同一凭证来源对应的内容不一致' });
  return existing.id;
}

async function getJournalForTenant(id: number, tenantId: number | null): Promise<PaymentJournal> {
  const [row] = await db
    .select()
    .from(paymentJournals)
    .where(and(eq(paymentJournals.id, id), exactTenantCondition(paymentJournals.tenantId, tenantId)))
    .limit(1);
  requireRow(row, '资金凭证不存在');
  const tenantScope = exactTenantCondition(paymentJournals.tenantId, tenantId);
  const [lines, reversalMap] = await Promise.all([
    loadJournalLines([row.id]),
    loadReversalMap([row.id], tenantScope),
  ]);
  return mapJournal(row, lines.get(row.id) ?? [], reversalMap.get(row.id));
}

async function postJournalInternal(
  input: PostPaymentJournalInput,
  reversalOfJournalId: number | null,
  actor: JournalActor,
): Promise<PaymentJournal> {
  const scope: PaymentMoneyScope = {
    tenantId: actor.tenantId,
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
  };
  const normalized = normalizeBalancedLines(input.lines);
  const requestHash = journalRequestHash(input, reversalOfJournalId);

  let journalId: number;
  try {
    journalId = await db.transaction(async (tx) => {
      const posted = await findPostedJournalId(tx, scope, input, requestHash);
      if (posted !== undefined) return posted;

      await assertScopeOwnership(tx, scope);
      const accountIds = [...new Set(normalized.map((line) => line.accountId))];
      const accounts = await tx.select().from(paymentLedgerAccounts).where(inArray(paymentLedgerAccounts.id, accountIds));
      if (accounts.length !== accountIds.length) throw new HTTPException(400, { message: '资金凭证包含不存在的账本账户' });
      for (const account of accounts) {
        if (account.status !== 'enabled') throw new HTTPException(400, { message: `账本账户 ${account.accountNo} 已停用` });
        if (!accountScopeMatches(account, scope)) throw new HTTPException(400, { message: `账本账户 ${account.accountNo} 与凭证作用域不一致` });
      }

      const [journal] = await tx.insert(paymentJournals).values({
        journalNo: `JRN${randomUUID().replaceAll('-', '')}`,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        requestHash,
        description: input.description,
        appId: scope.appId,
        channelConfigId: scope.channelConfigId,
        currency: scope.currency,
        reversalOfJournalId,
        operatorId: actor.operatorId,
        tenantId: scope.tenantId,
      }).returning({ id: paymentJournals.id });
      await tx.insert(paymentJournalLines).values(normalized.map((line) => ({ ...line, journalId: journal.id })));
      return journal.id;
    });
  } catch (err) {
    if (!isPgUniqueViolation(err)) throw err;
    const [existing] = await db
      .select({ id: paymentJournals.id, requestHash: paymentJournals.requestHash })
      .from(paymentJournals)
      .where(journalSourceWhere(scope, input.sourceType, input.sourceId))
      .limit(1);
    if (!existing || existing.requestHash !== requestHash) {
      throw new HTTPException(409, { message: '资金凭证幂等冲突' });
    }
    journalId = existing.id;
  }
  return getJournalForTenant(journalId, scope.tenantId);
}

export function postJournal(input: PostPaymentJournalInput): Promise<PaymentJournal> {
  if (!input.sourceType.startsWith('manual.')) {
    throw new HTTPException(400, { message: '人工凭证来源类型必须以 manual. 开头' });
  }
  const user = currentUser();
  return postJournalInternal(input, null, {
    tenantId: requireTenantScopeId(user),
    operatorId: user.userId,
  });
}

function standardAccountNo(scope: PaymentMoneyScope, code: PaymentLedgerAccountCode): string {
  const digest = createHash('sha256')
    .update(`${scope.tenantId ?? 0}:${scope.appId}:${scope.channelConfigId}:${scope.currency}:${code}`)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase();
  return `PLA${digest}`;
}

async function ensureStandardLedgerAccountsInternal(
  executor: DbExecutor,
  scope: PaymentMoneyScope,
  codes: readonly PaymentLedgerAccountCode[],
): Promise<Map<PaymentLedgerAccountCode, PaymentLedgerAccountRow>> {
  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length === 0) return new Map();
  await assertScopeOwnership(executor, scope);
  await executor
    .insert(paymentLedgerAccounts)
    .values(uniqueCodes.map((code) => ({
      accountNo: standardAccountNo(scope, code),
      name: PAYMENT_LEDGER_STANDARD_ACCOUNTS[code].name,
      code,
      normalBalance: PAYMENT_LEDGER_STANDARD_ACCOUNTS[code].normalBalance,
      appId: scope.appId,
      channelConfigId: scope.channelConfigId,
      currency: scope.currency,
      status: 'enabled' as const,
      tenantId: scope.tenantId,
    })))
    .onConflictDoNothing();
  const rows = await executor
    .select()
    .from(paymentLedgerAccounts)
    .where(and(
      exactTenantCondition(paymentLedgerAccounts.tenantId, scope.tenantId),
      eq(paymentLedgerAccounts.appId, scope.appId),
      eq(paymentLedgerAccounts.channelConfigId, scope.channelConfigId),
      eq(paymentLedgerAccounts.currency, scope.currency),
      inArray(paymentLedgerAccounts.code, uniqueCodes),
    ));
  const accountByCode = new Map(rows.map((row) => [row.code, row]));
  for (const code of uniqueCodes) {
    const maybeAccount = accountByCode.get(code);
    const account = requireRow(maybeAccount, `标准账本账户 ${code} 创建失败`, 409);
    if (account.status !== 'enabled') throw new HTTPException(409, { message: `标准账本账户 ${code} 已停用` });
  }
  return accountByCode;
}

/** 为资金业务显式作用域取得标准账户；不依赖 HTTP/currentUser 上下文。 */
export async function ensureSystemLedgerAccount(
  scope: PaymentMoneyScope,
  code: PaymentLedgerAccountCode,
): Promise<PaymentLedgerAccountRow> {
  return db.transaction(async (tx) => {
    const accounts = await ensureStandardLedgerAccountsInternal(tx, scope, [code]);
    return accounts.get(code)!;
  });
}

export interface PostSystemPaymentJournalInput {
  tenantId: number | null;
  operatorId: number | null;
  sourceType: string;
  sourceId: string;
  description: string;
  appId: number;
  channelConfigId: number;
  currency: string;
  lines: Array<{
    accountCode: PaymentLedgerAccountCode;
    debitAmount?: string;
    creditAmount?: string;
    memo?: string;
  }>;
}

async function postSystemJournalWithExecutor(
  executor: DbExecutor,
  input: PostSystemPaymentJournalInput,
): Promise<number> {
  const scope: PaymentMoneyScope = {
    tenantId: input.tenantId,
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
  };
  const accounts = await ensureStandardLedgerAccountsInternal(
    executor,
    scope,
    input.lines.map((line) => line.accountCode),
  );
  const journalInput: PostPaymentJournalInput = {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
    lines: input.lines.map((line) => ({
      accountId: accounts.get(line.accountCode)!.id,
      debitAmount: line.debitAmount ?? '0',
      creditAmount: line.creditAmount ?? '0',
      memo: line.memo,
    })),
  };
  const normalized = normalizeBalancedLines(journalInput.lines);
  const requestHash = journalRequestHash(journalInput, null);
  const posted = await findPostedJournalId(executor, scope, input, requestHash);
  if (posted !== undefined) return posted;
  // Idempotency must win before any balance check. A retry after a crash may
  // legitimately see the already-posted journal while the current balance has
  // since changed; re-running the debit guard would incorrectly reject it.
  const availableAccount = accounts.get('merchant_available');
  const availableDebit = availableAccount
    ? normalized
      .filter((line) => line.accountId === availableAccount.id)
      .reduce((total, line) => total + line.debitAmount, 0n)
    : 0n;
  if (availableAccount && availableDebit > 0n) {
    await assertMerchantAvailableDebit(executor, scope, availableAccount.id, availableDebit, input.sourceType, input.sourceId);
  }
  const [journal] = await executor
    .insert(paymentJournals)
    .values({
      journalNo: `JRN${randomUUID().replaceAll('-', '')}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      requestHash,
      description: input.description,
      appId: input.appId,
      channelConfigId: input.channelConfigId,
      currency: input.currency,
      reversalOfJournalId: null,
      operatorId: input.operatorId,
      tenantId: input.tenantId,
    })
    .onConflictDoNothing()
    .returning({ id: paymentJournals.id });
  if (!journal) {
    const [raced] = await executor
      .select({ id: paymentJournals.id, requestHash: paymentJournals.requestHash })
      .from(paymentJournals)
      .where(journalSourceWhere(scope, input.sourceType, input.sourceId))
      .limit(1);
    if (!raced || raced.requestHash !== requestHash) throw new HTTPException(409, { message: '资金凭证幂等冲突' });
    return raced.id;
  }
  await executor.insert(paymentJournalLines).values(normalized.map((line) => ({ ...line, journalId: journal.id })));
  return journal.id;
}

/**
 * 在同一事务内锁定可用账户并校验余额。转账有自己的 active reservation，
 * 该 reservation 会从普通可用余额中扣除，但允许由同一 transfer source 消费。
 */
async function assertMerchantAvailableDebit(
  executor: DbExecutor,
  scope: PaymentMoneyScope,
  accountId: number,
  debitAmount: bigint,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  await executor.execute(sql`SELECT id FROM payment_ledger_accounts WHERE id = ${accountId} FOR UPDATE`);
  const [balance] = await executor
    .select({ amount: sql<string>`coalesce(sum(${paymentJournalLines.creditAmount} - ${paymentJournalLines.debitAmount}), 0)::text` })
    .from(paymentJournalLines)
    .where(eq(paymentJournalLines.accountId, accountId));
  const excludeCurrentTransfer = sourceType === 'payment.transfer'
    ? sql`not (${paymentFundReservations.sourceType} = 'payment.transfer' and ${paymentFundReservations.sourceId} = ${sourceId})`
    : undefined;
  if (sourceType === 'payment.transfer') {
    const [own] = await executor
      .select({ amount: paymentFundReservations.amount })
      .from(paymentFundReservations)
      .where(and(
        eq(paymentFundReservations.accountId, accountId),
        eq(paymentFundReservations.sourceType, 'payment.transfer'),
        eq(paymentFundReservations.sourceId, sourceId),
        eq(paymentFundReservations.status, 'active'),
        exactTenantCondition(paymentFundReservations.tenantId, scope.tenantId),
      ))
      .limit(1);
    const ownTransferReservation = own?.amount ?? 0n;
    if (ownTransferReservation < debitAmount) {
      throw new HTTPException(409, { message: '转账资金预占不足，拒绝过账' });
    }
  }
  const [reserved] = await executor
    .select({ amount: sql<string>`coalesce(sum(${paymentFundReservations.amount}), 0)::text` })
    .from(paymentFundReservations)
    .where(buildWhere(
      eq(paymentFundReservations.accountId, accountId),
      eq(paymentFundReservations.status, 'active'),
      or(isNull(paymentFundReservations.expiresAt), gt(paymentFundReservations.expiresAt, new Date())),
      exactTenantCondition(paymentFundReservations.tenantId, scope.tenantId),
      excludeCurrentTransfer,
    ));
  const available = BigInt(balance?.amount ?? '0') - BigInt(reserved?.amount ?? '0');
  if (available < debitAmount) {
    throw new HTTPException(409, { message: `商户可用余额不足，拒绝过账（可用 ${available.toString()} 分）` });
  }
}

/** 在调用方事务内过账，供“业务终态 + Journal”原子提交。 */
export function postSystemJournalWithin(
  executor: DbExecutor,
  input: PostSystemPaymentJournalInput,
): Promise<number> {
  const work = () => postSystemJournalWithExecutor(executor, input);
  return input.operatorId == null ? work() : runAsUser(input.operatorId, work);
}

/**
 * 供回调、Outbox 与定时查单使用的显式作用域记账入口。
 * 不读取 HTTP 上下文，标准科目与 Journal 在同一事务中幂等创建。
 */
export async function postSystemJournal(input: PostSystemPaymentJournalInput): Promise<PaymentJournal> {
  const journalId = await db.transaction((tx) => postSystemJournalWithin(tx, input));
  return getJournalForTenant(journalId, input.tenantId);
}

export async function reverseJournal(id: number, reason: string): Promise<PaymentJournal> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const original = await getJournalRow(id);
  if (original.reversalOfJournalId != null) throw new HTTPException(400, { message: '冲正凭证不能再次冲正' });
  if (!original.sourceType.startsWith('manual.')) {
    throw new HTTPException(400, { message: '系统业务凭证必须通过对应业务流程冲回，不能在总账中直接冲正' });
  }
  const [existingReversal] = await db
    .select({ id: paymentJournals.id })
    .from(paymentJournals)
    .where(and(eq(paymentJournals.reversalOfJournalId, original.id), tenantCondition(paymentJournals, currentUser())))
    .limit(1);
  if (existingReversal) return getJournal(existingReversal.id);
  const lineMap = await loadJournalLines([original.id]);
  const lines = lineMap.get(original.id) ?? [];
  if (lines.length === 0) throw new HTTPException(409, { message: '原凭证没有可冲正的分录行' });
  return postJournalInternal({
    sourceType: 'journal.reversal',
    sourceId: original.journalNo,
    description: `冲正 ${original.journalNo}：${reason}`,
    appId: original.appId,
    channelConfigId: original.channelConfigId,
    currency: original.currency,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debitAmount: line.creditAmount,
      creditAmount: line.debitAmount,
      memo: `冲正：${line.memo ?? original.description}`,
    })),
  }, original.id, {
    tenantId,
    operatorId: user.userId,
  });
}

async function getReservationRow(id: number): Promise<PaymentFundReservationRow> {
  const [row] = await db
    .select()
    .from(paymentFundReservations)
    .where(and(eq(paymentFundReservations.id, id), tenantCondition(paymentFundReservations, currentUser())))
    .limit(1);
  requireRow(row, '资金预占不存在');
  return row;
}

export type ListFundReservationsQuery = QueryOutputOf<typeof paymentJournalContract.reservations>;

export async function listFundReservations(q: ListFundReservationsQuery) {
  const { page, pageSize } = q;
  const where = buildWhere(
    ...dateRangeConditions(paymentFundReservations.createdAt, q.startTime, q.endTime),
    q.accountId ? eq(paymentFundReservations.accountId, q.accountId) : undefined,
    q.status ? eq(paymentFundReservations.status, q.status) : undefined,
    q.sourceType ? eq(paymentFundReservations.sourceType, q.sourceType) : undefined,
    tenantCondition(paymentFundReservations, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentFundReservations, where),
    rows: () => withPagination(db.select().from(paymentFundReservations).where(where).orderBy(desc(paymentFundReservations.id)).$dynamic(), page, pageSize),
    map: mapFundReservation,
  });
}

/**
 * 账户可用余额（分，bigint）：凭证行「贷方 − 借方」的累计余额，扣除仍在生效期内（active 且未过期）的资金预占。
 * 人工预占与转账预占共用同一口径；调用方需先对账户行加锁再计算。
 */
export async function computeAccountAvailable(tx: DbExecutor, accountId: number, now = new Date()): Promise<bigint> {
  const [balance] = await tx
    .select({ amount: sql<string>`coalesce(sum(${paymentJournalLines.creditAmount} - ${paymentJournalLines.debitAmount}), 0)::text` })
    .from(paymentJournalLines)
    .where(eq(paymentJournalLines.accountId, accountId));
  const [reserved] = await tx
    .select({ amount: sql<string>`coalesce(sum(${paymentFundReservations.amount}), 0)::text` })
    .from(paymentFundReservations)
    .where(and(
      eq(paymentFundReservations.accountId, accountId),
      eq(paymentFundReservations.status, 'active'),
      or(isNull(paymentFundReservations.expiresAt), gt(paymentFundReservations.expiresAt, now)),
    ));
  return BigInt(balance?.amount ?? '0') - BigInt(reserved?.amount ?? '0');
}

export async function createFundReservation(input: CreatePaymentFundReservationInput): Promise<PaymentFundReservation> {
  if (!input.sourceType.startsWith('manual.')) {
    throw new HTTPException(400, { message: '人工预占来源类型必须以 manual. 开头' });
  }
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const expiresAt = input.expiresAt ? parseDateTimeInput(input.expiresAt) : null;
  if (input.expiresAt && !expiresAt) throw new HTTPException(400, { message: '预占到期时间格式不正确' });
  if (expiresAt && expiresAt <= new Date()) throw new HTTPException(400, { message: '预占到期时间必须晚于当前时间' });
  const amount = BigInt(input.amount);
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(paymentLedgerAccounts)
      .where(and(eq(paymentLedgerAccounts.id, input.accountId), exactTenantCondition(paymentLedgerAccounts.tenantId, tenantId)))
      .for('update')
      .limit(1);
    requireRow(account, '账本账户不存在');
    if (account.status !== 'enabled') throw new HTTPException(400, { message: '账本账户已停用' });
    if (account.code !== 'merchant_available' || account.normalBalance !== 'credit') {
      throw new HTTPException(400, { message: '资金预占只能作用于商户可用账户' });
    }
    const scope: PaymentMoneyScope = {
      tenantId,
      appId: account.appId,
      channelConfigId: account.channelConfigId,
      currency: account.currency,
    };
    await assertScopeOwnership(tx, scope);
    const sourceWhere = and(
      exactTenantCondition(paymentFundReservations.tenantId, scope.tenantId),
      eq(paymentFundReservations.appId, scope.appId),
      eq(paymentFundReservations.channelConfigId, scope.channelConfigId),
      eq(paymentFundReservations.currency, scope.currency),
      eq(paymentFundReservations.sourceType, input.sourceType),
      eq(paymentFundReservations.sourceId, input.sourceId),
    );
    const [prior] = await tx.select().from(paymentFundReservations).where(sourceWhere).limit(1);
    if (prior) {
      if (
        prior.accountId !== account.id
        || prior.amount !== amount
        || prior.reason !== input.reason
        || prior.expiresAt?.getTime() !== expiresAt?.getTime()
      ) {
        throw new HTTPException(409, { message: '同一预占来源对应的参数不一致' });
      }
      return mapFundReservation(prior);
    }

    const now = new Date();
    const available = await computeAccountAvailable(tx, account.id, now);
    if (available < amount) {
      throw new HTTPException(400, { message: `商户可用余额不足（可预占 ${available.toString()}）` });
    }

    const [row] = await tx.insert(paymentFundReservations).values({
      reservationNo: `RSV${randomUUID().replaceAll('-', '')}`,
      accountId: account.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      amount,
      reason: input.reason ?? null,
      appId: scope.appId,
      channelConfigId: scope.channelConfigId,
      currency: scope.currency,
      tenantId: scope.tenantId,
      expiresAt,
    }).onConflictDoNothing().returning();
    if (row) return mapFundReservation(row);
    const [raced] = await tx.select().from(paymentFundReservations).where(sourceWhere).limit(1);
    if (!raced || raced.accountId !== account.id || raced.amount !== amount || raced.reason !== input.reason) {
      throw new HTTPException(409, { message: '资金预占幂等冲突' });
    }
    return mapFundReservation(raced);
  });
}

async function finalizeFundReservation(
  id: number,
  target: 'captured' | 'released',
  input: TransitionPaymentFundReservationInput,
): Promise<PaymentFundReservation> {
  requireTenantScopeId(currentUser());
  const row = await getReservationRow(id);
  if (row.status === target) return mapFundReservation(row);
  if (row.status !== 'active') throw new HTTPException(409, { message: `资金预占已处于 ${row.status} 状态` });
  if (row.expiresAt && row.expiresAt <= new Date()) {
    await db
      .update(paymentFundReservations)
      .set({ status: 'expired', finalizedAt: new Date(), finalizationReason: '预占已到期', version: sql`${paymentFundReservations.version} + 1` })
      .where(and(eq(paymentFundReservations.id, row.id), eq(paymentFundReservations.version, input.version), eq(paymentFundReservations.status, 'active')));
    throw new HTTPException(409, { message: '资金预占已过期' });
  }
  const [maybeUpdated] = await db
    .update(paymentFundReservations)
    .set({
      status: target,
      finalizedAt: new Date(),
      finalizationReason: input.reason ?? null,
      version: sql`${paymentFundReservations.version} + 1`,
    })
    .where(and(
      eq(paymentFundReservations.id, row.id),
      eq(paymentFundReservations.version, input.version),
      eq(paymentFundReservations.status, 'active'),
    ))
    .returning();
  const updated = requireRow(maybeUpdated, '资金预占版本已变化，请刷新后重试', 409);
  return mapFundReservation(updated);
}

export function captureFundReservation(id: number, input: TransitionPaymentFundReservationInput) {
  return finalizeFundReservation(id, 'captured', input);
}

export function releaseFundReservation(id: number, input: TransitionPaymentFundReservationInput) {
  return finalizeFundReservation(id, 'released', input);
}

export async function getActiveReservationAmount(accountId: number): Promise<PaymentActiveReservationAmount> {
  const account = await db
    .select({ id: paymentLedgerAccounts.id })
    .from(paymentLedgerAccounts)
    .where(and(eq(paymentLedgerAccounts.id, accountId), tenantCondition(paymentLedgerAccounts, currentUser())))
    .limit(1);
  requireRow(account[0], '账本账户不存在');
  const [row] = await db
    .select({ amount: sql<string>`coalesce(sum(${paymentFundReservations.amount}), 0)::text` })
    .from(paymentFundReservations)
    .where(and(
      eq(paymentFundReservations.accountId, accountId),
      eq(paymentFundReservations.status, 'active'),
      or(isNull(paymentFundReservations.expiresAt), gt(paymentFundReservations.expiresAt, new Date())),
      tenantCondition(paymentFundReservations, currentUser()),
    ));
  return { accountId, amount: row?.amount ?? '0' };
}
