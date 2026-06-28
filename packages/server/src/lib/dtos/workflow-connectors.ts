import { z } from '@hono/zod-openapi';

const WORKFLOW_CONNECTOR_TYPES = ['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database'] as const;

/** 连接器（脱敏：仅回传 hasCredentials，绝不回传凭据明文） */
export const WorkflowConnectorDTO = z.object({
  id: z.number().int(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  type: z.enum(WORKFLOW_CONNECTOR_TYPES),
  config: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int(),
  retryMax: z.number().int(),
  circuitBreakerEnabled: z.boolean(),
  failureThreshold: z.number().int(),
  cooldownSec: z.number().int(),
  status: z.enum(['enabled', 'disabled']),
  hasCredentials: z.boolean(),
  breakerState: z.enum(['closed', 'open', 'halfOpen']),
  tenantId: z.number().int().nullable(),
  createdBy: z.number().int().nullable().optional(),
  updatedBy: z.number().int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('WorkflowConnector');

/** 列表查询（叠加 PaginationQuery） */
export const WorkflowConnectorListQuery = z.object({
  type: z.enum(WORKFLOW_CONNECTOR_TYPES).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  keyword: z.string().optional(),
});

/** 调用 / 测试结果 */
export const WorkflowConnectorInvokeResultDTO = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  durationMs: z.number().int(),
  responseSnippet: z.string().nullable(),
  error: z.string().nullable(),
}).openapi('WorkflowConnectorInvokeResult');

/** 调用统计 */
export const WorkflowConnectorStatsDTO = z.object({
  connectorId: z.number().int(),
  windowDays: z.number().int(),
  total: z.number().int(),
  success: z.number().int(),
  failed: z.number().int(),
  successRate: z.number(),
  avgDurationMs: z.number().int(),
}).openapi('WorkflowConnectorStats');

/** 单次调用记录 */
export const WorkflowConnectorInvocationDTO = z.object({
  id: z.number().int(),
  source: z.enum(['test', 'trigger', 'external', 'webhook', 'manual']),
  ok: z.boolean(),
  status: z.number().int().nullable(),
  durationMs: z.number().int(),
  requestUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
}).openapi('WorkflowConnectorInvocation');
