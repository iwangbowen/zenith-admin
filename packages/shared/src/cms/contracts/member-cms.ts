import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { memberSubmitCmsCommentSchema } from '../../member/validation';
import { CMS_CONTENT_STATUSES, CMS_CONTENT_TYPES, CMS_SUBSCRIPTION_SUBJECT_TYPES } from '../constants';
import {
  cmsSubscriptionSubjectSchema,
  createCmsContributionSchema,
  submitCmsInteractionSchema,
  updateCmsContributionSchema,
  updateCmsSubscriptionSchema,
} from '../validation';
import { cmsCommentStatusSchema } from './comments';
import { cmsInteractionSubmitResultSchema } from './interactions';
import { cmsMemberSubscriptionSchema } from './subscriptions';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 会员投稿（内容实体的会员侧投影） */
export const cmsContributionSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  channelId: z.int(),
  channelName: z.string().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  coverImage: z.string().nullable(),
  body: z.string().nullable(),
  status: z.enum(CMS_CONTENT_STATUSES),
  rejectReason: z.string().nullable(),
  publishedAt: z.string().nullable(),
  viewCount: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsContribution' });

export type CmsContribution = z.infer<typeof cmsContributionSchema>;

/** 可投稿站点及其开放投稿的栏目 */
export const cmsContribSiteSchema = z.object({
  id: z.int(),
  name: z.string(),
  channels: z.array(z.object({ id: z.int(), name: z.string() })),
}).meta({ id: 'CmsContribSite' });

export type CmsContribSite = z.infer<typeof cmsContribSiteSchema>;

/** 会员对某内容的互动状态（前台详情页交互条用） */
export const cmsInteractionStateSchema = z.object({
  liked: z.boolean(),
  favorited: z.boolean(),
  likeCount: z.int(),
  favoriteCount: z.int(),
}).meta({ id: 'CmsInteractionState' });

export type CmsInteractionState = z.infer<typeof cmsInteractionStateSchema>;

/** 会员收藏 / 浏览历史条目（会员中心列表） */
export const cmsMemberContentItemSchema = z.object({
  contentId: z.int(),
  title: z.string(),
  url: z.string().nullable().meta({ description: '前台详情站内路径（内容已下线/删除时为 null）' }),
  coverThumb: z.string().nullable(),
  contentType: z.enum(CMS_CONTENT_TYPES),
  viewCount: z.int().optional().meta({ description: '浏览历史：累计次数' }),
  createdAt: z.string(),
  updatedAt: z.string().optional().meta({ description: '浏览历史：最近浏览时间' }),
}).meta({ id: 'CmsMemberContentItem' });

export type CmsMemberContentItem = z.infer<typeof cmsMemberContentItemSchema>;

/** 会员端「我的评论」条目 */
export const cmsMemberCommentSchema = z.object({
  id: z.int(),
  contentId: z.int(),
  contentTitle: z.string().nullable(),
  contentUrl: z.string().nullable().meta({ description: '内容前台地址（未绑定域名时为相对路径）' }),
  parentId: z.int(),
  content: z.string(),
  likeCount: z.int(),
  status: cmsCommentStatusSchema,
  createdAt: z.string(),
}).meta({ id: 'CmsMemberComment' });

export type CmsMemberComment = z.infer<typeof cmsMemberCommentSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const memberCmsContributionListQuery = paginationQuery.extend({
  status: z.enum(CMS_CONTENT_STATUSES).optional(),
});

export const memberCmsSubscriptionListQuery = paginationQuery.extend({
  subjectType: z.enum(CMS_SUBSCRIPTION_SUBJECT_TYPES).optional(),
});

export const memberCmsSubscriptionStatusQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  subjectType: z.enum(CMS_SUBSCRIPTION_SUBJECT_TYPES),
  subjectId: z.coerce.number().int().positive().optional(),
  subjectKey: z.string().max(255).optional(),
});

export const memberCmsInteractionSubmitQuery = z.object({
  siteId: z.coerce.number().int().positive(),
});

// ─── 契约（会员登录态 CMS 接口） ───────────────────────────────────────────────

export const memberCmsContract = defineContract('/api/member/cms', {
  channels: op.get('/channels', { response: z.array(cmsContribSiteSchema), summary: '可投稿站点与栏目' }),
  contributions: op.get('/contributions', { query: memberCmsContributionListQuery, response: paginated(cmsContributionSchema), summary: '我的投稿列表' }),
  contribution: op.get('/contributions/{id}', { params: idParam, response: cmsContributionSchema, summary: '投稿详情' }),
  createContribution: op.post('/contributions', { body: createCmsContributionSchema, response: cmsContributionSchema, summary: '提交投稿（进入审核）' }),
  updateContribution: op.put('/contributions/{id}', { params: idParam, body: updateCmsContributionSchema, response: cmsContributionSchema, summary: '修改投稿并重新提交' }),
  removeContribution: op.delete('/contributions/{id}', { params: idParam, summary: '删除投稿（草稿/被驳回）' }),
  interactionState: op.get('/contents/{id}/interaction-state', { params: idParam, response: cmsInteractionStateSchema, summary: '我对内容的互动状态（点赞/收藏 + 计数）' }),
  like: op.post('/contents/{id}/like', { params: idParam, response: cmsInteractionStateSchema, summary: '点赞内容' }),
  unlike: op.delete('/contents/{id}/like', { params: idParam, response: cmsInteractionStateSchema, summary: '取消点赞' }),
  favorite: op.post('/contents/{id}/favorite', { params: idParam, response: cmsInteractionStateSchema, summary: '收藏内容' }),
  unfavorite: op.delete('/contents/{id}/favorite', { params: idParam, response: cmsInteractionStateSchema, summary: '取消收藏' }),
  recordView: op.post('/contents/{id}/view', { params: idParam, summary: '记录浏览历史（去重累计，保留最近 100 条）' }),
  favorites: op.get('/favorites', { query: paginationQuery, response: paginated(cmsMemberContentItemSchema), summary: '我的收藏列表' }),
  viewHistory: op.get('/view-history', { query: paginationQuery, response: paginated(cmsMemberContentItemSchema), summary: '我的浏览历史（最近浏览优先）' }),
  clearViewHistory: op.delete('/view-history', { summary: '清空我的浏览历史' }),
  subscriptions: op.get('/subscriptions', { query: memberCmsSubscriptionListQuery, response: paginated(cmsMemberSubscriptionSchema), summary: '我的 CMS 订阅' }),
  subscriptionStatus: op.get('/subscriptions/status', { query: memberCmsSubscriptionStatusQuery, response: cmsMemberSubscriptionSchema.nullable(), summary: '查询 CMS 订阅状态' }),
  subscribe: op.post('/subscriptions', { body: cmsSubscriptionSubjectSchema, response: cmsMemberSubscriptionSchema, summary: '订阅 CMS 站点/栏目/作者' }),
  updateSubscription: op.put('/subscriptions/{id}', { params: idParam, body: updateCmsSubscriptionSchema, response: cmsMemberSubscriptionSchema, summary: '更新我的订阅通知设置' }),
  cancelSubscription: op.delete('/subscriptions/{id}', { params: idParam, response: cmsMemberSubscriptionSchema, summary: '取消我的 CMS 订阅' }),
  submitComment: op.post('/contents/{id}/comments', { params: idParam, body: memberSubmitCmsCommentSchema, summary: '会员提交评论（进入审核，昵称自动取会员资料）' }),
  comments: op.get('/comments', { query: paginationQuery, response: paginated(cmsMemberCommentSchema), summary: '我的评论列表' }),
  removeComment: op.delete('/comments/{id}', { params: idParam, summary: '删除我的评论' }),
  submitInteraction: op.post('/interactions/{id}/submit', { params: idParam, query: memberCmsInteractionSubmitQuery, body: submitCmsInteractionSchema, response: cmsInteractionSubmitResultSchema, summary: '会员提交互动问卷' }),
}, { tags: ['MemberCms'] });
