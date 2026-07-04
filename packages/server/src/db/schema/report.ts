import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, uniqueIndex, index, jsonb, real, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
// 报表中心 jsonb 列形态（前后端共享契约；type-only 导入，编译期即擦除）
import type { ReportDatasourceConfig, ReportDatasetContent, ReportField, ReportGridItem, ReportWidget, ReportDatasetParam, ReportFilter, ReportDashboardConfig, ReportDashboardVersionSnapshot, ReportComputedField, ReportCanvasItem, ReportPrintContent, ReportPrintPageConfig, ReportDatasetMaterialize } from '@zenith/shared';
import { statusEnum } from './common';
import { auditColumns, users } from './core';

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）—— 通用报表设计器 / 数据大屏
// ════════════════════════════════════════════════════════════════════════════
export const reportDatasourceTypeEnum = pgEnum('report_datasource_type', ['api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static']);

/** 报表数据源：api=远程 HTTP；sql=内置只读主库 */
export const reportDatasources = pgTable('report_datasources', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  type: reportDatasourceTypeEnum('type').notNull(),
  /** 连接配置：api→{url,method,headers}；sql→{connection:'internal'} */
  config: jsonb('config').$type<ReportDatasourceConfig>().notNull().default(sql`'{}'::jsonb`),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportDatasourceRow = typeof reportDatasources.$inferSelect;

export type NewReportDatasource = typeof reportDatasources.$inferInsert;

/** 报表数据集：绑定数据源 + 查询内容 + 字段定义 */
export const reportDatasets = pgTable('report_datasets', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  datasourceId: integer('datasource_id').notNull().references(() => reportDatasources.id, { onDelete: 'restrict' }),
  /** 从数据源继承的类型（冗余，便于取数无需 JOIN） */
  type: reportDatasourceTypeEnum('type').notNull(),
  /** 查询内容：sql→{sql}；api→{itemsPath,params} */
  content: jsonb('content').$type<ReportDatasetContent>().notNull().default(sql`'{}'::jsonb`),
  /** 字段（列）定义 */
  fields: jsonb('fields').$type<ReportField[]>().notNull().default(sql`'[]'::jsonb`),
  /** 参数定义（SQL ${name} / API 注入）*/
  params: jsonb('params').$type<ReportDatasetParam[]>().notNull().default(sql`'[]'::jsonb`),
  /** 计算字段（衍生列）*/
  computedFields: jsonb('computed_fields').$type<ReportComputedField[]>().notNull().default(sql`'[]'::jsonb`),
  /** 结果缓存 TTL（秒），0=不缓存 */
  cacheTtl: integer('cache_ttl').notNull().default(0),
  /** 物化快照配置（定时刷新到持久层） */
  materialize: jsonb('materialize').$type<ReportDatasetMaterialize>().notNull().default(sql`'{}'::jsonb`),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportDatasetRow = typeof reportDatasets.$inferSelect;

export type NewReportDataset = typeof reportDatasets.$inferInsert;

/** 类 Excel 单据/中国式打印报表模板 */
export const reportPrintTemplates = pgTable('report_print_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** 绑定的数据集（主数据源，可空）*/
  datasetId: integer('dataset_id').references((): AnyPgColumn => reportDatasets.id, { onDelete: 'set null' }),
  /** Univer 工作簿快照(编辑用) + 归一化网格(渲染/导出用)，单元格含 ${field}/#{field}/${SUM(field)} 表达式 */
  content: jsonb('content').$type<ReportPrintContent>().notNull().default(sql`'{}'::jsonb`),
  /** 参数定义（${param} 注入）*/
  params: jsonb('params').$type<ReportDatasetParam[]>().notNull().default(sql`'[]'::jsonb`),
  /** 页面/打印配置 */
  pageConfig: jsonb('page_config').$type<ReportPrintPageConfig>().notNull().default(sql`'{}'::jsonb`),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportPrintTemplateRow = typeof reportPrintTemplates.$inferSelect;

export type NewReportPrintTemplate = typeof reportPrintTemplates.$inferInsert;

/** 数据预警规则：监控某数据集聚合值，超阈值时通知 */
export const reportAlertRules = pgTable('report_alert_rules', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  datasetId: integer('dataset_id').notNull().references((): AnyPgColumn => reportDatasets.id, { onDelete: 'cascade' }),
  /** 监控字段（count 可空） */
  field: varchar('field', { length: 128 }),
  /** 聚合方式：sum/avg/max/min/count/first */
  aggregate: varchar('aggregate', { length: 16 }).notNull().default('sum'),
  /** 比较运算符：gt/gte/lt/lte/eq/neq */
  op: varchar('op', { length: 8 }).notNull().default('gt'),
  /** 阈值 */
  threshold: real('threshold').notNull().default(0),
  /** 评估 Cron（留空=仅手动） */
  cron: varchar('cron', { length: 64 }),
  /** 通知渠道：email / inApp */
  channels: jsonb('channels').$type<Array<'email' | 'inApp'>>().notNull().default(sql`'[]'::jsonb`),
  recipients: varchar('recipients', { length: 512 }),
  enabled: boolean('enabled').notNull().default(true),
  lastCheckedAt: timestamp('last_checked_at'),
  lastTriggered: boolean('last_triggered'),
  lastValue: real('last_value'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('report_alert_rules_dataset_idx').on(t.datasetId),
]);

export type ReportAlertRuleRow = typeof reportAlertRules.$inferSelect;

export type NewReportAlertRule = typeof reportAlertRules.$inferInsert;

/** 仪表盘评论（协作批注） */
export const reportDashboardComments = pgTable('report_dashboard_comments', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull().references((): AnyPgColumn => reportDashboards.id, { onDelete: 'cascade' }),
  /** 关联组件 id（可空，整盘评论） */
  widgetId: varchar('widget_id', { length: 64 }),
  content: varchar('content', { length: 1000 }).notNull(),
  userId: integer('user_id').notNull().references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('report_dashboard_comments_dashboard_idx').on(t.dashboardId),
]);

export type ReportDashboardCommentRow = typeof reportDashboardComments.$inferSelect;

export type NewReportDashboardComment = typeof reportDashboardComments.$inferInsert;

/** 报表仪表盘：网格布局 + 组件配置 */
export const reportDashboards = pgTable('report_dashboards', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** react-grid-layout 布局数组 */
  layout: jsonb('layout').$type<ReportGridItem[]>().notNull().default(sql`'[]'::jsonb`),
  /** 自由画布定位数组（canvas 大屏模式）*/
  canvasLayout: jsonb('canvas_layout').$type<ReportCanvasItem[]>().notNull().default(sql`'[]'::jsonb`),
  /** 组件配置数组 */
  widgets: jsonb('widgets').$type<ReportWidget[]>().notNull().default(sql`'[]'::jsonb`),
  /** 全局筛选器 */
  filters: jsonb('filters').$type<ReportFilter[]>().notNull().default(sql`'[]'::jsonb`),
  /** 全局配置（主题/大屏/自动刷新）*/
  config: jsonb('config').$type<ReportDashboardConfig>().notNull().default(sql`'{}'::jsonb`),
  /** 分类（可空）*/
  categoryId: integer('category_id').references((): AnyPgColumn => reportDashboardCategories.id, { onDelete: 'set null' }),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportDashboardRow = typeof reportDashboards.$inferSelect;

export type NewReportDashboard = typeof reportDashboards.$inferInsert;

/** 仪表盘分类 */
export const reportDashboardCategories = pgTable('report_dashboard_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  sort: integer('sort').notNull().default(0),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportDashboardCategoryRow = typeof reportDashboardCategories.$inferSelect;

export type NewReportDashboardCategory = typeof reportDashboardCategories.$inferInsert;

/** 仪表盘版本快照（追加型）*/
export const reportDashboardVersions = pgTable('report_dashboard_versions', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  snapshot: jsonb('snapshot').$type<ReportDashboardVersionSnapshot>().notNull(),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [uniqueIndex('report_dashboard_versions_dash_ver_uq').on(t.dashboardId, t.version)]);

export type ReportDashboardVersionRow = typeof reportDashboardVersions.$inferSelect;

export type NewReportDashboardVersion = typeof reportDashboardVersions.$inferInsert;

/** 公开分享链接 */
export const reportDashboardShares = pgTable('report_dashboard_shares', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 100 }),
  enabled: boolean('enabled').notNull().default(true),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportDashboardShareRow = typeof reportDashboardShares.$inferSelect;

export type NewReportDashboardShare = typeof reportDashboardShares.$inferInsert;

/** 仪表盘收藏（用户 ↔ 仪表盘，纯关联表）*/
export const reportDashboardFavorites = pgTable('report_dashboard_favorites', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  dashboardId: integer('dashboard_id').notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.dashboardId] })]);

export type ReportDashboardFavoriteRow = typeof reportDashboardFavorites.$inferSelect;

/** 订阅推送（按 Cron 推送报表摘要）*/
export const reportDashboardSubscriptions = pgTable('report_dashboard_subscriptions', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull().references(() => reportDashboards.id, { onDelete: 'cascade' }),
  cron: varchar('cron', { length: 64 }).notNull(),
  channels: jsonb('channels').$type<Array<'email' | 'inApp'>>().notNull().default(sql`'[]'::jsonb`),
  recipients: varchar('recipients', { length: 512 }),
  enabled: boolean('enabled').notNull().default(true),
  remark: varchar('remark', { length: 256 }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ReportDashboardSubscriptionRow = typeof reportDashboardSubscriptions.$inferSelect;

export type NewReportDashboardSubscription = typeof reportDashboardSubscriptions.$inferInsert;
