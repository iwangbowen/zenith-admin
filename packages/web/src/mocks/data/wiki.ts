import { SEED_WIKI_COMMENTS, SEED_WIKI_DOCS, SEED_WIKI_SPACES, SEED_WIKI_SPACE_MEMBERS, SEED_WIKI_TAGS, SEED_WIKI_TEMPLATES } from '@zenith/shared/seed';
import { wikiSettingsSchema, type WikiSettings } from '@zenith/shared/settings';
import type { WikiComment, WikiDoc, WikiDocVersion, WikiSpace, WikiSpaceMember, WikiTag, WikiTemplate } from '@zenith/shared/wiki';
import { mockDateTime } from '@/mocks/utils/date';
import { nextIdFrom } from '@/mocks/utils/handlers';

const now = mockDateTime();

export const mockWikiTags: WikiTag[] = SEED_WIKI_TAGS.map((t) => ({
  ...t,
  createdAt: now,
  updatedAt: now,
}));

export const mockWikiSpaces: WikiSpace[] = SEED_WIKI_SPACES.map((s) => ({
  ...s,
  tenantId: null,
  myRole: 'owner' as const,
  createdAt: now,
  updatedAt: now,
}));

export const mockWikiSpaceMembers: WikiSpaceMember[] = SEED_WIKI_SPACE_MEMBERS.map((m) => ({
  ...m,
  username: 'admin',
  nickname: '管理员',
  createdAt: now,
}));

export const mockWikiTemplates: WikiTemplate[] = SEED_WIKI_TEMPLATES.map((t) => ({
  ...t,
  createdAt: now,
  updatedAt: now,
}));

/** 内存文档：始终持有正文与标签 ID，标签摘要、空间名等派生字段在 handler 输出时按需附加 */
export interface MockWikiDoc extends Omit<WikiDoc, 'tags'> {
  content: string;
}

export const mockWikiDocs: MockWikiDoc[] = SEED_WIKI_DOCS.map((d, i) => ({
  id: d.id,
  spaceId: d.spaceId,
  parentId: d.parentId,
  title: d.title,
  summary: d.summary,
  content: d.content,
  status: d.status,
  rejectReason: null,
  sort: d.sort,
  isPinned: d.isPinned,
  viewCount: (6 - i) * 12,
  currentVersion: 1,
  revision: 1,
  requireReadReceipt: false,
  ownerId: 1,
  ownerName: '管理员',
  expireAt: null,
  reviewCycleDays: null,
  nextReviewAt: null,
  isArchived: false,
  publishedAt: d.status === 'published' ? now : null,
  deletedAt: null,
  tagIds: [...d.tagIds],
  authorName: '管理员',
  createdBy: 1,
  createdAt: now,
  updatedAt: now,
}));

export const mockWikiDocVersions: WikiDocVersion[] = SEED_WIKI_DOCS.map((d, i) => ({
  id: i + 1,
  docId: d.id,
  version: 1,
  title: d.title,
  content: d.content,
  changeNote: '创建文档',
  authorId: 1,
  authorName: '管理员',
  createdAt: now,
}));

export const mockWikiComments: WikiComment[] = SEED_WIKI_COMMENTS.map((c) => ({
  ...c,
  mentionedUserIds: [],
  isQuestion: false,
  resolvedAt: null,
  authorName: '管理员',
  createdAt: now,
}));

/** 当前演示用户的订阅与已读确认 */
export const mockWikiSubscribedDocIds = new Set<number>();
export const mockWikiReadConfirmedDocIds = new Set<number>();

/** 当前演示用户的收藏 */
export const mockWikiFavoriteDocIds = new Set<number>([1]);

/** 知识库设置镜像：默认值来自设置模块 schema，保存设置后由 settings handler 同步 */
export const mockWikiSettings: WikiSettings = wikiSettingsSchema.parse({});

let nextSpaceId = nextIdFrom(mockWikiSpaces);
export function getNextWikiSpaceId(): number {
  return nextSpaceId++;
}

let nextDocId = nextIdFrom(mockWikiDocs);
export function getNextWikiDocId(): number {
  return nextDocId++;
}

let nextTagId = nextIdFrom(mockWikiTags);
export function getNextWikiTagId(): number {
  return nextTagId++;
}

let nextTemplateId = nextIdFrom(mockWikiTemplates);
export function getNextWikiTemplateId(): number {
  return nextTemplateId++;
}

let nextCommentId = nextIdFrom(mockWikiComments);
export function getNextWikiCommentId(): number {
  return nextCommentId++;
}

let nextVersionId = nextIdFrom(mockWikiDocVersions);
export function getNextWikiVersionId(): number {
  return nextVersionId++;
}
