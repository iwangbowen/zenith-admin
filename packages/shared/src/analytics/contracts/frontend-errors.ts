import * as z from 'zod';
import { batchIdsBody, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  ANALYTICS_DEVICE_TYPES,
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_EVENT_SOURCES,
  ERROR_ALERT_CONDITIONS,
  ERROR_LEVELS,
  ERROR_STATUSES,
  FRONTEND_ERROR_TYPES,
} from '../constants';
import {
  createErrorAlertRuleSchema,
  errorBreadcrumbSchema,
  reportFrontendErrorSchema,
  sourceMapUploadSchema,
  updateErrorAlertRuleSchema,
  updateErrorGroupSchema,
} from '../validation';
import { daysQuery } from './_query';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 错误分组（Issue） */
export const errorGroupSchema = z.object({
  id: z.int(),
  fingerprint: z.string(),
  errorType: z.enum(FRONTEND_ERROR_TYPES),
  level: z.enum(ERROR_LEVELS),
  message: z.string(),
  status: z.enum(ERROR_STATUSES),
  assigneeId: z.int().nullable(),
  assigneeName: z.string().nullable(),
  release: z.string().nullable(),
  note: z.string().nullable(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS).meta({ description: '归属环境（development/staging/production 分开成组）' }),
  count: z.int(),
  affectedUsers: z.int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  resolvedAt: z.string().nullable(),
  trend: z.array(z.int()).optional().meta({ description: '近 7 日每日发生次数（列表返回，用于迷你趋势）' }),
}).meta({ id: 'ErrorGroup' });

export type ErrorGroup = z.infer<typeof errorGroupSchema>;

/** 单次错误事件 */
export const errorEventSchema = z.object({
  id: z.int(),
  groupId: z.int(),
  fingerprint: z.string(),
  errorType: z.enum(FRONTEND_ERROR_TYPES),
  level: z.enum(ERROR_LEVELS),
  message: z.string(),
  stack: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  lineNo: z.int().nullable(),
  colNo: z.int().nullable(),
  pageUrl: z.string().nullable(),
  release: z.string().nullable(),
  userAgent: z.string().nullable(),
  browser: z.string().nullable(),
  browserVersion: z.string().nullable(),
  os: z.string().nullable(),
  deviceType: z.enum(ANALYTICS_DEVICE_TYPES).nullable(),
  userId: z.int().nullable(),
  username: z.string().nullable(),
  sessionId: z.string().nullable(),
  breadcrumbs: z.array(errorBreadcrumbSchema).nullable(),
  context: z.record(z.string(), z.unknown()).nullable(),
  httpStatus: z.int().nullable(),
  httpMethod: z.string().nullable(),
  httpUrl: z.string().nullable(),
  source: z.enum(ANALYTICS_EVENT_SOURCES),
  appId: z.string(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS),
  memberId: z.int().nullable().meta({ description: '会员身份（前台错误上报），与 userId（后台管理员）互斥' }),
  replayId: z.string().nullable().meta({ description: '报错时刻活跃的回放会话 ID（SDK 注入）' }),
  createdAt: z.string(),
}).meta({ id: 'ErrorEvent' });

export type ErrorEvent = z.infer<typeof errorEventSchema>;

/** 分组详情：趋势 / 分布 / 最近事件 / 堆栈还原 */
export const errorGroupDetailSchema = z.object({
  group: errorGroupSchema,
  symbolicatedStack: z.string().nullable().meta({ description: '按 release 匹配 Source Map 还原后的堆栈；无可用 Source Map 为 null' }),
  trend: z.array(z.object({ date: z.string(), count: z.int() })).meta({ description: '近 14 日每日发生次数' }),
  browsers: z.array(z.object({ name: z.string(), value: z.int() })),
  os: z.array(z.object({ name: z.string(), value: z.int() })),
  recentEvents: z.array(errorEventSchema),
}).meta({ id: 'ErrorGroupDetail' });

export type ErrorGroupDetail = z.infer<typeof errorGroupDetailSchema>;

export const errorOverviewSchema = z.object({
  totalGroups: z.int(),
  unresolved: z.int(),
  totalOccurrences: z.int(),
  affectedUsers: z.int(),
  newToday: z.int(),
  byType: z.array(z.object({ errorType: z.enum(FRONTEND_ERROR_TYPES), groups: z.int(), occurrences: z.int() })),
  byLevel: z.array(z.object({ level: z.enum(ERROR_LEVELS), groups: z.int(), occurrences: z.int() })),
  trend: z.array(z.object({ date: z.string(), occurrences: z.int(), groups: z.int() })),
  topIssues: z.array(errorGroupSchema),
}).meta({ id: 'ErrorOverview' });

export type ErrorOverview = z.infer<typeof errorOverviewSchema>;

export const errorAlertRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  errorType: z.enum(FRONTEND_ERROR_TYPES).nullable(),
  level: z.enum(ERROR_LEVELS).nullable(),
  condition: z.enum(ERROR_ALERT_CONDITIONS),
  thresholdCount: z.int(),
  windowMinutes: z.int(),
  channels: z.array(z.string()),
  webhookUrl: z.string().nullable(),
  recipients: z.array(z.string()),
  enabled: z.boolean(),
  lastTriggeredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ErrorAlertRule' });

export type ErrorAlertRule = z.infer<typeof errorAlertRuleSchema>;

export const errorAlertLogSchema = z.object({
  id: z.int(),
  ruleId: z.int().nullable(),
  ruleName: z.string(),
  condition: z.enum(ERROR_ALERT_CONDITIONS),
  detail: z.string(),
  channels: z.array(z.string()),
  source: z.string().meta({ description: '触发来源：realtime / cron' }),
  createdAt: z.string(),
}).meta({ id: 'ErrorAlertLog' });

export type ErrorAlertLog = z.infer<typeof errorAlertLogSchema>;

export const sourceMapItemSchema = z.object({
  id: z.int(),
  release: z.string(),
  fileName: z.string(),
  size: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SourceMapItem' });

export type SourceMapItem = z.infer<typeof sourceMapItemSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const errorOverviewQuery = z.object({ days: daysQuery(365, 30) });

export const errorGroupListQuery = paginationQuery.extend({
  status: queryEnum(ERROR_STATUSES),
  errorType: queryEnum(FRONTEND_ERROR_TYPES),
  level: queryEnum(ERROR_LEVELS),
  keyword: z.string().optional(),
  assigneeId: z.coerce.number().int().optional(),
  environment: queryEnum(ANALYTICS_ENVIRONMENTS),
});

export const errorGroupBatchStatusQuery = z.object({
  status: z.enum(ERROR_STATUSES),
});

export const errorEventListQuery = paginationQuery.extend({
  groupId: z.coerce.number().int().optional(),
});

export const errorCleanQuery = z.object({
  days: z.coerce.number().int().min(0).default(0).meta({ description: '仅清除 N 天前的数据；0 = 全部' }),
});

export const sourceMapListQuery = paginationQuery.extend({
  release: z.string().optional(),
});

export const errorAlertLogListQuery = paginationQuery.extend({
  ruleId: z.coerce.number().int().optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const frontendErrorContract = defineContract('/api/frontend-errors', {
  report: op.post('/', { body: reportFrontendErrorSchema, public: true, summary: '上报前端错误（匿名/登录均可）' }),
  overview: op.get('/overview', { query: errorOverviewQuery, response: errorOverviewSchema, summary: '错误概览' }),

  groups: op.get('/groups', { query: errorGroupListQuery, response: paginated(errorGroupSchema), summary: '错误分组列表' }),
  batchUpdateGroupStatus: op.post('/groups/batch-status', { query: errorGroupBatchStatusQuery, body: batchIdsBody, summary: '批量更新分组状态' }),
  batchDeleteGroups: op.delete('/groups/batch', { body: batchIdsBody, summary: '批量删除分组' }),
  groupDetail: op.get('/groups/{id}', { params: idParam, response: errorGroupDetailSchema, summary: '错误分组详情' }),
  updateGroup: op.put('/groups/{id}', { params: idParam, body: updateErrorGroupSchema, response: errorGroupSchema, summary: '处理错误分组' }),

  events: op.get('/events', { query: errorEventListQuery, response: paginated(errorEventSchema), summary: '错误事件列表' }),
  clean: op.delete('/clean', { query: errorCleanQuery, summary: '清除错误数据' }),

  sourceMaps: op.get('/source-maps', { query: sourceMapListQuery, response: paginated(sourceMapItemSchema), summary: 'Source Map 列表' }),
  uploadSourceMap: op.post('/source-maps', { body: sourceMapUploadSchema, response: sourceMapItemSchema, summary: '上传 Source Map' }),
  removeSourceMap: op.delete('/source-maps/{id}', { params: idParam, summary: '删除 Source Map' }),

  alerts: op.get('/alerts', { query: paginationQuery, response: paginated(errorAlertRuleSchema), summary: '告警规则列表' }),
  createAlert: op.post('/alerts', { body: createErrorAlertRuleSchema, response: errorAlertRuleSchema, summary: '新增告警规则' }),
  updateAlert: op.put('/alerts/{id}', { params: idParam, body: updateErrorAlertRuleSchema, response: errorAlertRuleSchema, summary: '更新告警规则' }),
  removeAlert: op.delete('/alerts/{id}', { params: idParam, summary: '删除告警规则' }),
  alertLogs: op.get('/alert-logs', { query: errorAlertLogListQuery, response: paginated(errorAlertLogSchema), summary: '告警触发历史' }),
  testAlert: op.post('/alerts/{id}/test', { params: idParam, summary: '测试发送告警通知' }),
}, { tags: ['FrontendErrors'] });
