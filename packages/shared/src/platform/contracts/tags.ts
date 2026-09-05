import * as z from 'zod';
import { batchIdsBody, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createTagSchema, updateTagSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const tagSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '重要' }),
  color: z.string().nullable().meta({ example: '#2563eb' }),
  groupName: z.string().nullable().meta({ example: '用户标签' }),
  description: z.string().nullable(),
  status: entityStatusSchema,
  sortOrder: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Tag' });

export type Tag = z.infer<typeof tagSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const tagListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 描述模糊匹配' }),
  status: entityStatusSchema.optional(),
  groupName: z.string().optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const tagContract = defineContract('/api/tags', {
  list: op.get('/', { query: tagListQuery, response: paginated(tagSchema), summary: '标签列表' }),
  groups: op.get('/groups', { response: z.array(z.string()), summary: '获取标签分组列表' }),
  detail: op.get('/{id}', { params: idParam, response: tagSchema, summary: '标签详情' }),
  create: op.post('/', { body: createTagSchema, response: tagSchema, summary: '创建标签' }),
  update: op.put('/{id}', { params: idParam, body: updateTagSchema, response: tagSchema, summary: '更新标签' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除标签' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除标签' }),
}, { tags: ['Tags'] });
