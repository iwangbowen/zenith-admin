import * as z from 'zod';
import { auditFieldsSchema, idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { saveWorkflowSimulationCaseSchema, workflowSimulationDecisionSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 已保存的仿真用例（测试场景：表单数据 + 决策 + 发起人，按定义归档，供回归仿真复用） */
export const workflowSimulationCaseSchema = z.object({
  id: z.int(),
  definitionId: z.int(),
  name: z.string(),
  starterUserId: z.int().nullable(),
  formData: z.record(z.string(), z.unknown()),
  decisions: z.array(workflowSimulationDecisionSchema),
  runtimeConfig: saveWorkflowSimulationCaseSchema.shape.runtimeConfig,
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowSimulationCase' });

export type WorkflowSimulationCase = z.infer<typeof workflowSimulationCaseSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowSimulationCaseListQuery = z.object({
  definitionId: z.coerce.number().int().positive().meta({ description: '流程定义 ID', example: 1 }),
});

export const workflowSimulationCaseContract = defineContract('/api/workflows/simulation-cases', {
  list: op.get('/', { access: { permission: 'workflow:definition:list' }, query: workflowSimulationCaseListQuery, response: z.array(workflowSimulationCaseSchema), summary: '按定义列出仿真用例' }),
  save: op.post('/', { access: { permission: 'workflow:definition:edit' }, audit: '保存流程仿真用例', body: saveWorkflowSimulationCaseSchema, response: workflowSimulationCaseSchema, summary: '保存仿真用例（同名覆盖）' }),
  remove: op.delete('/{id}', { access: { permission: 'workflow:definition:edit' }, audit: '删除流程仿真用例', params: idParam, summary: '删除仿真用例' }),
}, { auditModule: '流程仿真', tags: ['流程仿真用例'] });
