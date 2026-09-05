import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  createCmsErrorProneWordSchema,
  createCmsSensitiveWordSchema,
  updateCmsErrorProneWordSchema,
  updateCmsSensitiveWordSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsSensitiveWordSchema = z.object({
  id: z.int(),
  word: z.string(),
  replaceWith: z.string().nullable(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsSensitiveWord' });

export type CmsSensitiveWord = z.infer<typeof cmsSensitiveWordSchema>;

/** CMS 易错词（编辑辅助：错误词 → 正确词） */
export const cmsErrorProneWordSchema = z.object({
  id: z.int(),
  word: z.string().meta({ example: '登陆系统' }),
  correction: z.string().meta({ example: '登录系统' }),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsErrorProneWord' });

export type CmsErrorProneWord = z.infer<typeof cmsErrorProneWordSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

/** 敏感词 / 易错词为平台级词库，不按站点过滤 */
export const cmsWordListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: entityStatusSchema.optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsSensitiveWordContract = defineContract('/api/cms/sensitive-words', {
  list: op.get('/', { query: cmsWordListQuery, response: paginated(cmsSensitiveWordSchema), summary: '敏感词分页列表' }),
  create: op.post('/', { body: createCmsSensitiveWordSchema, response: cmsSensitiveWordSchema, summary: '创建敏感词' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsSensitiveWordSchema, response: cmsSensitiveWordSchema, summary: '更新敏感词' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除敏感词' }),
}, { tags: ['CMS-敏感词库'] });

export const cmsErrorProneWordContract = defineContract('/api/cms/error-prone-words', {
  list: op.get('/', { query: cmsWordListQuery, response: paginated(cmsErrorProneWordSchema), summary: '易错词分页列表' }),
  create: op.post('/', { body: createCmsErrorProneWordSchema, response: cmsErrorProneWordSchema, summary: '新增易错词' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsErrorProneWordSchema, response: cmsErrorProneWordSchema, summary: '更新易错词' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除易错词' }),
}, { tags: ['CMS-易错词库'] });
