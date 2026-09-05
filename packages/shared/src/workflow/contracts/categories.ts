import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWorkflowCategorySchema, updateWorkflowCategorySchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const workflowCategorySchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '人事流程' }),
  code: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  sort: z.int(),
  description: z.string().nullable(),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowCategory' });

export type WorkflowCategory = z.infer<typeof workflowCategorySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowCategoryListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
});

export const workflowCategoryContract = defineContract('/api/workflows/categories', {
  list: op.get('/', { query: workflowCategoryListQuery, response: paginated(workflowCategorySchema), summary: '流程分类分页列表' }),
  all: op.get('/all', { response: z.array(workflowCategorySchema), summary: '全部流程分类（不分页）' }),
  detail: op.get('/{id}', { params: idParam, response: workflowCategorySchema, summary: '获取流程分类' }),
  create: op.post('/', { body: createWorkflowCategorySchema, response: workflowCategorySchema, summary: '创建流程分类' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowCategorySchema, response: workflowCategorySchema, summary: '更新流程分类' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除流程分类' }),
}, { tags: ['WorkflowCategories'] });
