import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, idParam, keywordQuery, paginated, paginationQuery, queryBool, queryEnum, idQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_EVENT_DELIVERY_STATUSES, WORKFLOW_EVENT_DELIVERY_STATUS_OPTIONS, WORKFLOW_EVENT_DELIVERY_JOB_STATUSES, WORKFLOW_EVENT_DELIVERY_JOB_STATUS_OPTIONS, WORKFLOW_EVENT_SIGN_MODES, WORKFLOW_EVENT_TYPES } from '../constants';
import {
  createWorkflowEventSubscriptionSchema,
  replayWorkflowEventDeliveriesSchema,
  toggleWorkflowEventSubscriptionSchema,
  updateWorkflowEventSubscriptionSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const workflowEventSubscriptionSchema = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  definitionId: z.int().nullable().meta({ description: 'null = 全局（订阅所有流程定义）' }),
  definitionName: z.string().nullable().optional(),
  events: z.array(z.enum(WORKFLOW_EVENT_TYPES)),
  url: z.string(),
  secretMasked: z.string().nullable().meta({ description: '已脱敏的 secret（如 abcd****wxyz）；明文经 secret 接口按需获取' }),
  signMode: z.enum(WORKFLOW_EVENT_SIGN_MODES),
  headers: z.record(z.string(), z.string()).nullable(),
  connectorId: z.int().nullable().meta({ description: '经连接器投递：引用 http 连接器 id（设置后 url 退化为相对路径）' }),
  enabled: z.boolean(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowEventSubscription' });

export type WorkflowEventSubscription = z.infer<typeof workflowEventSubscriptionSchema>;

export const workflowEventSubscriptionSecretSchema = z.object({
  id: z.int(),
  secret: z.string().nullable(),
}).meta({ id: 'WorkflowEventSubscriptionSecret' });

export type WorkflowEventSubscriptionSecret = z.infer<typeof workflowEventSubscriptionSecretSchema>;

/** 测试投递的同步结果 */
export const workflowEventSubscriptionTestResultSchema = z.object({
  ok: z.boolean(),
  httpStatus: z.int().nullable(),
  durationMs: z.int(),
  responseSnippet: z.string().nullable(),
  error: z.string().nullable(),
  requestUrl: z.string(),
  eventType: z.string(),
}).meta({ id: 'WorkflowEventSubscriptionTestResult' });

export type WorkflowEventSubscriptionTestResult = z.infer<typeof workflowEventSubscriptionTestResultSchema>;

export const workflowEventDeliverySchema = z.object({
  id: z.int(),
  jobId: z.int(),
  subscriptionId: z.int(),
  subscriptionName: z.string().nullable().optional(),
  instanceId: z.int().nullable(),
  taskId: z.int().nullable(),
  eventId: z.string(),
  eventType: z.string(),
  payload: z.unknown().nullable().meta({ description: '投递的事件体（WorkflowEvent）' }),
  attempt: z.int(),
  status: z.enum(WORKFLOW_EVENT_DELIVERY_STATUSES),
  jobStatus: z.enum(WORKFLOW_EVENT_DELIVERY_JOB_STATUSES).meta({ description: '父作业当前调度状态，独立于本次执行结果' }),
  isLatestExecution: z.boolean(),
  canRetry: z.boolean().meta({ description: '最新执行、订阅启用且作业失败/死信/取消时可重试' }),
  canReplay: z.boolean().meta({ description: '最新执行、订阅启用且作业已终结时可重新投递' }),
  requestUrl: z.string().nullable(),
  requestHeaders: z.record(z.string(), z.string()).nullable(),
  responseStatus: z.int().nullable(),
  responseBody: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.int().nullable(),
  nextRetryAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowEventDelivery' });

export type WorkflowEventDelivery = z.infer<typeof workflowEventDeliverySchema>;

export const workflowEventDeliveryCountSchema = z.object({ count: z.int() }).meta({ id: 'WorkflowEventDeliveryCount' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowEventSubscriptionListQuery = paginationQuery.extend({
  keyword: keywordQuery(),
  definitionId: idQuery(),
  enabled: queryBool('启用状态', { labels: ['启用', '禁用'] }),
});

export const workflowEventDeliveryListQuery = paginationQuery.extend({
  subscriptionId: idQuery(),
  instanceId: idQuery(),
  status: queryEnum(WORKFLOW_EVENT_DELIVERY_STATUSES, { description: '本次结果', options: WORKFLOW_EVENT_DELIVERY_STATUS_OPTIONS }),
  jobStatus: queryEnum(WORKFLOW_EVENT_DELIVERY_JOB_STATUSES, { description: '当前作业', options: WORKFLOW_EVENT_DELIVERY_JOB_STATUS_OPTIONS }),
});

export const workflowEventSubscriptionContract = defineContract('/api/workflows/event-subscriptions', {
  list: op.get('/', { access: { permission: 'workflow:event-subscription:view' }, query: workflowEventSubscriptionListQuery, response: paginated(workflowEventSubscriptionSchema), summary: '获取事件订阅列表' }),
  detail: op.get('/{id}', { access: { permission: 'workflow:event-subscription:view' }, params: idParam, response: workflowEventSubscriptionSchema, summary: '获取订阅详情' }),
  secret: op.get('/{id}/secret', { access: { permission: 'workflow:event-subscription:view' }, audit: { description: '查看事件订阅 secret', recordResponseBody: false }, params: idParam, response: workflowEventSubscriptionSecretSchema, summary: '查看订阅 secret 明文（敏感操作）' }),
  create: op.post('/', { access: { permission: 'workflow:event-subscription:create' }, audit: '创建事件订阅', body: createWorkflowEventSubscriptionSchema, response: workflowEventSubscriptionSchema, summary: '创建事件订阅' }),
  update: op.put('/{id}', { access: { permission: 'workflow:event-subscription:edit' }, audit: '更新事件订阅', params: idParam, body: updateWorkflowEventSubscriptionSchema, response: workflowEventSubscriptionSchema, summary: '更新事件订阅' }),
  remove: op.delete('/{id}', { access: { permission: 'workflow:event-subscription:delete' }, audit: '删除事件订阅', params: idParam, summary: '删除事件订阅' }),
  toggle: op.patch('/{id}/toggle', { access: { permission: 'workflow:event-subscription:edit' }, audit: '切换事件订阅启用状态', params: idParam, body: toggleWorkflowEventSubscriptionSchema, response: workflowEventSubscriptionSchema, summary: '启用/禁用订阅' }),
  test: op.post('/{id}/test', { access: { permission: 'workflow:event-subscription:edit' }, audit: '测试事件订阅投递', params: idParam, response: workflowEventSubscriptionTestResultSchema, summary: '测试投递：同步发送一条带 test 标记的样例事件并返回 HTTP 结果' }),
  deliveries: op.get('/deliveries/list', { access: { permission: 'workflow:event-delivery:view' }, query: workflowEventDeliveryListQuery, response: paginated(workflowEventDeliverySchema), summary: '事件投递记录列表' }),
  deliveryDetail: op.get('/deliveries/{id}', { access: { permission: 'workflow:event-delivery:view' }, params: idParam, response: workflowEventDeliverySchema, summary: '投递记录详情' }),
  retryDelivery: op.post('/deliveries/{id}/retry', { access: { permission: 'workflow:event-delivery:retry' }, audit: '重试事件投递', params: idParam, response: workflowEventDeliverySchema, summary: '重试投递' }),
  replayDelivery: op.post('/deliveries/{id}/replay', { access: { permission: 'workflow:event-delivery:retry' }, audit: '重新投递事件', params: idParam, response: workflowEventDeliveryCountSchema, summary: '重新投递启用订阅的最新终态作业，保留原执行记录' }),
  batchRetryDeliveries: op.post('/deliveries/batch-retry', { access: { permission: 'workflow:event-delivery:retry' }, audit: '批量重试事件投递', body: batchIdsBody, response: workflowEventDeliveryCountSchema, summary: '批量重试投递' }),
  replayDeliveries: op.post('/deliveries/replay', { access: { permission: 'workflow:event-delivery:retry' }, audit: '按筛选批量重放事件投递', body: replayWorkflowEventDeliveriesSchema, response: workflowEventDeliveryCountSchema, summary: '按筛选批量重放投递（含补发已成功，支持订阅/事件类型/时间范围）' }),
}, { auditModule: '工作流管理', tags: ['WorkflowEventSubscriptions'] });
