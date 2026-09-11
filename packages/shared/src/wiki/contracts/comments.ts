import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { lazyRecursive } from '../../core/validation';
import { WIKI_COMMENT_STATUSES, type WikiCommentStatus } from '../constants';
import { createWikiCommentSchema, updateWikiCommentStatusSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 评论；评论树中顶层评论携带二级回复，自引用结构，类型需手写供递归 schema 标注 */
export type WikiComment = {
  id: number;
  docId: number;
  /** 所属文档标题（评论管理列表返回） */
  docTitle?: string;
  parentId: number | null;
  content: string;
  status: WikiCommentStatus;
  mentionedUserIds: number[];
  isQuestion: boolean;
  resolvedAt: string | null;
  authorId: number | null;
  authorName: string | null;
  /** 二级回复（文档评论树返回） */
  replies?: WikiComment[];
  createdAt: string;
};

export const wikiCommentSchema: z.ZodType<WikiComment> = lazyRecursive(() => z.object({
  id: z.int(),
  docId: z.int(),
  docTitle: z.string().optional(),
  parentId: z.int().nullable(),
  content: z.string(),
  status: z.enum(WIKI_COMMENT_STATUSES),
  mentionedUserIds: z.array(z.int()),
  isQuestion: z.boolean(),
  resolvedAt: z.string().nullable(),
  authorId: z.int().nullable(),
  authorName: z.string().nullable(),
  replies: z.array(wikiCommentSchema).optional(),
  createdAt: z.string(),
})).meta({ id: 'WikiComment' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const wikiCommentListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按评论内容模糊匹配' }),
  status: queryEnum(WIKI_COMMENT_STATUSES),
  docId: z.coerce.number().int().positive().optional(),
  startTime: dateRangeBound('评论时间起'),
  endTime: dateRangeBound('评论时间止'),
});

export const wikiCommentContract = defineContract('/api/wiki/comments', {
  docComments: op.get('/doc/{id}', { params: idParam, response: z.array(wikiCommentSchema), summary: '文档评论树' }),
  deleteMine: op.delete('/mine/{id}', { params: idParam, summary: '删除自己的评论' }),
  list: op.get('/', { query: wikiCommentListQuery, response: paginated(wikiCommentSchema), summary: '评论管理列表' }),
  create: op.post('/', { body: createWikiCommentSchema, response: wikiCommentSchema, summary: '发表评论 / 回复（支持 @提及与问题标记）' }),
  resolve: op.post('/{id}/resolve', { params: idParam, response: wikiCommentSchema, summary: '标记问题评论为已解决' }),
  updateStatus: op.put('/{id}/status', { params: idParam, body: updateWikiCommentStatusSchema, response: wikiCommentSchema, summary: '隐藏 / 恢复评论' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除评论（管理端）' }),
}, { tags: ['知识中心-评论'] });
