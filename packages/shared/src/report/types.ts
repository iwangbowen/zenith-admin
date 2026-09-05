import type {
  REPORT_ALERT_AGGREGATES,
  REPORT_ALERT_OPS,
  REPORT_APPROVAL_ACTIONS,
  REPORT_DASHBOARD_LIFECYCLE_STATUSES,
  REPORT_DASHBOARD_VERSION_SOURCES,
  REPORT_DELIVERY_STATUSES,
  REPORT_DELIVERY_TARGET_TYPES,
  REPORT_DELIVERY_TRIGGER_TYPES,
  REPORT_FIELD_TYPES,
  REPORT_FILTER_TYPES,
  REPORT_NOTIFY_CHANNELS,
  REPORT_SCHEDULE_MISFIRE_POLICIES,
  REPORT_SORT_ORDERS,
} from './constants';
import type { ReportPrintDatasetBinding, ReportPrintRenderResult } from './contracts/print';

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）—— 枚举清单与联合类型别名
// 实体形状由 ./contracts 下的 schema 推导；这里只保留无法由 schema 推导的类型。
// ════════════════════════════════════════════════════════════════════════════

/** 数据源类型清单（单一来源，派生 type/zod/DTO，防止"半加一个类型"漂移） */
export const REPORT_DATASOURCE_TYPES = ['api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static'] as const;

/** 数据源类型：api=远程 HTTP；sql=内置只读主库；mysql/postgresql/sqlserver=外部数据库；static=静态/文件 */
export type ReportDatasourceType = typeof REPORT_DATASOURCE_TYPES[number];

export const REPORT_RESOURCE_TYPES = [
  'datasource', 'dataset', 'dashboard', 'metric', 'print_template', 'fill_template', 'asset_template',
] as const;

export type ReportResourceType = typeof REPORT_RESOURCE_TYPES[number];

export const REPORT_METRIC_TYPES = ['simple', 'ratio', 'composite'] as const;

export type ReportMetricType = typeof REPORT_METRIC_TYPES[number];

export const REPORT_METRIC_LIFECYCLE_STATUSES = ['draft', 'published', 'deprecated'] as const;

export type ReportMetricLifecycleStatus = typeof REPORT_METRIC_LIFECYCLE_STATUSES[number];

export const REPORT_ACL_SUBJECT_TYPES = ['user', 'role', 'department', 'user_group'] as const;

export type ReportAclSubjectType = typeof REPORT_ACL_SUBJECT_TYPES[number];

export const REPORT_ACL_ROLES = ['viewer', 'editor', 'owner'] as const;

export type ReportAclRole = typeof REPORT_ACL_ROLES[number];

export const REPORT_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export type ReportApprovalStatus = typeof REPORT_APPROVAL_STATUSES[number];

export const REPORT_TRANSFER_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled'] as const;

export type ReportTransferStatus = typeof REPORT_TRANSFER_STATUSES[number];

export const REPORT_ENVIRONMENT_KINDS = ['development', 'testing', 'staging', 'production'] as const;

export type ReportEnvironmentKind = typeof REPORT_ENVIRONMENT_KINDS[number];

export const REPORT_PROMOTION_STATUSES = [
  'pending', 'approved', 'deploying', 'succeeded', 'failed', 'cancelled', 'rolled_back',
] as const;

export type ReportPromotionStatus = typeof REPORT_PROMOTION_STATUSES[number];

export const REPORT_DQ_RULE_TYPES = [
  'not_null', 'uniqueness', 'range', 'pattern', 'freshness', 'row_count', 'custom_sql',
] as const;

export type ReportDqRuleType = typeof REPORT_DQ_RULE_TYPES[number];

export const REPORT_DQ_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type ReportDqSeverity = typeof REPORT_DQ_SEVERITIES[number];

export const REPORT_DQ_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;

export type ReportDqRunStatus = typeof REPORT_DQ_RUN_STATUSES[number];

export const REPORT_DQ_ANOMALY_STATUSES = ['open', 'acknowledged', 'resolved', 'ignored'] as const;

export type ReportDqAnomalyStatus = typeof REPORT_DQ_ANOMALY_STATUSES[number];

export const REPORT_MATERIALIZATION_STRATEGIES = ['full', 'incremental'] as const;

export type ReportMaterializationStrategy = typeof REPORT_MATERIALIZATION_STRATEGIES[number];

export const REPORT_SNAPSHOT_STATUSES = ['pending', 'building', 'ready', 'failed', 'expired', 'deleted'] as const;

export type ReportSnapshotStatus = typeof REPORT_SNAPSHOT_STATUSES[number];

export const REPORT_QUOTA_SCOPES = ['tenant', 'user'] as const;

export type ReportQuotaScope = typeof REPORT_QUOTA_SCOPES[number];

export const REPORT_SLA_TYPES = ['freshness', 'query_latency_p95', 'availability', 'dq_score'] as const;

export type ReportSlaType = typeof REPORT_SLA_TYPES[number];

export const REPORT_SLA_VIOLATION_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

export type ReportSlaViolationStatus = typeof REPORT_SLA_VIOLATION_STATUSES[number];

export const REPORT_ASSET_TEMPLATE_TYPES = ['dashboard', 'widget', 'print', 'semantic_model'] as const;

export type ReportAssetTemplateType = typeof REPORT_ASSET_TEMPLATE_TYPES[number];

export const REPORT_CHATBI_SESSION_STATUSES = ['active', 'archived'] as const;

export type ReportChatbiSessionStatus = typeof REPORT_CHATBI_SESSION_STATUSES[number];

export const REPORT_CHATBI_MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;

export type ReportChatbiMessageRole = typeof REPORT_CHATBI_MESSAGE_ROLES[number];

export const REPORT_FILL_TEMPLATE_STATUSES = ['draft', 'published', 'disabled'] as const;

export type ReportFillTemplateStatus = typeof REPORT_FILL_TEMPLATE_STATUSES[number];

export const REPORT_FILL_RECORD_STATUSES = [
  'draft', 'submitted', 'in_review', 'approved', 'rejected', 'cancelled',
] as const;

export type ReportFillRecordStatus = typeof REPORT_FILL_RECORD_STATUSES[number];

export const REPORT_FILL_SYNC_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

export type ReportFillSyncStatus = typeof REPORT_FILL_SYNC_STATUSES[number];

/** 外部数据库类型（凭据加密 + 走外部连接池取数） */
export const EXTERNAL_DB_TYPES = ['mysql', 'postgresql', 'sqlserver'] as const;

/** 以 SQL 文本取数的类型（内置主库 + 外部库），统一驱动 SQL 编辑 / 系统变量解析 */
export const SQL_DATASET_TYPES = ['sql', 'mysql', 'postgresql', 'sqlserver'] as const;

/** 是否外部数据库类型 */
export function isExternalDbType(t: ReportDatasourceType): boolean {
  return (EXTERNAL_DB_TYPES as readonly string[]).includes(t);
}

/** 是否以 SQL 取数（内置主库或外部库） */
export function isSqlLikeType(t: ReportDatasourceType): boolean {
  return (SQL_DATASET_TYPES as readonly string[]).includes(t);
}

/** 仪表盘组件类型清单（单一来源） */
export const REPORT_WIDGET_TYPES = [
  'kpi', 'table', 'pivot', 'text',
  'bar', 'line', 'area', 'dualAxis',
  'pie', 'scatter', 'radar', 'funnel', 'gauge', 'treemap',
  'flipper', 'scrollList', 'map',
  'sankey', 'wordCloud', 'liquid', 'heatmap',
  'image', 'iframe',
] as const;

/** 仪表盘组件类型 */
export type ReportWidgetType = typeof REPORT_WIDGET_TYPES[number];

// ─── 联合类型别名（值清单见 constants.ts） ────────────────────────────────────

/** 数据集字段（列）数据类型 */
export type ReportFieldType = typeof REPORT_FIELD_TYPES[number];

/** 全局筛选器类型 */
export type ReportFilterType = typeof REPORT_FILTER_TYPES[number];

export type ReportSortOrder = typeof REPORT_SORT_ORDERS[number];

export type ReportDashboardLifecycleStatus = typeof REPORT_DASHBOARD_LIFECYCLE_STATUSES[number];

export type ReportDashboardVersionSource = typeof REPORT_DASHBOARD_VERSION_SOURCES[number];

/** 通知渠道（预警 / 订阅共用）：邮件 / 站内信 / Webhook（企微 / 钉钉机器人或通用端点） */
export type ReportNotifyChannel = typeof REPORT_NOTIFY_CHANNELS[number];

export type ReportScheduleMisfirePolicy = typeof REPORT_SCHEDULE_MISFIRE_POLICIES[number];

export type ReportDeliveryTargetType = typeof REPORT_DELIVERY_TARGET_TYPES[number];

export type ReportDeliveryTriggerType = typeof REPORT_DELIVERY_TRIGGER_TYPES[number];

export type ReportDeliveryStatus = typeof REPORT_DELIVERY_STATUSES[number];

/** 预警比较运算符 */
export type ReportAlertOp = typeof REPORT_ALERT_OPS[number];

/** 预警聚合方式 */
export type ReportAlertAggregate = typeof REPORT_ALERT_AGGREGATES[number];

export type ReportApprovalAction = typeof REPORT_APPROVAL_ACTIONS[number];

// ─── 打印渲染引擎入参（仅服务端 / 渲染工具使用，不经 API 传输） ─────────────────────

export type ReportPrintDatasetRows = Record<string, Array<Record<string, unknown>>>;

export interface ReportPrintResolvedSubreport {
  sheetId: string;
  row: number;
  col: number;
  templateId: number;
  result: ReportPrintRenderResult;
}

export interface ReportPrintRenderOptions {
  datasets?: ReportPrintDatasetRows;
  bindings?: ReportPrintDatasetBinding[];
  subreports?: ReportPrintResolvedSubreport[];
  /** 已由调用方按系统时间规范格式化的渲染时间 */
  renderedAt?: string;
  crosstabBudget?: {
    maxDynamicColumns?: number;
    maxCells?: number;
    maxBytes?: number;
  };
}
