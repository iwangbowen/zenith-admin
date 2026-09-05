import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { cloneFromTemplateSchema, createWorkflowTemplateSchema, saveAsTemplateSchema, updateWorkflowTemplateSchema } from '../validation';
import { workflowDefinitionSchema } from './definitions';
import { workflowFlowDataSchema, workflowFormSchemaShape } from './flow-data';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 流程模板 */
export const workflowTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  categoryName: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  flowData: workflowFlowDataSchema.nullable(),
  formSchema: workflowFormSchemaShape.nullable(),
  sort: z.int(),
  builtin: z.boolean().meta({ description: '内置模板不可删除' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowTemplate' });

export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowTemplateContract = defineContract('/api/workflows/templates', {
  list: op.get('/', { response: z.array(workflowTemplateSchema), summary: '流程模板列表' }),
  create: op.post('/', { body: createWorkflowTemplateSchema, response: workflowTemplateSchema, summary: '新增模板' }),
  saveAs: op.post('/save-as', { body: saveAsTemplateSchema, response: workflowTemplateSchema, summary: '将流程定义另存为模板' }),
  clone: op.post('/{id}/clone', { params: idParam, body: cloneFromTemplateSchema, response: workflowDefinitionSchema, summary: '从模板创建流程' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowTemplateSchema, response: workflowTemplateSchema, summary: '更新模板' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除模板' }),
}, { tags: ['WorkflowTemplates'] });
