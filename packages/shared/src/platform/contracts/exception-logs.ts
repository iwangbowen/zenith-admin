import * as z from 'zod';
import { batchIdsBody, dateRangeQuery, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_ENVIRONMENT_OPTIONS,
  ERROR_LEVELS,
  ERROR_LEVEL_OPTIONS,
  ERROR_STATUSES,
  ERROR_STATUS_OPTIONS,
  SERVER_ERROR_TYPES,
  SERVER_ERROR_TYPE_OPTIONS,
} from '../../analytics/constants';
import { errorAlertLogSchema, errorAlertRuleSchema, errorEventSchema, errorGroupSchema } from '../../analytics/contracts/frontend-errors';
import { createErrorAlertRuleSchema, updateErrorAlertRuleSchema, updateErrorGroupSchema } from '../../analytics/validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────
// 分组 / 事件 / 告警规则复用错误监控的 Issue 实体（同一套表），本契约只暴露 source = 'server' 的部分。

const countByNameSchema = z.object({ name: z.string(), value: z.int() });

/** 异常分组详情：趋势 / 路由与作业分布 / 主机分布 / 受影响租户 / 最近事件 */
export const exceptionGroupDetailSchema = z.object({
  group: errorGroupSchema,
  trend: z.array(z.object({ date: z.string(), count: z.int() })).meta({ description: '近 14 日每日发生次数' }),
  routes: z.array(countByNameSchema).meta({ description: '按路由模板 / 作业类型分布（前 8）' }),
  hosts: z.array(countByNameSchema).meta({ description: '按主机分布（前 8）' }),
  affectedTenants: z.array(z.object({ tenantId: z.int().nullable(), value: z.int() })).meta({ description: '按发生时请求所属租户分布（null = 平台 / 无租户）' }),
  recentEvents: z.array(errorEventSchema),
}).meta({ id: 'ExceptionGroupDetail' });

export type ExceptionGroupDetail = z.infer<typeof exceptionGroupDetailSchema>;

export const exceptionOverviewSchema = z.object({
  totalGroups: z.int(),
  unresolved: z.int(),
  totalOccurrences: z.int(),
  newToday: z.int(),
  occurrences24h: z.int().meta({ description: '近 24 小时事件数' }),
  byType: z.array(z.object({ errorType: z.enum(SERVER_ERROR_TYPES), groups: z.int(), occurrences: z.int() })),
  byLevel: z.array(z.object({ level: z.enum(ERROR_LEVELS), groups: z.int(), occurrences: z.int() })),
  trend: z.array(z.object({ date: z.string(), occurrences: z.int(), groups: z.int() })),
  topIssues: z.array(errorGroupSchema),
}).meta({ id: 'ExceptionOverview' });

export type ExceptionOverview = z.infer<typeof exceptionOverviewSchema>;

/** 采集器运行状态（进程内计数器，多副本部署时为当前应答节点的值） */
export const exceptionReporterStatusSchema = z.object({
  enabled: z.boolean(),
  captured: z.int(),
  stored: z.int(),
  countOnly: z.int().meta({ description: '因限流只累加次数、未保存详情的事件数' }),
  dropped: z.int(),
  ignored: z.int(),
  flushFailures: z.int(),
  pending: z.int(),
  paused: z.boolean().meta({ description: '连续落库失败触发熔断中' }),
  hostname: z.string(),
  pid: z.int(),
  processRole: z.string(),
}).meta({ id: 'ExceptionReporterStatus' });

export type ExceptionReporterStatus = z.infer<typeof exceptionReporterStatusSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const exceptionOverviewQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30).meta({ description: '统计窗口（天）', example: 30 }),
});

export const exceptionGroupListQuery = paginationQuery.extend({
  status: queryEnum(ERROR_STATUSES, { description: '处理状态', options: ERROR_STATUS_OPTIONS }),
  errorType: queryEnum(SERVER_ERROR_TYPES, { description: '异常类型', options: SERVER_ERROR_TYPE_OPTIONS }),
  level: queryEnum(ERROR_LEVELS, { description: '级别', options: ERROR_LEVEL_OPTIONS }),
  environment: queryEnum(ANALYTICS_ENVIRONMENTS, { description: '环境', options: ANALYTICS_ENVIRONMENT_OPTIONS }),
  keyword: keywordQuery('异常消息'),
  assigneeId: idQuery('指派人'),
  ...dateRangeQuery('最近发生时间'),
});

export const exceptionGroupBatchStatusQuery = z.object({
  status: z.enum(ERROR_STATUSES),
});

export const exceptionEventListQuery = paginationQuery.extend({
  groupId: idQuery('分组'),
  errorType: queryEnum(SERVER_ERROR_TYPES, { description: '异常类型', options: SERVER_ERROR_TYPE_OPTIONS }),
  level: queryEnum(ERROR_LEVELS, { description: '级别', options: ERROR_LEVEL_OPTIONS }),
  correlationId: keywordQuery('链路 ID', { max: 64 }),
  route: keywordQuery('路由模板', { max: 256 }),
  jobType: keywordQuery('任务 / 作业 / 事件类型', { max: 64 }),
  hostname: keywordQuery('主机名', { max: 128 }),
  ...dateRangeQuery('发生时间'),
});

export const exceptionAlertLogListQuery = paginationQuery.extend({
  ruleId: idQuery('告警规则'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

/**
 * 异常日志（服务端异常）：与「数据分析 → 错误监控」共用 Issue 表，只暴露 source = 'server' 的分组 / 事件，
 * 多租户下仅平台超管可见（服务端堆栈与请求快照是平台运维数据）。
 */
export const exceptionLogContract = defineContract('/api/exception-logs', {
  overview: op.get('/overview', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, query: exceptionOverviewQuery, response: exceptionOverviewSchema, summary: '异常概览' }),
  reporterStatus: op.get('/reporter-status', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, response: exceptionReporterStatusSchema, summary: '采集器运行状态（当前节点）' }),

  groups: op.get('/groups', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, query: exceptionGroupListQuery, response: paginated(errorGroupSchema), summary: '异常分组列表' }),
  batchUpdateGroupStatus: op.post('/groups/batch-status', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '批量更新异常分组状态', query: exceptionGroupBatchStatusQuery, body: batchIdsBody, summary: '批量更新分组状态' }),
  batchDeleteGroups: op.delete('/groups/batch', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '批量删除异常分组', body: batchIdsBody, summary: '批量删除分组' }),
  groupDetail: op.get('/groups/{id}', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, params: idParam, response: exceptionGroupDetailSchema, summary: '异常分组详情' }),
  updateGroup: op.put('/groups/{id}', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '处理异常分组', params: idParam, body: updateErrorGroupSchema, response: errorGroupSchema, summary: '处理异常分组（状态 / 级别 / 指派 / 备注）' }),

  events: op.get('/events', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, query: exceptionEventListQuery, response: paginated(errorEventSchema), summary: '异常事件列表' }),
  eventDetail: op.get('/events/{id}', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, params: idParam, response: errorEventSchema, summary: '异常事件详情（含堆栈与请求快照）' }),

  alerts: op.get('/alerts', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, query: paginationQuery, response: paginated(errorAlertRuleSchema), summary: '服务端异常告警规则列表' }),
  createAlert: op.post('/alerts', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '新增异常告警规则', body: createErrorAlertRuleSchema, response: errorAlertRuleSchema, summary: '新增告警规则（来源固定为服务端）' }),
  updateAlert: op.put('/alerts/{id}', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '更新异常告警规则', params: idParam, body: updateErrorAlertRuleSchema, response: errorAlertRuleSchema, summary: '更新告警规则' }),
  removeAlert: op.delete('/alerts/{id}', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '删除异常告警规则', params: idParam, summary: '删除告警规则' }),
  testAlert: op.post('/alerts/{id}/test', { access: { permission: 'system:exception-log:manage', platformOnly: 'multi-tenant' }, audit: '测试发送异常告警', params: idParam, summary: '测试发送告警通知' }),
  alertLogs: op.get('/alert-logs', { access: { permission: 'system:exception-log:list', platformOnly: 'multi-tenant' }, query: exceptionAlertLogListQuery, response: paginated(errorAlertLogSchema), summary: '告警触发历史（服务端规则）' }),
}, { auditModule: '异常日志', tags: ['ExceptionLogs'] });
