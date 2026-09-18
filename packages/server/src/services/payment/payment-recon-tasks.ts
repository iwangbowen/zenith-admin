import dayjs from 'dayjs';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BodyOf } from '@zenith/shared/core';
import { isAsyncTaskTerminal } from '@zenith/shared/tasks';
import { paymentReconContract, PAYMENT_RECON_RULE_VERSION, paymentStatementImportDocumentSchema,
  parseReconciliationCsv, assertUniqueReconciliationEntries, type ReconciliationEntry } from '@zenith/shared/payment';
import { db, readSnapshot } from '../../db';
import { paymentChannelAccounts, paymentChannelConfigs, paymentStatementPeriods, paymentStatements, paymentStatementFiles,
  paymentStatementEntries, paymentReconRuns, paymentReconCases, paymentOrders, paymentRefunds, asyncTasks,
  type PaymentStatementPeriodRow, type PaymentChannelAccountRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { exactTenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { mapAsyncTask, persistAsyncTask, persistSystemAsyncTask, enqueueAsyncTask, registerTaskHandler, TaskCancelledError, TaskNonRetryableError, type TaskRunContext } from '../../lib/task-center';
import { getAdapter } from '../../lib/payment/registry';
import { ProviderBillError, type ProviderBillResult } from '../../lib/payment/bill-types';
import { parseProviderBill } from '../../lib/payment/bill-parsers';
import { assertPaymentEngineConfig } from './payment-channel-config-resolver';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';
import { buildAdapterContext, syncOrderStatus, syncRefundStatus, loadOrderConfig } from './payment.service';
import { getSettings } from '../../lib/settings';
import { notifyWithin } from '../messaging/notification-outbox.service';
import logger from '../../lib/logger';
import { requireReconAccount, requireStatementPeriod, requireStatement, requireReconCase, assertReconWriteScope,
  reconNotificationPolicy, notifyReconFailure, RECON_DOWNLOAD_TASK, RECON_IMPORT_TASK, RECON_COMPARE_TASK, RECON_COMPENSATE_TASK } from './payment-recon-common';
import { archiveStatement, statementArtifact, readStatementFileBytes } from './payment-statement-storage.service';
import { executeReconRun, loadTradeFacts, statementDateBounds } from './payment-recon-engine.service';
import { formatDateTime } from '../../lib/datetime';

export async function enqueueCommitted(id: number) {
  await enqueueAsyncTask(id).catch((error: unknown) => logger.warn({ taskId: id, error }, '支付对账任务已持久化，等待任务中心补投'));
}

async function ensurePeriod(account: PaymentChannelAccountRow, billDate: string, type: 'trade' | 'fund' | 'bank', currency: string) {
  if (account.status !== 'enabled') throw new HTTPException(409, { message: '渠道账户已停用' });
  if (currency !== 'CNY') throw new HTTPException(400, { message: '当前渠道账单仅支持 CNY' });
  if (billDate >= dayjs().tz(account.billTimezone).format('YYYY-MM-DD')) throw new HTTPException(400, { message: '只能获取已结束账期的账单' });
  const settings = await getSettings('payment', { tenantId: account.tenantId });
  const end = statementDateBounds(billDate, account.billTimezone).end;
  const [inserted] = await db.insert(paymentStatementPeriods).values({ accountId: account.id, billDate, type, currency, tenantId: account.tenantId,
    nextAttemptAt: new Date(end.getTime() + settings.reconDownloadHour * 3_600_000), deadlineAt: new Date(end.getTime() + settings.reconDeadlineHours * 3_600_000) })
    .onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.accountId, account.id),
    eq(paymentStatementPeriods.billDate, billDate), eq(paymentStatementPeriods.type, type), eq(paymentStatementPeriods.currency, currency),
    exactTenantCondition(paymentStatementPeriods.tenantId, account.tenantId))).limit(1);
  return requireRow(existing, '账期创建冲突，请重试', 409);
}

async function persistPeriodTask(tx: DbTransaction, period: PaymentStatementPeriodRow, taskType: string, payload: Record<string, unknown>, system: boolean) {
  const [locked] = await tx.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, period.id), exactTenantCondition(paymentStatementPeriods.tenantId, period.tenantId))).for('update');
  requireRow(locked, '账期不存在');
  if (locked.taskId) {
    const [existing] = await tx.select().from(asyncTasks).where(eq(asyncTasks.id, locked.taskId)).limit(1);
    if (existing && !isAsyncTaskTerminal(existing.status)) {
      if (existing.taskType !== taskType || (payload.statementId != null && existing.payload?.statementId !== payload.statementId)) {
        throw new HTTPException(409, { message: '该账期已有另一项任务在处理，请完成后提交' });
      }
      return existing;
    }
  }
  const generation = locked.generation + 1;
  const input = { taskType, title: `对账 ${period.billDate} · ${period.type} · 账户 #${period.accountId}`,
    payload: { ...payload, periodId: period.id, tenantId: period.tenantId, generation, previousError: locked.lastError }, idempotencyKey: `payment-period:${period.id}:${generation}` };
  const task = system ? await persistSystemAsyncTask(tx, input, period.tenantId) : await persistAsyncTask(tx, input);
  await tx.update(paymentStatementPeriods).set({ taskId: task.id, generation, nextAttemptAt: null, lastError: null }).where(eq(paymentStatementPeriods.id, period.id));
  return task;
}

function assertBillCapability(account: PaymentChannelAccountRow, type: 'trade' | 'fund' | 'bank') {
  if (type === 'bank') throw new HTTPException(400, { message: '银行流水请使用受控文件导入' });
  const capability = getAdapter(account.channel).manifest.capabilities.find((c) => c.operation === 'bill.download');
  if (!capability?.billKinds?.includes(type)) throw new HTTPException(409, { message: '该签约渠道不提供此类账单，请使用对应渠道文件导入' });
}
export async function submitStatementDownload(input: BodyOf<typeof paymentReconContract.submit>) {
  const account = await requireReconAccount(input.accountId);
  assertReconWriteScope(account.tenantId);
  assertBillCapability(account, input.type);
  const period = await ensurePeriod(account, input.billDate, input.type, input.currency ?? 'CNY');
  const task = await db.transaction((tx) => persistPeriodTask(tx, period, RECON_DOWNLOAD_TASK, {}, false));
  await enqueueCommitted(task.id);
  return mapAsyncTask(task);
}
export async function retryStatementPeriod(id: number) {
  const period = await requireStatementPeriod(id);
  assertReconWriteScope(period.tenantId);
  const account = await requireReconAccount(period.accountId);
  assertBillCapability(account, period.type);
  const task = await db.transaction((tx) => persistPeriodTask(tx, period, RECON_DOWNLOAD_TASK, {}, false));
  await enqueueCommitted(task.id);
  return mapAsyncTask(task);
}
export async function submitStatementImport(input: BodyOf<typeof paymentReconContract.importBill>) {
  const account = await requireReconAccount(input.accountId);
  assertReconWriteScope(account.tenantId);
  if (input.type === 'bank' && input.format !== 'internal') throw new HTTPException(400, { message: '银行流水请转换为标准 CSV 或 JSON 格式' });
  const period = await ensurePeriod(account, input.billDate, input.type, input.currency ?? 'CNY');
  const raw = statementArtifact(Buffer.from(input.content, 'base64'), input.filename);
  const statement = await archiveStatement(period, [raw], 'manual_upload', { format: input.format, accountId: account.id, merchantId: account.merchantId });
  const task = await db.transaction((tx) => persistPeriodTask(tx, period, RECON_IMPORT_TASK, { statementId: statement.id, format: input.format }, false));
  await enqueueCommitted(task.id);
  return mapAsyncTask(task);
}

export async function persistReconTask(tx: DbTransaction, statementId: number, tenantId: number | null, system: boolean) {
  // Lock account bill first; all publications and new run admission use this same boundary.
  const [statement] = await tx.select().from(paymentStatements).where(and(eq(paymentStatements.id, statementId), exactTenantCondition(paymentStatements.tenantId, tenantId))).limit(1);
  requireRow(statement, '账单不存在');
  const [period] = await tx.select().from(paymentStatementPeriods).where(eq(paymentStatementPeriods.id, statement.periodId)).for('update');
  if (statement.status !== 'validated' || period.currentStatementId !== statement.id) throw new HTTPException(409, { message: '只能核对当前已校验的账单' });
  const [active] = await tx.select().from(paymentReconRuns).where(and(eq(paymentReconRuns.statementId, statementId), inArray(paymentReconRuns.status, ['pending', 'running']))).limit(1);
  if (active?.taskId) {
    const [task] = await tx.select().from(asyncTasks).where(eq(asyncTasks.id, active.taskId)).limit(1);
    if (task && !isAsyncTaskTerminal(task.status)) return task;
    await tx.update(paymentReconRuns).set({ status: 'failed', error: '前次执行已终止，新运行将重新冻结事实', finishedAt: new Date() }).where(eq(paymentReconRuns.id, active.id));
  }
  const [run] = await tx.insert(paymentReconRuns).values({ statementId, ruleVersion: PAYMENT_RECON_RULE_VERSION, tenantId }).returning();
  const input = { taskType: RECON_COMPARE_TASK, title: `核对账单 #${statementId} · 运行 #${run.id}`,
    payload: { runId: run.id, tenantId, periodId: period.id }, idempotencyKey: `payment-recon-run:${run.id}` };
  const task = system ? await persistSystemAsyncTask(tx, input, tenantId) : await persistAsyncTask(tx, input);
  await tx.update(paymentReconRuns).set({ taskId: task.id }).where(eq(paymentReconRuns.id, run.id));
  return task;
}
export async function submitReconRun(id: number) {
  const statement = await requireStatement(id);
  assertReconWriteScope(statement.tenantId);
  const task = await db.transaction((tx) => persistReconTask(tx, id, statement.tenantId, false));
  await enqueueCommitted(task.id);
  return mapAsyncTask(task);
}
export async function queueReconRunForSystem(statementId: number, tenantId: number | null) {
  const task = await db.transaction((tx) => persistReconTask(tx, statementId, tenantId, true));
  await enqueueCommitted(task.id);
  return task.id;
}
export async function submitCompensation(id: number) {
  const item = await requireReconCase(id);
  assertReconWriteScope(item.tenantId);
  if (!item.orderId || item.stage !== 'trade' || !['open', 'investigating', 'suspended'].includes(item.status)) {
    throw new HTTPException(409, { message: '仅关联本地交易且未结案的交易差异可查单补偿' });
  }
  const task = await db.transaction((tx) => persistAsyncTask(tx, { taskType: RECON_COMPENSATE_TASK,
    title: `核查差异案件 #${id}`, payload: { caseId: id, caseVersion: item.version, tenantId: item.tenantId },
    idempotencyKey: `payment-compensate:${id}:${item.version}` }));
  await enqueueCommitted(task.id);
  return mapAsyncTask(task);
}

function sumEntries(entries: ReconciliationEntry[]) {
  let income = 0n; let expense = 0n; let payment = 0n; let refund = 0n; let fee = 0n;
  for (const e of entries) {
    const amount = BigInt(e.amount);
    if (e.direction === 'in') income += amount; else expense += amount;
    if (e.type === 'payment') payment += amount;
    if (e.type === 'refund') refund += amount;
    fee += BigInt(e.feeAmount ?? '0');
  }
  return { entryCount: entries.length, incomeAmount: income.toString(), expenseAmount: expense.toString(), paymentAmount: payment.toString(), refundAmount: refund.toString(), feeAmount: fee.toString() };
}

async function publishStatement(statementId: number, period: PaymentStatementPeriodRow, entries: ReconciliationEntry[], parserVersion: string, suppliedSummary: Record<string, unknown>, ctx: TaskRunContext) {
  assertUniqueReconciliationEntries(entries);
  const summary = sumEntries(entries);
  for (const key of ['entryCount', 'incomeAmount', 'expenseAmount', 'paymentAmount', 'refundAmount'] as const) {
    if (suppliedSummary[key] != null && String(suppliedSummary[key]) !== String(summary[key])) throw new ProviderBillError('integrity', `账单汇总校验不通过：${key}`);
  }
  for (const entry of entries) {
    if (entry.currency !== period.currency) throw new ProviderBillError('integrity', '账单币种与账期不一致');
    if (!Number.isFinite(Date.parse(entry.occurredAt))) throw new ProviderBillError('format', '明细缺少有效业务时间');
    // Ownership is derived from actual orders; caller-supplied applicationId is never authoritative.
    entry.applicationId = null;
  }
  const aliases = await db.select({ no: paymentOrders.outTradeNo, ref: paymentOrders.channelTradeNo, appId: paymentOrders.appId }).from(paymentOrders)
    .where(and(eq(paymentOrders.channelAccountId, period.accountId), exactTenantCondition(paymentOrders.tenantId, period.tenantId)));
  const byOrder = new Map(aliases.map((o) => [o.no, o.appId]));
  const byReference = new Map(aliases.filter((o) => o.ref).map((o) => [o.ref!, o.appId]));
  if ((await ctx.progress({ note: '校验账单并发布标准明细', total: entries.length, processed: 0 })).cancelRequested) return null;
  const task = await db.transaction(async (tx) => {
    const [lockedPeriod] = await tx.select().from(paymentStatementPeriods).where(eq(paymentStatementPeriods.id, period.id)).for('update');
    const [ownedTask] = await tx.select({ status: asyncTasks.status, cancelRequested: asyncTasks.cancelRequested, attempts: asyncTasks.attempts }).from(asyncTasks).where(eq(asyncTasks.id, ctx.taskId)).for('share');
    if (lockedPeriod.generation !== Number(ctx.payload.generation) || lockedPeriod.taskId !== ctx.taskId || !ownedTask || ownedTask.status !== 'running' || ownedTask.cancelRequested || ownedTask.attempts !== ctx.attempt) {
      throw new TaskCancelledError('任务已取消或账期已由新任务接管');
    }
    const [statement] = await tx.select().from(paymentStatements).where(eq(paymentStatements.id, statementId)).for('update');
    requireRow(statement, '账单不存在');
    if (statement.status === 'rejected') throw new ProviderBillError('permanent', '原件已被拒绝，请上传更正后的账单');
    if (statement.status === 'superseded') throw new ProviderBillError('permanent', '该账单已有更新版本');
    if (statement.status !== 'validated') {
      for (let offset = 0; offset < entries.length; offset += 500) {
        await tx.insert(paymentStatementEntries).values(entries.slice(offset, offset + 500).map((entry, i) => ({
          statementId, entryKey: entry.entryKey, type: entry.type, merchantOrderNo: entry.merchantOrderNo,
          merchantRefundNo: entry.merchantRefundNo, providerTransactionId: entry.providerTransactionId, providerRefundId: entry.providerRefundId,
          reference: entry.reference, currency: entry.currency, amount: BigInt(entry.amount), direction: entry.direction, status: entry.status,
          occurredAt: new Date(entry.occurredAt), applicationId: (entry.merchantOrderNo ? byOrder.get(entry.merchantOrderNo) : undefined)
            ?? (entry.providerTransactionId ? byReference.get(entry.providerTransactionId) : undefined) ?? null,
          raw: entry.raw ?? {}, lineNo: typeof entry.raw?.lineNo === 'number' ? entry.raw.lineNo : offset + i + 1,
          feeAmount: entry.feeAmount == null ? null : BigInt(entry.feeAmount), netAmount: entry.netAmount == null ? null : BigInt(entry.netAmount),
          balance: entry.balance == null ? null : BigInt(entry.balance), tenantId: period.tenantId,
        })));
      }
      await tx.update(paymentStatements).set({ status: 'validated', parserVersion, summary: { ...suppliedSummary, ...summary } }).where(eq(paymentStatements.id, statementId));
    }
    if (lockedPeriod.currentStatementId && lockedPeriod.currentStatementId !== statementId) {
      const { assertStatementNotAllocated } = await import('./payment-recon-funds.service');
      await assertStatementNotAllocated(tx, lockedPeriod.currentStatementId, period.tenantId);
      const [old] = await tx.select().from(paymentStatements).where(eq(paymentStatements.id, lockedPeriod.currentStatementId)).limit(1);
      if (old && old.version > statement.version) throw new ProviderBillError('permanent', '不能以旧版本替代更新账单');
      await tx.update(paymentStatements).set({ status: 'superseded' }).where(eq(paymentStatements.id, lockedPeriod.currentStatementId));
    }
    await tx.update(paymentStatementPeriods).set({ status: 'ready', currentStatementId: statementId, nextAttemptAt: null, lastError: null, completedAt: null }).where(eq(paymentStatementPeriods.id, period.id));
    return persistReconTask(tx, statementId, period.tenantId, true);
  });
  await enqueueCommitted(task.id);
  await ctx.progress({ note: '账单已归档，核对任务已提交', processed: entries.length, total: entries.length });
  return statementId;
}

async function runStatementTask(ctx: TaskRunContext, mode: 'download' | 'import') {
  const tenantId = ctx.payload.tenantId == null ? null : Number(ctx.payload.tenantId);
  const [period] = await db.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, Number(ctx.payload.periodId)), exactTenantCondition(paymentStatementPeriods.tenantId, tenantId))).limit(1);
  requireRow(period, '账期不存在');
  const [account] = await db.select().from(paymentChannelAccounts).where(and(eq(paymentChannelAccounts.id, period.accountId), exactTenantCondition(paymentChannelAccounts.tenantId, tenantId))).limit(1);
  requireRow(account, '渠道账户不存在');
  const policy = await reconNotificationPolicy(tenantId, period.createdBy ?? account.createdBy);
  let archivedId = mode === 'import' ? Number(ctx.payload.statementId) : undefined;
  try {
    if ((await ctx.progress({ note: mode === 'download' ? '正在获取渠道原始账单' : '正在校验导入原件', total: null })).cancelRequested) return { cancelled: true };
    let entries: ReconciliationEntry[]; let summary: Record<string, unknown>; let parserVersion: string;
    if (mode === 'import') {
      const [file] = await db.select().from(paymentStatementFiles).where(and(eq(paymentStatementFiles.statementId, archivedId!), exactTenantCondition(paymentStatementFiles.tenantId, tenantId))).orderBy(paymentStatementFiles.id).limit(1);
      requireRow(file, '归档原件不存在');
      const bytes = await readStatementFileBytes(file);
      if (ctx.payload.format === 'provider') {
        if (period.type === 'bank') throw new ProviderBillError('format', '银行流水需使用标准格式');
        const parsed = parseProviderBill(account.channel, period.type, bytes, file.filename, account.merchantId, period.billDate);
        entries = parsed.entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt ?? formatDateTime(statementDateBounds(period.billDate, account.billTimezone).start), raw: { ...entry.raw, lineNo: entry.lineNo } }));
        summary = parsed.summary; parserVersion = parsed.parserVersion;
      } else {
        const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
        if (text.trimStart().startsWith('{')) {
          const document = paymentStatementImportDocumentSchema.parse(JSON.parse(text)); entries = document.entries; summary = document.summary ?? {};
          parserVersion = 'internal-json/1';
        } else { entries = parseReconciliationCsv(text); summary = {}; parserVersion = 'internal-csv/1'; }
      }
    } else {
      assertBillCapability(account, period.type);
      const [config] = await db.select().from(paymentChannelConfigs).where(and(eq(paymentChannelConfigs.channelAccountId, account.id),
        eq(paymentChannelConfigs.status, 'enabled'), exactTenantCondition(paymentChannelConfigs.tenantId, tenantId))).orderBy(desc(paymentChannelConfigs.credentialVersion), desc(paymentChannelConfigs.id)).limit(1);
      requireRow(config, '账户没有启用的渠道凭据', 409);
      if (config.sandbox) {
        assertPaymentEngineConfig(config);
        if (period.type === 'fund') {
          const { loadFundFacts } = await import('./payment-recon-funds.service');
          entries = await readSnapshot((tx) => loadFundFacts(tx, period, account.billTimezone));
        } else entries = await readSnapshot((tx) => loadTradeFacts(tx, period, account.billTimezone));
        summary = sumEntries(entries); parserVersion = 'sandbox/2';
        archivedId = (await archiveStatement(period, [statementArtifact(Buffer.from(JSON.stringify({ entries, summary })), `sandbox-${period.billDate}.json`, 'application/json')], 'sandbox_generated', { accountId: account.id, environment: account.environment })).id;
      } else {
        await assertEffectivePaymentOperation({ configRow: config, operation: 'bill.download', currency: period.currency });
        const adapter = getAdapter(account.channel);
        if (!adapter.downloadBill || period.type === 'bank') throw new ProviderBillError('permanent', '渠道不支持该账单');
        const parsed: ProviderBillResult = await adapter.downloadBill(buildAdapterContext(config), period.billDate, period.type);
        if (parsed.merchantId !== account.merchantId || parsed.billDate !== period.billDate || parsed.kind !== period.type) throw new ProviderBillError('integrity', '渠道账单身份或账期不一致');
        archivedId = (await archiveStatement(period, parsed.artifacts, 'provider_download', { merchantId: parsed.merchantId, billDate: parsed.billDate,
          kind: parsed.kind, configId: config.id, credentialVersion: config.credentialVersion, authenticated: true })).id;
        entries = parsed.entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt ?? formatDateTime(statementDateBounds(period.billDate, account.billTimezone).start), raw: { ...entry.raw, lineNo: entry.lineNo } }));
        summary = parsed.summary; parserVersion = parsed.parserVersion;
      }
    }
    const id = await publishStatement(requireRow(archivedId, '原件尚未归档'), period, entries, parserVersion, summary, ctx);
    if (id && ctx.payload.previousError) await db.transaction((tx) => notifyWithin(tx, 'payment.recon.recovered', {
      tenantId, recipients: policy.recipients, vars: { accountName: account.name, billDate: period.billDate },
      dedupeKey: `payment-recon-recovered:${period.id}:${period.generation}`, link: `/payment/recon?periodId=${period.id}` }));
    return { statementId: id, entryCount: entries.length };
  } catch (error) {
    if (error instanceof TaskCancelledError) throw error;
    const waiting = error instanceof ProviderBillError && (error.code === 'waiting' || error.code === 'no_bill');
    const message = error instanceof Error ? error.message : String(error);
    if (!archivedId && error instanceof ProviderBillError && error.artifacts?.length) {
      archivedId = (await archiveStatement(period, error.artifacts, 'provider_download', { error: message, authenticated: false })).id;
    }
    await db.transaction(async (tx) => {
      await tx.update(paymentStatementPeriods).set({ status: waiting ? 'waiting' : 'failed', lastError: message,
        nextAttemptAt: waiting ? new Date(Date.now() + policy.settings.reconWaitMinutes * 60_000) : null })
        .where(and(eq(paymentStatementPeriods.id, period.id), eq(paymentStatementPeriods.generation, Number(ctx.payload.generation))));
      if (archivedId) await tx.update(paymentStatements).set({ status: 'rejected', verification: { error: message } })
        .where(and(eq(paymentStatements.id, archivedId), eq(paymentStatements.status, 'archived')));
      if (!waiting) await notifyReconFailure(tx, { tenantId, periodId: period.id, generation: period.generation,
        accountName: account.name, billDate: period.billDate, message, recipients: policy.recipients });
    });
    if (waiting) return { waiting: true, reason: message };
    // Permanent failures stop retries, while task itself must be recorded as failed by the common runner.
    if (error instanceof ProviderBillError && !error.retryable) throw new TaskNonRetryableError(message, { cause: error });
    throw error;
  }
}

export function registerPaymentReconTaskHandlers() {
  registerTaskHandler({ taskType: RECON_DOWNLOAD_TASK, title: '下载支付账单', module: '支付中心', maxAttempts: 5, retryDelayMs: 60_000, run: (ctx) => runStatementTask(ctx, 'download') });
  registerTaskHandler({ taskType: RECON_IMPORT_TASK, title: '解析支付账单', module: '支付中心', maxAttempts: 1, run: (ctx) => runStatementTask(ctx, 'import') });
  registerTaskHandler({ taskType: RECON_COMPARE_TASK, title: '支付账单核对', module: '支付中心', maxAttempts: 3, retryDelayMs: 30_000,
    async run(ctx) {
      const runId = Number(ctx.payload.runId); const tenantId = ctx.payload.tenantId == null ? null : Number(ctx.payload.tenantId);
      try { return await executeReconRun(runId, tenantId, ctx); }
      catch (error) {
        const [task] = await db.select({ maxAttempts: asyncTasks.maxAttempts }).from(asyncTasks).where(eq(asyncTasks.id, ctx.taskId)).limit(1);
        await db.update(paymentReconRuns).set({ status: error instanceof TaskCancelledError || ctx.attempt >= (task?.maxAttempts ?? ctx.attempt) ? 'failed' : 'running', error: error instanceof Error ? error.message : String(error) })
          .where(and(eq(paymentReconRuns.id, runId), exactTenantCondition(paymentReconRuns.tenantId, tenantId)));
        throw error;
      }
    },
  });
  registerTaskHandler({ taskType: RECON_COMPENSATE_TASK, title: '支付差异查单补偿', module: '支付中心', maxAttempts: 3, retryDelayMs: 30_000,
    async run(ctx) {
      const tenantId = ctx.payload.tenantId == null ? null : Number(ctx.payload.tenantId);
      const [item] = await db.select().from(paymentReconCases).where(and(eq(paymentReconCases.id, Number(ctx.payload.caseId)), exactTenantCondition(paymentReconCases.tenantId, tenantId))).limit(1);
      requireRow(item, '案件不存在');
      if (item.version !== Number(ctx.payload.caseVersion)) throw new TaskCancelledError('案件已变化，请重新核查');
      const [order] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, requireRow(item.orderId, '案件未关联订单')),
        eq(paymentOrders.channelAccountId, item.accountId), exactTenantCondition(paymentOrders.tenantId, tenantId))).limit(1);
      requireRow(order, '案件关联订单不存在');
      if ((await ctx.progress({ note: '渠道查单，使用原交易确认链路补齐状态' })).cancelRequested) return { cancelled: true };
      if (item.refundId) {
        const [refund] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.id, item.refundId), eq(paymentRefunds.orderId, order.id), exactTenantCondition(paymentRefunds.tenantId, tenantId))).limit(1);
        const config = await loadOrderConfig(order);
        await syncRefundStatus(requireRow(refund, '退款单不存在'), order, requireRow(config, '渠道配置不存在'));
      } else await syncOrderStatus(order);
      const [period] = await db.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, item.periodId), exactTenantCondition(paymentStatementPeriods.tenantId, tenantId))).limit(1);
      const task = await db.transaction((tx) => persistReconTask(tx, requireRow(period?.currentStatementId, '账单未就绪'), tenantId, true));
      await enqueueCommitted(task.id);
      return { caseId: item.id, reconTaskId: task.id };
    },
  });
}

/** Explicit account/date coverage plus durable pending periods survives missing an entire calendar day. */
export async function planPaymentReconciliation() {
  const accounts = await db.select().from(paymentChannelAccounts).where(eq(paymentChannelAccounts.status, 'enabled'));
  let planned = 0; let submitted = 0;
  for (const account of accounts) {
    const policy = await reconNotificationPolicy(account.tenantId, account.createdBy);
    if (!policy.settings.reconEnabled) continue;
    const supported = getAdapter(account.channel).manifest.capabilities.find((c) => c.operation === 'bill.download')?.billKinds ?? [];
    const yesterday = dayjs().tz(account.billTimezone).subtract(1, 'day').format('YYYY-MM-DD');
    for (const kind of supported) {
      const firstDate = dayjs(account.createdAt).tz(account.billTimezone).format('YYYY-MM-DD');
      // Enumerate holes, not max(date): a manually submitted recent date cannot hide older gaps.
      const missing = await db.execute<{ bill_date: string }>(sql`
        select to_char(d, 'YYYY-MM-DD') as bill_date
        from generate_series(${firstDate}::date, ${yesterday}::date, interval '1 day') d
        where not exists(select 1 from ${paymentStatementPeriods} p
          where p.account_id = ${account.id} and p.bill_date = d::date and p.type = ${kind} and p.currency = 'CNY')
        order by d limit 31`);
      for (const item of missing) {
        await ensurePeriod(account, item.bill_date, kind, 'CNY'); planned++;
      }
    }
  }
  const due = await db.select().from(paymentStatementPeriods).where(and(inArray(paymentStatementPeriods.status, ['expected', 'waiting']),
    or(isNull(paymentStatementPeriods.nextAttemptAt), lte(paymentStatementPeriods.nextAttemptAt, new Date())))).orderBy(paymentStatementPeriods.billDate, paymentStatementPeriods.id).limit(100);
  for (const period of due) {
    const settings = await getSettings('payment', { tenantId: period.tenantId });
    if (!settings.reconEnabled || period.type === 'bank') continue;
    const task = await db.transaction((tx) => persistPeriodTask(tx, period, RECON_DOWNLOAD_TASK, {}, true));
    await enqueueCommitted(task.id); submitted++;
  }
  const overdue = await db.select().from(paymentStatementPeriods).where(and(inArray(paymentStatementPeriods.status, ['expected', 'waiting', 'failed']), lte(paymentStatementPeriods.deadlineAt, new Date()))).orderBy(paymentStatementPeriods.id).limit(100);
  for (const period of overdue) {
    const account = accounts.find((a) => a.id === period.accountId);
    if (!account) continue;
    const policy = await reconNotificationPolicy(period.tenantId, account.createdBy);
    await db.transaction((tx) => notifyWithin(tx, 'payment.recon.overdue', { tenantId: period.tenantId, recipients: policy.recipients,
      vars: { accountName: account.name, billDate: period.billDate, message: period.lastError ?? '账单尚未就绪' },
      dedupeKey: `payment-bill-overdue:${period.id}`, link: `/payment/recon?periodId=${period.id}` }));
  }
  return { planned, submitted };
}
