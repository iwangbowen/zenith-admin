import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWorkflowSavedViewSchema, updateWorkflowSavedViewSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 列表保存视图（按页面 key 归档的筛选条件） */
export const workflowSavedViewSchema = z.object({
  id: z.int(),
  userId: z.int(),
  pageKey: z.string().meta({ example: 'workflow-my-applications' }),
  name: z.string(),
  filters: z.record(z.string(), z.unknown()),
  isDefault: z.boolean(),
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowSavedView' });

export type WorkflowSavedView = z.infer<typeof workflowSavedViewSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowSavedViewListQuery = z.object({
  pageKey: z.string().min(1).meta({ description: '页面 key' }),
});

export const workflowSavedViewContract = defineContract('/api/workflows/saved-views', {
  list: op.get('/', { query: workflowSavedViewListQuery, response: z.array(workflowSavedViewSchema), summary: '保存视图列表' }),
  create: op.post('/', { body: createWorkflowSavedViewSchema, response: workflowSavedViewSchema, summary: '保存视图' }),
  update: op.put('/{id}', { params: idParam, body: updateWorkflowSavedViewSchema, response: workflowSavedViewSchema, summary: '更新视图' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除视图' }),
}, { tags: ['WorkflowSavedViews'] });
