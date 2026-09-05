import * as z from 'zod';
import { partialForUpdate } from '../core/validation';
import { WIKI_COMMENT_STATUSES, WIKI_SPACE_MEMBER_ROLES, WIKI_SPACE_VISIBILITIES } from './constants';

// ─── 知识空间 ─────────────────────────────────────────────────────────────────

export const createWikiSpaceSchema = z.object({
  name: z.string().min(1, '空间名称不能为空').max(100),
  description: z.string().max(300).optional(),
  icon: z.string().max(50).optional(),
  visibility: z.enum(WIKI_SPACE_VISIBILITIES).default('public'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
  aiSyncEnabled: z.boolean().default(false),
});

export const updateWikiSpaceSchema = partialForUpdate(createWikiSpaceSchema);

export type CreateWikiSpaceInput = z.infer<typeof createWikiSpaceSchema>;
export type UpdateWikiSpaceInput = z.infer<typeof updateWikiSpaceSchema>;

/** 全量保存空间成员（replace 模式） */
export const saveWikiSpaceMembersSchema = z.object({
  members: z.array(z.object({
    userId: z.number().int().positive(),
    role: z.enum(WIKI_SPACE_MEMBER_ROLES),
  })),
});

export type SaveWikiSpaceMembersInput = z.infer<typeof saveWikiSpaceMembersSchema>;

// ─── 文档 ─────────────────────────────────────────────────────────────────────

export const createWikiDocSchema = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1, '标题不能为空').max(200),
  summary: z.string().max(500).optional(),
  content: z.string().default(''),
  tagIds: z.array(z.number().int()).default([]),
  fileIds: z.array(z.uuid()).default([]),
  requireReadReceipt: z.boolean().default(false),
});

export const updateWikiDocSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200).optional(),
  summary: z.string().max(500).nullable().optional(),
  content: z.string().optional(),
  tagIds: z.array(z.number().int()).optional(),
  fileIds: z.array(z.uuid()).optional(),
  requireReadReceipt: z.boolean().optional(),
  sort: z.number().int().optional(),
  isPinned: z.boolean().optional(),
  /** 版本说明；正文变更时写入版本历史 */
  changeNote: z.string().max(300).optional(),
  /** 乐观锁：加载详情时的 revision，服务端不一致时返回 409 */
  revision: z.number().int().positive().optional(),
});

export type CreateWikiDocInput = z.infer<typeof createWikiDocSchema>;
export type UpdateWikiDocInput = z.infer<typeof updateWikiDocSchema>;

/** 移动文档：改父节点并指定插入位置，服务端对目标层级整层重排 sort */
export const moveWikiDocSchema = z.object({
  parentId: z.number().int().positive().nullable(),
  /** 在目标层级中的插入位（不含自身）；缺省 = 追加到末尾 */
  index: z.number().int().min(0).optional(),
});

export type MoveWikiDocInput = z.infer<typeof moveWikiDocSchema>;

/** 审核（通过 / 驳回） */
export const reviewWikiDocSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
}).refine((v) => v.action !== 'reject' || !!v.reason?.trim(), { message: '驳回时必须填写驳回意见', path: ['reason'] });

export type ReviewWikiDocInput = z.infer<typeof reviewWikiDocSchema>;

/** 回滚到历史版本 */
export const rollbackWikiDocSchema = z.object({
  version: z.number().int().positive(),
});

export type RollbackWikiDocInput = z.infer<typeof rollbackWikiDocSchema>;

/** 收藏 / 取消收藏 */
export const favoriteWikiDocSchema = z.object({
  favorite: z.boolean(),
});

export type FavoriteWikiDocInput = z.infer<typeof favoriteWikiDocSchema>;

/** 订阅 / 取消订阅（发布与评论时站内信通知） */
export const subscribeWikiDocSchema = z.object({
  subscribe: z.boolean(),
});

export type SubscribeWikiDocInput = z.infer<typeof subscribeWikiDocSchema>;

/** 搜索点击回报：把当前用户最近一条同关键词搜索日志标记为已点击 */
export const reportWikiSearchClickSchema = z.object({
  keyword: z.string().min(1).max(200),
  docId: z.number().int().positive(),
});

export type ReportWikiSearchClickInput = z.infer<typeof reportWikiSearchClickSchema>;

// ─── 模板与标签 ───────────────────────────────────────────────────────────────

export const createWikiTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(100),
  description: z.string().max(300).optional(),
  content: z.string().default(''),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
});

export const updateWikiTemplateSchema = partialForUpdate(createWikiTemplateSchema);

export type CreateWikiTemplateInput = z.infer<typeof createWikiTemplateSchema>;
export type UpdateWikiTemplateInput = z.infer<typeof updateWikiTemplateSchema>;

export const createWikiTagSchema = z.object({
  name: z.string().min(1, '标签名称不能为空').max(50),
  color: z.string().max(20).optional(),
});

export const updateWikiTagSchema = partialForUpdate(createWikiTagSchema);

export type CreateWikiTagInput = z.infer<typeof createWikiTagSchema>;
export type UpdateWikiTagInput = z.infer<typeof updateWikiTagSchema>;

// ─── 评论 ─────────────────────────────────────────────────────────────────────

export const createWikiCommentSchema = z.object({
  docId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().optional(),
  content: z.string().min(1, '评论内容不能为空').max(1000),
  mentionedUserIds: z.array(z.number().int().positive()).default([]),
  isQuestion: z.boolean().default(false),
});

export type CreateWikiCommentInput = z.infer<typeof createWikiCommentSchema>;

export const updateWikiCommentStatusSchema = z.object({
  status: z.enum(WIKI_COMMENT_STATUSES),
});

export type UpdateWikiCommentStatusInput = z.infer<typeof updateWikiCommentStatusSchema>;

// ─── 治理批量操作 ─────────────────────────────────────────────────────────────

export const wikiGovernanceBatchSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '请选择要操作的文档'),
});

export type WikiGovernanceBatchInput = z.infer<typeof wikiGovernanceBatchSchema>;

export const wikiGovernanceArchiveSchema = wikiGovernanceBatchSchema.extend({
  archived: z.boolean(),
});

export type WikiGovernanceArchiveInput = z.infer<typeof wikiGovernanceArchiveSchema>;

export const wikiGovernanceOwnerSchema = wikiGovernanceBatchSchema.extend({
  ownerId: z.number().int().positive(),
});

export type WikiGovernanceOwnerInput = z.infer<typeof wikiGovernanceOwnerSchema>;

export const wikiGovernanceReviewSchema = wikiGovernanceBatchSchema.extend({
  /** 复审周期（天）；null = 取消定期复审 */
  reviewCycleDays: z.number().int().min(1).max(3650).nullable(),
  /** 有效期（可选，YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD） */
  expireAt: z.string().nullable().optional(),
});

export type WikiGovernanceReviewInput = z.infer<typeof wikiGovernanceReviewSchema>;

// ─── Markdown 导入 ────────────────────────────────────────────────────────────

export const importWikiDocsSchema = z.object({
  spaceId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().optional(),
  files: z.array(z.object({
    name: z.string().min(1).max(200),
    content: z.string().max(500_000, '单个文件不能超过 500KB'),
  })).min(1, '请选择要导入的文件').max(20, '单次最多导入 20 个文件'),
});

export type ImportWikiDocsInput = z.infer<typeof importWikiDocsSchema>;
