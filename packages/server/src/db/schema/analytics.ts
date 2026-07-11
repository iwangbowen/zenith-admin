import { pgTable, serial, varchar, timestamp, pgEnum, integer, bigint, boolean, text, uniqueIndex, index, jsonb, smallint, real, date, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnalyticsEnvironment, AnalyticsEventPropertyDef, AnalyticsExperimentVariant, AnalyticsSegmentRule } from '@zenith/shared';
import { auditColumns, tenants, users } from './core';
import { members } from './member';

// ─── 枚举 ────────────────────────────────────────────────────────────────────
export const userBehaviorEventTypeEnum = pgEnum('user_behavior_event_type', [
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
]);

export const analyticsDeviceTypeEnum = pgEnum('analytics_device_type', ['desktop', 'mobile', 'tablet', 'bot', 'unknown']);

// 行为中心阶段 1：事件来源平台（后台 SPA / 会员前台 SPA / 服务端埋点），默认 web_admin 兼容存量数据
export const analyticsEventSourceEnum = pgEnum('analytics_event_source', ['web_admin', 'web_member', 'server']);

// 身份归属类型：后台管理员 / 前台会员 / 匿名访客
export const analyticsIdentityTypeEnum = pgEnum('analytics_identity_type', ['admin', 'member', 'anonymous']);

export const analyticsCampaignChannelEnum = pgEnum('analytics_campaign_channel', ['email', 'in_app', 'webhook']);

export const analyticsCampaignStatusEnum = pgEnum('analytics_campaign_status', ['draft', 'running', 'completed', 'failed']);

export const analyticsExperimentStatusEnum = pgEnum('analytics_experiment_status', ['draft', 'running', 'paused', 'completed']);

// ─── 用户行为事件表（原始事件流）──────────────────────────────────────────────
export const userEvents = pgTable('user_events', {
  id: serial('id').primaryKey(),
  eventId: uuid('event_id'),
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
  // 行为中心阶段 1：多端来源归因（后台 SPA / 会员前台 SPA / 服务端上报）
  source: analyticsEventSourceEnum('source').notNull().default('web_admin'),
  // 应用标识（多 App 场景预留，默认 admin 兼容存量后台数据）
  appId: varchar('app_id', { length: 64 }).notNull().default('admin'),
  // 采集环境（production / staging / development，默认 production 兼容存量数据）
  environment: varchar('environment', { length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  // 采集 SDK 版本，便于排查上报口径差异
  sdkVersion: varchar('sdk_version', { length: 32 }),
  // 会员身份（前台会员事件），与 userId（后台管理员）互斥，不复用同一列
  memberId: integer('member_id').references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('user_events_event_id_uq').on(t.eventId),
  index('user_events_created_idx').on(t.createdAt),
  index('user_events_type_idx').on(t.eventType),
  index('user_events_name_idx').on(t.eventName),
  index('user_events_page_idx').on(t.pagePath),
  index('user_events_user_idx').on(t.userId),
  index('user_events_session_idx').on(t.sessionId),
  index('user_events_tenant_idx').on(t.tenantId),
  index('user_events_distinct_idx').on(t.distinctId),
  index('user_events_member_idx').on(t.memberId),
  // 趋势/概览/维度分析主查询路径（tenant + 时间范围 + 事件类型过滤）
  index('user_events_tenant_created_type_idx').on(t.tenantId, t.createdAt, t.eventType),
  // 事件字典 / Tracking Plan 质量分析主查询路径（tenant + 时间范围 + 事件名）
  index('user_events_tenant_created_name_idx').on(t.tenantId, t.createdAt, t.eventName),
  // 多端来源趋势拆分查询路径
  index('user_events_source_created_idx').on(t.source, t.createdAt),
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
  // 行为中心阶段 1：多端来源归因，与 user_events 保持同一套平台字段口径
  source: analyticsEventSourceEnum('source').notNull().default('web_admin'),
  appId: varchar('app_id', { length: 64 }).notNull().default('admin'),
  environment: varchar('environment', { length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  memberId: integer('member_id').references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_sessions_sid_uq').on(t.sessionId),
  index('analytics_sessions_started_idx').on(t.startedAt),
  index('analytics_sessions_user_idx').on(t.userId),
  index('analytics_sessions_tenant_idx').on(t.tenantId),
  index('analytics_sessions_member_idx').on(t.memberId),
  // 租户会话列表/趋势主查询路径（tenant + 时间范围）
  index('analytics_sessions_tenant_started_idx').on(t.tenantId, t.startedAt),
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
  propertySchema: jsonb('property_schema').$type<AnalyticsEventPropertyDef[]>(),
  status: analyticsEventStatusEnum('status').notNull().default('active'),
  eventCount: bigint('event_count', { mode: 'number' }).notNull().default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  // Tracking Plan：契约版本号，每次结构性变更（新增/删除属性、变更类型）递增
  version: integer('version').notNull().default(1),
  // Tracking Plan：负责人（平台侧用户），便于契约变更后追溯与通知
  ownerId: integer('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  ownerName: varchar('owner_name', { length: 64 }),
  // 严格模式：开启后采集入口对不符合 propertySchema 的属性做质量记录（阶段 1 仅落库标识，校验逻辑在采集服务落地）
  strictMode: boolean('strict_mode').notNull().default(false),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_event_meta_name_uq').on(t.eventName),
  index('analytics_event_meta_status_idx').on(t.status),
  index('analytics_event_meta_owner_idx').on(t.ownerId),
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
  anonymizeIp: boolean('anonymize_ip').notNull().default(false),
  blacklistPaths: jsonb('blacklist_paths').$type<string[]>().notNull().default([]),
  retentionDays: integer('retention_days').notNull().default(180),
  errorRetentionDays: integer('error_retention_days').notNull().default(90),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(30),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_settings_tenant_uq').on(sql`coalesce(${t.tenantId}, 0)`),
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
  // 行为中心阶段 1：多端来源归因，与 user_events / analytics_sessions 保持同一套平台字段口径
  source: analyticsEventSourceEnum('source').notNull().default('web_admin'),
  appId: varchar('app_id', { length: 64 }).notNull().default('admin'),
  environment: varchar('environment', { length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  memberId: integer('member_id').references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('error_events_group_idx').on(t.groupId),
  index('error_events_created_idx').on(t.createdAt),
  index('error_events_user_idx').on(t.userId),
  index('error_events_tenant_idx').on(t.tenantId),
  index('error_events_member_idx').on(t.memberId),
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

// 告警触发历史（规则命中即记录，供回溯与审计）
export const errorAlertLogs = pgTable('error_alert_logs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ruleId: integer('rule_id').references(() => errorAlertRules.id, { onDelete: 'set null' }),
  ruleName: varchar('rule_name', { length: 128 }).notNull(),
  condition: errorAlertConditionEnum('condition').notNull(),
  detail: text('detail').notNull(),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  source: varchar('source', { length: 16 }).notNull().default('cron'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('error_alert_logs_created_idx').on(t.createdAt),
  index('error_alert_logs_rule_idx').on(t.ruleId),
  index('error_alert_logs_tenant_idx').on(t.tenantId),
]);

export type ErrorAlertLogRow = typeof errorAlertLogs.$inferSelect;

export type NewErrorAlertLog = typeof errorAlertLogs.$inferInsert;

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

// 保存的分析报表配置（漏斗步骤等），供复用加载
export const analyticsSavedReports = pgTable('analytics_saved_reports', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  reportType: varchar('report_type', { length: 32 }).notNull().default('funnel'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  createdBy: integer('created_by'),
  createdByName: varchar('created_by_name', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('analytics_saved_reports_tenant_idx').on(t.tenantId),
  index('analytics_saved_reports_type_idx').on(t.reportType),
]);

export type AnalyticsSavedReportRow = typeof analyticsSavedReports.$inferSelect;

export type NewAnalyticsSavedReport = typeof analyticsSavedReports.$inferInsert;

// ─── 行为中心阶段 1：租户级事件启停覆盖 ───────────────────────────────────────
// 全局封禁（blocked）仍由 analytics_event_meta 平台超管维护；本表仅承载租户自助的启/停开关
export const analyticsEventOverrideStatusEnum = pgEnum('analytics_event_override_status', ['enabled', 'disabled']);

export const analyticsEventOverrides = pgTable('analytics_event_overrides', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventName: varchar('event_name', { length: 128 }).notNull(),
  status: analyticsEventOverrideStatusEnum('status').notNull().default('enabled'),
  reason: text('reason'),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_event_overrides_tenant_name_uq').on(t.tenantId, t.eventName),
  index('analytics_event_overrides_status_idx').on(t.status),
]);

export type AnalyticsEventOverrideRow = typeof analyticsEventOverrides.$inferSelect;

export type NewAnalyticsEventOverride = typeof analyticsEventOverrides.$inferInsert;


// ─── 行为中心阶段 2：站点模型（匿名 site key 归属）──────────────────────────────
export const analyticsSites = pgTable('analytics_sites', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  siteKey: varchar('site_key', { length: 64 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  appId: varchar('app_id', { length: 50 }).notNull(),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>(),
  dailyEventQuota: integer('daily_event_quota'),
  status: analyticsEventOverrideStatusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 500 }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_sites_site_key_uq').on(t.siteKey),
  index('analytics_sites_tenant_idx').on(t.tenantId),
]);

export type AnalyticsSiteRow = typeof analyticsSites.$inferSelect;

export type NewAnalyticsSite = typeof analyticsSites.$inferInsert;

// ─── 行为中心阶段 1：埋点质量日聚合（轻量，供质量看板/告警使用）──────────────────
// tenantId 非空（0 = 平台/无租户哨兵），避免 NULL 在唯一索引中视为相异导致 upsert 失效，与 analytics_daily_rollup 约定一致
export const analyticsEventQualityIssueTypeEnum = pgEnum('analytics_event_quality_issue_type', [
  'missing_required', 'type_mismatch', 'invalid_enum', 'event_disabled', 'origin_rejected', 'quota_exceeded',
]);

export const analyticsEventQualityDaily = pgTable('analytics_event_quality_daily', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().default(0),
  statDate: date('stat_date').notNull(),
  eventName: varchar('event_name', { length: 128 }).notNull(),
  issueType: analyticsEventQualityIssueTypeEnum('issue_type').notNull(),
  count: bigint('count', { mode: 'number' }).notNull().default(0),
  // 命中样本（脱敏后的属性快照片段），便于排查，非追责用途
  sample: jsonb('sample').$type<Record<string, unknown>>(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_event_quality_daily_uq').on(t.tenantId, t.statDate, t.eventName, t.issueType),
  index('analytics_event_quality_daily_date_idx').on(t.statDate),
  index('analytics_event_quality_daily_tenant_idx').on(t.tenantId),
]);

export type AnalyticsEventQualityDailyRow = typeof analyticsEventQualityDaily.$inferSelect;

export type NewAnalyticsEventQualityDaily = typeof analyticsEventQualityDaily.$inferInsert;

// ─── 行为中心阶段 1：统一用户画像（系统派生，供分群圈选使用）────────────────────
export const analyticsUserProfiles = pgTable('analytics_user_profiles', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  distinctId: varchar('distinct_id', { length: 64 }).notNull(),
  identityType: analyticsIdentityTypeEnum('identity_type').notNull().default('anonymous'),
  // userId / memberId 为跨系统弱关联标识，不建立物理外键（与 user_events / error_events 现有约定一致），
  // 避免高频派生表因主体删除产生级联/约束开销；关系查询通过 relations() 提供的逻辑关联完成
  userId: integer('user_id'),
  memberId: integer('member_id'),
  displayName: varchar('display_name', { length: 64 }),
  properties: jsonb('properties').$type<Record<string, unknown>>(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // tenantId 可空（全局/无租户场景），coalesce 归一后与 distinct_id 联合唯一
  uniqueIndex('analytics_user_profiles_tenant_distinct_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.distinctId),
  index('analytics_user_profiles_user_idx').on(t.userId),
  index('analytics_user_profiles_member_idx').on(t.memberId),
  index('analytics_user_profiles_last_seen_idx').on(t.lastSeenAt),
]);

export type AnalyticsUserProfileRow = typeof analyticsUserProfiles.$inferSelect;

export type NewAnalyticsUserProfile = typeof analyticsUserProfiles.$inferInsert;

// ─── 行为中心阶段 1：用户分群定义 ──────────────────────────────────────────────
export const analyticsUserSegments = pgTable('analytics_user_segments', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  rules: jsonb('rules').$type<AnalyticsSegmentRule>().notNull(),
  status: analyticsEventOverrideStatusEnum('status').notNull().default('enabled'),
  estimatedSize: integer('estimated_size').notNull().default(0),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // 全局分群（tenantId 为 NULL）与租户内分群分别做 name 唯一约束
  uniqueIndex('analytics_user_segments_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('analytics_user_segments_global_name_uq').on(t.name).where(sql`${t.tenantId} is null`),
  index('analytics_user_segments_tenant_status_idx').on(t.tenantId, t.status),
]);

export type AnalyticsUserSegmentRow = typeof analyticsUserSegments.$inferSelect;

export type NewAnalyticsUserSegment = typeof analyticsUserSegments.$inferInsert;

// ─── 行为中心阶段 1：分群成员物化快照（系统派生，定时任务重算）─────────────────
export const analyticsSegmentMembers = pgTable('analytics_segment_members', {
  id: serial('id').primaryKey(),
  segmentId: integer('segment_id').notNull().references(() => analyticsUserSegments.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  distinctId: varchar('distinct_id', { length: 64 }).notNull(),
  identityType: analyticsIdentityTypeEnum('identity_type').notNull().default('anonymous'),
  // 与 analytics_user_profiles 一致：弱关联标识，不建立物理外键
  userId: integer('user_id'),
  memberId: integer('member_id'),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('analytics_segment_members_segment_distinct_uq').on(t.segmentId, t.distinctId),
  index('analytics_segment_members_segment_idx').on(t.segmentId),
  index('analytics_segment_members_tenant_idx').on(t.tenantId),
  index('analytics_segment_members_member_idx').on(t.memberId),
]);

export type AnalyticsSegmentMemberRow = typeof analyticsSegmentMembers.$inferSelect;

export type NewAnalyticsSegmentMember = typeof analyticsSegmentMembers.$inferInsert;


// ─── 行为中心阶段 2：A/B 实验（无状态确定性分流）───────────────────────────────
export const analyticsExperiments = pgTable('analytics_experiments', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  expKey: varchar('exp_key', { length: 64 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }),
  status: analyticsExperimentStatusEnum('status').notNull().default('draft'),
  trafficAllocation: integer('traffic_allocation').notNull().default(100),
  variants: jsonb('variants').$type<AnalyticsExperimentVariant[]>().notNull(),
  metricEventName: varchar('metric_event_name', { length: 128 }).notNull(),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex('analytics_experiments_tenant_key_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.expKey),
  index('analytics_experiments_tenant_idx').on(t.tenantId),
  index('analytics_experiments_status_idx').on(t.status),
]);

export type AnalyticsExperimentRow = typeof analyticsExperiments.$inferSelect;

export type NewAnalyticsExperiment = typeof analyticsExperiments.$inferInsert;

// ─── 行为中心阶段 2：分群触达活动 ──────────────────────────────────────────────
export const analyticsSegmentCampaigns = pgTable('analytics_segment_campaigns', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: integer('segment_id').notNull().references(() => analyticsUserSegments.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  channel: analyticsCampaignChannelEnum('channel').notNull(),
  templateId: integer('template_id'),
  webhookUrl: varchar('webhook_url', { length: 500 }),
  status: analyticsCampaignStatusEnum('status').notNull().default('draft'),
  totalCount: integer('total_count').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: varchar('last_error', { length: 500 }),
  ...auditColumns(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('analytics_segment_campaigns_tenant_idx').on(t.tenantId),
  index('analytics_segment_campaigns_segment_idx').on(t.segmentId),
]);

export type AnalyticsSegmentCampaignRow = typeof analyticsSegmentCampaigns.$inferSelect;

export type NewAnalyticsSegmentCampaign = typeof analyticsSegmentCampaigns.$inferInsert;
