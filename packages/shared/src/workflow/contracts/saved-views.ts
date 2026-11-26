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
  list: op.get('/', { access: { permission: 'workflow:instance:list' }, query: workflowSavedViewListQuery, response: z.array(workflowSavedViewSchema), summary: '保存视图列表' }),
  create: op.post('/', { access: { permission: 'workflow:instance:collaborate' }, audit: '保存工作流视图', body: createWorkflowSavedViewSchema, response: workflowSavedViewSchema, summary: '保存视图' }),
  update: op.put('/{id}', { access: { permission: 'workflow:instance:collaborate' }, audit: '更新工作流视图', params: idParam, body: updateWorkflowSavedViewSchema, response: workflowSavedViewSchema, summary: '更新视图' }),
  remove: op.delete('/{id}', { access: { permission: 'workflow:instance:collaborate' }, audit: '删除工作流视图', params: idParam, summary: '删除视图' }),
}, { auditModule: '工作流管理', tags: ['WorkflowSavedViews'] });
