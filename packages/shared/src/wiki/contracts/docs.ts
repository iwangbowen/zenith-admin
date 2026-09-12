import * as z from 'zod';
import { auditFieldsSchema, idParam, idQuery, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { lazyRecursive } from '../../core/validation';
import { businessFileSchema } from '../../platform/contracts';
import { WIKI_DOC_STATUSES, WIKI_REVIEW_ACTIONS, type WikiDocStatus } from '../constants';
import {
  createWikiDocSchema,
  favoriteWikiDocSchema,
  moveWikiDocSchema,
  reportWikiSearchClickSchema,
  reviewWikiDocSchema,
  rollbackWikiDocSchema,
  subscribeWikiDocSchema,
  updateWikiDocSchema,
} from '../validation';
import { wikiDocTagSchema } from './tags';

// ─── 跨域引用：用户预览（本域精简形态） ───────────────────────────────────────

export const wikiUserRefSchema = z.object({
  userId: z.int(),
  nickname: z.string(),
}).meta({ id: 'WikiUserRef' });

export type WikiUserRef = z.infer<typeof wikiUserRefSchema>;

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const wikiDocSchema = z.object({
  id: z.int(),
  spaceId: z.int(),
  spaceName: z.string().optional(),
  parentId: z.int().nullable(),
  title: z.string().meta({ example: '新员工入职指南' }),
  summary: z.string().nullable(),
  content: z.string().optional().meta({ description: 'Markdown 正文；详情与写操作响应返回，列表省略' }),
  status: z.enum(WIKI_DOC_STATUSES),
  rejectReason: z.string().nullable(),
  sort: z.int(),
  isPinned: z.boolean(),
  viewCount: z.int(),
  currentVersion: z.int(),
  revision: z.int().meta({ description: '乐观锁版本：保存时回传，服务端不一致返回 409' }),
  requireReadReceipt: z.boolean().meta({ description: '发布后要求读者确认已读' }),
  ownerId: z.int().nullable().meta({ description: '内容负责人（治理）' }),
  ownerName: z.string().nullable(),
  expireAt: z.string().nullable().meta({ description: '有效期（治理）' }),
  reviewCycleDays: z.int().nullable().meta({ description: '复审周期天数（治理）' }),
  nextReviewAt: z.string().nullable().meta({ description: '下次复审时间（治理）' }),
  isArchived: z.boolean().meta({ description: '已归档：默认从树 / 列表 / 搜索隐藏' }),
  publishedAt: z.string().nullable(),
  deletedAt: z.string().nullable().meta({ description: '非空即在回收站' }),
  tags: z.array(wikiDocTagSchema),
  tagIds: z.array(z.int()),
  authorName: z.string().nullable(),
  attachments: z.array(businessFileSchema).optional().meta({ description: '附件（详情返回；business_type = wiki_doc）' }),
  snippet: z.string().optional().meta({ description: '正文命中片段（全文检索返回）' }),
  favorited: z.boolean().optional().meta({ description: '当前用户是否已收藏（详情返回）' }),
  favoriteCount: z.int().optional(),
  commentCount: z.int().optional(),
  commentsEnabled: z.boolean().optional().meta({ description: '当前是否允许发表评论（详情返回）' }),
  subscribed: z.boolean().optional().meta({ description: '当前用户是否已订阅（详情返回）' }),
  readConfirmed: z.boolean().optional().meta({ description: '当前用户是否已确认已读（详情返回）' }),
  readReceiptCount: z.int().optional().meta({ description: '已确认人数（详情返回）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WikiDoc' });

export type WikiDoc = z.infer<typeof wikiDocSchema>;

/** 目录树节点（不含正文）；自引用结构，类型需手写供递归 schema 标注 */
export type WikiDocTreeNode = {
  id: number;
  parentId: number | null;
  title: string;
  status: WikiDocStatus;
  isPinned: boolean;
  sort: number;
  /** 作者：editor 角色只能操作自己创建的文档，树节点操作菜单据此收敛 */
  createdBy: number | null;
  children?: WikiDocTreeNode[];
};

export const wikiDocTreeNodeSchema: z.ZodType<WikiDocTreeNode> = lazyRecursive(() => z.object({
  id: z.int(),
  parentId: z.int().nullable(),
  title: z.string(),
  status: z.enum(WIKI_DOC_STATUSES),
  isPinned: z.boolean(),
  sort: z.int(),
  createdBy: z.int().nullable(),
  children: z.array(wikiDocTreeNodeSchema).optional(),
})).meta({ id: 'WikiDocTreeNode' });

export const wikiDocVersionSchema = z.object({
  id: z.int(),
  docId: z.int(),
  version: z.int(),
  title: z.string(),
  content: z.string().optional().meta({ description: '版本正文；版本详情返回，列表省略' }),
  changeNote: z.string().nullable(),
  authorId: z.int().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WikiDocVersion' });

export type WikiDocVersion = z.infer<typeof wikiDocVersionSchema>;

export const wikiReviewRecordSchema = z.object({
  id: z.int(),
  docId: z.int(),
  docTitle: z.string().optional().meta({ description: '文档标题（我处理过的审核记录返回）' }),
  version: z.int(),
  action: z.enum(WIKI_REVIEW_ACTIONS),
  actorId: z.int().nullable().optional().meta({ description: '操作人（审核时间线返回）' }),
  actorName: z.string().nullable().optional(),
  reason: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WikiReviewRecord' });

export type WikiReviewRecord = z.infer<typeof wikiReviewRecordSchema>;

/** 阅读确认名单（作者 / 空间管理员可见） */
export const wikiDocReadReceiptsSchema = z.object({
  confirmed: z.array(z.object({ ...wikiUserRefSchema.shape, confirmedAt: z.string() })),
  unconfirmed: z.array(wikiUserRefSchema),
}).meta({ id: 'WikiDocReadReceipts' });

export type WikiDocReadReceipts = z.infer<typeof wikiDocReadReceiptsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const wikiDocListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按标题 / 摘要 / 正文模糊匹配' }),
  spaceId: idQuery(),
  status: queryEnum(WIKI_DOC_STATUSES),
  tagId: idQuery(),
  mine: queryBool('只查当前用户创建的文档'),
  submitted: queryBool('只查当前用户提交过审核的文档'),
});

export const wikiDocSearchQuery = paginationQuery.extend({
  keyword: z.string().min(1).meta({ description: '检索关键词', example: '入职' }),
  spaceId: idQuery(),
  status: queryEnum(WIKI_DOC_STATUSES),
  tagId: idQuery(),
});

export const wikiDocTreeQuery = z.object({
  spaceId: z.coerce.number().int().positive().meta({ description: '知识空间 ID', example: 1 }),
});

export const wikiDocFavoriteListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按标题 / 摘要模糊匹配' }),
});

export const wikiDocVersionParams = idParam.extend({
  version: z.coerce.number().int().positive().meta({ description: '版本号', example: 1 }),
});

export const wikiDocContract = defineContract('/api/wiki/docs', {
  list: op.get('/', { query: wikiDocListQuery, response: paginated(wikiDocSchema), summary: '文档列表（搜索 / 管理）' }),
  search: op.get('/search', { query: wikiDocSearchQuery, response: paginated(wikiDocSchema), summary: '全文检索（标题>摘要>正文加权，返回命中片段）' }),
  reportSearchClick: op.post('/search/click', { body: reportWikiSearchClickSchema, summary: '搜索点击回报（统计搜索成功率）' }),
  recent: op.get('/recent', { response: z.array(wikiDocSchema), summary: '最近访问的文档' }),
  processedReviews: op.get('/reviews/processed', { query: paginationQuery, response: paginated(wikiReviewRecordSchema), summary: '我处理过的审核记录' }),
  tree: op.get('/tree', { query: wikiDocTreeQuery, response: z.array(wikiDocTreeNodeSchema), summary: '空间目录树' }),
  favorites: op.get('/favorites', { query: wikiDocFavoriteListQuery, response: paginated(wikiDocSchema), summary: '我的收藏' }),
  recycle: op.get('/recycle', { query: wikiDocListQuery, response: paginated(wikiDocSchema), summary: '回收站列表' }),
  detail: op.get('/{id}', { params: idParam, response: wikiDocSchema, summary: '文档详情（含正文）' }),
  create: op.post('/', { body: createWikiDocSchema, response: wikiDocSchema, summary: '创建文档' }),
  update: op.put('/{id}', { params: idParam, body: updateWikiDocSchema, response: wikiDocSchema, summary: '更新文档（正文变更自动生成版本）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除文档（移入回收站）' }),
  move: op.post('/{id}/move', { params: idParam, body: moveWikiDocSchema, response: wikiDocSchema, summary: '移动文档' }),
  submit: op.post('/{id}/submit', { params: idParam, response: wikiDocSchema, summary: '提交发布（审批关闭时直接发布）' }),
  withdraw: op.post('/{id}/withdraw', { params: idParam, response: wikiDocSchema, summary: '撤回审核（pending → draft，仅提交人）' }),
  review: op.post('/{id}/review', { params: idParam, body: reviewWikiDocSchema, response: wikiDocSchema, summary: '审核文档（通过 / 驳回）' }),
  favorite: op.post('/{id}/favorite', { params: idParam, body: favoriteWikiDocSchema, summary: '收藏 / 取消收藏' }),
  subscribe: op.post('/{id}/subscribe', { params: idParam, body: subscribeWikiDocSchema, summary: '订阅 / 取消订阅（发布与评论时站内信通知）' }),
  confirmRead: op.post('/{id}/read-receipt', { params: idParam, summary: '确认已读' }),
  readReceipts: op.get('/{id}/read-receipts', { params: idParam, response: wikiDocReadReceiptsSchema, summary: '已读名单（作者/空间管理员）' }),
  reviewRecords: op.get('/{id}/review-records', { params: idParam, response: z.array(wikiReviewRecordSchema), summary: '审核时间线' }),
  view: op.post('/{id}/view', { params: idParam, summary: '浏览上报' }),
  versions: op.get('/{id}/versions', { params: idParam, query: paginationQuery, response: paginated(wikiDocVersionSchema), summary: '版本历史' }),
  versionDetail: op.get('/{id}/versions/{version}', { params: wikiDocVersionParams, response: wikiDocVersionSchema, summary: '版本详情（含正文，供对比）' }),
  rollback: op.post('/{id}/rollback', { params: idParam, body: rollbackWikiDocSchema, response: wikiDocSchema, summary: '回滚到历史版本' }),
  restore: op.post('/{id}/restore', { params: idParam, response: wikiDocSchema, summary: '从回收站还原' }),
  purge: op.delete('/{id}/purge', { params: idParam, summary: '彻底删除（不可恢复）' }),
}, { tags: ['知识中心-文档'] });
