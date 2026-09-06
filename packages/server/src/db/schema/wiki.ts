import { pgTable, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, index, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';

// ─── 枚举 ─────────────────────────────────────────────────────────────────────

export const wikiSpaceVisibilityEnum = pgEnum('wiki_space_visibility', ['public', 'private']);

export const wikiSpaceMemberRoleEnum = pgEnum('wiki_space_member_role', ['owner', 'admin', 'editor', 'viewer']);

export const wikiDocStatusEnum = pgEnum('wiki_doc_status', ['draft', 'pending', 'published', 'rejected']);

export const wikiCommentStatusEnum = pgEnum('wiki_comment_status', ['visible', 'hidden']);

export const wikiReviewActionEnum = pgEnum('wiki_review_action', ['submit', 'approve', 'reject', 'withdraw']);

// ─── 知识空间 ─────────────────────────────────────────────────────────────────

export const wikiSpaces = pgTable('wiki_spaces', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 300 }),
  /** lucide 图标名 */
  icon: varchar({ length: 50 }),
  /** public = 全员可读；private = 仅空间成员可见 */
  visibility: wikiSpaceVisibilityEnum().notNull().default('public'),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  /** 发布的文档是否同步到 AI 知识库（需全局设置同时开启） */
  aiSyncEnabled: boolean().notNull().default(false),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
});

export type WikiSpaceRow = typeof wikiSpaces.$inferSelect;
export type NewWikiSpace = typeof wikiSpaces.$inferInsert;

/** 空间成员（纯关联表） */
export const wikiSpaceMembers = pgTable('wiki_space_members', {
  spaceId: integer().notNull().references(() => wikiSpaces.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: wikiSpaceMemberRoleEnum().notNull().default('viewer'),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.spaceId, t.userId] })]);

export type WikiSpaceMemberRow = typeof wikiSpaceMembers.$inferSelect;

// ─── 文档 ─────────────────────────────────────────────────────────────────────

export const wikiDocs = pgTable('wiki_docs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  spaceId: integer().notNull().references(() => wikiSpaces.id, { onDelete: 'cascade' }),
  /** 目录树父节点；null = 空间根级 */
  parentId: integer().references((): AnyPgColumn => wikiDocs.id, { onDelete: 'set null' }),
  title: varchar({ length: 200 }).notNull(),
  summary: varchar({ length: 500 }),
  /** Markdown 正文 */
  content: text().notNull().default(''),
  status: wikiDocStatusEnum().notNull().default('draft'),
  /** 驳回意见（status = rejected 时展示） */
  rejectReason: varchar({ length: 500 }),
  sort: integer().notNull().default(0),
  isPinned: boolean().notNull().default(false),
  viewCount: integer().notNull().default(0),
  /** 当前版本号，与 wiki_doc_versions.version 对应 */
  currentVersion: integer().notNull().default(1),
  /** 乐观锁：每次更新 +1，PUT 带旧值时冲突返回 409 */
  revision: integer().notNull().default(1),
  /** 发布后是否要求读者点击「确认已读」（制度宣贯） */
  requireReadReceipt: boolean().notNull().default(false),
  // ─── 治理字段（P2-D）────────────────────────────────────────────────────────
  /** 内容负责人；null = 无负责人（治理清单跟进），创建时默认为作者 */
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 有效期；过期后进入治理「已过期」清单 */
  expireAt: timestamp(),
  /** 复审周期（天）；0/null = 不复审 */
  reviewCycleDays: integer(),
  /** 下次复审时间；到期进入治理「待复审」清单 */
  nextReviewAt: timestamp(),
  /** 归档：默认从目录树/列表/搜索隐藏，仅治理页可见 */
  isArchived: boolean().notNull().default(false),
  publishedAt: timestamp(),
  /** 软删除时间；非 null 表示在回收站 */
  deletedAt: timestamp(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('wiki_docs_space_idx').on(t.spaceId),
  index('wiki_docs_parent_idx').on(t.parentId),
  index('wiki_docs_status_idx').on(t.status),
  // pg_trgm：加速标题/正文 ILIKE 模糊检索（扩展在 0001_extensions.sql 已启用）
  index('wiki_docs_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  index('wiki_docs_content_trgm_idx').using('gin', t.content.op('gin_trgm_ops')),
]);

export type WikiDocRow = typeof wikiDocs.$inferSelect;
export type NewWikiDoc = typeof wikiDocs.$inferInsert;

/** 文档版本快照（追加型，作者即当前用户） */
export const wikiDocVersions = pgTable('wiki_doc_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  title: varchar({ length: 200 }).notNull(),
  content: text().notNull().default(''),
  changeNote: varchar({ length: 300 }),
  authorId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [unique('wiki_doc_versions_doc_version_uk').on(t.docId, t.version)]);

export type WikiDocVersionRow = typeof wikiDocVersions.$inferSelect;

// ─── 模板与标签 ───────────────────────────────────────────────────────────────

export const wikiTemplates = pgTable('wiki_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 300 }),
  /** Markdown 模板内容 */
  content: text().notNull().default(''),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  ...auditColumns(),
  ...timestampColumns(),
});

export type WikiTemplateRow = typeof wikiTemplates.$inferSelect;

export const wikiTags = pgTable('wiki_tags', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 50 }).notNull().unique(),
  /** 展示色（hex），空则前端取默认色板 */
  color: varchar({ length: 20 }),
  ...auditColumns(),
  ...timestampColumns(),
});

export type WikiTagRow = typeof wikiTags.$inferSelect;

/** 文档-标签（纯关联表） */
export const wikiDocTags = pgTable('wiki_doc_tags', {
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  tagId: integer().notNull().references(() => wikiTags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.docId, t.tagId] })]);

// ─── 评论与互动 ───────────────────────────────────────────────────────────────

/** 文档评论（作者即当前用户） */
export const wikiComments = pgTable('wiki_comments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  /** 回复的父评论；null = 顶层评论 */
  parentId: integer().references((): AnyPgColumn => wikiComments.id, { onDelete: 'cascade' }),
  content: varchar({ length: 1000 }).notNull(),
  status: wikiCommentStatusEnum().notNull().default('visible'),
  /** @提及的用户（发表时通知） */
  mentionedUserIds: integer().array().notNull().default([]),
  /** 标记为「问题」的评论可被解决 */
  isQuestion: boolean().notNull().default(false),
  resolvedAt: timestamp(),
  authorId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('wiki_comments_doc_idx').on(t.docId)]);

export type WikiCommentRow = typeof wikiComments.$inferSelect;

/** 收藏（纯关联表） */
export const wikiDocFavorites = pgTable('wiki_doc_favorites', {
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.docId, t.userId] })]);

/** 浏览记录（追加型日志，统计用） */
export const wikiDocViews = pgTable('wiki_doc_views', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('wiki_doc_views_doc_idx').on(t.docId),
  index('wiki_doc_views_created_idx').on(t.createdAt),
]);

export type WikiDocViewRow = typeof wikiDocViews.$inferSelect;

/** 搜索日志（追加型，供无结果关键词与搜索成功率统计） */
export const wikiSearchLogs = pgTable('wiki_search_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  keyword: varchar({ length: 200 }).notNull(),
  resultCount: integer().notNull().default(0),
  /** 用户点击进入的文档；null = 未点击（无结果或未选中） */
  clickedDocId: integer().references(() => wikiDocs.id, { onDelete: 'set null' }),
  userId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('wiki_search_logs_created_idx').on(t.createdAt),
  index('wiki_search_logs_keyword_idx').on(t.keyword),
]);

export type WikiSearchLogRow = typeof wikiSearchLogs.$inferSelect;

// ─── 协作：订阅 / 审核记录 / 阅读确认 ─────────────────────────────────────────

/** 文档订阅（纯关联表）：发布、评论时经站内信通知订阅者 */
export const wikiDocSubscriptions = pgTable('wiki_doc_subscriptions', {
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.docId, t.userId] })]);

/** 审核时间线（追加型）：提交 / 通过 / 驳回 / 撤回全记录 */
export const wikiReviewRecords = pgTable('wiki_review_records', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  /** 动作发生时的文档版本（审批绑定版本） */
  version: integer().notNull(),
  action: wikiReviewActionEnum().notNull(),
  actorId: integer().references(() => users.id, { onDelete: 'set null' }),
  reason: varchar({ length: 500 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('wiki_review_records_doc_idx').on(t.docId),
  index('wiki_review_records_actor_idx').on(t.actorId),
]);

export type WikiReviewRecordRow = typeof wikiReviewRecords.$inferSelect;

/** 阅读确认（纯关联表）：requireReadReceipt 文档的已读回执 */
export const wikiDocReadReceipts = pgTable('wiki_doc_read_receipts', {
  docId: integer().notNull().references(() => wikiDocs.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.docId, t.userId] })]);
