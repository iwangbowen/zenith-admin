import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_CONNECTOR_BREAKER_STATES, WORKFLOW_CONNECTOR_INVOCATION_SOURCES, WORKFLOW_CONNECTOR_TYPES } from '../constants';
import { createWorkflowConnectorSchema, testWorkflowConnectorSchema, updateWorkflowConnectorSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 流程连接器（脱敏：仅回传 hasCredentials，绝不回传凭据明文） */
export const workflowConnectorSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string().meta({ example: 'erp-gateway' }),
  description: z.string().nullable(),
  type: z.enum(WORKFLOW_CONNECTOR_TYPES),
  config: z.record(z.string(), z.unknown()),
  timeoutMs: z.int(),
  retryMax: z.int(),
  circuitBreakerEnabled: z.boolean(),
  failureThreshold: z.int(),
  cooldownSec: z.int(),
  rateLimitEnabled: z.boolean().meta({ description: '限流开关（与熔断并列）' }),
  rateLimitWindowSec: z.int().meta({ description: '限流：滑动时间窗（秒）' }),
  rateLimitMax: z.int().meta({ description: '限流：窗口内最大调用次数（<=0 不限制）' }),
  status: z.enum(['enabled', 'disabled']),
  hasCredentials: z.boolean().meta({ description: '是否已配置凭据（脱敏，不回传明文）' }),
  breakerState: z.enum(WORKFLOW_CONNECTOR_BREAKER_STATES).meta({ description: '熔断实时状态（来自 Redis）' }),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowConnector' });

export type WorkflowConnector = z.infer<typeof workflowConnectorSchema>;

/** 连接器调用 / 测试结果 */
export const workflowConnectorInvokeResultSchema = z.object({
  ok: z.boolean(),
  status: z.int().nullable().meta({ description: 'HTTP 状态码（网络层失败为 null）' }),
  durationMs: z.int(),
  responseSnippet: z.string().nullable().meta({ description: '截断的响应体（测试用）' }),
  error: z.string().nullable(),
}).meta({ id: 'WorkflowConnectorInvokeResult' });

export type WorkflowConnectorInvokeResult = z.infer<typeof workflowConnectorInvokeResultSchema>;

/** 连接器调用统计（按时间窗聚合） */
export const workflowConnectorStatsSchema = z.object({
  connectorId: z.int(),
  windowDays: z.int(),
  total: z.int(),
  success: z.int(),
  failed: z.int(),
  successRate: z.number().meta({ description: '成功率 0~1' }),
  avgDurationMs: z.int(),
}).meta({ id: 'WorkflowConnectorStats' });

export type WorkflowConnectorStats = z.infer<typeof workflowConnectorStatsSchema>;

/** 连接器单次调用记录 */
export const workflowConnectorInvocationSchema = z.object({
  id: z.int(),
  source: z.enum(WORKFLOW_CONNECTOR_INVOCATION_SOURCES),
  ok: z.boolean(),
  status: z.int().nullable(),
  durationMs: z.int(),
  requestUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowConnectorInvocation' });

export type WorkflowConnectorInvocation = z.infer<typeof workflowConnectorInvocationSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowConnectorListQuery = paginationQuery.extend({
  type: z.enum(WORKFLOW_CONNECTOR_TYPES).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  keyword: z.string().optional(),
});

export const workflowConnectorStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().meta({ description: '统计窗口天数，默认 7' }),
});

export const workflowConnectorInvocationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().meta({ description: '返回条数，默认 20' }),
});

export const workflowConnectorContract = defineContract('/api/workflows/connectors', {
  list: op.get('/', { query: workflowConnectorListQuery, response: paginated(workflowConnectorSchema), summary: '连接器列表' }),
  detail: op.get('/{id}', { params: idParam, response: workflowConnectorSchema, summary: '连接器详情' }),
  create: op.post('/', { body: createWorkflowConnectorSchema, response: workflowConnectorSchema, summary: '创建连接器' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowConnectorSchema, response: workflowConnectorSchema, summary: '更新连接器' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除连接器' }),
  test: op.post('/{id}/test', { params: idParam, body: testWorkflowConnectorSchema, response: workflowConnectorInvokeResultSchema, summary: '测试连接器调用' }),
  stats: op.get('/{id}/stats', { params: idParam, query: workflowConnectorStatsQuery, response: workflowConnectorStatsSchema, summary: '连接器调用统计' }),
  invocations: op.get('/{id}/invocations', { params: idParam, query: workflowConnectorInvocationsQuery, response: z.array(workflowConnectorInvocationSchema), summary: '连接器最近调用记录' }),
}, { tags: ['流程连接器'] });
