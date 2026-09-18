import { asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import type { QueryOutputOf } from '@zenith/shared/core';
import { handlePaymentReconCaseSchema, nextReconciliationCaseStatus, paymentBankMatchSchema, paymentReconAdjustmentSchema, paymentReconCaseEventSchema, paymentReconCaseSchema, paymentReconContract, paymentReconRunSchema, paymentStatementEntrySchema, paymentStatementFileSchema, paymentStatementPeriodSchema, paymentStatementSchema } from '@zenith/shared/payment';
import { db, readSnapshot } from '../../db';
import { paymentChannelAccounts, paymentReconAdjustments, paymentReconCaseEvents, paymentReconCases, paymentReconRuns, paymentStatementEntries, paymentStatementFiles, paymentStatementPeriods, paymentStatements, type PaymentBankMatchRow, type PaymentReconAdjustmentRow, type PaymentReconCaseEventRow, type PaymentReconCaseRow, type PaymentReconRunRow, type PaymentStatementEntryRow, type PaymentStatementFileRow, type PaymentStatementPeriodRow, type PaymentStatementRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { pickEntity } from '../../lib/entity-map';
import { buildListResult, listRows } from '../../lib/list-query';
import { exactTenantCondition, requireTenantScopeId, tenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { requireTenantUser } from '../../lib/user-nicknames';

export const mapStatementPeriod = (row: PaymentStatementPeriodRow) => pickEntity(paymentStatementPeriodSchema, row);
export const mapStatement = (row: PaymentStatementRow) => pickEntity(paymentStatementSchema, row);
export const mapStatementFile = (row: PaymentStatementFileRow) => pickEntity(paymentStatementFileSchema, row);
export const mapReconRun = (row: Omit<PaymentReconRunRow, 'localSnapshot'>) => pickEntity(paymentReconRunSchema, row);
export const mapReconCaseEvent = (row: PaymentReconCaseEventRow) => pickEntity(paymentReconCaseEventSchema, row);
export const mapStatementEntry = (row: PaymentStatementEntryRow) => pickEntity(paymentStatementEntrySchema, row, {
  amount: row.amount.toString(), feeAmount: row.feeAmount?.toString() ?? null,
  netAmount: row.netAmount?.toString() ?? null, balance: row.balance?.toString() ?? null,
});
export const mapReconCase = (row: PaymentReconCaseRow) => pickEntity(paymentReconCaseSchema, row, {
  localAmount: row.localAmount?.toString() ?? null, channelAmount: row.channelAmount?.toString() ?? null,
});
export const mapReconAdjustment = (row: PaymentReconAdjustmentRow) => pickEntity(paymentReconAdjustmentSchema, row, { amount: row.amount.toString() });
export const mapBankMatch = (row: PaymentBankMatchRow) => pickEntity(paymentBankMatchSchema, row, { amount: row.amount.toString() });

export async function listStatementPeriods(q: QueryOutputOf<typeof paymentReconContract.list>) {
  const accountIds = q.channel ? db.select({ id: paymentChannelAccounts.id }).from(paymentChannelAccounts).where(eq(paymentChannelAccounts.channel, q.channel)) : undefined;
  return listRows({ table: paymentStatementPeriods, page: q.page, pageSize: q.pageSize,
    where: buildWhere(tenantCondition(paymentStatementPeriods, currentUser()), q.accountId ? eq(paymentStatementPeriods.accountId, q.accountId) : undefined,
      q.status ? eq(paymentStatementPeriods.status, q.status) : undefined, q.type ? eq(paymentStatementPeriods.type, q.type) : undefined,
      q.billDate ? eq(paymentStatementPeriods.billDate, q.billDate.slice(0, 10)) : undefined, accountIds ? inArray(paymentStatementPeriods.accountId, accountIds) : undefined),
    orderBy: [desc(paymentStatementPeriods.billDate), desc(paymentStatementPeriods.id)], map: mapStatementPeriod });
}

export async function getStatementPeriod(id: number) {
  const [row] = await db.select().from(paymentStatementPeriods).where(buildWhere(eq(paymentStatementPeriods.id, id), tenantCondition(paymentStatementPeriods, currentUser()))).limit(1);
  return mapStatementPeriod(requireRow(row, '账期不存在'));
}

export async function listStatements(periodId: number) {
  await getStatementPeriod(periodId);
  return (await db.select().from(paymentStatements).where(buildWhere(eq(paymentStatements.periodId, periodId), tenantCondition(paymentStatements, currentUser()))).orderBy(desc(paymentStatements.version))).map(mapStatement);
}

export async function getStatement(id: number) {
  const [row] = await db.select().from(paymentStatements).where(buildWhere(eq(paymentStatements.id, id), tenantCondition(paymentStatements, currentUser()))).limit(1);
  requireRow(row, '账单不存在');
  const files = await db.select().from(paymentStatementFiles).where(buildWhere(eq(paymentStatementFiles.statementId, id), tenantCondition(paymentStatementFiles, currentUser()))).orderBy(asc(paymentStatementFiles.id));
  return { ...mapStatement(row), files: files.map(mapStatementFile) };
}

export async function listStatementEntries(statementId: number, q: QueryOutputOf<typeof paymentReconContract.entries>) {
  await getStatement(statementId);
  return listRows({ table: paymentStatementEntries, page: q.page, pageSize: q.pageSize,
    where: buildWhere(eq(paymentStatementEntries.statementId, statementId), tenantCondition(paymentStatementEntries, currentUser()),
      q.type ? eq(paymentStatementEntries.type, q.type) : undefined, q.applicationId ? eq(paymentStatementEntries.applicationId, q.applicationId) : undefined),
    orderBy: [asc(paymentStatementEntries.lineNo)], map: mapStatementEntry });
}

export async function listReconRuns(q: QueryOutputOf<typeof paymentReconContract.runs>) {
  const statementIds = q.accountId ? db.select({ id: paymentStatements.id }).from(paymentStatements).innerJoin(paymentStatementPeriods, eq(paymentStatementPeriods.id, paymentStatements.periodId)).where(eq(paymentStatementPeriods.accountId, q.accountId)) : undefined;
  const where = buildWhere(tenantCondition(paymentReconRuns, currentUser()), q.statementId ? eq(paymentReconRuns.statementId, q.statementId) : undefined,
    q.status ? eq(paymentReconRuns.status, q.status) : undefined, statementIds ? inArray(paymentReconRuns.statementId, statementIds) : undefined);
  const { localSnapshot: _localSnapshot, ...columns } = getTableColumns(paymentReconRuns);
  return buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(paymentReconRuns, where),
    rows: () => withPagination(db.select(columns).from(paymentReconRuns).where(where).orderBy(desc(paymentReconRuns.id)).$dynamic(), q.page, q.pageSize), map: mapReconRun });
}

export async function listReconCases(q: QueryOutputOf<typeof paymentReconContract.cases>) {
  return listRows({ table: paymentReconCases, page: q.page, pageSize: q.pageSize,
    where: buildWhere(tenantCondition(paymentReconCases, currentUser()), q.accountId ? eq(paymentReconCases.accountId, q.accountId) : undefined,
      q.periodId ? eq(paymentReconCases.periodId, q.periodId) : undefined, q.assignedTo ? eq(paymentReconCases.assignedTo, q.assignedTo) : undefined,
      q.applicationId ? eq(paymentReconCases.applicationId, q.applicationId) : undefined, q.type ? eq(paymentReconCases.type, q.type) : undefined,
      q.stage ? eq(paymentReconCases.stage, q.stage) : undefined, q.status ? eq(paymentReconCases.status, q.status) : undefined),
    orderBy: [desc(paymentReconCases.updatedAt), desc(paymentReconCases.id)], map: mapReconCase });
}

export async function getReconCase(id: number) {
  const [row] = await db.select().from(paymentReconCases).where(buildWhere(eq(paymentReconCases.id, id), tenantCondition(paymentReconCases, currentUser()))).limit(1);
  requireRow(row, '差异案件不存在');
  const [events, adjustments] = await Promise.all([
    db.select().from(paymentReconCaseEvents).where(buildWhere(eq(paymentReconCaseEvents.caseId, id), tenantCondition(paymentReconCaseEvents, currentUser()))).orderBy(asc(paymentReconCaseEvents.id)),
    db.select().from(paymentReconAdjustments).where(buildWhere(eq(paymentReconAdjustments.caseId, id), tenantCondition(paymentReconAdjustments, currentUser()))).orderBy(desc(paymentReconAdjustments.id)),
  ]);
  return { ...mapReconCase(row), events: events.map(mapReconCaseEvent), adjustments: adjustments.map(mapReconAdjustment) };
}

export async function handleReconCase(id: number, input: z.output<typeof handlePaymentReconCaseSchema>) {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  if (input.assignedTo != null) await requireTenantUser(input.assignedTo, '责任人不存在或不在当前租户', { enabledOnly: true });
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(paymentReconCases).where(buildWhere(eq(paymentReconCases.id, id), exactTenantCondition(paymentReconCases.tenantId, tenantId))).for('update').limit(1);
    requireRow(row, '差异案件不存在');
    if (row.version !== input.expectedVersion) throw new HTTPException(409, { message: '案件已经变化，请刷新后操作' });
    const status = nextReconciliationCaseStatus(row.status, input.action);
    if (!status) throw new HTTPException(409, { message: '当前案件状态不允许此操作' });
    const [updated] = await tx.update(paymentReconCases).set({ status, version: row.version + 1, resolution: input.remark,
      ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}) }).where(buildWhere(eq(paymentReconCases.id, id), eq(paymentReconCases.version, input.expectedVersion))).returning();
    requireRow(updated, '案件已经变化，请刷新后操作', 409);
    await tx.insert(paymentReconCaseEvents).values({ caseId: id, action: input.action, actorId: user.userId, remark: input.remark,
      before: mapReconCase(row), after: mapReconCase(updated), tenantId: row.tenantId });
    return mapReconCase(updated);
  });
}

export async function listReconAdjustments(q: QueryOutputOf<typeof paymentReconContract.adjustments>) {
  return listRows({ table: paymentReconAdjustments, page: q.page, pageSize: q.pageSize,
    where: buildWhere(tenantCondition(paymentReconAdjustments, currentUser()), q.caseId ? eq(paymentReconAdjustments.caseId, q.caseId) : undefined,
      q.status ? eq(paymentReconAdjustments.status, q.status) : undefined), orderBy: [desc(paymentReconAdjustments.id)], map: mapReconAdjustment });
}

export async function getReconSummary(q: QueryOutputOf<typeof paymentReconContract.summary>) {
  const user = currentUser();
  const periodWhere = buildWhere(tenantCondition(paymentStatementPeriods, user), q.accountId ? eq(paymentStatementPeriods.accountId, q.accountId) : undefined);
  const caseWhere = buildWhere(tenantCondition(paymentReconCases, user), q.accountId ? eq(paymentReconCases.accountId, q.accountId) : undefined);
  const accountCases = q.accountId ? db.select({ id: paymentReconCases.id }).from(paymentReconCases).where(buildWhere(eq(paymentReconCases.accountId, q.accountId), tenantCondition(paymentReconCases, user))) : undefined;
  return readSnapshot(async (tx) => {
  const unmatched = (bank: boolean) => tx.$count(paymentStatementEntries, buildWhere(
    tenantCondition(paymentStatementEntries, user), eq(paymentStatementEntries.type, 'settlement'), eq(paymentStatementEntries.status, 'success'), eq(paymentStatementEntries.direction, bank ? 'in' : 'out'),
    inArray(paymentStatementEntries.statementId, tx.select({ id: paymentStatements.id }).from(paymentStatements).innerJoin(paymentStatementPeriods, eq(paymentStatementPeriods.id, paymentStatements.periodId)).where(buildWhere(periodWhere,
      bank ? eq(paymentStatementPeriods.type, 'bank') : inArray(paymentStatementPeriods.type, ['trade', 'fund']),
      eq(paymentStatementPeriods.currentStatementId, paymentStatements.id), eq(paymentStatements.status, 'validated'), eq(paymentStatementPeriods.currency, paymentStatementEntries.currency)))),
    sql`${paymentStatementEntries.amount} > coalesce((select sum(m.amount) from payment_bank_matches m where ${bank ? sql`m.bank_entry_id` : sql`m.settlement_entry_id`} = ${paymentStatementEntries.id} and m.tenant_id is not distinct from ${paymentStatementEntries.tenantId}), 0)`));
  const periods = await tx.select({ status: paymentStatementPeriods.status, count: sql<number>`count(*)::int` }).from(paymentStatementPeriods).where(periodWhere).groupBy(paymentStatementPeriods.status);
  const cases = await tx.select({ status: paymentReconCases.status, count: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${paymentReconCases.dueAt} < now())::int` }).from(paymentReconCases).where(caseWhere).groupBy(paymentReconCases.status);
  const pendingAdjustments = await tx.$count(paymentReconAdjustments, buildWhere(tenantCondition(paymentReconAdjustments, user), inArray(paymentReconAdjustments.status, ['pending', 'approved']), accountCases ? inArray(paymentReconAdjustments.caseId, accountCases) : undefined));
  const unmatchedBankEntries = await unmatched(true);
  const unmatchedSettlementEntries = await unmatched(false);
  const differences = await tx.select({ currency: paymentReconCases.currency, amount: sql<string>`coalesce(sum(abs(coalesce(${paymentReconCases.channelAmount}, 0) - coalesce(${paymentReconCases.localAmount}, 0))), 0)::text` }).from(paymentReconCases).where(buildWhere(caseWhere, inArray(paymentReconCases.status, ['open', 'investigating', 'suspended']))).groupBy(paymentReconCases.currency);
  // Include system-owned runs and every page/status; UI list filters must not hide completion.
  const runs = await tx.select({ status: paymentReconRuns.status, count: sql<number>`count(*)::int`, changedAt: sql<string>`max(${paymentReconRuns.updatedAt})::text` })
    .from(paymentReconRuns).innerJoin(paymentStatements, eq(paymentStatements.id, paymentReconRuns.statementId))
    .innerJoin(paymentStatementPeriods, eq(paymentStatementPeriods.id, paymentStatements.periodId))
    .where(buildWhere(periodWhere, tenantCondition(paymentReconRuns, user)))
    .groupBy(paymentReconRuns.status).orderBy(asc(paymentReconRuns.status));
  const activeRuns = runs.filter((row) => row.status === 'pending' || row.status === 'running').reduce((total, row) => total + row.count, 0);
  const runRevision = runs.map((row) => `${row.status}:${row.count}:${row.changedAt}`).join('|');
  const periodCount = (status: string) => periods.find((row) => row.status === status)?.count ?? 0;
  const caseCount = (status: string) => cases.find((row) => row.status === status)?.count ?? 0;
  return { activeRuns, runRevision, expectedPeriods: periodCount('expected'), waitingPeriods: periodCount('waiting'), readyPeriods: periodCount('ready'), failedPeriods: periodCount('failed'),
    openCases: caseCount('open') + caseCount('investigating'), suspendedCases: caseCount('suspended'),
    overdueCases: cases.filter((row) => ['open', 'investigating', 'suspended'].includes(row.status)).reduce((total, row) => total + row.overdue, 0),
    pendingAdjustments, unmatchedBankEntries, unmatchedSettlementEntries, differenceAmounts: differences };
  });
}
