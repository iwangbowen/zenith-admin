import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { PAYMENT_RECON_ADJUSTMENT_STATUSES, PAYMENT_RECON_CASE_STATUSES, PAYMENT_RECON_CASE_TYPES, PAYMENT_RECON_DIRECTIONS, PAYMENT_RECON_RUN_STATUSES, PAYMENT_STATEMENT_ENTRY_TYPES, PAYMENT_STATEMENT_PERIOD_STATUSES, PAYMENT_STATEMENT_SOURCES, PAYMENT_STATEMENT_STATUSES, PAYMENT_STATEMENT_TYPES } from '@zenith/shared/payment';
import { idColumn, timestampColumns } from './common';
import { auditColumns, tenantIdColumn, users } from './core';
import { fileStorageConfigs } from './files';
import { paymentApps, paymentChannelAccounts, paymentChannelConfigs, paymentJournals, paymentOrders, paymentRefunds } from './payment';
import { asyncTasks } from './tasks';
import { workflowInstances } from './workflow';

export const paymentStatementTypeEnum = pgEnum('payment_statement_type', PAYMENT_STATEMENT_TYPES);
export const paymentStatementPeriodStatusEnum = pgEnum('payment_statement_period_status', PAYMENT_STATEMENT_PERIOD_STATUSES);
export const paymentStatementSourceEnum = pgEnum('payment_statement_source', PAYMENT_STATEMENT_SOURCES);
export const paymentStatementStatusEnum = pgEnum('payment_statement_status', PAYMENT_STATEMENT_STATUSES);
export const paymentStatementEntryTypeEnum = pgEnum('payment_statement_entry_type', PAYMENT_STATEMENT_ENTRY_TYPES);
export const paymentReconDirectionEnum = pgEnum('payment_recon_direction', PAYMENT_RECON_DIRECTIONS);
export const paymentReconRunStatusEnum = pgEnum('payment_recon_run_status', PAYMENT_RECON_RUN_STATUSES);
export const paymentReconCaseTypeEnum = pgEnum('payment_recon_case_type', PAYMENT_RECON_CASE_TYPES);
export const paymentReconCaseStatusEnum = pgEnum('payment_recon_case_status', PAYMENT_RECON_CASE_STATUSES);
export const paymentReconAdjustmentStatusEnum = pgEnum('payment_recon_adjustment_status', PAYMENT_RECON_ADJUSTMENT_STATUSES);

/** 账期是幂等与恢复边界，应用不是渠道账单的下载范围。 */
export const paymentStatementPeriods = pgTable('payment_statement_periods', {
  id: idColumn(),
  accountId: integer().notNull().references(() => paymentChannelAccounts.id, { onDelete: 'restrict' }),
  billDate: date({ mode: 'string' }).notNull(),
  type: paymentStatementTypeEnum().notNull(),
  currency: varchar({ length: 3 }).notNull().default('CNY'),
  status: paymentStatementPeriodStatusEnum().notNull().default('expected'),
  nextAttemptAt: timestamp({ withTimezone: true }),
  deadlineAt: timestamp({ withTimezone: true }),
  lastError: text(),
  /** 与 statement.periodId 形成环，由服务在同一事务内写入。 */
  currentStatementId: integer(),
  taskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  generation: integer().notNull().default(0),
  completedAt: timestamp({ withTimezone: true }),
  tenantId: tenantIdColumn('restrict'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  unique('payment_statement_periods_scope_unique').on(t.accountId, t.billDate, t.type, t.currency),
  index('payment_statement_periods_due_idx').on(t.status, t.nextAttemptAt),
  index('payment_statement_periods_tenant_idx').on(t.tenantId),
]);
export type PaymentStatementPeriodRow = typeof paymentStatementPeriods.$inferSelect;
export type NewPaymentStatementPeriod = typeof paymentStatementPeriods.$inferInsert;

/** 每一版本固定原件摘要、来源与解析规则；更正版仅替代，不能覆盖旧证据。 */
export const paymentStatements = pgTable('payment_statements', {
  id: idColumn(),
  periodId: integer().notNull().references(() => paymentStatementPeriods.id, { onDelete: 'restrict' }),
  version: integer().notNull(),
  source: paymentStatementSourceEnum().notNull(),
  contentHash: varchar({ length: 64 }).notNull(),
  parserVersion: varchar({ length: 64 }).notNull(),
  status: paymentStatementStatusEnum().notNull().default('archived'),
  summary: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  verification: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  tenantId: tenantIdColumn('restrict'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  unique('payment_statements_period_source_hash_unique').on(t.periodId, t.source, t.contentHash),
  unique('payment_statements_period_version_unique').on(t.periodId, t.version),
  check('payment_statements_positive_version', sql`${t.version} > 0`),
  index('payment_statements_tenant_idx').on(t.tenantId),
]);
export type PaymentStatementRow = typeof paymentStatements.$inferSelect;
export type NewPaymentStatement = typeof paymentStatements.$inferInsert;

export const paymentStatementFiles = pgTable('payment_statement_files', {
  id: idColumn(),
  statementId: integer().notNull().references(() => paymentStatements.id, { onDelete: 'restrict' }),
  storageKey: varchar({ length: 1024 }).notNull(),
  storageConfigId: integer().references(() => fileStorageConfigs.id, { onDelete: 'restrict' }),
  storageProvider: varchar({ length: 32 }).notNull(),
  bucketName: varchar({ length: 256 }),
  filename: varchar({ length: 255 }).notNull(),
  mimeType: varchar({ length: 128 }).notNull(),
  sha256: varchar({ length: 64 }).notNull(),
  providerHash: varchar({ length: 256 }),
  byteLength: integer().notNull(),
  tenantId: tenantIdColumn('restrict'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('payment_statement_files_identity_unique').on(t.statementId, t.sha256, t.filename),
  check('payment_statement_files_nonnegative_length', sql`${t.byteLength} >= 0`),
  index('payment_statement_files_tenant_idx').on(t.tenantId),
]);
export type PaymentStatementFileRow = typeof paymentStatementFiles.$inferSelect;
export type NewPaymentStatementFile = typeof paymentStatementFiles.$inferInsert;

export const paymentStatementEntries = pgTable('payment_statement_entries', {
  id: idColumn(),
  statementId: integer().notNull().references(() => paymentStatements.id, { onDelete: 'restrict' }),
  entryKey: varchar({ length: 256 }).notNull(),
  type: paymentStatementEntryTypeEnum().notNull(),
  merchantOrderNo: varchar({ length: 128 }),
  merchantRefundNo: varchar({ length: 128 }),
  providerTransactionId: varchar({ length: 128 }),
  providerRefundId: varchar({ length: 128 }),
  reference: varchar({ length: 256 }),
  currency: varchar({ length: 3 }).notNull(),
  amount: bigint({ mode: 'bigint' }).notNull(),
  direction: paymentReconDirectionEnum().notNull(),
  status: varchar({ length: 64 }).notNull(),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  applicationId: integer().references(() => paymentApps.id, { onDelete: 'restrict' }),
  raw: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  lineNo: integer().notNull(),
  feeAmount: bigint({ mode: 'bigint' }),
  netAmount: bigint({ mode: 'bigint' }),
  balance: bigint({ mode: 'bigint' }),
  tenantId: tenantIdColumn('restrict'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('payment_statement_entries_statement_key_unique').on(t.statementId, t.entryKey),
  index('payment_statement_entries_order_idx').on(t.merchantOrderNo),
  index('payment_statement_entries_refund_idx').on(t.merchantRefundNo),
  index('payment_statement_entries_reference_idx').on(t.reference),
  index('payment_statement_entries_tenant_idx').on(t.tenantId),
  check('payment_statement_entries_nonnegative_amount', sql`${t.amount} >= 0`),
  check('payment_statement_entries_positive_line', sql`${t.lineNo} > 0`),
]);
export type PaymentStatementEntryRow = typeof paymentStatementEntries.$inferSelect;
export type NewPaymentStatementEntry = typeof paymentStatementEntries.$inferInsert;

export const paymentReconRuns = pgTable('payment_recon_runs', {
  id: idColumn(),
  statementId: integer().notNull().references(() => paymentStatements.id, { onDelete: 'restrict' }),
  ruleVersion: varchar({ length: 64 }).notNull(),
  status: paymentReconRunStatusEnum().notNull().default('pending'),
  localSnapshot: jsonb().$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  snapshotContext: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  matchedCount: integer().notNull().default(0),
  diffCount: integer().notNull().default(0),
  totalCount: integer().notNull().default(0),
  taskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
  error: text(),
  tenantId: tenantIdColumn('restrict'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('payment_recon_runs_statement_idx').on(t.statementId),
  index('payment_recon_runs_tenant_idx').on(t.tenantId),
  uniqueIndex('payment_recon_runs_active_statement_unique').on(t.statementId).where(sql`${t.status} in ('pending', 'running')`),
]);
export type PaymentReconRunRow = typeof paymentReconRuns.$inferSelect;
export type NewPaymentReconRun = typeof paymentReconRuns.$inferInsert;

export const paymentReconCases = pgTable('payment_recon_cases', {
  id: idColumn(),
  accountId: integer().notNull().references(() => paymentChannelAccounts.id, { onDelete: 'restrict' }),
  periodId: integer().notNull().references(() => paymentStatementPeriods.id, { onDelete: 'restrict' }),
  caseKey: varchar({ length: 320 }).notNull(),
  entryKey: varchar({ length: 256 }).notNull(),
  type: paymentReconCaseTypeEnum().notNull(),
  stage: paymentStatementTypeEnum().notNull(),
  status: paymentReconCaseStatusEnum().notNull().default('open'),
  version: integer().notNull().default(1),
  lastRunId: integer().notNull().references(() => paymentReconRuns.id, { onDelete: 'restrict' }),
  applicationId: integer().references(() => paymentApps.id, { onDelete: 'restrict' }),
  orderId: integer().references(() => paymentOrders.id, { onDelete: 'restrict' }),
  refundId: integer().references(() => paymentRefunds.id, { onDelete: 'restrict' }),
  localAmount: bigint({ mode: 'bigint' }),
  channelAmount: bigint({ mode: 'bigint' }),
  currency: varchar({ length: 3 }).notNull(),
  evidence: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  assignedTo: integer().references(() => users.id, { onDelete: 'set null' }),
  dueAt: timestamp({ withTimezone: true }),
  resolution: text(),
  tenantId: tenantIdColumn('restrict'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  unique('payment_recon_cases_period_key_unique').on(t.periodId, t.caseKey),
  index('payment_recon_cases_account_status_idx').on(t.accountId, t.status),
  index('payment_recon_cases_due_idx').on(t.dueAt, t.status),
  index('payment_recon_cases_tenant_idx').on(t.tenantId),
  check('payment_recon_cases_positive_version', sql`${t.version} > 0`),
]);
export type PaymentReconCaseRow = typeof paymentReconCases.$inferSelect;
export type NewPaymentReconCase = typeof paymentReconCases.$inferInsert;

export const paymentReconCaseEvents = pgTable('payment_recon_case_events', {
  id: idColumn(),
  caseId: integer().notNull().references(() => paymentReconCases.id, { onDelete: 'restrict' }),
  action: varchar({ length: 64 }).notNull(),
  actorId: integer().references(() => users.id, { onDelete: 'set null' }),
  remark: text(),
  before: jsonb().$type<Record<string, unknown>>(),
  after: jsonb().$type<Record<string, unknown>>(),
  tenantId: tenantIdColumn('restrict'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('payment_recon_case_events_case_idx').on(t.caseId, t.id), index('payment_recon_case_events_tenant_idx').on(t.tenantId)]);
export type PaymentReconCaseEventRow = typeof paymentReconCaseEvents.$inferSelect;
export type NewPaymentReconCaseEvent = typeof paymentReconCaseEvents.$inferInsert;

export const paymentReconAdjustments = pgTable('payment_recon_adjustments', {
  id: idColumn(),
  caseId: integer().notNull().references(() => paymentReconCases.id, { onDelete: 'restrict' }),
  caseVersion: integer().notNull(),
  applicationId: integer().notNull().references(() => paymentApps.id, { onDelete: 'restrict' }),
  channelConfigId: integer().notNull().references(() => paymentChannelConfigs.id, { onDelete: 'restrict' }),
  amount: bigint({ mode: 'bigint' }).notNull(),
  direction: paymentReconDirectionEnum().notNull(),
  reason: text().notNull(),
  evidence: jsonb().$type<Record<string, unknown>>().notNull(),
  status: paymentReconAdjustmentStatusEnum().notNull().default('draft'),
  workflowInstanceId: integer().references(() => workflowInstances.id, { onDelete: 'restrict' }),
  journalId: integer().references(() => paymentJournals.id, { onDelete: 'restrict' }),
  reversalOfId: integer().references((): AnyPgColumn => paymentReconAdjustments.id, { onDelete: 'restrict' }),
  applicantId: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
  approverId: integer().references(() => users.id, { onDelete: 'restrict' }),
  approvedAt: timestamp({ withTimezone: true }),
  executedAt: timestamp({ withTimezone: true }),
  tenantId: tenantIdColumn('restrict'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('payment_recon_adjustments_active_case_unique').on(t.caseId).where(sql`${t.reversalOfId} is null and ${t.status} in ('draft', 'pending', 'approved', 'executed')`),
  uniqueIndex('payment_recon_adjustments_active_reversal_unique').on(t.reversalOfId).where(sql`${t.reversalOfId} is not null and ${t.status} <> 'rejected'`),
  unique('payment_recon_adjustments_journal_unique').on(t.journalId),
  index('payment_recon_adjustments_case_idx').on(t.caseId),
  index('payment_recon_adjustments_tenant_status_idx').on(t.tenantId, t.status),
  check('payment_recon_adjustments_positive_amount', sql`${t.amount} > 0`),
  check('payment_recon_adjustments_four_eyes', sql`${t.approverId} is null or ${t.approverId} <> ${t.applicantId}`),
  check('payment_recon_adjustments_execution_journal', sql`${t.status} not in ('executed', 'reversed') or (${t.journalId} is not null and ${t.executedAt} is not null)`),
]);
export type PaymentReconAdjustmentRow = typeof paymentReconAdjustments.$inferSelect;
export type NewPaymentReconAdjustment = typeof paymentReconAdjustments.$inferInsert;

/** 每一笔到账分配只追加。两侧可有多笔分配，事务锁住两端并检查累计上限。 */
export const paymentBankMatches = pgTable('payment_bank_matches', {
  id: idColumn(),
  accountId: integer().notNull().references(() => paymentChannelAccounts.id, { onDelete: 'restrict' }),
  bankEntryId: integer().notNull().references(() => paymentStatementEntries.id, { onDelete: 'restrict' }),
  settlementEntryId: integer().notNull().references(() => paymentStatementEntries.id, { onDelete: 'restrict' }),
  amount: bigint({ mode: 'bigint' }).notNull(),
  tenantId: tenantIdColumn('restrict'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  unique('payment_bank_matches_pair_unique').on(t.bankEntryId, t.settlementEntryId),
  check('payment_bank_matches_positive_amount', sql`${t.amount} > 0`),
  check('payment_bank_matches_distinct_entries', sql`${t.bankEntryId} <> ${t.settlementEntryId}`),
  index('payment_bank_matches_account_idx').on(t.accountId),
  index('payment_bank_matches_tenant_idx').on(t.tenantId),
]);
export type PaymentBankMatchRow = typeof paymentBankMatches.$inferSelect;
export type NewPaymentBankMatch = typeof paymentBankMatches.$inferInsert;
