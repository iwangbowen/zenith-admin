import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_TRIGGER_EXECUTION_STATUSES, WORKFLOW_TRIGGER_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 触发器节点执行记录 */
export const workflowTriggerExecutionSchema = z.object({
  id: z.int(),
  instanceId: z.int(),
  instanceTitle: z.string().nullable().meta({ description: '实例标题（实例被清理后为 null）' }),
  taskId: z.int().nullable(),
  nodeKey: z.string(),
  nodeName: z.string().nullable(),
  triggerType: z.enum(WORKFLOW_TRIGGER_TYPES),
  status: z.enum(WORKFLOW_TRIGGER_EXECUTION_STATUSES),
  attempt: z.int(),
  requestUrl: z.string().nullable(),
  requestMethod: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseStatus: z.int().nullable(),
  responseBody: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.int().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowTriggerExecution' });

export type WorkflowTriggerExecution = z.infer<typeof workflowTriggerExecutionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowTriggerExecutionListQuery = paginationQuery.extend({
  instanceId: z.coerce.number().int().optional(),
  nodeKey: z.string().optional(),
  status: z.enum(WORKFLOW_TRIGGER_EXECUTION_STATUSES).optional(),
});

export const workflowTriggerExecutionContract = defineContract('/api/workflows/trigger-executions', {
  list: op.get('/', { query: workflowTriggerExecutionListQuery, response: paginated(workflowTriggerExecutionSchema), summary: '获取触发器执行记录列表' }),
  detail: op.get('/{id}', { params: idParam, response: workflowTriggerExecutionSchema, summary: '获取触发器执行记录详情' }),
}, { tags: ['WorkflowTriggerExecutions'] });
