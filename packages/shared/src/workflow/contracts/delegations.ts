import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWorkflowDelegationSchema, updateWorkflowDelegationSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 审批代理 / 离岗委托规则 */
export const workflowDelegationSchema = z.object({
  id: z.int(),
  principalId: z.int(),
  principalName: z.string().nullable().optional(),
  delegateId: z.int(),
  delegateName: z.string().nullable().optional(),
  definitionId: z.int().nullable().meta({ description: 'null = 对全部流程生效' }),
  definitionName: z.string().nullable().optional(),
  mode: z.enum(['full', 'suggest']).meta({ description: 'full=代理人直接代批（默认）；suggest=建议制，意见回执给委托人确认' }),
  reason: z.string().nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  enabled: z.boolean(),
  active: z.boolean().optional().meta({ description: '当前是否处于生效区间（由后端计算）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowDelegation' });

export type WorkflowDelegation = z.infer<typeof workflowDelegationSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowDelegationListQuery = paginationQuery.extend({
  principalId: z.coerce.number().int().optional(),
  scope: z.enum(['mine', 'all']).optional().meta({ description: 'mine=我作为委托人 / 代理人的规则；all=全部（需管理权限）' }),
});

export const workflowDelegationContract = defineContract('/api/workflows/delegations', {
  list: op.get('/', { query: workflowDelegationListQuery, response: paginated(workflowDelegationSchema), summary: '审批代理列表' }),
  create: op.post('/', { body: createWorkflowDelegationSchema, response: workflowDelegationSchema, summary: '新增审批代理' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowDelegationSchema, response: workflowDelegationSchema, summary: '更新审批代理' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除审批代理' }),
}, { tags: ['WorkflowDelegations'] });
