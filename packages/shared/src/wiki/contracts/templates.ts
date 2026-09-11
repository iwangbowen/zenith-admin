import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createWikiTemplateSchema, updateWikiTemplateSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const wikiTemplateSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '会议纪要' }),
  description: z.string().nullable(),
  content: z.string().meta({ description: 'Markdown 模板正文' }),
  status: entityStatusSchema,
  sort: z.int(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WikiTemplate' });

export type WikiTemplate = z.infer<typeof wikiTemplateSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const wikiTemplateListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 描述模糊匹配' }),
  status: entityStatusQuery,
});

export const wikiTemplateContract = defineContract('/api/wiki/templates', {
  list: op.get('/', { query: wikiTemplateListQuery, response: paginated(wikiTemplateSchema), summary: '文档模板列表' }),
  all: op.get('/all', { response: z.array(wikiTemplateSchema), summary: '全部启用模板（编辑器选用）' }),
  detail: op.get('/{id}', { params: idParam, response: wikiTemplateSchema, summary: '模板详情' }),
  create: op.post('/', { body: createWikiTemplateSchema, response: wikiTemplateSchema, summary: '创建模板' }),
  update: op.put('/{id}', { params: idParam, body: updateWikiTemplateSchema, response: wikiTemplateSchema, summary: '更新模板' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除模板' }),
}, { tags: ['知识中心-模板'] });
