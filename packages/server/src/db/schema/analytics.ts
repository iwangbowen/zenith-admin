import { timestampColumns, idColumn, remarkColumn, timestamptz } from './common';
import { pgTable, varchar, pgEnum, integer, bigint, boolean, text, uniqueIndex, index, jsonb, smallint, real, date, uuid, primaryKey, customType, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnalyticsEnvironment, AnalyticsEventPropertyDef, AnalyticsExperimentVariant, AnalyticsSegmentRule, ReplayTrigger } from '@zenith/shared/analytics';
import { auditColumns, tenants, users, tenantIdColumn } from './core';
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

export const analyticsCampaignChannelEnum = pgEnum('analytics_campaign_channel', ['email', 'in_app', 'webhook', 'sms']);

export const analyticsCampaignStatusEnum = pgEnum('analytics_campaign_status', ['draft', 'running', 'completed', 'failed']);

export const analyticsExperimentStatusEnum = pgEnum('analytics_experiment_status', ['draft', 'running', 'paused', 'completed']);

// ─── 用户行为事件表（原始事件流）──────────────────────────────────────────────
export const userEvents = pgTable('user_events', {
  id: idColumn(),
  eventId: uuid(),
  tenantId: tenantIdColumn(),
  // 身份
  distinctId: varchar({ length: 64 }),
  anonymousId: varchar({ length: 64 }),
  userId: integer(),
  username: varchar({ length: 64 }),
  sessionId: varchar({ length: 36 }),
  // 事件
  eventType: userBehaviorEventTypeEnum().notNull(),
  eventName: varchar({ length: 128 }),
  pagePath: varchar({ length: 256 }).notNull(),
  pageTitle: varchar({ length: 128 }),
  elementKey: varchar({ length: 128 }),
  elementLabel: varchar({ length: 128 }),
  componentArea: varchar({ length: 64 }),
  clickX: real(),
  clickY: real(),
  scrollDepth: smallint(),
  durationMs: integer(),
  // 自定义属性袋
  properties: jsonb().$type<Record<string, unknown>>(),
  // 来源
  referrer: varchar({ length: 512 }),
  utmSource: varchar({ length: 128 }),
  utmMedium: varchar({ length: 128 }),
  utmCampaign: varchar({ length: 128 }),
  utmTerm: varchar({ length: 128 }),
  utmContent: varchar({ length: 128 }),
  // 环境（服务端解析 UA / IP 填充）
  browser: varchar({ length: 48 }),
  browserVersion: varchar({ length: 32 }),
  os: varchar({ length: 48 }),
  osVersion: varchar({ length: 32 }),
  deviceType: analyticsDeviceTypeEnum(),
  screenW: integer(),
  screenH: integer(),
  language: varchar({ length: 16 }),
  userAgent: varchar({ length: 512 }),
  ip: varchar({ length: 64 }),
  country: varchar({ length: 64 }),
  region: varchar({ length: 64 }),
  city: varchar({ length: 64 }),
  // 性能指标（perf 事件）
  metricName: varchar({ length: 32 }),
  metricValue: real(),
  // 行为中心阶段 1：多端来源归因（后台 SPA / 会员前台 SPA / 服务端上报）
  source: analyticsEventSourceEnum().notNull().default('web_admin'),
  // 应用标识（多 App 场景预留，默认 admin 兼容存量后台数据）
  appId: varchar({ length: 64 }).notNull().default('admin'),
  // 采集环境（production / staging / development，默认 production 兼容存量数据）
  environment: varchar({ length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  // 采集 SDK 版本，便于排查上报口径差异
  sdkVersion: varchar({ length: 32 }),
  // 会员身份（前台会员事件），与 userId（后台管理员）互斥，不复用同一列
  memberId: integer().references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  createdAt: timestamptz().notNull().defaultNow(),
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
  // 按应用统计当日事件量（埋点站点列表 todayUsage）：只扫目标 app 的当日区间，不再走 created_at 单列索引后逐行过滤 app_id
  index('user_events_app_created_idx').on(t.appId, t.createdAt),
  // Web Vitals 性能统计（perf 事件占比小，部分索引降低维护成本）
  index('user_events_perf_metric_idx').on(t.metricName, t.createdAt).where(sql`${t.eventType} = 'perf'`),
  // 自定义属性过滤（漏斗步骤 / 分群圈选 / 事件分析工作台）：默认 jsonb_ops 操作符类，
  // 支持 `properties ? 'key'` 键存在判断。属性过滤统一带该键存在前置条件（见
  // services/analytics/analytics-property-filter.ts），使高基数属性 key 可走位图索引扫描，
  // 而不是对时间窗内每一行求值 `properties ->> 'key'`
  index('user_events_properties_gin_idx').using('gin', t.properties),
  index('user_events_cms_site_created_idx').on(sql`(${t.properties}->>'cmsSiteId')`, t.createdAt).where(sql`${t.properties} @> '{"cmsSchemaVersion":2,"trustedCms":true}'::jsonb`),
  index('user_events_cms_page_created_idx').on(sql`(${t.properties}->>'pageViewId')`, t.createdAt).where(sql`${t.properties} @> '{"cmsSchemaVersion":2,"trustedCms":true}'::jsonb`),
  uniqueIndex('user_events_cms_page_view_uq').on(sql`(${t.properties}->>'cmsSiteId')`, sql`(${t.properties}->>'pageViewId')`).where(sql`${t.properties} @> '{"cmsSchemaVersion":2,"trustedCms":true}'::jsonb and ${t.eventName}='cms.page_view'`),
  // 身份回溯合并（$identify → 历史匿名事件改写 distinct_id）的更新路径：
  // 只覆盖尚未归属登录身份的匿名行，部分索引控制维护成本
  index('user_events_anon_pending_idx').on(t.anonymousId).where(sql`${t.userId} IS NULL AND ${t.memberId} IS NULL AND ${t.anonymousId} IS NOT NULL`),
]);

export type UserEventRow = typeof userEvents.$inferSelect;

export type NewUserEvent = typeof userEvents.$inferInsert;

// ─── 身份映射（匿名 anonymousId → 权威 distinctId）─────────────────────────────
// $identify 时首绑写入（ON CONFLICT DO NOTHING = 首绑优先，防共享设备串号）；
// 匿名 ingest 批次查表做前向合并，$identify 时做历史回溯合并（user_events / sessions / profiles）。
// 纯映射表，不加审计列。
export const analyticsIdentityMap = pgTable('analytics_identity_map', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  anonymousId: varchar({ length: 64 }).notNull(),
  distinctId: varchar({ length: 64 }).notNull(),
  identityType: analyticsIdentityTypeEnum().notNull(),
  userId: integer(),
  memberId: integer(),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  uniqueIndex('analytics_identity_map_tenant_anon_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.anonymousId),
]);

export type AnalyticsIdentityMapRow = typeof analyticsIdentityMap.$inferSelect;

// ─── 会话聚合表 ──────────────────────────────────────────────────────────────
export const analyticsSessions = pgTable('analytics_sessions', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  sessionId: varchar({ length: 36 }).notNull(),
  distinctId: varchar({ length: 64 }),
  userId: integer(),
  username: varchar({ length: 64 }),
  startedAt: timestamptz().notNull().defaultNow(),
  endedAt: timestamptz().notNull().defaultNow(),
  durationMs: integer().notNull().default(0),
  pageCount: integer().notNull().default(0),
  eventCount: integer().notNull().default(0),
  entryPage: varchar({ length: 256 }),
  exitPage: varchar({ length: 256 }),
  referrer: varchar({ length: 512 }),
  utmSource: varchar({ length: 128 }),
  browser: varchar({ length: 48 }),
  os: varchar({ length: 48 }),
  deviceType: analyticsDeviceTypeEnum(),
  country: varchar({ length: 64 }),
  region: varchar({ length: 64 }),
  isBounce: boolean().notNull().default(true),
  // 行为中心阶段 1：多端来源归因，与 user_events 保持同一套平台字段口径
  source: analyticsEventSourceEnum().notNull().default('web_admin'),
  appId: varchar({ length: 64 }).notNull().default('admin'),
  environment: varchar({ length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  memberId: integer().references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  ...timestampColumns(),
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
  id: idColumn(),
  tenantId: integer().notNull().default(0),
  statDate: date().notNull(),
  metric: varchar({ length: 32 }).notNull(),
  dimType: varchar({ length: 32 }).notNull().default('overall'),
  dimValue: varchar({ length: 256 }).notNull().default(''),
  value: bigint({ mode: 'number' }).notNull().default(0),
  ...timestampColumns(),
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
  id: idColumn(),
  tenantId: integer(),
  eventName: varchar({ length: 128 }).notNull(),
  displayName: varchar({ length: 128 }),
  category: varchar({ length: 64 }),
  description: text(),
  propertySchema: jsonb().$type<AnalyticsEventPropertyDef[]>(),
  status: analyticsEventStatusEnum().notNull().default('active'),
  eventCount: bigint({ mode: 'number' }).notNull().default(0),
  firstSeenAt: timestamptz(),
  lastSeenAt: timestamptz(),
  // Tracking Plan：契约版本号，每次结构性变更（新增/删除属性、变更类型）递增
  version: integer().notNull().default(1),
  // Tracking Plan：负责人（平台侧用户），便于契约变更后追溯与通知
  ownerId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  ownerName: varchar({ length: 64 }),
  // 严格模式：开启后采集入口对不符合 propertySchema 的属性做质量记录（阶段 1 仅落库标识，校验逻辑在采集服务落地）
  strictMode: boolean().notNull().default(false),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('analytics_event_meta_name_uq').on(t.eventName),
  index('analytics_event_meta_status_idx').on(t.status),
  index('analytics_event_meta_owner_idx').on(t.ownerId),
]);

export type AnalyticsEventMetaRow = typeof analyticsEventMeta.$inferSelect;

export type NewAnalyticsEventMeta = typeof analyticsEventMeta.$inferInsert;

// ─── 前端错误监控（Issue 模型：error_groups + error_events）────────────────────
/**
 * 错误类型：前端（SDK 上报）+ 服务端（进程内采集）共用一个枚举，取值以 `@zenith/shared/analytics` 的 `ERROR_TYPES` 为准。
 * PG 枚举名沿用 frontend_error_type：新增取值只需 ADD VALUE；重命名类型 drizzle-kit 会生成 DROP + CREATE，不值得为名字手写迁移。
 */
export const errorTypeEnum = pgEnum('frontend_error_type', [
  'js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash',
  'server_exception', 'job_failure', 'cron_failure', 'event_failure', 'process_crash', 'logged_error',
]);

export const errorLevelEnum = pgEnum('error_level', ['fatal', 'error', 'warning', 'info']);

export const errorStatusEnum = pgEnum('error_status', ['unresolved', 'resolved', 'ignored', 'muted']);

export const errorAlertConditionEnum = pgEnum('error_alert_condition', ['new_error', 'threshold', 'spike']);

// 错误分组（Issue）：fingerprint 全局唯一（已含 tenant 因子），修复原 ON CONFLICT 缺唯一索引的 Bug
export const errorGroups = pgTable('error_groups', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  fingerprint: varchar({ length: 64 }).notNull(),
  // 来源：浏览器端（web_admin / web_member）或服务端异常（server）；分组不跨来源，插入时确定、冲突不更新
  source: analyticsEventSourceEnum().notNull().default('web_admin'),
  errorType: errorTypeEnum().notNull(),
  level: errorLevelEnum().notNull().default('error'),
  message: text().notNull(),
  status: errorStatusEnum().notNull().default('unresolved'),
  assigneeId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  assigneeName: varchar({ length: 64 }),
  release: varchar({ length: 64 }),
  note: text(),
  // 环境维度（development/staging/production 分开成组）：dev 噪音不再淹没生产错误列表
  environment: varchar({ length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  count: bigint({ mode: 'number' }).notNull().default(0),
  affectedUsers: integer().notNull().default(0),
  firstSeenAt: timestamptz().notNull().defaultNow(),
  lastSeenAt: timestamptz().notNull().defaultNow(),
  resolvedAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('error_groups_fingerprint_uq').on(t.fingerprint),
  index('error_groups_status_idx').on(t.status),
  index('error_groups_type_idx').on(t.errorType),
  index('error_groups_last_seen_idx').on(t.lastSeenAt),
  index('error_groups_tenant_idx').on(t.tenantId),
  index('error_groups_assignee_idx').on(t.assigneeId),
// 异常日志页 / 前端错误页各自只看一种来源，列表按来源 + 最近发生排序
index('error_groups_source_last_seen_idx').on(t.source, t.lastSeenAt),
]);

export type ErrorGroupRow = typeof errorGroups.$inferSelect;

export type NewErrorGroup = typeof errorGroups.$inferInsert;

// 单次错误事件（追加型日志，含堆栈/面包屑/上下文/解析后的 UA）
export const errorEvents = pgTable('error_events', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  groupId: integer().notNull().references((): AnyPgColumn => errorGroups.id, { onDelete: 'cascade' }),
  fingerprint: varchar({ length: 64 }).notNull(),
  errorType: errorTypeEnum().notNull(),
  level: errorLevelEnum().notNull().default('error'),
  message: text().notNull(),
  stack: text(),
  sourceUrl: varchar({ length: 512 }),
  lineNo: integer(),
  colNo: integer(),
  pageUrl: varchar({ length: 512 }),
  release: varchar({ length: 64 }),
  userAgent: varchar({ length: 512 }),
  browser: varchar({ length: 48 }),
  browserVersion: varchar({ length: 32 }),
  os: varchar({ length: 48 }),
  deviceType: analyticsDeviceTypeEnum(),
  userId: integer(),
  username: varchar({ length: 64 }),
  sessionId: varchar({ length: 36 }),
  breadcrumbs: jsonb().$type<unknown[]>(),
  context: jsonb().$type<Record<string, unknown>>(),
  httpStatus: integer(),
  httpMethod: varchar({ length: 16 }),
  httpUrl: varchar({ length: 512 }),
  // 行为中心阶段 1：多端来源归因，与 user_events / analytics_sessions 保持同一套平台字段口径
  source: analyticsEventSourceEnum().notNull().default('web_admin'),
  appId: varchar({ length: 64 }).notNull().default('admin'),
  environment: varchar({ length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  memberId: integer().references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  // 报错时刻活跃的回放会话 ID（SDK 注入）：精确关联回放现场，无需时间窗模糊匹配
  replayId: varchar({ length: 36 }),
  // ─── 链路与服务端上下文（lib/error-tracking 采集；前端事件除 traceId 外为 null）───
  // 请求 / 链路 ID（= X-Request-Id）：服务端异常必带，前端接口错误读到响应头时带上，两侧按它互查
  traceId: varchar({ length: 64 }),
  // 匹配到的路由模板（/api/users/{id}），原始 URL 仍在 httpUrl；作业类异常为 null
  route: varchar({ length: 256 }),
  errorName: varchar({ length: 128 }),
  errorCode: varchar({ length: 64 }),
  // 任务类型 / 定时作业 key / 事件名 + 实例 ID
  jobType: varchar({ length: 64 }),
  jobId: varchar({ length: 64 }),
  processRole: varchar({ length: 16 }),
  hostname: varchar({ length: 128 }),
  pid: integer(),
  // 服务端异常本身归平台（tenantId 为 null），发生时请求所属租户单独记，供受影响租户分布
  affectedTenantId: integer(),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  index('error_events_group_idx').on(t.groupId),
  index('error_events_created_idx').on(t.createdAt),
  index('error_events_user_idx').on(t.userId),
  index('error_events_tenant_idx').on(t.tenantId),
  index('error_events_member_idx').on(t.memberId),
  // 分组详情「最近事件 / 影响用户」查询路径
  index('error_events_group_created_idx').on(t.groupId, t.createdAt),
  // 回放详情反查关联错误
  index('error_events_replay_idx').on(t.replayId),
  // 按链路 ID 互查（异常日志 ↔ 前端接口错误 ↔ 链路追踪）；只索引带值的行
  index('error_events_trace_idx').on(t.traceId).where(sql`${t.traceId} IS NOT NULL`),
]);

export type ErrorEventRow = typeof errorEvents.$inferSelect;

export type NewErrorEvent = typeof errorEvents.$inferInsert;

// 错误分组 × 受影响身份（'u:<userId>' / 'm:<memberId>' / 'a:<sessionId>'）：
// ingest 时 ON CONFLICT DO NOTHING 增量去重，支撑 error_groups.affected_users 的 O(1) 维护，
// 替代旧的「详情页 COUNT(DISTINCT) 懒回写」。纯关联表，不加审计列。
export const errorGroupIdentities = pgTable('error_group_identities', {
  groupId: integer().notNull().references((): AnyPgColumn => errorGroups.id, { onDelete: 'cascade' }),
  identity: varchar({ length: 80 }).notNull(),
  firstSeenAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.identity] }),
]);

export type ErrorGroupIdentityRow = typeof errorGroupIdentities.$inferSelect;

// 错误告警规则
export const errorAlertRules = pgTable('error_alert_rules', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  name: varchar({ length: 128 }).notNull(),
  // 只对某一来源生效（server = 服务端异常日志）；null = 全部来源
  source: analyticsEventSourceEnum(),
  errorType: errorTypeEnum(),
  level: errorLevelEnum(),
  condition: errorAlertConditionEnum().notNull().default('threshold'),
  thresholdCount: integer().notNull().default(10),
  windowMinutes: integer().notNull().default(60),
  channels: jsonb().$type<string[]>().notNull().default([]),
  webhookUrl: varchar({ length: 512 }),
  recipients: jsonb().$type<string[]>().notNull().default([]),
  enabled: boolean().notNull().default(true),
  lastTriggeredAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('error_alert_rules_tenant_idx').on(t.tenantId),
]);

export type ErrorAlertRuleRow = typeof errorAlertRules.$inferSelect;

export type NewErrorAlertRule = typeof errorAlertRules.$inferInsert;

// 告警触发历史（规则命中即记录，供回溯与审计）
export const errorAlertLogs = pgTable('error_alert_logs', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  ruleId: integer().references(() => errorAlertRules.id, { onDelete: 'set null' }),
  ruleName: varchar({ length: 128 }).notNull(),
  condition: errorAlertConditionEnum().notNull(),
  detail: text().notNull(),
  channels: jsonb().$type<string[]>().notNull().default([]),
  source: varchar({ length: 16 }).notNull().default('cron'),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  index('error_alert_logs_created_idx').on(t.createdAt),
  index('error_alert_logs_rule_idx').on(t.ruleId),
  index('error_alert_logs_tenant_idx').on(t.tenantId),
]);

export type ErrorAlertLogRow = typeof errorAlertLogs.$inferSelect;

export type NewErrorAlertLog = typeof errorAlertLogs.$inferInsert;

// Source Map（用于压缩堆栈还原）— 服务层以 replace 语义维护，无需唯一约束
export const sourceMaps = pgTable('source_maps', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  release: varchar({ length: 64 }).notNull(),
  fileName: varchar({ length: 256 }).notNull(),
  content: text().notNull(),
  size: integer().notNull().default(0),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('source_maps_release_idx').on(t.release, t.fileName),
  index('source_maps_tenant_idx').on(t.tenantId),
]);

export type SourceMapRow = typeof sourceMaps.$inferSelect;

export type NewSourceMap = typeof sourceMaps.$inferInsert;

// 保存的分析报表配置（漏斗步骤等），供复用加载
export const analyticsSavedReports = pgTable('analytics_saved_reports', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  name: varchar({ length: 128 }).notNull(),
  reportType: varchar({ length: 32 }).notNull().default('funnel'),
  config: jsonb().$type<Record<string, unknown>>().notNull(),
  createdBy: integer(),
  createdByName: varchar({ length: 64 }),
  ...timestampColumns(),
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
  id: idColumn(),
  tenantId: integer().notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventName: varchar({ length: 128 }).notNull(),
  status: analyticsEventOverrideStatusEnum().notNull().default('enabled'),
  reason: text(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('analytics_event_overrides_tenant_name_uq').on(t.tenantId, t.eventName),
  index('analytics_event_overrides_status_idx').on(t.status),
]);

export type AnalyticsEventOverrideRow = typeof analyticsEventOverrides.$inferSelect;

export type NewAnalyticsEventOverride = typeof analyticsEventOverrides.$inferInsert;


// ─── 行为中心阶段 2：站点模型（匿名 site key 归属）──────────────────────────────
export const analyticsSites = pgTable('analytics_sites', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  siteKey: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 100 }).notNull(),
  appId: varchar({ length: 50 }).notNull(),
  allowedOrigins: jsonb().$type<string[]>(),
  dailyEventQuota: integer(),
  status: analyticsEventOverrideStatusEnum().notNull().default('enabled'),
  remark: remarkColumn(500),
  ...auditColumns(),
  ...timestampColumns(),
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
  id: idColumn(),
  tenantId: integer().notNull().default(0),
  statDate: date().notNull(),
  eventName: varchar({ length: 128 }).notNull(),
  issueType: analyticsEventQualityIssueTypeEnum().notNull(),
  count: bigint({ mode: 'number' }).notNull().default(0),
  // 命中样本（脱敏后的属性快照片段），便于排查，非追责用途
  sample: jsonb().$type<Record<string, unknown>>(),
  lastSeenAt: timestamptz().notNull().defaultNow(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('analytics_event_quality_daily_uq').on(t.tenantId, t.statDate, t.eventName, t.issueType),
  index('analytics_event_quality_daily_date_idx').on(t.statDate),
  index('analytics_event_quality_daily_tenant_idx').on(t.tenantId),
]);

export type AnalyticsEventQualityDailyRow = typeof analyticsEventQualityDaily.$inferSelect;

export type NewAnalyticsEventQualityDaily = typeof analyticsEventQualityDaily.$inferInsert;

// ─── 行为中心阶段 1：统一用户画像（系统派生，供分群圈选使用）────────────────────
export const analyticsUserProfiles = pgTable('analytics_user_profiles', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  distinctId: varchar({ length: 64 }).notNull(),
  identityType: analyticsIdentityTypeEnum().notNull().default('anonymous'),
  // userId / memberId 为跨系统弱关联标识，不建立物理外键（与 user_events / error_events 现有约定一致），
  // 避免高频派生表因主体删除产生级联/约束开销；关系查询通过 relations() 提供的逻辑关联完成
  userId: integer(),
  memberId: integer(),
  displayName: varchar({ length: 64 }),
  properties: jsonb().$type<Record<string, unknown>>(),
  firstSeenAt: timestamptz().notNull().defaultNow(),
  lastSeenAt: timestamptz().notNull().defaultNow(),
  ...timestampColumns(),
}, (t) => [index('analytics_user_profiles_tenant_idx').on(t.tenantId), 
  // tenantId 可空（全局/无租户场景），coalesce 归一后与 distinct_id 联合唯一
  uniqueIndex('analytics_user_profiles_tenant_distinct_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.distinctId),
  index('analytics_user_profiles_user_idx').on(t.userId),
  index('analytics_user_profiles_member_idx').on(t.memberId),
  index('analytics_user_profiles_last_seen_idx').on(t.lastSeenAt),
  // 画像属性圈选（分群 attribute 条件 `property.<key>`）：与 user_events.properties 同口径
  index('analytics_user_profiles_properties_gin_idx').using('gin', t.properties),
]);

export type AnalyticsUserProfileRow = typeof analyticsUserProfiles.$inferSelect;

export type NewAnalyticsUserProfile = typeof analyticsUserProfiles.$inferInsert;

// ─── 行为中心阶段 1：用户分群定义 ──────────────────────────────────────────────
export const analyticsUserSegments = pgTable('analytics_user_segments', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  name: varchar({ length: 128 }).notNull(),
  description: text(),
  rules: jsonb().$type<AnalyticsSegmentRule>().notNull(),
  status: analyticsEventOverrideStatusEnum().notNull().default('enabled'),
  estimatedSize: integer().notNull().default(0),
  snapshotAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  // 全局分群（tenantId 为 NULL）与租户内分群分别做 name 唯一约束
  uniqueIndex('analytics_user_segments_tenant_name_uq').on(t.tenantId, t.name).where(sql`${t.tenantId} is not null`),
  uniqueIndex('analytics_user_segments_global_name_uq').on(t.name).where(sql`${t.tenantId} is null`),
  index('analytics_user_segments_tenant_status_idx').on(t.tenantId, t.status),
]);

export type AnalyticsUserSegmentRow = typeof analyticsUserSegments.$inferSelect;

export type NewAnalyticsUserSegment = typeof analyticsUserSegments.$inferInsert;

// ─── 会话回放 ─────────────────────────────────────────────────────────────────
export const replayModeEnum = pgEnum('replay_mode', ['buffer', 'stream']);

export const replayStatusEnum = pgEnum('replay_status', ['recording', 'completed', 'expired']);

/** rrweb 分片二进制（gzip 后 JSON），bytea 直存：删除与元数据事务一致，无文件孤儿 */
const bytea = customType<{ data: Buffer }>({
  dataType() { return 'bytea'; },
});

// 回放会话：id 为客户端生成 UUID（幂等重试锚点），首分片到达时 upsert
export const replaySessions = pgTable('replay_sessions', {
  id: varchar({ length: 36 }).primaryKey(),
  tenantId: tenantIdColumn(),
  sessionId: varchar({ length: 36 }).notNull(),
  mode: replayModeEnum().notNull(),
  status: replayStatusEnum().notNull().default('recording'),
  triggers: jsonb().$type<ReplayTrigger[]>().notNull().default([]),
  // 起止均为客户端时钟（与 rrweb 事件时间戳同源，播放器偏移计算一致）
  startedAt: timestamptz().notNull(),
  endedAt: timestamptz(),
  // 服务端时钟：僵尸会话收尾判定（客户端时钟不可信）
  lastActivityAt: timestamptz().notNull().defaultNow(),
  durationMs: integer().notNull().default(0),
  segmentCount: integer().notNull().default(0),
  totalBytes: bigint({ mode: 'number' }).notNull().default(0),
  errorCount: integer().notNull().default(0),
  pageCount: integer().notNull().default(0),
  clickCount: integer().notNull().default(0),
  // 内容检索索引：访问页面路径 / 点击元素文案（分片到达时去重合并，上限 40/60）
  pagePaths: jsonb().$type<string[]>().notNull().default([]),
  clickLabels: jsonb().$type<string[]>().notNull().default([]),
  entryPageUrl: varchar({ length: 512 }),
  source: analyticsEventSourceEnum().notNull().default('web_admin'),
  appId: varchar({ length: 64 }).notNull().default('admin'),
  environment: varchar({ length: 32 }).notNull().default('production').$type<AnalyticsEnvironment>(),
  userId: integer(),
  username: varchar({ length: 64 }),
  memberId: integer().references((): AnyPgColumn => members.id, { onDelete: 'set null' }),
  browser: varchar({ length: 48 }),
  os: varchar({ length: 48 }),
  deviceType: analyticsDeviceTypeEnum(),
  sdkVersion: varchar({ length: 32 }),
  ...timestampColumns(),
}, (t) => [
  index('replay_sessions_session_idx').on(t.sessionId),
  index('replay_sessions_started_idx').on(t.startedAt),
  // 僵尸收尾扫描路径：status='recording' AND last_activity_at < cutoff
  index('replay_sessions_status_activity_idx').on(t.status, t.lastActivityAt),
  index('replay_sessions_tenant_idx').on(t.tenantId),
  index('replay_sessions_user_idx').on(t.userId),
  index('replay_sessions_member_idx').on(t.memberId),
]);

export type ReplaySessionRow = typeof replaySessions.$inferSelect;

export type NewReplaySession = typeof replaySessions.$inferInsert;

export const replaySegments = pgTable('replay_segments', {
  id: idColumn(),
  replayId: varchar({ length: 36 }).notNull()
    .references(() => replaySessions.id, { onDelete: 'cascade' }),
  seq: integer().notNull(),
  data: bytea('data').notNull(),
  fromTs: timestamptz().notNull(),
  toTs: timestamptz().notNull(),
  byteSize: integer().notNull(),
  eventCount: integer().notNull().default(0),
  // 含 rrweb 全量快照的分片可作为播放起点（seek 优化）
  hasFullSnapshot: boolean().notNull().default(false),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  // (replayId, seq) 唯一：分片重传幂等
  uniqueIndex('replay_segments_replay_seq_uq').on(t.replayId, t.seq),
]);

export type ReplaySegmentRow = typeof replaySegments.$inferSelect;

export type NewReplaySegment = typeof replaySegments.$inferInsert;

// 点击坐标聚合（页面级热力图）：与回放会话解耦的独立事实表，
// 回放删除不影响热力累计，保留期独立（数据保留策略 90 天）
export const replayClickPoints = pgTable('replay_click_points', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  pagePath: varchar({ length: 256 }).notNull(),
  /** 视口归一化坐标（0-100 百分比） */
  xPct: smallint().notNull(),
  yPct: smallint().notNull(),
  source: analyticsEventSourceEnum().notNull().default('web_admin'),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  index('replay_click_points_page_idx').on(t.pagePath),
  index('replay_click_points_created_idx').on(t.createdAt),
  index('replay_click_points_tenant_idx').on(t.tenantId),
]);

export type ReplayClickPointRow = typeof replayClickPoints.$inferSelect;

// 回放访问审计：谁在什么时候查看了谁的操作录像（合规留痕，读操作专表）
export const replayAccessLogs = pgTable('replay_access_logs', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  replayId: varchar({ length: 36 }).notNull(),
  /** 回放归属（被查看用户的展示名，冗余存储避免回放删除后审计失联） */
  replayOwner: varchar({ length: 64 }),
  userId: integer().notNull(),
  username: varchar({ length: 64 }),
  /** view=打开详情（含实时旁观，10 分钟去重） */
  action: varchar({ length: 16 }).notNull().default('view'),
  ip: varchar({ length: 64 }),
  createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [
  index('replay_access_logs_replay_idx').on(t.replayId),
  index('replay_access_logs_user_idx').on(t.userId),
  index('replay_access_logs_created_idx').on(t.createdAt),
  index('replay_access_logs_tenant_idx').on(t.tenantId),
]);

export type ReplayAccessLogRow = typeof replayAccessLogs.$inferSelect;

// ─── 行为中心阶段 1：分群成员物化快照（系统派生，定时任务重算）─────────────────
export const analyticsSegmentMembers = pgTable('analytics_segment_members', {
  id: idColumn(),
  segmentId: integer().notNull().references(() => analyticsUserSegments.id, { onDelete: 'cascade' }),
  tenantId: tenantIdColumn(),
  distinctId: varchar({ length: 64 }).notNull(),
  identityType: analyticsIdentityTypeEnum().notNull().default('anonymous'),
  // 与 analytics_user_profiles 一致：弱关联标识，不建立物理外键
  userId: integer(),
  memberId: integer(),
  snapshotAt: timestamptz().notNull().defaultNow(),
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
  id: idColumn(),
  tenantId: tenantIdColumn(),
  expKey: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 500 }),
  status: analyticsExperimentStatusEnum().notNull().default('draft'),
  trafficAllocation: integer().notNull().default(100),
  variants: jsonb().$type<AnalyticsExperimentVariant[]>().notNull(),
  metricEventName: varchar({ length: 128 }).notNull(),
  startAt: timestamptz(),
  endAt: timestamptz(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('analytics_experiments_tenant_key_uq').on(sql`coalesce(${t.tenantId}, 0)`, t.expKey),
  index('analytics_experiments_tenant_idx').on(t.tenantId),
  index('analytics_experiments_status_idx').on(t.status),
]);

export type AnalyticsExperimentRow = typeof analyticsExperiments.$inferSelect;

export type NewAnalyticsExperiment = typeof analyticsExperiments.$inferInsert;

// ─── 行为中心阶段 2：分群触达活动 ──────────────────────────────────────────────
export const analyticsSegmentCampaigns = pgTable('analytics_segment_campaigns', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  segmentId: integer().notNull().references(() => analyticsUserSegments.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  channel: analyticsCampaignChannelEnum().notNull(),
  templateId: integer(),
  webhookUrl: varchar({ length: 500 }),
  /** 落地页地址：执行时自动生成短链（bizType=campaign）并注入模板变量 {{shortUrl}} */
  landingUrl: varchar({ length: 2048 }),
  status: analyticsCampaignStatusEnum().notNull().default('draft'),
  totalCount: integer().notNull().default(0),
  sentCount: integer().notNull().default(0),
  failedCount: integer().notNull().default(0),
  lastRunAt: timestamptz(),
  lastError: varchar({ length: 500 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('analytics_segment_campaigns_tenant_idx').on(t.tenantId),
  index('analytics_segment_campaigns_segment_idx').on(t.segmentId),
]);

export type AnalyticsSegmentCampaignRow = typeof analyticsSegmentCampaigns.$inferSelect;

export type NewAnalyticsSegmentCampaign = typeof analyticsSegmentCampaigns.$inferInsert;
