import { createLabelOptionsFromMap } from '../core/enum-options';
import type { ReportAlertAggregate, ReportChatbiSessionStatus, ReportDatasourceType, ReportDeliveryStatus, ReportDeliveryTriggerType, ReportFieldType, ReportFillRecordStatus, ReportFillSyncStatus, ReportFillTemplateStatus, ReportScheduleMisfirePolicy } from './types';

/** 数据集字段（列）数据类型 */
export const REPORT_FIELD_TYPES = ['string', 'number', 'date', 'boolean'] as const;

/** 仪表盘全局筛选器类型 */
export const REPORT_FILTER_TYPES = ['date', 'daterange', 'select', 'multiSelect', 'input', 'numberRange'] as const;

export const REPORT_SORT_ORDERS = ['asc', 'desc'] as const;

/** 通知渠道（预警 / 订阅 / SLA 共用）：邮件 / 站内信 / Webhook */
export const REPORT_NOTIFY_CHANNELS = ['email', 'inApp', 'webhook'] as const;

export const REPORT_SCHEDULE_MISFIRE_POLICIES = ['skip', 'fire_once'] as const;

export const REPORT_DELIVERY_TARGET_TYPES = ['subscription', 'alert', 'sla'] as const;

export const REPORT_DELIVERY_TRIGGER_TYPES = ['manual', 'scheduled', 'trigger', 'recover'] as const;

export const REPORT_DELIVERY_STATUSES = ['pending', 'running', 'success', 'partial', 'failed', 'cancelled'] as const;

/** 预警比较运算符 */
export const REPORT_ALERT_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;

/** 预警聚合方式 */
export const REPORT_ALERT_AGGREGATES = ['sum', 'avg', 'max', 'min', 'count', 'first'] as const;

export const REPORT_APPROVAL_ACTIONS = ['publish', 'promote', 'deprecate'] as const;

export const REPORT_DQ_TRIGGER_TYPES = ['manual', 'scheduled', 'dataset_refresh'] as const;

export const REPORT_DASHBOARD_LIFECYCLE_STATUSES = ['draft', 'published', 'offline'] as const;

export const REPORT_DASHBOARD_LIFECYCLE_LABELS = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
} as const;

export const REPORT_DASHBOARD_VERSION_SOURCES = ['manual', 'publish', 'restore_backup'] as const;

export const REPORT_DASHBOARD_VERSION_SOURCE_LABELS = {
  manual: '手动快照',
  publish: '发布快照',
  restore_backup: '恢复前备份',
} as const;

export const REPORT_AGGREGATE_LABELS: Record<ReportAlertAggregate, string> = {
  sum: '求和',
  avg: '平均',
  max: '最大',
  min: '最小',
  count: '计数',
  first: '首行',
};

export const REPORT_AGGREGATE_OPTIONS: Array<{ value: ReportAlertAggregate; label: string }> =
  createLabelOptionsFromMap(REPORT_AGGREGATE_LABELS);

export const REPORT_VISUAL_AGGREGATE_OPTIONS = REPORT_AGGREGATE_OPTIONS
  .filter((option) => option.value !== 'first');

export const REPORT_DELIVERY_STATUS_LABELS: Record<ReportDeliveryStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};

export const REPORT_DELIVERY_STATUS_OPTIONS: Array<{ value: ReportDeliveryStatus; label: string }> =
  createLabelOptionsFromMap(REPORT_DELIVERY_STATUS_LABELS);

export const REPORT_DELIVERY_TRIGGER_LABELS: Record<ReportDeliveryTriggerType, string> = {
  manual: '手动',
  scheduled: '定时',
  trigger: '触发',
  recover: '恢复',
};

export const REPORT_MISFIRE_POLICY_LABELS: Record<ReportScheduleMisfirePolicy, string> = {
  skip: '跳过',
  fire_once: '补执行一次',
};

export const REPORT_MISFIRE_POLICY_OPTIONS: Array<{ value: ReportScheduleMisfirePolicy; label: string }> =
  createLabelOptionsFromMap(REPORT_MISFIRE_POLICY_LABELS);

export const REPORT_DQ_TRIGGER_LABELS: Record<typeof REPORT_DQ_TRIGGER_TYPES[number], string> = {
  manual: '手动',
  scheduled: '定时',
  dataset_refresh: '数据集刷新',
};

export const REPORT_DQ_ANOMALY_STATUS_LABELS = {
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已解决',
  ignored: '已忽略',
} as const;

export const REPORT_DQ_ANOMALY_STATUS_OPTIONS = createLabelOptionsFromMap(REPORT_DQ_ANOMALY_STATUS_LABELS);

export const REPORT_PROMOTION_STATUS_LABELS = {
  pending: '待审批',
  approved: '已批准',
  deploying: '部署中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  rolled_back: '已回滚',
} as const;

export const REPORT_FIELD_TYPE_LABELS: Record<ReportFieldType, string> = {
  string: '字符串',
  number: '数字',
  date: '日期',
  boolean: '布尔',
};

export const REPORT_FIELD_TYPE_OPTIONS: Array<{ value: ReportFieldType; label: string }> =
  createLabelOptionsFromMap(REPORT_FIELD_TYPE_LABELS);

export const REPORT_DATASOURCE_TYPE_LABELS: Record<ReportDatasourceType, string> = {
  api: 'API',
  sql: 'SQL',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  static: '静态数据',
};

export const REPORT_DATASOURCE_TYPE_DESCRIPTIONS: Record<ReportDatasourceType, string> = {
  api: '远程 HTTP',
  sql: '内置只读主库',
  mysql: '外部库',
  postgresql: '外部库',
  sqlserver: '外部库',
  static: 'JSON/文件',
};

export const REPORT_DATASOURCE_TYPE_OPTIONS: Array<{ value: ReportDatasourceType; label: string }> =
  (Object.keys(REPORT_DATASOURCE_TYPE_LABELS) as ReportDatasourceType[])
    .map((value) => ({
      value,
      label: `${REPORT_DATASOURCE_TYPE_LABELS[value]}（${REPORT_DATASOURCE_TYPE_DESCRIPTIONS[value]}）`,
    }));

export const REPORT_CHATBI_SESSION_STATUS_LABELS: Record<ReportChatbiSessionStatus, string> = {
  active: '进行中',
  archived: '已归档',
};

export const REPORT_CHATBI_SESSION_STATUS_OPTIONS =
  createLabelOptionsFromMap(REPORT_CHATBI_SESSION_STATUS_LABELS);

export const REPORT_FILL_TEMPLATE_STATUS_LABELS: Record<ReportFillTemplateStatus, string> = {
  draft: '草稿',
  published: '已发布',
  disabled: '已下线',
};

export const REPORT_FILL_TEMPLATE_STATUS_OPTIONS =
  createLabelOptionsFromMap(REPORT_FILL_TEMPLATE_STATUS_LABELS);

export const REPORT_FILL_RECORD_STATUS_LABELS: Record<ReportFillRecordStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
};

export const REPORT_FILL_RECORD_STATUS_OPTIONS =
  createLabelOptionsFromMap(REPORT_FILL_RECORD_STATUS_LABELS);

export const REPORT_FILL_SYNC_STATUS_LABELS: Record<ReportFillSyncStatus, string> = {
  pending: '待同步',
  running: '同步中',
  succeeded: '同步成功',
  failed: '同步失败',
};
