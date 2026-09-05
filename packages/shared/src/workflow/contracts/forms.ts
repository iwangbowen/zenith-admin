import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWorkflowFormSchema, updateWorkflowFormSchema } from '../validation';
import { workflowFormSchemaShape } from './flow-data';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 表单库实体 */
export const workflowFormSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '请假申请表' }),
  code: z.string().nullable(),
  description: z.string().nullable(),
  categoryId: z.int().nullable(),
  categoryName: z.string().nullable().optional(),
  schema: workflowFormSchemaShape.nullable(),
  status: z.enum(['enabled', 'disabled']),
  revision: z.int().meta({ description: '乐观锁版本号（每次更新 +1，更新时回传 expectedRevision 做并发冲突检测）' }),
  usageCount: z.int().optional().meta({ description: '被多少个流程定义引用（列表场景返回）' }),
  tenantId: z.int().nullable(),
  ...auditFieldsSchema,
  createdByName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowForm' });

export type WorkflowForm = z.infer<typeof workflowFormSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowFormListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
  status: z.enum(['enabled', 'disabled']).optional(),
  categoryId: z.coerce.number().int().optional(),
});

export const workflowFormContract = defineContract('/api/workflows/forms', {
  list: op.get('/', { query: workflowFormListQuery, response: paginated(workflowFormSchema), summary: '表单分页列表' }),
  enabled: op.get('/enabled', { response: z.array(workflowFormSchema), summary: '全部启用表单（流程设计选用）' }),
  detail: op.get('/{id}', { params: idParam, response: workflowFormSchema, summary: '获取表单详情' }),
  create: op.post('/', { body: createWorkflowFormSchema, response: workflowFormSchema, summary: '创建表单' }),
  duplicate: op.post('/{id}/duplicate', { params: idParam, response: workflowFormSchema, summary: '复制表单' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowFormSchema, response: workflowFormSchema, summary: '更新表单' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除表单' }),
}, { tags: ['WorkflowForms'] });
