import { sql } from 'drizzle-orm';
import {
  bigint, boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid as pgUuid, varchar } from 'drizzle-orm/pg-core';
import { REPORT_ACL_ROLES, REPORT_ACL_SUBJECT_TYPES, REPORT_APPROVAL_STATUSES, REPORT_ASSET_TEMPLATE_TYPES, REPORT_CHATBI_MESSAGE_ROLES, REPORT_CHATBI_SESSION_STATUSES, REPORT_DQ_ANOMALY_STATUSES, REPORT_DQ_RULE_TYPES, REPORT_DQ_RUN_STATUSES, REPORT_DQ_SEVERITIES, REPORT_ENVIRONMENT_KINDS, REPORT_FILL_RECORD_STATUSES, REPORT_FILL_SYNC_STATUSES, REPORT_FILL_TEMPLATE_STATUSES, REPORT_MATERIALIZATION_STRATEGIES, REPORT_METRIC_LIFECYCLE_STATUSES, REPORT_METRIC_TYPES, REPORT_PROMOTION_STATUSES, REPORT_QUOTA_SCOPES, REPORT_SLA_TYPES, REPORT_SLA_VIOLATION_STATUSES, REPORT_SNAPSHOT_STATUSES, REPORT_TRANSFER_STATUSES } from '@zenith/shared/report';
import type { ReportChatbiChartSuggestion, ReportChatbiContextSnapshot, ReportDataResult, ReportDqRuleConfig, ReportNotifyChannel } from '@zenith/shared/report';
import type { WorkflowFormSchema } from '@zenith/shared/workflow';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';
import { managedFiles } from './files';
import {
  reportDatasets,
  reportDashboards,
  reportDatasources,
  reportFolders,
  reportResourceTypeEnum,
} from './report';
import { workflowDefinitions, workflowInstances } from './workflow';

export const reportMetricTypeEnum = pgEnum('report_metric_type', REPORT_METRIC_TYPES);
export const reportMetricLifecycleStatusEnum = pgEnum('report_metric_lifecycle_status', REPORT_METRIC_LIFECYCLE_STATUSES);
export const reportAclSubjectTypeEnum = pgEnum('report_acl_subject_type', REPORT_ACL_SUBJECT_TYPES);
export const reportAclRoleEnum = pgEnum('report_acl_role', REPORT_ACL_ROLES);
export const reportApprovalStatusEnum = pgEnum('report_approval_status', REPORT_APPROVAL_STATUSES);
export const reportTransferStatusEnum = pgEnum('report_transfer_status', REPORT_TRANSFER_STATUSES);
export const reportEnvironmentKindEnum = pgEnum('report_environment_kind', REPORT_ENVIRONMENT_KINDS);
export const reportPromotionStatusEnum = pgEnum('report_promotion_status', REPORT_PROMOTION_STATUSES);
export const reportDqRuleTypeEnum = pgEnum('report_dq_rule_type', REPORT_DQ_RULE_TYPES);
export const reportDqSeverityEnum = pgEnum('report_dq_severity', REPORT_DQ_SEVERITIES);
export const reportDqRunStatusEnum = pgEnum('report_dq_run_status', REPORT_DQ_RUN_STATUSES);
export const reportDqAnomalyStatusEnum = pgEnum('report_dq_anomaly_status', REPORT_DQ_ANOMALY_STATUSES);
export const reportMaterializationStrategyEnum = pgEnum('report_materialization_strategy', REPORT_MATERIALIZATION_STRATEGIES);
export const reportSnapshotStatusEnum = pgEnum('report_snapshot_status', REPORT_SNAPSHOT_STATUSES);
export const reportQuotaScopeEnum = pgEnum('report_quota_scope', REPORT_QUOTA_SCOPES);
export const reportSlaTypeEnum = pgEnum('report_sla_type', REPORT_SLA_TYPES);
export const reportSlaViolationStatusEnum = pgEnum('report_sla_violation_status', REPORT_SLA_VIOLATION_STATUSES);
export const reportAssetTemplateTypeEnum = pgEnum('report_asset_template_type', REPORT_ASSET_TEMPLATE_TYPES);
export const reportChatbiSessionStatusEnum = pgEnum('report_chatbi_session_status', REPORT_CHATBI_SESSION_STATUSES);
export const reportChatbiMessageRoleEnum = pgEnum('report_chatbi_message_role', REPORT_CHATBI_MESSAGE_ROLES);
export const reportFillTemplateStatusEnum = pgEnum('report_fill_template_status', REPORT_FILL_TEMPLATE_STATUSES);
export const reportFillRecordStatusEnum = pgEnum('report_fill_record_status', REPORT_FILL_RECORD_STATUSES);
export const reportFillSyncStatusEnum = pgEnum('report_fill_sync_status', REPORT_FILL_SYNC_STATUSES);

export const reportMetrics = pgTable('report_metrics', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  code: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 128 }).notNull(),
  description: text(),
  type: reportMetricTypeEnum().notNull(),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'restrict' }),
  sourceField: varchar({ length: 128 }),
  formula: text(),
  aggregate: varchar({ length: 32 }),
  dimensions: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  timeField: varchar({ length: 128 }),
  unit: varchar({ length: 32 }),
  format: varchar({ length: 128 }),
  caliber: text(),
  lifecycleStatus: reportMetricLifecycleStatusEnum().notNull().default('draft'),
  revision: integer().notNull().default(1),
  publishedSnapshot: jsonb().$type<Record<string, unknown> | null>(),
  publishedAt: timestamp({ withTimezone: true }),
  publishedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  deprecatedAt: timestamp({ withTimezone: true }),
  deprecatedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  deprecationReason: varchar({ length: 500 }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_metrics_tenant_code_uq').on(t.tenantId, t.code).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_metrics_global_code_uq').on(t.code).where(sql`${t.tenantId} is null`),
  index('report_metrics_tenant_lifecycle_idx').on(t.tenantId, t.lifecycleStatus),
  index('report_metrics_dataset_idx').on(t.datasetId),
  index('report_metrics_folder_idx').on(t.folderId),
  index('report_metrics_owner_idx').on(t.ownerId),
]);

export const reportResourceAcls = pgTable('report_resource_acls', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  resourceType: reportResourceTypeEnum().notNull(),
  resourceId: integer().notNull(),
  subjectType: reportAclSubjectTypeEnum().notNull(),
  subjectId: integer().notNull(),
  role: reportAclRoleEnum().notNull(),
  inheritFromFolder: boolean().notNull().default(false),
  expiresAt: timestamp({ withTimezone: true }),
  grantedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_resource_acls_tenant_subject_uq')
    .on(t.tenantId, t.resourceType, t.resourceId, t.subjectType, t.subjectId, t.inheritFromFolder)
    .where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_resource_acls_global_subject_uq')
    .on(t.resourceType, t.resourceId, t.subjectType, t.subjectId, t.inheritFromFolder)
    .where(sql`${t.tenantId} is null`),
  index('report_resource_acls_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  index('report_resource_acls_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
  index('report_resource_acls_expires_idx').on(t.expiresAt),
]);

export const reportPublishApprovals = pgTable('report_publish_approvals', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  resourceType: reportResourceTypeEnum().notNull(),
  resourceId: integer().notNull(),
  action: varchar({ length: 16 }).$type<'publish' | 'promote' | 'deprecate'>().notNull(),
  requestedRevision: integer().notNull(),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  status: reportApprovalStatusEnum().notNull().default('pending'),
  requestedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  requestedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  decidedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp({ withTimezone: true }),
  decisionNote: varchar({ length: 1000 }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_publish_approvals_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  index('report_publish_approvals_status_time_idx').on(t.tenantId, t.status, t.requestedAt),
  index('report_publish_approvals_requester_idx').on(t.requestedBy),
]);

export const reportResourceTransfers = pgTable('report_resource_transfers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  resourceType: reportResourceTypeEnum().notNull(),
  resourceId: integer().notNull(),
  fromOwnerId: integer().references(() => users.id, { onDelete: 'set null' }),
  toOwnerId: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: reportTransferStatusEnum().notNull().default('pending'),
  reason: varchar({ length: 500 }),
  requestedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  decidedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp({ withTimezone: true }),
  decisionNote: varchar({ length: 500 }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_resource_transfers_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  index('report_resource_transfers_owner_status_idx').on(t.toOwnerId, t.status, t.createdAt),
]);

export const reportEnvironments = pgTable('report_environments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  code: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 128 }).notNull(),
  kind: reportEnvironmentKindEnum().notNull(),
  description: varchar({ length: 500 }),
  baseUrl: varchar({ length: 1024 }),
  config: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  isDefault: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_environments_tenant_code_uq').on(t.tenantId, t.code).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_environments_global_code_uq').on(t.code).where(sql`${t.tenantId} is null`),
  uniqueIndex('report_environments_tenant_default_uq').on(t.tenantId).where(sql`${t.tenantId} is not null and ${t.isDefault} = true`),
  uniqueIndex('report_environments_global_default_uq').on(t.isDefault).where(sql`${t.tenantId} is null and ${t.isDefault} = true`),
  index('report_environments_tenant_kind_status_idx').on(t.tenantId, t.kind, t.status),
]);

export const reportEnvironmentPromotions = pgTable('report_environment_promotions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  resourceType: reportResourceTypeEnum().notNull(),
  resourceId: integer().notNull(),
  sourceEnvironmentId: integer().notNull().references(() => reportEnvironments.id, { onDelete: 'restrict' }),
  targetEnvironmentId: integer().notNull().references(() => reportEnvironments.id, { onDelete: 'restrict' }),
  sourceRevision: integer().notNull(),
  sourceSnapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  targetSnapshot: jsonb().$type<Record<string, unknown> | null>(),
  rollbackSnapshot: jsonb().$type<Record<string, unknown> | null>(),
  status: reportPromotionStatusEnum().notNull().default('pending'),
  requestedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  approvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  deployedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  errorMessage: varchar({ length: 1000 }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_environment_promotions_resource_idx').on(t.tenantId, t.resourceType, t.resourceId, t.createdAt),
  index('report_environment_promotions_target_status_idx').on(t.targetEnvironmentId, t.status, t.createdAt),
]);

export const reportDqRules = pgTable('report_dq_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  name: varchar({ length: 128 }).notNull(),
  type: reportDqRuleTypeEnum().notNull(),
  field: varchar({ length: 128 }),
  severity: reportDqSeverityEnum().notNull().default('medium'),
  config: jsonb().$type<ReportDqRuleConfig>().notNull().default(sql`'{}'::jsonb`),
  cron: varchar({ length: 64 }),
  timezone: varchar({ length: 64 }).notNull().default('Asia/Shanghai'),
  enabled: boolean().notNull().default(true),
  lastRunAt: timestamp({ withTimezone: true }),
  lastStatus: reportDqRunStatusEnum(),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_dq_rules_tenant_dataset_name_uq').on(t.tenantId, t.datasetId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_dq_rules_global_dataset_name_uq').on(t.datasetId, t.name).where(sql`${t.tenantId} is null`),
  index('report_dq_rules_dataset_enabled_idx').on(t.datasetId, t.enabled),
  index('report_dq_rules_schedule_idx').on(t.enabled, t.cron),
]);

export const reportDqRuns = pgTable('report_dq_runs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  ruleId: integer().notNull().references(() => reportDqRules.id, { onDelete: 'cascade' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  status: reportDqRunStatusEnum().notNull().default('pending'),
  triggerType: varchar({ length: 32 }).$type<'manual' | 'scheduled' | 'dataset_refresh'>().notNull(),
  checkedRows: bigint({ mode: 'number' }).notNull().default(0),
  failedRows: bigint({ mode: 'number' }).notNull().default(0),
  passRate: doublePrecision(),
  sampleRows: jsonb().$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  sampleRowCount: integer().notNull().default(0),
  sampleBytes: bigint({ mode: 'number' }).notNull().default(0),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  durationMs: integer(),
  errorMessage: varchar({ length: 1000 }),
  schemaSignature: varchar({ length: 128 }),
  requestedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_dq_runs_rule_time_idx').on(t.ruleId, t.createdAt),
  index('report_dq_runs_dataset_status_time_idx').on(t.datasetId, t.status, t.createdAt),
  index('report_dq_runs_tenant_time_idx').on(t.tenantId, t.createdAt),
]);

export const reportDqScores = pgTable('report_dq_scores', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  score: doublePrecision().notNull(),
  passedRules: integer().notNull().default(0),
  failedRules: integer().notNull().default(0),
  totalRules: integer().notNull().default(0),
  dimensions: jsonb().$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  measuredAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('report_dq_scores_dataset_time_idx').on(t.datasetId, t.measuredAt),
  index('report_dq_scores_tenant_time_idx').on(t.tenantId, t.measuredAt),
]);

export const reportDqAnomalies = pgTable('report_dq_anomalies', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  ruleId: integer().references(() => reportDqRules.id, { onDelete: 'set null' }),
  runId: integer().references(() => reportDqRuns.id, { onDelete: 'set null' }),
  severity: reportDqSeverityEnum().notNull(),
  title: varchar({ length: 256 }).notNull(),
  detail: text(),
  sample: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  sampleRowCount: integer().notNull().default(0),
  sampleBytes: bigint({ mode: 'number' }).notNull().default(0),
  status: reportDqAnomalyStatusEnum().notNull().default('open'),
  acknowledgedAt: timestamp({ withTimezone: true }),
  acknowledgedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  acknowledgementNote: varchar({ length: 1000 }),
  resolvedAt: timestamp({ withTimezone: true }),
  resolvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_dq_anomalies_dataset_status_idx').on(t.datasetId, t.status, t.createdAt),
  index('report_dq_anomalies_tenant_severity_status_idx').on(t.tenantId, t.severity, t.status),
  index('report_dq_anomalies_run_idx').on(t.runId),
]);

export const reportMaterializationSnapshots = pgTable('report_materialization_snapshots', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  strategy: reportMaterializationStrategyEnum().notNull().default('full'),
  status: reportSnapshotStatusEnum().notNull().default('pending'),
  revision: integer().notNull(),
  keyField: varchar({ length: 128 }),
  watermark: varchar({ length: 256 }),
  deltaWindowMinutes: integer(),
  fileId: pgUuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  inlineData: jsonb().$type<ReportDataResult | null>(),
  rowCount: bigint({ mode: 'number' }).notNull().default(0),
  byteSize: bigint({ mode: 'number' }).notNull().default(0),
  checksum: varchar({ length: 128 }),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  errorMessage: varchar({ length: 1000 }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_materialization_snapshots_dataset_revision_uq').on(t.datasetId, t.revision),
  index('report_materialization_snapshots_dataset_status_idx').on(t.datasetId, t.status, t.createdAt),
  index('report_materialization_snapshots_tenant_expiry_idx').on(t.tenantId, t.expiresAt),
]);

export const reportQueryQuotas = pgTable('report_query_quotas', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  scope: reportQuotaScopeEnum().notNull(),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }),
  maxConcurrent: integer().notNull(),
  dailyQueryLimit: bigint({ mode: 'number' }).notNull().default(0),
  dailyRowLimit: bigint({ mode: 'number' }).notNull().default(0),
  dailyByteLimit: bigint({ mode: 'number' }).notNull().default(0),
  dailyCostLimit: doublePrecision().notNull().default(0),
  resetTimezone: varchar({ length: 64 }).notNull().default('Asia/Shanghai'),
  enabled: boolean().notNull().default(true),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_query_quotas_tenant_scope_uq').on(t.tenantId, t.scope)
    .where(sql`${t.tenantId} is not null and ${t.scope} = 'tenant' and ${t.userId} is null`),
  uniqueIndex('report_query_quotas_global_scope_uq').on(t.scope)
    .where(sql`${t.tenantId} is null and ${t.scope} = 'tenant' and ${t.userId} is null`),
  uniqueIndex('report_query_quotas_tenant_user_uq').on(t.tenantId, t.userId)
    .where(sql`${t.tenantId} is not null and ${t.scope} = 'user' and ${t.userId} is not null`),
  uniqueIndex('report_query_quotas_global_user_uq').on(t.userId)
    .where(sql`${t.tenantId} is null and ${t.scope} = 'user' and ${t.userId} is not null`),
  index('report_query_quotas_enabled_idx').on(t.tenantId, t.enabled),
]);

export const reportQueryCostLogs = pgTable('report_query_cost_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  datasetId: integer().references(() => reportDatasets.id, { onDelete: 'set null' }),
  datasourceId: integer().references(() => reportDatasources.id, { onDelete: 'set null' }),
  scene: varchar({ length: 64 }).notNull(),
  requestId: varchar({ length: 128 }).notNull(),
  queuedMs: integer().notNull().default(0),
  durationMs: integer().notNull().default(0),
  rowCount: bigint({ mode: 'number' }).notNull().default(0),
  byteSize: bigint({ mode: 'number' }).notNull().default(0),
  costUnits: doublePrecision().notNull().default(0),
  cacheHit: boolean().notNull().default(false),
  success: boolean().notNull().default(true),
  errorCode: varchar({ length: 64 }),
  occurredAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('report_query_cost_logs_request_uq').on(t.requestId),
  index('report_query_cost_logs_tenant_time_idx').on(t.tenantId, t.occurredAt),
  index('report_query_cost_logs_user_time_idx').on(t.userId, t.occurredAt),
  index('report_query_cost_logs_dataset_time_idx').on(t.datasetId, t.occurredAt),
]);

export const reportSlaRules = pgTable('report_sla_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  name: varchar({ length: 128 }).notNull(),
  type: reportSlaTypeEnum().notNull(),
  targetValue: doublePrecision().notNull(),
  warningValue: doublePrecision(),
  windowMinutes: integer().notNull(),
  cron: varchar({ length: 64 }),
  timezone: varchar({ length: 64 }).notNull().default('Asia/Shanghai'),
  severity: reportDqSeverityEnum().notNull().default('high'),
  channels: jsonb().$type<ReportNotifyChannel[]>().notNull().default(sql`'[]'::jsonb`),
  recipients: varchar({ length: 512 }),
  webhookUrl: varchar({ length: 512 }),
  silenceMins: integer().notNull().default(60),
  enabled: boolean().notNull().default(true),
  lastEvaluatedAt: timestamp({ withTimezone: true }),
  lastNotifiedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_sla_rules_tenant_dataset_name_uq').on(t.tenantId, t.datasetId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_sla_rules_global_dataset_name_uq').on(t.datasetId, t.name).where(sql`${t.tenantId} is null`),
  index('report_sla_rules_dataset_enabled_idx').on(t.datasetId, t.enabled),
]);

export const reportSlaViolations = pgTable('report_sla_violations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  ruleId: integer().notNull().references(() => reportSlaRules.id, { onDelete: 'cascade' }),
  datasetId: integer().notNull().references(() => reportDatasets.id, { onDelete: 'cascade' }),
  status: reportSlaViolationStatusEnum().notNull().default('open'),
  observedValue: doublePrecision().notNull(),
  targetValue: doublePrecision().notNull(),
  windowStartedAt: timestamp({ withTimezone: true }).notNull(),
  windowEndedAt: timestamp({ withTimezone: true }).notNull(),
  detail: text(),
  acknowledgedAt: timestamp({ withTimezone: true }),
  acknowledgedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp({ withTimezone: true }),
  resolvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  resolutionNote: varchar({ length: 1000 }),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_sla_violations_rule_time_idx').on(t.ruleId, t.createdAt),
  index('report_sla_violations_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
]);

export const reportAssetUsageLogs = pgTable('report_asset_usage_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  resourceType: reportResourceTypeEnum().notNull(),
  resourceId: integer().notNull(),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  action: varchar({ length: 16 }).$type<'view' | 'query' | 'export' | 'embed' | 'share'>().notNull(),
  scene: varchar({ length: 64 }),
  durationMs: integer(),
  rowCount: bigint({ mode: 'number' }).notNull().default(0),
  byteSize: bigint({ mode: 'number' }).notNull().default(0),
  success: boolean().notNull().default(true),
  occurredAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('report_asset_usage_logs_resource_time_idx').on(t.tenantId, t.resourceType, t.resourceId, t.occurredAt),
  index('report_asset_usage_logs_user_time_idx').on(t.userId, t.occurredAt),
]);

export const reportDeprecationNotices = pgTable('report_deprecation_notices', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  resourceType: reportResourceTypeEnum().notNull(),
  resourceId: integer().notNull(),
  title: varchar({ length: 128 }).notNull(),
  message: text().notNull(),
  replacementResourceType: reportResourceTypeEnum(),
  replacementResourceId: integer(),
  effectiveAt: timestamp({ withTimezone: true }).notNull(),
  expiresAt: timestamp({ withTimezone: true }),
  publishedAt: timestamp({ withTimezone: true }),
  publishedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  processedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_deprecation_notices_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  index('report_deprecation_notices_effective_idx').on(t.tenantId, t.effectiveAt, t.expiresAt),
]);

export const reportAssetTemplates = pgTable('report_asset_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  code: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 128 }).notNull(),
  type: reportAssetTemplateTypeEnum().notNull(),
  description: text(),
  content: jsonb().$type<Record<string, unknown>>().notNull(),
  previewFileId: pgUuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  version: integer().notNull().default(1),
  usageCount: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_asset_templates_tenant_code_uq').on(t.tenantId, t.code).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_asset_templates_global_code_uq').on(t.code).where(sql`${t.tenantId} is null`),
  index('report_asset_templates_tenant_type_status_idx').on(t.tenantId, t.type, t.status),
  index('report_asset_templates_folder_idx').on(t.folderId),
  index('report_asset_templates_owner_idx').on(t.ownerId),
]);

export const reportChatbiSessions = pgTable('report_chatbi_sessions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar({ length: 128 }).notNull(),
  datasourceId: integer().references(() => reportDatasources.id, { onDelete: 'set null' }),
  datasetId: integer().references(() => reportDatasets.id, { onDelete: 'set null' }),
  allowedTables: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  contextSnapshot: jsonb().$type<ReportChatbiContextSnapshot>().notNull(),
  status: reportChatbiSessionStatusEnum().notNull().default('active'),
  totalTokens: bigint({ mode: 'number' }).notNull().default(0),
  totalCostUnits: doublePrecision().notNull().default(0),
  lastMessageAt: timestamp({ withTimezone: true }),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [index('report_chatbi_sessions_user_idx').on(t.userId), 
  index('report_chatbi_sessions_user_status_time_idx').on(t.tenantId, t.userId, t.status, t.updatedAt),
  index('report_chatbi_sessions_dataset_idx').on(t.datasetId),
  index('report_chatbi_sessions_datasource_idx').on(t.datasourceId),
]);

export const reportChatbiMessages = pgTable('report_chatbi_messages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  sessionId: integer().notNull().references(() => reportChatbiSessions.id, { onDelete: 'cascade' }),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  role: reportChatbiMessageRoleEnum().notNull(),
  content: text().notNull(),
  generatedSql: text(),
  chartSuggestion: jsonb().$type<ReportChatbiChartSuggestion | null>(),
  resultSample: jsonb().$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  resultRowCount: bigint({ mode: 'number' }).notNull().default(0),
  resultByteSize: bigint({ mode: 'number' }).notNull().default(0),
  savedResourceType: reportResourceTypeEnum(),
  savedResourceId: integer(),
  savedDatasetId: integer().references(() => reportDatasets.id, { onDelete: 'set null' }),
  savedDashboardId: integer().references(() => reportDashboards.id, { onDelete: 'set null' }),
  promptTokens: integer().notNull().default(0),
  completionTokens: integer().notNull().default(0),
  costUnits: doublePrecision().notNull().default(0),
  latencyMs: integer(),
  modelId: varchar({ length: 128 }),
  errorMessage: varchar({ length: 1000 }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('report_chatbi_messages_user_idx').on(t.userId), 
  index('report_chatbi_messages_session_time_idx').on(t.sessionId, t.createdAt),
  index('report_chatbi_messages_tenant_user_time_idx').on(t.tenantId, t.userId, t.createdAt),
]);

export const reportFillTemplates = pgTable('report_fill_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  code: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 128 }).notNull(),
  description: text(),
  formSchema: jsonb().$type<WorkflowFormSchema>().notNull(),
  publishedSchema: jsonb().$type<WorkflowFormSchema>(),
  publishedRevision: integer(),
  workflowDefinitionId: integer().references(() => workflowDefinitions.id, { onDelete: 'set null' }),
  needReview: boolean().notNull().default(false),
  generatedDatasetId: integer().references(() => reportDatasets.id, { onDelete: 'set null' }),
  status: reportFillTemplateStatusEnum().notNull().default('draft'),
  revision: integer().notNull().default(1),
  publishedAt: timestamp({ withTimezone: true }),
  publishedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  uniqueIndex('report_fill_templates_tenant_code_uq').on(t.tenantId, t.code).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_fill_templates_global_code_uq').on(t.code).where(sql`${t.tenantId} is null`),
  index('report_fill_templates_tenant_status_idx').on(t.tenantId, t.status),
  index('report_fill_templates_folder_idx').on(t.folderId),
  index('report_fill_templates_owner_idx').on(t.ownerId),
  index('report_fill_templates_dataset_idx').on(t.generatedDatasetId),
]);

export const reportFillRecords = pgTable('report_fill_records', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  templateId: integer().notNull().references(() => reportFillTemplates.id, { onDelete: 'restrict' }),
  submitterId: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: reportFillRecordStatusEnum().notNull().default('draft'),
  data: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  templateRevision: integer().notNull(),
  templateSchemaSnapshot: jsonb().$type<WorkflowFormSchema>().notNull(),
  templateNeedReview: boolean().notNull(),
  workflowDefinitionIdSnapshot: integer(),
  submitComment: varchar({ length: 1000 }),
  submittedAt: timestamp({ withTimezone: true }),
  reviewedAt: timestamp({ withTimezone: true }),
  reviewedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  reviewComment: varchar({ length: 1000 }),
  workflowInstanceId: integer().references(() => workflowInstances.id, { onDelete: 'set null' }),
  generatedDatasetId: integer().references(() => reportDatasets.id, { onDelete: 'set null' }),
  syncStatus: reportFillSyncStatusEnum().notNull().default('pending'),
  syncTaskId: integer(),
  syncError: varchar({ length: 1000 }),
  syncedAt: timestamp({ withTimezone: true }),
  revision: integer().notNull().default(1),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [
  index('report_fill_records_template_status_time_idx').on(t.templateId, t.status, t.createdAt),
  index('report_fill_records_submitter_status_time_idx').on(t.tenantId, t.submitterId, t.status, t.createdAt),
  index('report_fill_records_workflow_idx').on(t.workflowInstanceId),
  index('report_fill_records_dataset_idx').on(t.generatedDatasetId),
  index('report_fill_records_sync_idx').on(t.tenantId, t.syncStatus, t.updatedAt),
]);

export type ReportMetricRow = typeof reportMetrics.$inferSelect;
export type NewReportMetric = typeof reportMetrics.$inferInsert;
export type ReportResourceAclRow = typeof reportResourceAcls.$inferSelect;
export type NewReportResourceAcl = typeof reportResourceAcls.$inferInsert;
export type ReportPublishApprovalRow = typeof reportPublishApprovals.$inferSelect;
export type NewReportPublishApproval = typeof reportPublishApprovals.$inferInsert;
export type ReportResourceTransferRow = typeof reportResourceTransfers.$inferSelect;
export type NewReportResourceTransfer = typeof reportResourceTransfers.$inferInsert;
export type ReportEnvironmentRow = typeof reportEnvironments.$inferSelect;
export type NewReportEnvironment = typeof reportEnvironments.$inferInsert;
export type ReportEnvironmentPromotionRow = typeof reportEnvironmentPromotions.$inferSelect;
export type NewReportEnvironmentPromotion = typeof reportEnvironmentPromotions.$inferInsert;
export type ReportDqRuleRow = typeof reportDqRules.$inferSelect;
export type NewReportDqRule = typeof reportDqRules.$inferInsert;
export type ReportDqRunRow = typeof reportDqRuns.$inferSelect;
export type ReportDqScoreRow = typeof reportDqScores.$inferSelect;
export type ReportDqAnomalyRow = typeof reportDqAnomalies.$inferSelect;
export type ReportMaterializationSnapshotRow = typeof reportMaterializationSnapshots.$inferSelect;
export type ReportQueryQuotaRow = typeof reportQueryQuotas.$inferSelect;
export type NewReportQueryQuota = typeof reportQueryQuotas.$inferInsert;
export type ReportQueryCostLogRow = typeof reportQueryCostLogs.$inferSelect;
export type ReportSlaRuleRow = typeof reportSlaRules.$inferSelect;
export type NewReportSlaRule = typeof reportSlaRules.$inferInsert;
export type ReportSlaViolationRow = typeof reportSlaViolations.$inferSelect;
export type ReportAssetUsageLogRow = typeof reportAssetUsageLogs.$inferSelect;
export type ReportDeprecationNoticeRow = typeof reportDeprecationNotices.$inferSelect;
export type NewReportDeprecationNotice = typeof reportDeprecationNotices.$inferInsert;
export type ReportAssetTemplateRow = typeof reportAssetTemplates.$inferSelect;
export type NewReportAssetTemplate = typeof reportAssetTemplates.$inferInsert;
export type ReportChatbiSessionRow = typeof reportChatbiSessions.$inferSelect;
export type NewReportChatbiSession = typeof reportChatbiSessions.$inferInsert;
export type ReportChatbiMessageRow = typeof reportChatbiMessages.$inferSelect;
export type ReportFillTemplateRow = typeof reportFillTemplates.$inferSelect;
export type NewReportFillTemplate = typeof reportFillTemplates.$inferInsert;
export type ReportFillRecordRow = typeof reportFillRecords.$inferSelect;
export type NewReportFillRecord = typeof reportFillRecords.$inferInsert;
