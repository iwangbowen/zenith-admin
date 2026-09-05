import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createCmsTagSchema, updateCmsTagSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsTagSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  name: z.string().meta({ example: '行业动态' }),
  slug: z.string().meta({ example: 'industry' }),
  groupName: z.string().nullable().meta({ description: '标签分组（可空；同组标签聚合管理）' }),
  contentCount: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsTag' });

export type CmsTag = z.infer<typeof cmsTagSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsTagListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
});

export const cmsSiteScopeQuery = z.object({
  siteId: z.coerce.number().int().positive(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsTagContract = defineContract('/api/cms/tags', {
  list: op.get('/', { query: cmsTagListQuery, response: paginated(cmsTagSchema), summary: '标签分页列表' }),
  all: op.get('/all', { query: cmsSiteScopeQuery, response: z.array(cmsTagSchema), summary: '站点全部标签（内容打标下拉）' }),
  detail: op.get('/{id}', { params: idParam, response: cmsTagSchema, summary: '标签详情' }),
  create: op.post('/', { body: createCmsTagSchema, response: cmsTagSchema, summary: '创建标签' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsTagSchema, response: cmsTagSchema, summary: '更新标签' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除标签' }),
}, { tags: ['CMS-标签管理'] });
