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
  list: op.get('/', { query: workflowSimulationCaseListQuery, response: z.array(workflowSimulationCaseSchema), summary: '按定义列出仿真用例' }),
  save: op.post('/', { body: saveWorkflowSimulationCaseSchema, response: workflowSimulationCaseSchema, summary: '保存仿真用例（同名覆盖）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除仿真用例' }),
}, { tags: ['流程仿真用例'] });
