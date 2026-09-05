import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MP_AUTO_REPLY_MATCH_TYPES, MP_AUTO_REPLY_TYPES, MP_REPLY_CONTENT_TYPES } from '../constants';
import { createMpAutoReplySchema, mpReplyArticleSchema, updateMpAutoReplySchema } from '../validation';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpAutoReplySchema = z.object({
  id: z.int(),
  accountId: z.int(),
  replyType: z.enum(MP_AUTO_REPLY_TYPES),
  keyword: z.string().nullable(),
  matchType: z.enum(MP_AUTO_REPLY_MATCH_TYPES),
  contentType: z.enum(MP_REPLY_CONTENT_TYPES),
  content: z.string().nullable(),
  mediaId: z.string().nullable(),
  newsArticles: z.array(mpReplyArticleSchema).nullable(),
  transferToKf: z.boolean(),
  status: entityStatusSchema,
  sort: z.int(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpAutoReply' });

export type MpAutoReply = z.infer<typeof mpAutoReplySchema>;

/** 未命中任何关键词回复的粉丝提问热词（按账号 + 关键词累计） */
export const mpUnmatchedKeywordSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  keyword: z.string(),
  count: z.int(),
  lastAt: z.string(),
}).meta({ id: 'MpUnmatchedKeyword' });

export type MpUnmatchedKeyword = z.infer<typeof mpUnmatchedKeywordSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpAutoReplyListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  replyType: z.enum(MP_AUTO_REPLY_TYPES).optional(),
  keyword: z.string().optional().meta({ description: '按关键词模糊匹配' }),
});

export const mpUnmatchedKeywordListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpAutoReplyContract = defineContract('/api/mp/auto-replies', {
  unmatched: op.get('/unmatched', { query: mpUnmatchedKeywordListQuery, response: paginated(mpUnmatchedKeywordSchema), summary: '未命中热词列表' }),
  removeUnmatched: op.delete('/unmatched/{id}', { params: idParam, summary: '删除未命中热词' }),
  list: op.get('/', { query: mpAutoReplyListQuery, response: paginated(mpAutoReplySchema), summary: '自动回复列表' }),
  create: op.post('/', { body: createMpAutoReplySchema, response: mpAutoReplySchema, summary: '创建自动回复' }),
  update: op.put('/{id}', { params: idParam, body: updateMpAutoReplySchema, response: mpAutoReplySchema, summary: '更新自动回复' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除自动回复' }),
}, { tags: ['公众号自动回复'] });
