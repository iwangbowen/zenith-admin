/**
 * 工作流事件订阅 / 投递 / 触发器执行 / 外部回调 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const WorkflowEventSubscriptionDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    definitionId: z.number().int().nullable(),
    definitionName: z.string().nullable().optional(),
    events: z.array(z.string()),
    url: z.string(),
    /** 已脱敏后的 secret 字符串，例如 `abcd****wxyz` */
    secretMasked: z.string().nullable(),
    signMode: z.enum(['hmacSha256', 'none']),
    headers: z.record(z.string(), z.string()).nullable(),
    enabled: z.boolean(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowEventSubscription');

export const WorkflowEventSubscriptionSecretDTO = z
  .object({
    id: z.number().int(),
    secret: z.string().nullable(),
  })
  .openapi('WorkflowEventSubscriptionSecret');

export const WorkflowEventDeliveryDTO = z
  .object({
    id: z.number().int(),
    subscriptionId: z.number().int(),
    subscriptionName: z.string().nullable().optional(),
    instanceId: z.number().int().nullable(),
    taskId: z.number().int().nullable(),
    eventId: z.string(),
    eventType: z.string(),
    payload: z.unknown().nullable(),
    attempt: z.number().int(),
    status: z.enum(['pending', 'success', 'failed', 'retrying']),
    requestUrl: z.string().nullable(),
    requestHeaders: z.record(z.string(), z.string()).nullable(),
    responseStatus: z.number().int().nullable(),
    responseBody: z.string().nullable(),
    errorMessage: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    nextRetryAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowEventDelivery');

export const WorkflowTriggerExecutionDTO = z
  .object({
    id: z.number().int(),
    instanceId: z.number().int(),
    taskId: z.number().int().nullable(),
    nodeKey: z.string(),
    nodeName: z.string().nullable(),
    triggerType: z.string(),
    status: z.enum(['pending', 'running', 'success', 'failed', 'retrying']),
    attempt: z.number().int(),
    requestUrl: z.string().nullable(),
    requestMethod: z.string().nullable(),
    requestBody: z.string().nullable(),
    responseStatus: z.number().int().nullable(),
    responseBody: z.string().nullable(),
    errorMessage: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    tenantId: z.number().int().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTriggerExecution');
