import { pgTable, varchar, timestamp, pgEnum, integer, boolean, primaryKey, uniqueIndex, index, jsonb, real, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
// 报表中心 jsonb 列形态（前后端共享契约；type-only 导入，编译期即擦除）
import type { ReportDatasourceConfig, ReportDatasetContent, ReportField, ReportGridItem, ReportWidget, ReportDatasetParam, ReportFilter, ReportDashboardConfig, ReportComputedField, ReportCanvasItem, ReportPrintContent, ReportPrintPageConfig, ReportDatasetMaterialize, ReportNotifyChannel, ReportRowRule, ReportScheduleMisfirePolicy, ReportDeliveryStatus, ReportDeliveryTargetType, ReportDeliveryTriggerType, ReportDashboardLifecycleStatus, ReportDashboardVersionSource, ReportDashboardSnapshot, ReportResourceType } from '@zenith/shared/report';
import { REPORT_PRINT_SOURCE_TYPES, REPORT_RESOURCE_TYPES } from '@zenith/shared/report';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）—— 通用报表设计器 / 数据大屏
// ════════════════════════════════════════════════════════════════════════════
export const reportDatasourceTypeEnum = pgEnum('report_datasource_type', ['api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static']);
export const reportPrintSourceTypeEnum = pgEnum('report_print_source_type', REPORT_PRINT_SOURCE_TYPES);
export const reportScheduleMisfirePolicyEnum = pgEnum('report_schedule_misfire_policy', ['skip', 'fire_once']);
export const reportDeliveryStatusEnum = pgEnum('report_delivery_status', ['pending', 'running', 'success', 'partial', 'failed', 'cancelled']);
export const reportDeliveryTargetTypeEnum = pgEnum('report_delivery_target_type', ['subscription', 'alert', 'sla']);
export const reportDeliveryTriggerTypeEnum = pgEnum('report_delivery_trigger_type', ['manual', 'scheduled', 'trigger', 'recover']);
export const reportDashboardLifecycleStatusEnum = pgEnum('report_dashboard_lifecycle_status', ['draft', 'published', 'offline']);
export const reportDashboardVersionSourceEnum = pgEnum('report_dashboard_version_source', ['manual', 'publish', 'restore_backup']);
export const reportResourceTypeEnum = pgEnum('report_resource_type', REPORT_RESOURCE_TYPES);

/** 资源目录：按租户及资源类型组织，可嵌套并独立授权。 */
export const reportFolders = pgTable('report_folders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  parentId: integer().references((): AnyPgColumn => reportFolders.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  resourceType: reportResourceTypeEnum().$type<ReportResourceType>().notNull(),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_folders_tenant_root_name_uq').on(t.tenantId, t.resourceType, t.name)
    .where(sql`${t.tenantId} is not null and ${t.parentId} is null`),
  uniqueIndex('report_folders_tenant_child_name_uq').on(t.tenantId, t.parentId, t.resourceType, t.name)
    .where(sql`${t.tenantId} is not null and ${t.parentId} is not null`),
  uniqueIndex('report_folders_global_root_name_uq').on(t.resourceType, t.name)
    .where(sql`${t.tenantId} is null and ${t.parentId} is null`),
  uniqueIndex('report_folders_global_child_name_uq').on(t.parentId, t.resourceType, t.name)
    .where(sql`${t.tenantId} is null and ${t.parentId} is not null`),
  index('report_folders_tenant_type_status_idx').on(t.tenantId, t.resourceType, t.status),
  index('report_folders_parent_sort_idx').on(t.parentId, t.sort),
  index('report_folders_owner_idx').on(t.ownerId),
]);

export type ReportFolderRow = typeof reportFolders.$inferSelect;
export type NewReportFolder = typeof reportFolders.$inferInsert;

/** 报表数据源：api=远程 HTTP；sql=内置只读主库 */
export const reportDatasources = pgTable('report_datasources', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  name: varchar({ length: 64 }).notNull(),
  type: reportDatasourceTypeEnum().notNull(),
  /** 连接配置：api→{url,method,headers}；sql→{connection:'internal'} */
  config: jsonb().$type<ReportDatasourceConfig>().notNull().default(sql`'{}'::jsonb`),
  status: statusEnum().notNull().default('enabled'),
  lastTestAt: timestamp({ withTimezone: true }),
  lastTestStatus: varchar({ length: 16 }),
  lastTestLatencyMs: integer(),
  lastTestError: varchar({ length: 512 }),
  consecutiveFailures: integer().notNull().default(0),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_datasources_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_datasources_global_name_uq').on(t.name).where(sql`${t.tenantId} is null`),
  index('report_datasources_tenant_status_idx').on(t.tenantId, t.status),
  index('report_datasources_folder_idx').on(t.folderId),
  index('report_datasources_owner_idx').on(t.ownerId),
]);

export type ReportDatasourceRow = typeof reportDatasources.$inferSelect;

export type NewReportDatasource = typeof reportDatasources.$inferInsert;

/** 报表数据集：绑定数据源 + 查询内容 + 字段定义 */
export const reportDatasets = pgTable('report_datasets', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  name: varchar({ length: 64 }).notNull(),
  datasourceId: integer().notNull().references(() => reportDatasources.id, { onDelete: 'restrict' }),
  /** 从数据源继承的类型（冗余，便于取数无需 JOIN） */
  type: reportDatasourceTypeEnum().notNull(),
  /** 查询内容：sql→{sql}；api→{itemsPath,params} */
  content: jsonb().$type<ReportDatasetContent>().notNull().default(sql`'{}'::jsonb`),
  /** 字段（列）定义 */
  fields: jsonb().$type<ReportField[]>().notNull().default(sql`'[]'::jsonb`),
  /** 参数定义（SQL ${name} / API 注入）*/
  params: jsonb().$type<ReportDatasetParam[]>().notNull().default(sql`'[]'::jsonb`),
  /** 计算字段（衍生列）*/
  computedFields: jsonb().$type<ReportComputedField[]>().notNull().default(sql`'[]'::jsonb`),
  /** 结果缓存 TTL（秒），0=不缓存 */
  cacheTtl: integer().notNull().default(0),
  /** 物化快照配置（定时刷新到持久层） */
  materialize: jsonb().$type<ReportDatasetMaterialize>().notNull().default(sql`'{}'::jsonb`),
  /** 行级权限规则（仅 SQL 型数据集生效；按角色命中 OR 拼接 WHERE） */
  rowRules: jsonb().$type<ReportRowRule[]>().notNull().default(sql`'[]'::jsonb`),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_datasets_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_datasets_global_name_uq').on(t.name).where(sql`${t.tenantId} is null`),
  index('report_datasets_tenant_status_idx').on(t.tenantId, t.status),
  index('report_datasets_datasource_idx').on(t.datasourceId),
  index('report_datasets_folder_idx').on(t.folderId),
  index('report_datasets_owner_idx').on(t.ownerId),
]);

export type ReportDatasetRow = typeof reportDatasets.$inferSelect;

export type NewReportDataset = typeof reportDatasets.$inferInsert;

/** 数据集执行日志：记录运行场景、耗时、命中缓存与错误摘要（不落敏感参数值） */
export const reportDatasetExecutionLogs = pgTable('report_dataset_execution_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  datasetId: integer().references((): AnyPgColumn => reportDatasets.id, { onDelete: 'set null' }),
  datasourceId: integer().references((): AnyPgColumn => reportDatasources.id, { onDelete: 'set null' }),
  userId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  scene: varchar({ length: 32 }).notNull(),
  sourceRefId: varchar({ length: 64 }),
  durationMs: integer().notNull(),
  rowCount: integer(),
  bytes: integer(),
  truncated: boolean().notNull().default(false),
  slow: boolean().notNull().default(false),
  cacheHit: boolean().notNull().default(false),
  success: boolean().notNull().default(true),
  errorCode: integer(),
  errorMessage: varchar({ length: 512 }),
  paramKeys: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  executedAt: timestamp().defaultNow().notNull(),
}, (t) => [index('report_dataset_execution_logs_tenant_idx').on(t.tenantId), 
  index('report_dataset_execution_logs_dataset_idx').on(t.datasetId),
  index('report_dataset_execution_logs_datasource_idx').on(t.datasourceId),
  index('report_dataset_execution_logs_scene_idx').on(t.scene),
  index('report_dataset_execution_logs_user_idx').on(t.userId),
  index('report_dataset_execution_logs_executed_idx').on(t.executedAt),
]);

export type ReportDatasetExecutionLogRow = typeof reportDatasetExecutionLogs.$inferSelect;

/** 类 Excel 单据/中国式打印报表模板 */
export const reportPrintTemplates = pgTable('report_print_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  name: varchar({ length: 64 }).notNull(),
  /** 绑定的数据集（主数据源，可空）*/
  datasetId: integer().references((): AnyPgColumn => reportDatasets.id, { onDelete: 'set null' }),
  /** 数据来源：dataset 走主数据集 / 数据集绑定取数；entity 由业务实体所属域在渲染时注入数据集 */
  sourceType: reportPrintSourceTypeEnum().notNull().default('dataset'),
  /** sourceType=entity 时的实体类型（如 workflow_instance），决定设计器字段目录与渲染时的数据集提供方 */
  entityKind: varchar({ length: 32 }),
  /** 实体模板的设计时参照（如流程定义 ID：决定表单字段目录）；渲染时的实体 ID 由请求方给出 */
  entityRefId: integer(),
  /** Univer 工作簿快照(编辑用) + 归一化网格(渲染/导出用)，单元格含 ${field}/#{field}/${SUM(field)} 表达式 */
  content: jsonb().$type<ReportPrintContent>().notNull().default(sql`'{}'::jsonb`),
  /** 参数定义（${param} 注入）*/
  params: jsonb().$type<ReportDatasetParam[]>().notNull().default(sql`'[]'::jsonb`),
  /** 页面/打印配置 */
  pageConfig: jsonb().$type<ReportPrintPageConfig>().notNull().default(sql`'{}'::jsonb`),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_print_templates_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_print_templates_global_name_uq').on(t.name).where(sql`${t.tenantId} is null`),
  index('report_print_templates_tenant_status_idx').on(t.tenantId, t.status),
  index('report_print_templates_folder_idx').on(t.folderId),
  index('report_print_templates_owner_idx').on(t.ownerId),
  // 实体模板按「实体类型 + 设计参照」检索（流程绑定下拉 / 设计器筛选）
  index('report_print_templates_entity_idx').on(t.entityKind, t.entityRefId),
]);

export type ReportPrintTemplateRow = typeof reportPrintTemplates.$inferSelect;

export type NewReportPrintTemplate = typeof reportPrintTemplates.$inferInsert;

/** 数据预警规则：监控某数据集聚合值，超阈值时通知 */
export const reportAlertRules = pgTable('report_alert_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  datasetId: integer().references((): AnyPgColumn => reportDatasets.id, { onDelete: 'cascade' }),
  metricId: integer(),
  /** 监控字段（count 可空） */
  field: varchar({ length: 128 }),
  /** 分组维度（可空=全局聚合；有值=按组聚合，任一组命中即触发） */
  groupByField: varchar({ length: 128 }),
  /** 聚合方式：sum/avg/max/min/count/first */
  aggregate: varchar({ length: 16 }).notNull().default('sum'),
  /** 比较运算符：gt/gte/lt/lte/eq/neq */
  op: varchar({ length: 8 }).notNull().default('gt'),
  /** 阈值 */
  threshold: real().notNull().default(0),
  /** 评估 Cron（留空=仅手动） */
  cron: varchar({ length: 64 }),
  timezone: varchar({ length: 64 }).notNull().default('Asia/Shanghai'),
  misfirePolicy: reportScheduleMisfirePolicyEnum().$type<ReportScheduleMisfirePolicy>().notNull().default('fire_once'),
  nextRunAt: timestamp({ withTimezone: true }),
  /** 通知渠道：email / inApp / webhook */
  channels: jsonb().$type<ReportNotifyChannel[]>().notNull().default(sql`'[]'::jsonb`),
  recipients: varchar({ length: 512 }),
  /** Webhook 通知地址（企微/钉钉机器人或通用 JSON 端点） */
  webhookUrl: varchar({ length: 1024 }),
  /** 静默期（分钟）：持续触发时距上次通知不足该时长不重复通知；0=每次触发都通知 */
  silenceMins: integer().notNull().default(60),
  /** 从触发恢复正常时是否发送恢复通知 */
  notifyOnRecover: boolean().notNull().default(false),
  enabled: boolean().notNull().default(true),
  lastCheckedAt: timestamp(),
  lastTriggered: boolean(),
  lastValue: real(),
  /** 最近一次发送通知时间（静默窗口基准） */
  lastNotifiedAt: timestamp(),
  lastDeliveryAt: timestamp({ withTimezone: true }),
  lastDeliveryStatus: reportDeliveryStatusEnum().$type<ReportDeliveryStatus>(),
  lastDeliveryError: varchar({ length: 512 }),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('report_alert_rules_tenant_idx').on(t.tenantId),
  index('report_alert_rules_dataset_idx').on(t.datasetId),
  index('report_alert_rules_metric_idx').on(t.metricId),
  index('report_alert_rules_next_run_idx').on(t.nextRunAt),
  check('report_alert_rules_source_check', sql`(${t.datasetId} IS NOT NULL) <> (${t.metricId} IS NOT NULL)`),
]);

export type ReportAlertRuleRow = typeof reportAlertRules.$inferSelect;

export type NewReportAlertRule = typeof reportAlertRules.$inferInsert;

/** 仪表盘评论（协作批注） */
export const reportDashboardComments = pgTable('report_dashboard_comments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer().notNull().references((): AnyPgColumn => reportDashboards.id, { onDelete: 'cascade' }),
  /** 关联组件 id（可空，整盘评论） */
  widgetId: varchar({ length: 64 }),
  parentId: integer().references((): AnyPgColumn => reportDashboardComments.id, { onDelete: 'set null' }),
  content: varchar({ length: 1000 }).notNull(),
  userId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp(),
  resolvedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  deletedAt: timestamp(),
  deletedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  ...timestampColumns(),
}, (t) => [index('report_dashboard_comments_user_idx').on(t.userId), 
  index('report_dashboard_comments_dashboard_idx').on(t.dashboardId),
  index('report_dashboard_comments_parent_idx').on(t.parentId),
]);

export type ReportDashboardCommentRow = typeof reportDashboardComments.$inferSelect;

export type NewReportDashboardComment = typeof reportDashboardComments.$inferInsert;

/** 报表仪表盘：网格布局 + 组件配置 */
export const reportDashboards = pgTable('report_dashboards', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  folderId: integer().references(() => reportFolders.id, { onDelete: 'set null' }),
  name: varchar({ length: 64 }).notNull(),
  /** react-grid-layout 布局数组 */
  layout: jsonb().$type<ReportGridItem[]>().notNull().default(sql`'[]'::jsonb`),
  /** 自由画布定位数组（canvas 大屏模式）*/
  canvasLayout: jsonb().$type<ReportCanvasItem[]>().notNull().default(sql`'[]'::jsonb`),
  /** 组件配置数组 */
  widgets: jsonb().$type<ReportWidget[]>().notNull().default(sql`'[]'::jsonb`),
  /** 全局筛选器 */
  filters: jsonb().$type<ReportFilter[]>().notNull().default(sql`'[]'::jsonb`),
  /** 全局配置（主题/大屏/自动刷新）*/
  config: jsonb().$type<ReportDashboardConfig>().notNull().default(sql`'{}'::jsonb`),
  /** 分类（可空）*/
  categoryId: integer().references((): AnyPgColumn => reportDashboardCategories.id, { onDelete: 'set null' }),
  status: statusEnum().notNull().default('enabled'),
  lifecycleStatus: reportDashboardLifecycleStatusEnum().$type<ReportDashboardLifecycleStatus>().notNull().default('draft'),
  lifecycleInitialized: boolean().notNull().default(false),
  revision: integer().notNull().default(1),
  publishedSnapshot: jsonb().$type<ReportDashboardSnapshot | null>(),
  publishedAt: timestamp(),
  publishedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_dashboards_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('report_dashboards_global_name_uq').on(t.name).where(sql`${t.tenantId} is null`),
  index('report_dashboards_tenant_lifecycle_idx').on(t.tenantId, t.lifecycleStatus),
  index('report_dashboards_category_idx').on(t.categoryId),
  index('report_dashboards_folder_idx').on(t.folderId),
  index('report_dashboards_owner_idx').on(t.ownerId),
]);

export type ReportDashboardRow = typeof reportDashboards.$inferSelect;

export type NewReportDashboard = typeof reportDashboards.$inferInsert;

/** 仪表盘分类 */
export const reportDashboardCategories = pgTable('report_dashboard_categories', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull().unique(),
  sort: integer().notNull().default(0),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('report_dashboard_categories_tenant_idx').on(t.tenantId)]);

export type ReportDashboardCategoryRow = typeof reportDashboardCategories.$inferSelect;

export type NewReportDashboardCategory = typeof reportDashboardCategories.$inferInsert;

/** 仪表盘版本快照（追加型）*/
export const reportDashboardVersions = pgTable('report_dashboard_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer().notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  snapshot: jsonb().$type<ReportDashboardSnapshot>().notNull(),
  source: reportDashboardVersionSourceEnum().$type<ReportDashboardVersionSource>().notNull().default('manual'),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [uniqueIndex('report_dashboard_versions_dash_ver_uq').on(t.dashboardId, t.version)]);

export type ReportDashboardVersionRow = typeof reportDashboardVersions.$inferSelect;

export type NewReportDashboardVersion = typeof reportDashboardVersions.$inferInsert;

/** 公开分享链接 */
export const reportDashboardShares = pgTable('report_dashboard_shares', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer().notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  token: varchar({ length: 64 }).notNull().unique(),
  tokenEncrypted: varchar({ length: 256 }),
  passwordHash: varchar({ length: 100 }),
  enabled: boolean().notNull().default(true),
  expireAt: timestamp({ withTimezone: true }),
  maxAccessCount: integer(),
  accessCount: integer().notNull().default(0),
  sessionVersion: integer().notNull().default(1),
  allowedCidrs: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  allowedIps: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  ...auditColumns(),
  ...timestampColumns(),
});

export type ReportDashboardShareRow = typeof reportDashboardShares.$inferSelect;

export type NewReportDashboardShare = typeof reportDashboardShares.$inferInsert;

/** 匿名嵌入 token */
export const reportDashboardEmbedTokens = pgTable('report_dashboard_embed_tokens', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer().notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  token: varchar({ length: 64 }).notNull().unique(),
  tokenEncrypted: varchar({ length: 256 }),
  allowedFilterIds: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  fixedFilters: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  expireAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('report_dashboard_embed_tokens_dashboard_idx').on(t.dashboardId)]);

export type ReportDashboardEmbedTokenRow = typeof reportDashboardEmbedTokens.$inferSelect;

export type NewReportDashboardEmbedToken = typeof reportDashboardEmbedTokens.$inferInsert;

/** 公开分享访问日志（无登录访问的审计线索；含被拒绝的尝试） */
export const reportShareAccessLogs = pgTable('report_share_access_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  shareId: integer().notNull().references(() => reportDashboardShares.id, { onDelete: 'cascade' }),
  /** 冗余仪表盘 id（分享删除后日志级联删除，此列便于按盘检索） */
  dashboardId: integer().notNull(),
  /** 动作：view=拉取定义；data=取数 */
  action: varchar({ length: 16 }).notNull(),
  clientIp: varchar({ length: 64 }),
  /** 是否通过校验（false=密码错误/链接过期被拒） */
  ok: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('report_share_access_logs_share_idx').on(t.shareId),
  index('report_share_access_logs_created_idx').on(t.createdAt),
]);

export type ReportShareAccessLogRow = typeof reportShareAccessLogs.$inferSelect;

/** 仪表盘收藏（用户 ↔ 仪表盘，纯关联表）*/
export const reportDashboardFavorites = pgTable('report_dashboard_favorites', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  dashboardId: integer().notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.dashboardId] })]);

export type ReportDashboardFavoriteRow = typeof reportDashboardFavorites.$inferSelect;

/** 订阅推送（按 Cron 推送报表摘要）*/
export const reportDashboardSubscriptions = pgTable('report_dashboard_subscriptions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  dashboardId: integer().notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  cron: varchar({ length: 64 }).notNull(),
  timezone: varchar({ length: 64 }).notNull().default('Asia/Shanghai'),
  misfirePolicy: reportScheduleMisfirePolicyEnum().$type<ReportScheduleMisfirePolicy>().notNull().default('fire_once'),
  nextRunAt: timestamp({ withTimezone: true }),
  channels: jsonb().$type<ReportNotifyChannel[]>().notNull().default(sql`'[]'::jsonb`),
  recipients: varchar({ length: 512 }),
  /** Webhook 通知地址（企微/钉钉机器人或通用 JSON 端点） */
  webhookUrl: varchar({ length: 1024 }),
  enabled: boolean().notNull().default(true),
  remark: varchar({ length: 256 }),
  lastRunAt: timestamp({ withTimezone: true }),
  lastDeliveryAt: timestamp({ withTimezone: true }),
  lastDeliveryStatus: reportDeliveryStatusEnum().$type<ReportDeliveryStatus>(),
  lastDeliveryError: varchar({ length: 512 }),
  /** 上次推送的 KPI 快照（widgetId → 数值），用于下次推送计算环比趋势 */
  lastSummary: jsonb().$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('report_dashboard_subscriptions_tenant_idx').on(t.tenantId),
  index('report_dashboard_subscriptions_dashboard_idx').on(t.dashboardId),
  index('report_dashboard_subscriptions_next_run_idx').on(t.nextRunAt),
]);

export type ReportDashboardSubscriptionRow = typeof reportDashboardSubscriptions.$inferSelect;

export type NewReportDashboardSubscription = typeof reportDashboardSubscriptions.$inferInsert;

export const reportDeliveryRuns = pgTable('report_delivery_runs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  targetType: reportDeliveryTargetTypeEnum().$type<ReportDeliveryTargetType>().notNull(),
  subscriptionId: integer().references((): AnyPgColumn => reportDashboardSubscriptions.id, { onDelete: 'set null' }),
  alertRuleId: integer().references((): AnyPgColumn => reportAlertRules.id, { onDelete: 'set null' }),
  slaRuleId: integer(),
  dashboardId: integer().references((): AnyPgColumn => reportDashboards.id, { onDelete: 'set null' }),
  datasetId: integer().references((): AnyPgColumn => reportDatasets.id, { onDelete: 'set null' }),
  targetName: varchar({ length: 128 }),
  triggerType: reportDeliveryTriggerTypeEnum().$type<ReportDeliveryTriggerType>().notNull(),
  status: reportDeliveryStatusEnum().$type<ReportDeliveryStatus>().notNull().default('pending'),
  idempotencyKey: varchar({ length: 128 }).notNull(),
  attempt: integer().notNull().default(0),
  maxAttempts: integer().notNull().default(3),
  durationMs: integer(),
  errorMessage: varchar({ length: 512 }),
  payloadSummary: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  lastValue: real(),
  triggered: boolean(),
  acknowledgedAt: timestamp({ withTimezone: true }),
  acknowledgedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  acknowledgeNote: varchar({ length: 500 }),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  nextRetryAt: timestamp({ withTimezone: true }),
  requestedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_delivery_runs_idempotency_uq').on(t.idempotencyKey),
  index('report_delivery_runs_target_idx').on(t.targetType, t.subscriptionId, t.alertRuleId, t.id),
  index('report_delivery_runs_subscription_idx').on(t.subscriptionId, t.id),
  index('report_delivery_runs_alert_idx').on(t.alertRuleId, t.id),
  index('report_delivery_runs_retry_idx').on(t.status, t.nextRetryAt),
  index('report_delivery_runs_tenant_idx').on(t.tenantId),
]);

export type ReportDeliveryRunRow = typeof reportDeliveryRuns.$inferSelect;

export const reportDeliveryAttempts = pgTable('report_delivery_attempts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  runId: integer().notNull().references((): AnyPgColumn => reportDeliveryRuns.id, { onDelete: 'cascade' }),
  channel: varchar({ length: 16 }).$type<ReportNotifyChannel>().notNull(),
  attempt: integer().notNull().default(1),
  status: reportDeliveryStatusEnum().$type<ReportDeliveryStatus>().notNull().default('pending'),
  durationMs: integer(),
  errorMessage: varchar({ length: 512 }),
  payloadSummary: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('report_delivery_attempts_run_channel_attempt_uq').on(t.runId, t.channel, t.attempt),
  index('report_delivery_attempts_run_idx').on(t.runId, t.id),
  index('report_delivery_attempts_tenant_idx').on(t.tenantId),
]);

export type ReportDeliveryAttemptRow = typeof reportDeliveryAttempts.$inferSelect;
