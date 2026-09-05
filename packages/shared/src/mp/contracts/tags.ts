import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createMpTagSchema, mpAccountIdBody, updateMpTagSchema } from '../validation';
import { mpAccountIdQuery, mpSyncResultSchema } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpTagSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  wechatTagId: z.int().nullable().meta({ description: '微信侧标签 ID，未同步为 null' }),
  name: z.string(),
  fansCount: z.int(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpTag' });

export type MpTag = z.infer<typeof mpTagSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpTagListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  keyword: z.string().optional().meta({ description: '按标签名模糊匹配' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpTagContract = defineContract('/api/mp/tags', {
  list: op.get('/', { query: mpTagListQuery, response: paginated(mpTagSchema), summary: '标签列表' }),
  sync: op.post('/sync', { body: mpAccountIdBody, response: mpSyncResultSchema, summary: '从微信同步标签' }),
  create: op.post('/', { body: createMpTagSchema, response: mpTagSchema, summary: '创建标签' }),
  update: op.put('/{id}', { params: idParam, body: updateMpTagSchema, response: mpTagSchema, summary: '更新标签' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除标签' }),
}, { tags: ['公众号标签'] });
