import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MP_DRAFT_STATUSES } from '../constants';
import { createMpDraftSchema, mpArticleSchema, updateMpDraftSchema } from '../validation';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpDraftSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  title: z.string().meta({ description: '取首篇文章标题' }),
  articles: z.array(mpArticleSchema),
  wechatMediaId: z.string().nullable().meta({ description: '推送到微信草稿箱后回填的 media_id' }),
  status: z.enum(MP_DRAFT_STATUSES),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpDraft' });

export type MpDraft = z.infer<typeof mpDraftSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpDraftListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  keyword: z.string().optional().meta({ description: '按标题模糊匹配' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpDraftContract = defineContract('/api/mp/drafts', {
  list: op.get('/', { query: mpDraftListQuery, response: paginated(mpDraftSchema), summary: '图文草稿列表' }),
  detail: op.get('/{id}', { params: idParam, response: mpDraftSchema, summary: '图文草稿详情' }),
  create: op.post('/', { body: createMpDraftSchema, response: mpDraftSchema, summary: '创建图文草稿' }),
  update: op.put('/{id}', { params: idParam, body: updateMpDraftSchema, response: mpDraftSchema, summary: '更新图文草稿' }),
  push: op.post('/{id}/push', { params: idParam, response: mpDraftSchema, summary: '推送到微信草稿箱' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除图文草稿' }),
}, { tags: ['公众号图文'] });
