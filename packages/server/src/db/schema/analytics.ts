import { pgTable, serial, varchar, timestamp, pgEnum, integer, bigint, boolean, text, uniqueIndex, index, jsonb, smallint, real, date, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, tenants, users } from './core';

// ─── 枚举 ────────────────────────────────────────────────────────────────────
export const userBehaviorEventTypeEnum = pgEnum('user_behavior_event_type', [
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
]);

export const analyticsDeviceTypeEnum = pgEnum('analytics_device_type', ['desktop', 'mobile', 'tablet', 'bot', 'unknown']);

// ─── 用户行为事件表（原始事件流）──────────────────────────────────────────────
export const userEvents = pgTable('user_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  // 身份
  distinctId: varchar('distinct_id', { length: 64 }),
  anonymousId: varchar('anonymous_id', { length: 64 }),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  sessionId: varchar('session_id', { length: 36 }),
  // 事件
  eventType: userBehaviorEventTypeEnum('event_type').notNull(),
  eventName: varchar('event_name', { length: 128 }),
  pagePath: varchar('page_path', { length: 256 }).notNull(),
  pageTitle: varchar('page_title', { length: 128 }),
  elementKey: varchar('element_key', { length: 128 }),
  elementLabel: varchar('element_label', { length: 128 }),
  componentArea: varchar('component_area', { length: 64 }),
  clickX: real('click_x'),
  clickY: real('click_y'),
  scrollDepth: smallint('scroll_depth'),
  durationMs: integer('duration_ms'),
  // 自定义属性袋
  properties: jsonb('properties').$type<Record<string, unknown>>(),
  // 来源
  referrer: varchar('referrer', { length: 512 }),
  utmSource: varchar('utm_source', { length: 128 }),
  utmMedium: varchar('utm_medium', { length: 128 }),
  utmCampaign: varchar('utm_campaign', { length: 128 }),
  utmTerm: varchar('utm_term', { length: 128 }),
  utmContent: varchar('utm_content', { length: 128 }),
  // 环境（服务端解析 UA / IP 填充）
  browser: varchar('browser', { length: 48 }),
  browserVersion: varchar('browser_version', { length: 32 }),
  os: varchar('os', { length: 48 }),
  osVersion: varchar('os_version', { length: 32 }),
  deviceType: analyticsDeviceTypeEnum('device_type'),
  screenW: integer('screen_w'),
  screenH: integer('screen_h'),
  language: varchar('language', { length: 16 }),
  userAgent: varchar('user_agent', { length: 512 }),
  ip: varchar('ip', { length: 64 }),
  country: varchar('country', { length: 64 }),
  region: varchar('region', { length: 64 }),
  city: varchar('city', { length: 64 }),
  // 性能指标（perf 事件）
  metricName: varchar('metric_name', { length: 32 }),
  metricValue: real('metric_value'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('user_events_created_idx').on(t.createdAt),
  index('user_events_type_idx').on(t.eventType),
  index('user_events_name_idx').on(t.eventName),
  index('user_events_page_idx').on(t.pagePath),
  index('user_events_user_idx').on(t.userId),
  index('user_events_session_idx').on(t.sessionId),
  index('user_events_tenant_idx').on(t.tenantId),
  index('user_events_distinct_idx').on(t.distinctId),
  // 趋势/概览/维度分析主查询路径（tenant + 时间范围 + 事件类型过滤）
  index('user_events_tenant_created_type_idx').on(t.tenantId, t.createdAt, t.eventType),
  // Web Vitals 性能统计（perf 事件占比小，部分索引降低维护成本）
  index('user_events_perf_metric_idx').on(t.metricName, t.createdAt).where(sql`${t.eventType} = 'perf'`),
]);

export type UserEventRow = typeof userEvents.$inferSelect;

export type NewUserEvent = typeof userEvents.$inferInsert;

// ─── 会话聚合表 ──────────────────────────────────────────────────────────────
export const analyticsSessions = pgTable('analytics_sessions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 36 }).notNull(),
  distinctId: varchar('distinct_id', { length: 64 }),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer('duration_ms').notNull().default(0),
  pageCount: integer('page_count').notNull().default(0),
  eventCount: integer('event_count').notNull().default(0),
  entryPage: varchar('entry_page', { length: 256 }),
  exitPage: varchar('exit_page', { length: 256 }),
  referrer: varchar('referrer', { length: 512 }),
  utmSource: varchar('utm_source', { length: 128 }),
  browser: varchar('browser', { length: 48 }),
  os: varchar('os', { length: 48 }),
  deviceType: analyticsDeviceTypeEnum('device_type'),
  country: varchar('country', { length: 64 }),
  region: varchar('region', { length: 64 }),
  isBounce: boolean('is_bounce').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_sessions_sid_uq').on(t.sessionId),
  index('analytics_sessions_started_idx').on(t.startedAt),
  index('analytics_sessions_user_idx').on(t.userId),
  index('analytics_sessions_tenant_idx').on(t.tenantId),
]);

export type AnalyticsSessionRow = typeof analyticsSessions.$inferSelect;

export type NewAnalyticsSession = typeof analyticsSessions.$inferInsert;

// ─── 每日预聚合表（趋势查询提速）─────────────────────────────────────────────
// tenantId 非空（0 = 平台/无租户），避免 NULL 在唯一索引中视为相异导致 upsert 失效
export const analyticsDailyRollup = pgTable('analytics_daily_rollup', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().default(0),
  statDate: date('stat_date').notNull(),
  metric: varchar('metric', { length: 32 }).notNull(),
  dimType: varchar('dim_type', { length: 32 }).notNull().default('overall'),
  dimValue: varchar('dim_value', { length: 256 }).notNull().default(''),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_rollup_uq').on(t.tenantId, t.statDate, t.metric, t.dimType, t.dimValue),
  index('analytics_rollup_date_idx').on(t.statDate),
  index('analytics_rollup_metric_idx').on(t.metric),
]);

export type AnalyticsDailyRollupRow = typeof analyticsDailyRollup.$inferSelect;

export type NewAnalyticsDailyRollup = typeof analyticsDailyRollup.$inferInsert;

// ─── 埋点事件元数据 / 事件字典 ───────────────────────────────────────────────
export const analyticsEventStatusEnum = pgEnum('analytics_event_status', ['active', 'deprecated', 'blocked']);

export const analyticsEventMeta = pgTable('analytics_event_meta', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id'),
  eventName: varchar('event_name', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 128 }),
  category: varchar('category', { length: 64 }),
  description: text('description'),
  propertySchema: jsonb('property_schema').$type<{ key: string; type: string; description?: string }[]>(),
  status: analyticsEventStatusEnum('status').notNull().default('active'),
  eventCount: bigint('event_count', { mode: 'number' }).notNull().default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_event_meta_name_uq').on(t.eventName),
  index('analytics_event_meta_status_idx').on(t.status),
]);

export type AnalyticsEventMetaRow = typeof analyticsEventMeta.$inferSelect;

export type NewAnalyticsEventMeta = typeof analyticsEventMeta.$inferInsert;

// ─── 采集配置 / 采样 / 保留策略（SDK 远程配置）──────────────────────────────
export const analyticsSettings = pgTable('analytics_settings', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id'),
  enabled: boolean('enabled').notNull().default(true),
  sampleRate: real('sample_rate').notNull().default(1),
  trackPageviews: boolean('track_pageviews').notNull().default(true),
  trackClicks: boolean('track_clicks').notNull().default(true),
  trackPerformance: boolean('track_performance').notNull().default(true),
  trackErrors: boolean('track_errors').notNull().default(true),
  trackApi: boolean('track_api').notNull().default(true),
  maskInputs: boolean('mask_inputs').notNull().default(true),
  respectDnt: boolean('respect_dnt').notNull().default(false),
  blacklistPaths: jsonb('blacklist_paths').$type<string[]>().notNull().default([]),
  retentionDays: integer('retention_days').notNull().default(180),
  errorRetentionDays: integer('error_retention_days').notNull().default(90),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(30),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('analytics_settings_tenant_idx').on(t.tenantId),
]);

export type AnalyticsSettingsRow = typeof analyticsSettings.$inferSelect;

export type NewAnalyticsSettings = typeof analyticsSettings.$inferInsert;

// ─── 前端错误监控（Issue 模型：error_groups + error_events）────────────────────
export const frontendErrorTypeEnum = pgEnum('frontend_error_type', [
  'js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash',
]);

export const errorLevelEnum = pgEnum('error_level', ['fatal', 'error', 'warning', 'info']);

export const errorStatusEnum = pgEnum('error_status', ['unresolved', 'resolved', 'ignored', 'muted']);

export const errorAlertConditionEnum = pgEnum('error_alert_condition', ['new_error', 'threshold', 'spike']);

// 错误分组（Issue）：fingerprint 全局唯一（已含 tenant 因子），修复原 ON CONFLICT 缺唯一索引的 Bug
export const errorGroups = pgTable('error_groups', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  errorType: frontendErrorTypeEnum('error_type').notNull(),
  level: errorLevelEnum('level').notNull().default('error'),
  message: text('message').notNull(),
  status: errorStatusEnum('status').notNull().default('unresolved'),
  assigneeId: integer('assignee_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  assigneeName: varchar('assignee_name', { length: 64 }),
  release: varchar('release', { length: 64 }),
  note: text('note'),
  count: bigint('count', { mode: 'number' }).notNull().default(0),
  affectedUsers: integer('affected_users').notNull().default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('error_groups_fingerprint_uq').on(t.fingerprint),
  index('error_groups_status_idx').on(t.status),
  index('error_groups_type_idx').on(t.errorType),
  index('error_groups_last_seen_idx').on(t.lastSeenAt),
  index('error_groups_tenant_idx').on(t.tenantId),
  index('error_groups_assignee_idx').on(t.assigneeId),
]);

export type ErrorGroupRow = typeof errorGroups.$inferSelect;

export type NewErrorGroup = typeof errorGroups.$inferInsert;

// 单次错误事件（追加型日志，含堆栈/面包屑/上下文/解析后的 UA）
export const errorEvents = pgTable('error_events', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references((): AnyPgColumn => errorGroups.id, { onDelete: 'cascade' }),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  errorType: frontendErrorTypeEnum('error_type').notNull(),
  level: errorLevelEnum('level').notNull().default('error'),
  message: text('message').notNull(),
  stack: text('stack'),
  sourceUrl: varchar('source_url', { length: 512 }),
  lineNo: integer('line_no'),
  colNo: integer('col_no'),
  pageUrl: varchar('page_url', { length: 512 }),
  release: varchar('release', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  browser: varchar('browser', { length: 48 }),
  browserVersion: varchar('browser_version', { length: 32 }),
  os: varchar('os', { length: 48 }),
  deviceType: analyticsDeviceTypeEnum('device_type'),
  userId: integer('user_id'),
  username: varchar('username', { length: 64 }),
  sessionId: varchar('session_id', { length: 36 }),
  breadcrumbs: jsonb('breadcrumbs').$type<unknown[]>(),
  context: jsonb('context').$type<Record<string, unknown>>(),
  httpStatus: integer('http_status'),
  httpMethod: varchar('http_method', { length: 16 }),
  httpUrl: varchar('http_url', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('error_events_group_idx').on(t.groupId),
  index('error_events_created_idx').on(t.createdAt),
  index('error_events_user_idx').on(t.userId),
  index('error_events_tenant_idx').on(t.tenantId),
  // 分组详情「最近事件 / 影响用户」查询路径
  index('error_events_group_created_idx').on(t.groupId, t.createdAt),
]);

export type ErrorEventRow = typeof errorEvents.$inferSelect;

export type NewErrorEvent = typeof errorEvents.$inferInsert;

// 错误告警规则
export const errorAlertRules = pgTable('error_alert_rules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  errorType: frontendErrorTypeEnum('error_type'),
  level: errorLevelEnum('level'),
  condition: errorAlertConditionEnum('condition').notNull().default('threshold'),
  thresholdCount: integer('threshold_count').notNull().default(10),
  windowMinutes: integer('window_minutes').notNull().default(60),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  webhookUrl: varchar('webhook_url', { length: 512 }),
  recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('error_alert_rules_tenant_idx').on(t.tenantId),
]);

export type ErrorAlertRuleRow = typeof errorAlertRules.$inferSelect;

export type NewErrorAlertRule = typeof errorAlertRules.$inferInsert;

// Source Map（用于压缩堆栈还原）— 服务层以 replace 语义维护，无需唯一约束
export const sourceMaps = pgTable('source_maps', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  release: varchar('release', { length: 64 }).notNull(),
  fileName: varchar('file_name', { length: 256 }).notNull(),
  content: text('content').notNull(),
  size: integer('size').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('source_maps_release_idx').on(t.release, t.fileName),
  index('source_maps_tenant_idx').on(t.tenantId),
]);

export type SourceMapRow = typeof sourceMaps.$inferSelect;

export type NewSourceMap = typeof sourceMaps.$inferInsert;
