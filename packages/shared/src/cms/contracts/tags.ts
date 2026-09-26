import * as z from 'zod';
import { idParam, keywordQuery, paginated, paginationQuery, requiredIdQuery } from '../../core/api-schemas';
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
  siteId: requiredIdQuery(),
  keyword: keywordQuery(),
  groupName: keywordQuery('分组', { max: 50 }),
});

export const cmsSiteScopeQuery = z.object({
  siteId: requiredIdQuery(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsTagContract = defineContract('/api/cms/tags', {
  list: op.get('/', { access: { permission: 'cms:tag:list' }, query: cmsTagListQuery, response: paginated(cmsTagSchema), summary: '标签分页列表' }),
  all: op.get('/all', { access: { permission: 'cms:content:list' }, query: cmsSiteScopeQuery, response: z.array(cmsTagSchema), summary: '站点全部标签（内容打标下拉）' }),
  detail: op.get('/{id}', { access: { permission: 'cms:tag:list' }, params: idParam, response: cmsTagSchema, summary: '标签详情' }),
  create: op.post('/', { access: { permission: 'cms:tag:create' }, audit: '创建 CMS 标签', body: createCmsTagSchema, response: cmsTagSchema, summary: '创建标签' }),
  update: op.put('/{id}', { access: { permission: 'cms:tag:update' }, audit: '更新 CMS 标签', params: idParam, body: updateCmsTagSchema, response: cmsTagSchema, summary: '更新标签' }),
  remove: op.delete('/{id}', { access: { permission: 'cms:tag:delete' }, audit: '删除 CMS 标签', params: idParam, summary: '删除标签' }),
}, { auditModule: 'CMS内容管理', tags: ['CMS-标签管理'] });
