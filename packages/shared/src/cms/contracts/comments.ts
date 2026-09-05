import * as z from 'zod';
import { batchIdsBody, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CMS_COMMENT_STATUSES } from '../constants';
import { cmsSiteScopeQuery } from './tags';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsCommentStatusSchema = z.enum(CMS_COMMENT_STATUSES);

export const cmsCommentSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  contentId: z.int(),
  contentTitle: z.string().nullable().optional(),
  parentId: z.int().meta({ description: '父评论 id，0 = 顶级' }),
  parentNickname: z.string().nullable().optional(),
  memberId: z.int().nullable().meta({ description: '会员评论：非空表示由登录会员提交' }),
  memberUsername: z.string().nullable().optional(),
  nickname: z.string(),
  content: z.string(),
  likeCount: z.int(),
  status: cmsCommentStatusSchema,
  riskFlag: z.string().nullable().meta({ description: '风控标注：watchlist=命中观察灰名单' }),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsComment' });

export type CmsComment = z.infer<typeof cmsCommentSchema>;

export const cmsPendingCommentCountSchema = z.object({
  count: z.int(),
}).meta({ id: 'CmsPendingCommentCount' });

export type CmsPendingCommentCount = z.infer<typeof cmsPendingCommentCountSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsCommentListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  status: cmsCommentStatusSchema.optional(),
  source: z.enum(['member', 'guest']).optional().meta({ description: '来源筛选：member=会员评论 guest=游客评论' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsCommentContract = defineContract('/api/cms/comments', {
  list: op.get('/', { query: cmsCommentListQuery, response: paginated(cmsCommentSchema), summary: '评论分页列表' }),
  pendingCount: op.get('/pending-count', { query: cmsSiteScopeQuery, response: cmsPendingCommentCountSchema, summary: '待审核评论数' }),
  approve: op.post('/approve', { body: batchIdsBody, summary: '批量审核通过（同步刷新详情页静态文件）' }),
  reject: op.post('/reject', { body: batchIdsBody, summary: '批量拒绝' }),
  batchDelete: op.post('/delete', { body: batchIdsBody, summary: '批量删除' }),
}, { tags: ['CMS-评论管理'] });
