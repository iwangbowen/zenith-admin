import * as z from 'zod';
import { auditFieldsSchema } from '../../core/api-schemas';
import { userBehaviorEventTypeEnum } from '../validation';
import {
  ANALYTICS_DEVICE_TYPES,
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_EVENT_META_STATUSES,
  ANALYTICS_EVENT_OVERRIDE_STATUSES,
  ANALYTICS_EVENT_SOURCES,
  ANALYTICS_QUALITY_ISSUE_TYPES,
} from '../constants';
import { analyticsEventPropertyDefSchema } from '../validation';

// ─── 埋点事件列表 / 详情 ──────────────────────────────────────────────────────

const eventRowShape = {
  id: z.int(),
  userId: z.int().nullable(),
  username: z.string().nullable(),
  eventType: userBehaviorEventTypeEnum,
  eventName: z.string().nullable(),
  pagePath: z.string(),
  pageTitle: z.string().nullable(),
  elementKey: z.string().nullable(),
  elementLabel: z.string().nullable(),
  componentArea: z.string().nullable(),
  durationMs: z.int().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  deviceType: z.enum(ANALYTICS_DEVICE_TYPES).nullable(),
  region: z.string().nullable(),
  sessionId: z.string().nullable(),
  createdAt: z.string(),
  memberId: z.int().nullable(),
  source: z.enum(ANALYTICS_EVENT_SOURCES),
  appId: z.string(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS),
};

export const eventListItemSchema = z.object({
  ...eventRowShape,
  apiUrl: z.string().nullable().meta({ description: 'API 请求事件（$api）的接口摘要，其余事件为 null' }),
  apiStatus: z.int().nullable(),
}).meta({ id: 'EventListItem' });

export type EventListItem = z.infer<typeof eventListItemSchema>;

export const eventDetailSchema = z.object({
  ...eventRowShape,
  distinctId: z.string().nullable(),
  anonymousId: z.string().nullable(),
  scrollDepth: z.int().nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  referrer: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  browserVersion: z.string().nullable(),
  osVersion: z.string().nullable(),
  screenW: z.int().nullable(),
  screenH: z.int().nullable(),
  language: z.string().nullable(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  metricName: z.string().nullable(),
  metricValue: z.number().nullable(),
  sdkVersion: z.string().nullable(),
}).meta({ id: 'EventDetail' });

export type EventDetail = z.infer<typeof eventDetailSchema>;

// ─── 事件调试流 ───────────────────────────────────────────────────────────────

export const analyticsDebugEventSchema = z.object({
  id: z.int(),
  eventId: z.string().nullable(),
  eventType: userBehaviorEventTypeEnum,
  eventName: z.string().nullable(),
  source: z.enum(ANALYTICS_EVENT_SOURCES),
  appId: z.string(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS),
  distinctId: z.string().nullable(),
  memberId: z.int().nullable(),
  userId: z.int().nullable(),
  pagePath: z.string(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  issueTypes: z.array(z.enum(ANALYTICS_QUALITY_ISSUE_TYPES)).meta({ description: '当日该事件命中的质量问题类型（去重）' }),
}).meta({ id: 'AnalyticsDebugEvent' });

export type AnalyticsDebugEvent = z.infer<typeof analyticsDebugEventSchema>;

// ─── 事件字典（Tracking Plan）─────────────────────────────────────────────────

export const analyticsEventMetaSchema = z.object({
  id: z.int(),
  eventName: z.string(),
  displayName: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  propertySchema: z.array(analyticsEventPropertyDefSchema).nullable(),
  status: z.enum(ANALYTICS_EVENT_META_STATUSES),
  version: z.int().meta({ description: 'Tracking Plan 契约版本号，结构性变更时递增' }),
  ownerId: z.int().nullable().meta({ description: '契约负责人（平台侧用户）' }),
  ownerName: z.string().nullable(),
  strictMode: z.boolean().meta({ description: '严格模式：开启后对不符合 propertySchema 的属性做质量记录' }),
  eventCount: z.int(),
  firstSeenAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsEventMeta' });

export type AnalyticsEventMeta = z.infer<typeof analyticsEventMetaSchema>;

export const analyticsEventMetaReferenceItemSchema = z.object({
  id: z.int(),
  name: z.string(),
}).meta({ id: 'AnalyticsEventMetaReferenceItem' });

export type AnalyticsEventMetaReferenceItem = z.infer<typeof analyticsEventMetaReferenceItemSchema>;

/** 事件字典下游影响面：屏蔽 / 删除 / 改契约前展示，防止静默断数据 */
export const analyticsEventMetaReferencesSchema = z.object({
  savedReports: z.array(analyticsEventMetaReferenceItemSchema),
  segments: z.array(analyticsEventMetaReferenceItemSchema),
  experiments: z.array(analyticsEventMetaReferenceItemSchema),
  total: z.int(),
}).meta({ id: 'AnalyticsEventMetaReferences' });

export type AnalyticsEventMetaReferences = z.infer<typeof analyticsEventMetaReferencesSchema>;

// ─── 租户级事件启停覆盖 ───────────────────────────────────────────────────────

export const analyticsEventOverrideSchema = z.object({
  id: z.int(),
  tenantId: z.int(),
  eventName: z.string(),
  status: z.enum(ANALYTICS_EVENT_OVERRIDE_STATUSES),
  reason: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsEventOverride' });

export type AnalyticsEventOverride = z.infer<typeof analyticsEventOverrideSchema>;

// ─── 埋点质量看板 ─────────────────────────────────────────────────────────────

export const analyticsQualityDailySchema = z.object({
  id: z.int(),
  tenantId: z.int(),
  statDate: z.string(),
  eventName: z.string(),
  issueType: z.enum(ANALYTICS_QUALITY_ISSUE_TYPES),
  count: z.int(),
  sample: z.record(z.string(), z.unknown()).nullable().meta({ description: '命中样本（脱敏后的属性快照片段）' }),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsQualityDaily' });

export type AnalyticsQualityDaily = z.infer<typeof analyticsQualityDailySchema>;

/** 质量看板查询结果：按日/事件/问题类型明细 + 汇总 */
export const analyticsQualityQueryResultSchema = z.object({
  items: z.array(analyticsQualityDailySchema),
  totals: z.array(z.object({ issueType: z.enum(ANALYTICS_QUALITY_ISSUE_TYPES), count: z.int() })),
  totalCount: z.int(),
  page: z.int(),
  pageSize: z.int(),
}).meta({ id: 'AnalyticsQualityQueryResult' });

export type AnalyticsQualityQueryResult = z.infer<typeof analyticsQualityQueryResultSchema>;

// ─── 采集设置（SDK 远程配置）────────────────────────────────────────────────

export const analyticsSettingsSchema = z.object({
  id: z.int(),
  enabled: z.boolean(),
  sampleRate: z.number(),
  trackPageviews: z.boolean(),
  trackClicks: z.boolean(),
  trackPerformance: z.boolean(),
  trackErrors: z.boolean(),
  trackApi: z.boolean(),
  maskInputs: z.boolean(),
  respectDnt: z.boolean(),
  anonymizeIp: z.boolean(),
  blacklistPaths: z.array(z.string()),
  errorIgnorePatterns: z.array(z.string()).meta({ description: '错误忽略规则（正则字符串数组），命中 message 的错误上报直接丢弃' }),
  retentionDays: z.int(),
  errorRetentionDays: z.int(),
  sessionTimeoutMinutes: z.int(),
  trackReplay: z.boolean().meta({ description: '会话回放总开关' }),
  replaySessionSampleRate: z.number().meta({ description: '全程录制采样率（0-1）' }),
  replayOnError: z.boolean().meta({ description: '错误触发回放：报错时上传错误前的缓冲现场并继续录制' }),
  replayMaskAllText: z.boolean(),
  replayBlockSelector: z.string().meta({ description: '回放屏蔽元素的 CSS 选择器' }),
  replayRetentionDays: z.int(),
  replayStorageQuotaMb: z.int().meta({ description: '回放存储配额（MB，0=不限制）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsSettings' });

export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;

/** SDK 公开配置（无需鉴权可获取的精简版） */
export const analyticsPublicConfigSchema = z.object({
  enabled: z.boolean(),
  sampleRate: z.number(),
  trackPageviews: z.boolean(),
  trackClicks: z.boolean(),
  trackPerformance: z.boolean(),
  trackErrors: z.boolean(),
  trackApi: z.boolean(),
  maskInputs: z.boolean(),
  respectDnt: z.boolean(),
  blacklistPaths: z.array(z.string()),
  sessionTimeoutMinutes: z.int(),
  trackReplay: z.boolean().meta({ description: '会话回放总开关（关闭时 SDK 不加载 rrweb）' }),
  replaySessionSampleRate: z.number(),
  replayOnError: z.boolean(),
  replayMaskAllText: z.boolean(),
  replayBlockSelector: z.string(),
  siteId: z.int().optional().meta({ description: '按站点 Key 解析成功时返回' }),
  appId: z.string().optional(),
}).meta({ id: 'AnalyticsPublicConfig' });

export type AnalyticsPublicConfig = z.infer<typeof analyticsPublicConfigSchema>;

// ─── 每日聚合 ─────────────────────────────────────────────────────────────────

export const analyticsRollupItemSchema = z.object({
  statDate: z.string(),
  pv: z.int(),
  uv: z.int(),
  sessions: z.int(),
  events: z.int(),
  bounceSessions: z.int(),
  totalDwellMs: z.int(),
}).meta({ id: 'AnalyticsRollupItem' });

export type AnalyticsRollupItem = z.infer<typeof analyticsRollupItemSchema>;

export const analyticsRollupSummarySchema = z.object({
  items: z.array(analyticsRollupItemSchema),
}).meta({ id: 'AnalyticsRollupSummary' });

export type AnalyticsRollupSummary = z.infer<typeof analyticsRollupSummarySchema>;
