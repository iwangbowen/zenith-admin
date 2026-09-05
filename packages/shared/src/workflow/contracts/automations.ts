import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_AUTOMATION_TRIGGERS } from '../constants';
import { createWorkflowAutomationSchema, updateWorkflowAutomationSchema, workflowAutomationActionSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 流程级自动化规则 */
export const workflowAutomationSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  definitionName: z.string().nullable().optional(),
  name: z.string(),
  trigger: z.enum(WORKFLOW_AUTOMATION_TRIGGERS),
  actions: z.array(workflowAutomationActionSchema),
  status: z.enum(['enabled', 'disabled']),
  sort: z.int(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowAutomation' });

export type WorkflowAutomation = z.infer<typeof workflowAutomationSchema>;

/** 自动化动作执行记录（每个动作执行一次记一行） */
export const workflowAutomationRunSchema = z.object({
  id: z.int(),
  ruleId: z.int().nullable(),
  ruleName: z.string(),
  instanceId: z.int().nullable(),
  instanceTitle: z.string().nullable(),
  trigger: z.enum(WORKFLOW_AUTOMATION_TRIGGERS),
  actionIndex: z.int(),
  actionType: z.string(),
  status: z.enum(['success', 'failed', 'skipped']).meta({ description: 'success=执行成功 failed=执行失败 skipped=幂等去重跳过' }),
  error: z.string().nullable(),
  durationMs: z.int().nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowAutomationRun' });

export type WorkflowAutomationRun = z.infer<typeof workflowAutomationRunSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowAutomationListQuery = paginationQuery.extend({
  definitionId: z.coerce.number().int().optional(),
  trigger: z.enum(WORKFLOW_AUTOMATION_TRIGGERS).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

export const workflowAutomationRunListQuery = paginationQuery.extend({
  ruleId: z.coerce.number().int().optional(),
  instanceId: z.coerce.number().int().optional(),
  status: z.enum(['success', 'failed', 'skipped']).optional(),
});

export const workflowAutomationContract = defineContract('/api/workflows/automations', {
  list: op.get('/', { query: workflowAutomationListQuery, response: paginated(workflowAutomationSchema), summary: '流程自动化规则分页列表' }),
  runs: op.get('/runs', { query: workflowAutomationRunListQuery, response: paginated(workflowAutomationRunSchema), summary: '自动化动作执行记录' }),
  detail: op.get('/{id}', { params: idParam, response: workflowAutomationSchema, summary: '获取自动化规则' }),
  create: op.post('/', { body: createWorkflowAutomationSchema, response: workflowAutomationSchema, summary: '创建自动化规则' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowAutomationSchema, response: workflowAutomationSchema, summary: '更新自动化规则' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除自动化规则' }),
  batchDelete: op.post('/batch-delete', { body: batchIdsBody, summary: '批量删除自动化规则' }),
}, { tags: ['WorkflowAutomations'] });
