import {
  wikiCommentContract, wikiDocContract, wikiGovernanceContract,
  wikiSpaceContract, wikiStatsContract, wikiTagContract, wikiTemplateContract,
} from '@zenith/shared/wiki';
import type {
  WikiComment, WikiDoc, WikiDocTag, WikiDocTreeNode, WikiReviewRecord, WikiSpace, WikiTag, WikiTemplate,
} from '@zenith/shared/wiki';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockDateTime } from '@/mocks/utils/date';
import {
  getNextWikiCommentId, getNextWikiDocId, getNextWikiSpaceId, getNextWikiTagId,
  getNextWikiTemplateId, getNextWikiVersionId, mockWikiComments, mockWikiDocVersions,
  mockWikiDocs, mockWikiFavoriteDocIds, mockWikiReadConfirmedDocIds, mockWikiSettings,
  mockWikiSpaceMembers, mockWikiSpaces, mockWikiSubscribedDocIds, mockWikiTags,
  mockWikiTemplates, type MockWikiDoc,
} from '../data/wiki';

/** 审核时间线（内存） */
const mockReviewRecords: WikiReviewRecord[] = [];
let nextReviewRecordId = 1;

function pushReviewRecord(doc: MockWikiDoc, action: WikiReviewRecord['action'], reason: string | null = null) {
  mockReviewRecords.push({
    id: nextReviewRecordId++,
    docId: doc.id,
    version: doc.currentVersion,
    action,
    actorId: 1,
    actorName: '管理员',
    reason,
    createdAt: mockDateTime(),
  });
}

// ─── 派生工具 ─────────────────────────────────────────────────────────────────

function spaceName(spaceId: number): string {
  return mockWikiSpaces.find((s) => s.id === spaceId)?.name ?? '';
}

function docTags(doc: MockWikiDoc): WikiDocTag[] {
  return mockWikiTags.filter((t) => doc.tagIds.includes(t.id)).map(({ id, name, color }) => ({ id, name, color }));
}

function toListDoc(doc: MockWikiDoc): WikiDoc {
  const { content: _content, ...rest } = doc;
  return {
    ...rest,
    spaceName: spaceName(doc.spaceId),
    tags: docTags(doc),
    tagIds: [...doc.tagIds],
  };
}

function toDetailDoc(doc: MockWikiDoc): WikiDoc {
  return {
    ...toListDoc(doc),
    content: doc.content,
    favorited: mockWikiFavoriteDocIds.has(doc.id),
    favoriteCount: mockWikiFavoriteDocIds.has(doc.id) ? 1 : 0,
    commentCount: mockWikiComments.filter((c) => c.docId === doc.id && c.status === 'visible').length,
    commentsEnabled: mockWikiSettings.commentsEnabled,
    subscribed: mockWikiSubscribedDocIds.has(doc.id),
    readConfirmed: mockWikiReadConfirmedDocIds.has(doc.id),
    readReceiptCount: mockWikiReadConfirmedDocIds.has(doc.id) ? 1 : 0,
    attachments: [],
  };
}

function findDoc(id: number): MockWikiDoc | undefined {
  return mockWikiDocs.find((d) => d.id === id);
}

function pushVersion(doc: MockWikiDoc, changeNote: string | null) {
  mockWikiDocVersions.push({
    id: getNextWikiVersionId(),
    docId: doc.id,
    version: doc.currentVersion,
    title: doc.title,
    content: doc.content,
    changeNote,
    authorId: 1,
    authorName: '管理员',
    createdAt: mockDateTime(),
  });
}

/** 与服务端一致：新文档追加到目标层级末尾 */
function nextSortIn(spaceId: number, parentId: number | null): number {
  return 1 + Math.max(-1, ...mockWikiDocs
    .filter((d) => d.spaceId === spaceId && (d.parentId ?? null) === parentId && !d.deletedAt)
    .map((d) => d.sort));
}

function newDraftDoc(input: {
  spaceId: number;
  parentId: number | null;
  title: string;
  summary: string | null;
  content: string;
  tagIds: number[];
  requireReadReceipt: boolean;
  sort: number;
}): MockWikiDoc {
  const now = mockDateTime();
  return {
    id: getNextWikiDocId(),
    spaceId: input.spaceId,
    parentId: input.parentId,
    title: input.title,
    summary: input.summary,
    content: input.content,
    status: 'draft',
    rejectReason: null,
    sort: input.sort,
    isPinned: false,
    viewCount: 0,
    currentVersion: 1,
    revision: 1,
    requireReadReceipt: input.requireReadReceipt,
    ownerId: 1,
    ownerName: '管理员',
    expireAt: null,
    reviewCycleDays: null,
    nextReviewAt: null,
    isArchived: false,
    publishedAt: null,
    deletedAt: null,
    tagIds: input.tagIds,
    authorName: '管理员',
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── 空间 ─────────────────────────────────────────────────────────────────────

const spaceHandlers = [
  mock(wikiSpaceContract.my, ({ ok }) => ok(mockWikiSpaces.filter((s) => s.status === 'enabled'))),

  mock(wikiSpaceContract.list, ({ query, ok, paginate }) => {
    let list = mockWikiSpaces.map((s) => ({
      ...s,
      memberCount: mockWikiSpaceMembers.filter((m) => m.spaceId === s.id).length,
      docCount: mockWikiDocs.filter((d) => d.spaceId === s.id && !d.deletedAt).length,
    }));
    if (query.keyword) {
      const keyword = query.keyword;
      list = list.filter((s) => s.name.includes(keyword) || (s.description ?? '').includes(keyword));
    }
    if (query.visibility) list = list.filter((s) => s.visibility === query.visibility);
    if (query.status) list = list.filter((s) => s.status === query.status);
    return ok(paginate(list));
  }),

  mock(wikiSpaceContract.listMembers, ({ params, ok }) =>
    ok(mockWikiSpaceMembers.filter((m) => m.spaceId === params.id))),

  mock(wikiSpaceContract.saveMembers, ({ params, body, ok }) => {
    const spaceId = params.id;
    if (!mockWikiSpaces.some((s) => s.id === spaceId)) return notFound('知识空间不存在', { status: 404 });
    if (!body.members.some((m) => m.role === 'owner')) {
      return badRequest('空间至少需要一名负责人', { status: 400 });
    }
    removeWhere(mockWikiSpaceMembers, (m) => m.spaceId === spaceId);
    for (const m of body.members) {
      mockWikiSpaceMembers.push({
        spaceId, userId: m.userId, role: m.role, username: `user${m.userId}`, nickname: `用户 ${m.userId}`, createdAt: mockDateTime(),
      });
    }
    return ok(null, '保存成功');
  }),

  mock(wikiSpaceContract.detail, ({ params, ok }) => {
    const space = mockWikiSpaces.find((s) => s.id === params.id);
    if (!space) return notFound('知识空间不存在', { status: 404 });
    return ok(space);
  }),

  mock(wikiSpaceContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const space: WikiSpace = {
      id: getNextWikiSpaceId(),
      name: body.name,
      description: body.description ?? null,
      icon: body.icon ?? null,
      visibility: body.visibility,
      status: body.status,
      sort: body.sort,
      aiSyncEnabled: body.aiSyncEnabled,
      tenantId: null,
      myRole: 'owner',
      createdAt: now,
      updatedAt: now,
    };
    mockWikiSpaces.push(space);
    mockWikiSpaceMembers.push({ spaceId: space.id, userId: 1, role: 'owner', username: 'admin', nickname: '管理员', createdAt: now });
    return ok(space, '创建成功');
  }),

  mock(wikiSpaceContract.update, ({ params, body, ok }) => {
    const space = mockWikiSpaces.find((s) => s.id === params.id);
    if (!space) return notFound('知识空间不存在', { status: 404 });
    Object.assign(space, body, { updatedAt: mockDateTime() });
    return ok(space, '更新成功');
  }),

  mock(wikiSpaceContract.remove, ({ params, ok }) => {
    const id = params.id;
    const idx = mockWikiSpaces.findIndex((s) => s.id === id);
    if (idx === -1) return notFound('知识空间不存在', { status: 404 });
    if (mockWikiDocs.some((d) => d.spaceId === id)) {
      return badRequest('空间下仍有文档（含回收站），请先清空后再删除', { status: 400 });
    }
    mockWikiSpaces.splice(idx, 1);
    removeWhere(mockWikiSpaceMembers, (m) => m.spaceId === id);
    return ok(null, '删除成功');
  }),
];

// ─── 文档 ─────────────────────────────────────────────────────────────────────

const docHandlers = [
  mock(wikiDocContract.search, ({ query, ok, paginate }) => {
    const keyword = query.keyword.toLowerCase();
    let list = mockWikiDocs.filter((d) => !d.deletedAt && (
      d.title.toLowerCase().includes(keyword)
      || (d.summary ?? '').toLowerCase().includes(keyword)
      || d.content.toLowerCase().includes(keyword)
    ));
    const { spaceId, status, tagId } = query;
    if (spaceId !== undefined) list = list.filter((d) => d.spaceId === spaceId);
    if (status) list = list.filter((d) => d.status === status);
    if (tagId !== undefined) list = list.filter((d) => d.tagIds.includes(tagId));
    const withSnippet = list.map((d) => ({
      ...toListDoc(d),
      snippet: d.content.replace(/[#>*`\-|[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
    }));
    return ok(paginate(withSnippet));
  }),

  mock(wikiDocContract.reportSearchClick, ({ ok }) => ok(null)),

  mock(wikiDocContract.recent, ({ ok }) =>
    ok(mockWikiDocs.filter((d) => !d.deletedAt && d.status === 'published').slice(0, 5).map(toListDoc))),

  mock(wikiDocContract.processedReviews, ({ ok, paginate }) => {
    const list = mockReviewRecords
      .filter((r) => r.action === 'approve' || r.action === 'reject')
      .map((r) => ({ ...r, docTitle: mockWikiDocs.find((d) => d.id === r.docId)?.title ?? '' }))
      .sort((a, b) => b.id - a.id);
    return ok(paginate(list));
  }),

  mock(wikiDocContract.tree, ({ query, ok }) => {
    const docs = mockWikiDocs
      .filter((d) => d.spaceId === query.spaceId && !d.deletedAt)
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.sort - b.sort || a.id - b.id);
    const nodes = new Map<number, WikiDocTreeNode>();
    for (const d of docs) {
      nodes.set(d.id, { id: d.id, parentId: d.parentId, title: d.title, status: d.status, isPinned: d.isPinned, sort: d.sort, createdBy: d.createdBy ?? null, children: [] });
    }
    const roots: WikiDocTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId !== null ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children!.push(node);
      else roots.push(node);
    }
    return ok(roots);
  }),

  mock(wikiDocContract.favorites, ({ query, ok, paginate }) => {
    const { keyword } = query;
    let list = mockWikiDocs.filter((d) => mockWikiFavoriteDocIds.has(d.id) && !d.deletedAt);
    if (keyword) list = list.filter((d) => d.title.includes(keyword));
    return ok(paginate(list.map(toListDoc)));
  }),

  mock(wikiDocContract.recycle, ({ query, ok, paginate }) => {
    const { keyword } = query;
    let list = mockWikiDocs.filter((d) => d.deletedAt);
    if (keyword) list = list.filter((d) => d.title.includes(keyword));
    return ok(paginate(list.map(toListDoc)));
  }),

  mock(wikiDocContract.list, ({ query, ok, paginate }) => {
    const { keyword, status, spaceId, tagId, mine, submitted } = query;
    let list = mockWikiDocs.filter((d) => !d.deletedAt);
    if (keyword) list = list.filter((d) => d.title.includes(keyword) || (d.summary ?? '').includes(keyword) || d.content.includes(keyword));
    if (status) list = list.filter((d) => d.status === status);
    if (spaceId !== undefined) list = list.filter((d) => d.spaceId === spaceId);
    if (tagId !== undefined) list = list.filter((d) => d.tagIds.includes(tagId));
    if (mine) list = list.filter((d) => d.createdBy === 1);
    if (submitted) {
      const submittedIds = new Set(
        mockReviewRecords.filter((record) => record.action === 'submit' && record.actorId === 1).map((record) => record.docId),
      );
      list = list.filter((d) => submittedIds.has(d.id));
    }
    return ok(paginate(list.map(toListDoc)));
  }),

  mock(wikiDocContract.create, ({ body, ok }) => {
    const parentId = body.parentId ?? null;
    const doc = newDraftDoc({
      spaceId: body.spaceId,
      parentId,
      title: body.title,
      summary: body.summary ?? null,
      content: body.content,
      tagIds: body.tagIds,
      requireReadReceipt: body.requireReadReceipt,
      sort: nextSortIn(body.spaceId, parentId),
    });
    mockWikiDocs.push(doc);
    pushVersion(doc, '创建文档');
    return ok(toDetailDoc(doc), '创建成功');
  }),

  mock(wikiDocContract.versionDetail, ({ params, ok }) => {
    const version = mockWikiDocVersions.find((v) => v.docId === params.id && v.version === params.version);
    if (!version) return notFound('版本不存在', { status: 404 });
    return ok(version);
  }),

  mock(wikiDocContract.versions, ({ params, ok, paginate }) => {
    const list = mockWikiDocVersions
      .filter((v) => v.docId === params.id)
      .sort((a, b) => b.version - a.version)
      .map(({ content: _content, ...rest }) => rest);
    return ok(paginate(list));
  }),

  mock(wikiDocContract.move, ({ params, body, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    // 与服务端一致：目标层级兄弟（不含自身）按展示序在 index 处插入后整层重排 sort
    const siblings = mockWikiDocs
      .filter((d) => d.spaceId === doc.spaceId && (d.parentId ?? null) === body.parentId && !d.deletedAt && !d.isArchived && d.id !== doc.id)
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.sort - b.sort || a.id - b.id);
    const insertAt = body.index === undefined ? siblings.length : Math.min(body.index, siblings.length);
    siblings.splice(insertAt, 0, doc);
    doc.parentId = body.parentId;
    siblings.forEach((d, position) => { d.sort = position; });
    doc.updatedAt = mockDateTime();
    return ok(toDetailDoc(doc), '移动成功');
  }),

  mock(wikiDocContract.submit, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (doc.status !== 'draft' && doc.status !== 'rejected') {
      return badRequest('只有草稿或已驳回的文档可以提交发布', { status: 400 });
    }
    doc.status = mockWikiSettings.requireApproval ? 'pending' : 'published';
    doc.rejectReason = null;
    pushReviewRecord(doc, 'submit');
    if (doc.status === 'published') {
      doc.publishedAt = mockDateTime();
      pushReviewRecord(doc, 'approve', '审批未开启，提交即发布');
    }
    doc.updatedAt = mockDateTime();
    return ok(toDetailDoc(doc), '提交成功');
  }),

  mock(wikiDocContract.withdraw, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (doc.status !== 'pending') return badRequest('只有待审核的文档可以撤回', { status: 400 });
    doc.status = 'draft';
    pushReviewRecord(doc, 'withdraw');
    doc.updatedAt = mockDateTime();
    return ok(toDetailDoc(doc), '已撤回');
  }),

  mock(wikiDocContract.subscribe, ({ params, body, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (body.subscribe) mockWikiSubscribedDocIds.add(doc.id);
    else mockWikiSubscribedDocIds.delete(doc.id);
    return ok(null, body.subscribe ? '已订阅' : '已取消订阅');
  }),

  mock(wikiDocContract.confirmRead, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    mockWikiReadConfirmedDocIds.add(doc.id);
    return ok(null, '已确认阅读');
  }),

  mock(wikiDocContract.readReceipts, ({ params, ok }) => {
    const confirmed = mockWikiReadConfirmedDocIds.has(params.id)
      ? [{ userId: 1, nickname: '管理员', confirmedAt: mockDateTime() }]
      : [];
    return ok({
      confirmed,
      unconfirmed: confirmed.length > 0 ? [] : [{ userId: 1, nickname: '管理员' }],
    });
  }),

  mock(wikiDocContract.reviewRecords, ({ params, ok }) =>
    ok(mockReviewRecords.filter((r) => r.docId === params.id).sort((a, b) => b.id - a.id))),

  mock(wikiDocContract.review, ({ params, body, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (doc.status !== 'pending') return badRequest('只有待审核的文档可以审核', { status: 400 });
    if (body.action === 'approve') {
      doc.status = 'published';
      doc.rejectReason = null;
      doc.publishedAt = mockDateTime();
      pushReviewRecord(doc, 'approve', body.reason ?? null);
    } else {
      doc.status = 'rejected';
      doc.rejectReason = body.reason ?? null;
      pushReviewRecord(doc, 'reject', body.reason ?? null);
    }
    doc.updatedAt = mockDateTime();
    return ok(toDetailDoc(doc), '审核完成');
  }),

  mock(wikiDocContract.favorite, ({ params, body, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (body.favorite) mockWikiFavoriteDocIds.add(doc.id);
    else mockWikiFavoriteDocIds.delete(doc.id);
    return ok(null, body.favorite ? '已收藏' : '已取消收藏');
  }),

  mock(wikiDocContract.view, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (doc && doc.status === 'published') doc.viewCount += 1;
    return ok(null);
  }),

  mock(wikiDocContract.rollback, ({ params, body, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    const target = mockWikiDocVersions.find((v) => v.docId === doc.id && v.version === body.version);
    if (!target) return notFound('版本不存在', { status: 404 });
    doc.title = target.title;
    doc.content = target.content ?? '';
    doc.currentVersion += 1;
    doc.status = 'draft';
    doc.updatedAt = mockDateTime();
    pushVersion(doc, `回滚自 v${body.version}`);
    return ok(toDetailDoc(doc), '回滚成功');
  }),

  mock(wikiDocContract.restore, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (!doc) return notFound('文档不存在', { status: 404 });
    if (!doc.deletedAt) return badRequest('文档不在回收站中', { status: 400 });
    doc.deletedAt = null;
    doc.updatedAt = mockDateTime();
    return ok(toDetailDoc(doc), '还原成功');
  }),

  mock(wikiDocContract.purge, ({ params, ok }) => {
    const id = params.id;
    const doc = findDoc(id);
    if (!doc) return notFound('文档不存在', { status: 404 });
    if (!doc.deletedAt) return badRequest('只能彻底删除回收站中的文档', { status: 400 });
    removeWhere(mockWikiDocs, (d) => d.id === id);
    removeWhere(mockWikiDocVersions, (v) => v.docId === id);
    removeWhere(mockWikiComments, (c) => c.docId === id);
    mockWikiFavoriteDocIds.delete(id);
    return ok(null, '已彻底删除');
  }),

  mock(wikiDocContract.detail, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    return ok(toDetailDoc(doc));
  }),

  mock(wikiDocContract.update, ({ params, body, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    const contentChanged = body.content !== undefined && body.content !== doc.content;
    const titleChanged = body.title !== undefined && body.title !== doc.title;

    if (body.title !== undefined) doc.title = body.title;
    if (body.summary !== undefined) doc.summary = body.summary;
    if (body.content !== undefined) doc.content = body.content;
    if (body.tagIds !== undefined) doc.tagIds = [...body.tagIds];
    if (body.sort !== undefined) doc.sort = body.sort;
    if (body.isPinned !== undefined) doc.isPinned = body.isPinned;
    if (body.requireReadReceipt !== undefined) doc.requireReadReceipt = body.requireReadReceipt;
    if (contentChanged && doc.status === 'published') doc.status = 'draft';
    if (contentChanged || titleChanged) {
      doc.currentVersion += 1;
      pushVersion(doc, body.changeNote ?? null);
    }
    doc.revision += 1;
    doc.updatedAt = mockDateTime();
    return ok(toDetailDoc(doc), '更新成功');
  }),

  mock(wikiDocContract.remove, ({ params, ok }) => {
    const doc = findDoc(params.id);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (mockWikiDocs.some((d) => d.parentId === doc.id && !d.deletedAt)) {
      return badRequest('该文档下还有子文档，请先移动或删除子文档', { status: 400 });
    }
    doc.deletedAt = mockDateTime();
    return ok(null, '已移入回收站');
  }),
];

// ─── 模板与标签 ───────────────────────────────────────────────────────────────

const templateHandlers = [
  mock(wikiTemplateContract.all, ({ ok }) => ok(mockWikiTemplates.filter((t) => t.status === 'enabled'))),

  mock(wikiTemplateContract.list, ({ query, ok, paginate }) => {
    let list = [...mockWikiTemplates];
    if (query.keyword) {
      const keyword = query.keyword;
      list = list.filter((t) => t.name.includes(keyword) || (t.description ?? '').includes(keyword));
    }
    if (query.status) list = list.filter((t) => t.status === query.status);
    return ok(paginate(list));
  }),

  mock(wikiTemplateContract.detail, ({ params, ok }) => {
    const tpl = mockWikiTemplates.find((t) => t.id === params.id);
    if (!tpl) return notFound('模板不存在', { status: 404 });
    return ok(tpl);
  }),

  mock(wikiTemplateContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const tpl: WikiTemplate = {
      id: getNextWikiTemplateId(),
      name: body.name,
      description: body.description ?? null,
      content: body.content,
      status: body.status,
      sort: body.sort,
      createdAt: now,
      updatedAt: now,
    };
    mockWikiTemplates.push(tpl);
    return ok(tpl, '创建成功');
  }),

  mock(wikiTemplateContract.update, ({ params, body, ok }) => {
    const tpl = mockWikiTemplates.find((t) => t.id === params.id);
    if (!tpl) return notFound('模板不存在', { status: 404 });
    Object.assign(tpl, body, { updatedAt: mockDateTime() });
    return ok(tpl, '更新成功');
  }),

  mock(wikiTemplateContract.remove, ({ params, ok }) => {
    const idx = mockWikiTemplates.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('模板不存在', { status: 404 });
    mockWikiTemplates.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];

const tagHandlers = [
  mock(wikiTagContract.all, ({ ok }) => ok(mockWikiTags)),

  mock(wikiTagContract.list, ({ query, ok, paginate }) => {
    const { keyword } = query;
    let list = mockWikiTags.map((t) => ({
      ...t,
      docCount: mockWikiDocs.filter((d) => !d.deletedAt && d.tagIds.includes(t.id)).length,
    }));
    if (keyword) list = list.filter((t) => t.name.includes(keyword));
    return ok(paginate(list));
  }),

  mock(wikiTagContract.create, ({ body, ok }) => {
    if (mockWikiTags.some((t) => t.name === body.name)) {
      return badRequest('标签名称已存在', { status: 400 });
    }
    const now = mockDateTime();
    const tag: WikiTag = { id: getNextWikiTagId(), name: body.name, color: body.color ?? null, createdAt: now, updatedAt: now };
    mockWikiTags.push(tag);
    return ok(tag, '创建成功');
  }),

  mock(wikiTagContract.update, ({ params, body, ok }) => {
    const tag = mockWikiTags.find((t) => t.id === params.id);
    if (!tag) return notFound('标签不存在', { status: 404 });
    Object.assign(tag, body, { updatedAt: mockDateTime() });
    return ok(tag, '更新成功');
  }),

  mock(wikiTagContract.remove, ({ params, ok }) => {
    const id = params.id;
    const idx = mockWikiTags.findIndex((t) => t.id === id);
    if (idx === -1) return notFound('标签不存在', { status: 404 });
    mockWikiTags.splice(idx, 1);
    for (const d of mockWikiDocs) d.tagIds = d.tagIds.filter((t) => t !== id);
    return ok(null, '删除成功');
  }),
];

// ─── 评论 ─────────────────────────────────────────────────────────────────────

const commentHandlers = [
  mock(wikiCommentContract.docComments, ({ params, ok }) => {
    const visible = mockWikiComments.filter((c) => c.docId === params.id && c.status === 'visible');
    const byId = new Map(visible.map((c) => [c.id, { ...c, replies: [] as WikiComment[] }]));
    const roots: WikiComment[] = [];
    for (const c of byId.values()) {
      const parent = c.parentId !== null ? byId.get(c.parentId) : undefined;
      if (parent) parent.replies.push(c);
      else roots.push(c);
    }
    return ok(roots.sort((a, b) => b.id - a.id));
  }),

  mock(wikiCommentContract.deleteMine, ({ params, ok }) => {
    const removed = removeWhere(mockWikiComments, (c) => c.id === params.id || c.parentId === params.id);
    if (removed === 0) return notFound('评论不存在', { status: 404 });
    return ok(null, '删除成功');
  }),

  mock(wikiCommentContract.list, ({ query, ok, paginate }) => {
    const { keyword, status, docId } = query;
    let list = mockWikiComments.map((c) => ({
      ...c,
      docTitle: mockWikiDocs.find((d) => d.id === c.docId)?.title ?? '',
    }));
    if (keyword) list = list.filter((c) => c.content.includes(keyword));
    if (status) list = list.filter((c) => c.status === status);
    if (docId !== undefined) list = list.filter((c) => c.docId === docId);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),

  mock(wikiCommentContract.create, ({ body, ok }) => {
    const doc = findDoc(body.docId);
    if (!doc || doc.deletedAt) return notFound('文档不存在', { status: 404 });
    if (doc.status !== 'published') return badRequest('只能评论已发布的文档', { status: 400 });
    const comment: WikiComment = {
      id: getNextWikiCommentId(),
      docId: body.docId,
      parentId: body.parentId ?? null,
      content: body.content,
      status: 'visible',
      mentionedUserIds: body.mentionedUserIds,
      isQuestion: body.isQuestion,
      resolvedAt: null,
      authorId: 1,
      authorName: '管理员',
      createdAt: mockDateTime(),
    };
    mockWikiComments.push(comment);
    return ok(comment, '评论成功');
  }),

  mock(wikiCommentContract.resolve, ({ params, ok }) => {
    const comment = mockWikiComments.find((c) => c.id === params.id);
    if (!comment) return notFound('评论不存在', { status: 404 });
    if (!comment.isQuestion) return badRequest('只有标记为问题的评论可以解决', { status: 400 });
    comment.resolvedAt = mockDateTime();
    return ok(comment, '已标记解决');
  }),

  mock(wikiCommentContract.updateStatus, ({ params, body, ok }) => {
    const comment = mockWikiComments.find((c) => c.id === params.id);
    if (!comment) return notFound('评论不存在', { status: 404 });
    comment.status = body.status;
    return ok(comment, '操作成功');
  }),

  mock(wikiCommentContract.remove, ({ params, ok }) => {
    const removed = removeWhere(mockWikiComments, (c) => c.id === params.id || c.parentId === params.id);
    if (removed === 0) return notFound('评论不存在', { status: 404 });
    return ok(null, '删除成功');
  }),
];

// ─── 统计与设置 ───────────────────────────────────────────────────────────────

const statsHandlers = [
  mock(wikiStatsContract.overview, ({ ok }) => {
    const active = mockWikiDocs.filter((d) => !d.deletedAt);
    return ok({
      spaceCount: mockWikiSpaces.length,
      docCount: active.length,
      publishedCount: active.filter((d) => d.status === 'published').length,
      pendingCount: active.filter((d) => d.status === 'pending').length,
      commentCount: mockWikiComments.filter((c) => c.status === 'visible').length,
      weekNewDocs: active.length,
      weekViews: active.reduce((sum, d) => sum + d.viewCount, 0),
    });
  }),

  mock(wikiStatsContract.hotDocs, ({ query, ok }) =>
    ok(mockWikiDocs
      .filter((d) => !d.deletedAt && d.status === 'published')
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, query.limit)
      .map((d) => ({ id: d.id, title: d.title, spaceName: spaceName(d.spaceId), viewCount: d.viewCount })))),

  mock(wikiStatsContract.contributors, ({ ok }) =>
    ok([{ userId: 1, nickname: '管理员', docCount: mockWikiDocs.filter((d) => !d.deletedAt).length }])),

  mock(wikiStatsContract.staleDocs, ({ ok }) => ok([])),

  mock(wikiStatsContract.ops, ({ ok }) => {
    const active = mockWikiDocs.filter((d) => !d.deletedAt);
    return ok({
      createdTrend: [{ date: mockDateTime().slice(0, 10), count: active.length }],
      spaceDistribution: mockWikiSpaces.map((s) => ({
        spaceName: s.name,
        count: active.filter((d) => d.spaceId === s.id).length,
      })),
      searchCount30d: 12,
      noResultCount30d: 2,
      approvedCount30d: mockReviewRecords.filter((r) => r.action === 'approve').length,
      rejectedCount30d: mockReviewRecords.filter((r) => r.action === 'reject').length,
      pendingBacklog: active.filter((d) => d.status === 'pending').length,
      expiredCount: 0,
      reviewDueCount: 0,
      noOwnerCount: active.filter((d) => d.ownerId == null).length,
      archivedCount: active.filter((d) => d.isArchived).length,
    });
  }),
];

// ─── 治理 ─────────────────────────────────────────────────────────────────────

const governanceHandlers = [
  mock(wikiGovernanceContract.listDocs, ({ query, ok, paginate }) => {
    let list = mockWikiDocs.filter((d) => !d.deletedAt);
    switch (query.kind) {
      case 'all': list = list.filter((d) => !d.isArchived); break;
      case 'archived': list = list.filter((d) => d.isArchived); break;
      case 'no-owner': list = list.filter((d) => !d.isArchived && d.ownerId == null); break;
      case 'draft-backlog': list = list.filter((d) => !d.isArchived && d.status === 'draft'); break;
      case 'review-backlog': list = list.filter((d) => !d.isArchived && d.status === 'pending'); break;
      default: list = [];
    }
    const rows = list.map((d) => ({
      id: d.id,
      spaceId: d.spaceId,
      spaceName: spaceName(d.spaceId),
      title: d.title,
      status: d.status,
      ownerId: d.ownerId,
      ownerName: d.ownerName,
      expireAt: d.expireAt,
      reviewCycleDays: d.reviewCycleDays,
      nextReviewAt: d.nextReviewAt,
      isArchived: d.isArchived,
      updatedAt: d.updatedAt,
    }));
    return ok(paginate(rows));
  }),

  mock(wikiGovernanceContract.noResultKeywords, ({ ok }) => ok([
    { keyword: '差旅报销标准', searchCount: 6, lastSearchedAt: mockDateTime() },
    { keyword: 'VPN 配置', searchCount: 3, lastSearchedAt: mockDateTime() },
  ])),

  mock(wikiGovernanceContract.remind, ({ body, ok }) => ok(null, `已提醒 ${body.ids.length} 位负责人`)),

  mock(wikiGovernanceContract.archive, ({ body, ok }) => {
    for (const doc of mockWikiDocs) {
      if (body.ids.includes(doc.id)) doc.isArchived = body.archived;
    }
    return ok(null, `${body.archived ? '已归档' : '已取消归档'} ${body.ids.length} 篇`);
  }),

  mock(wikiGovernanceContract.setOwner, ({ body, ok }) => {
    for (const doc of mockWikiDocs) {
      if (body.ids.includes(doc.id)) {
        doc.ownerId = body.ownerId;
        doc.ownerName = `用户 ${body.ownerId}`;
      }
    }
    return ok(null, `已为 ${body.ids.length} 篇文档指定负责人`);
  }),

  mock(wikiGovernanceContract.setReviewCycle, ({ body, ok }) => {
    for (const doc of mockWikiDocs) {
      if (body.ids.includes(doc.id)) {
        doc.reviewCycleDays = body.reviewCycleDays;
        doc.nextReviewAt = body.reviewCycleDays === null ? null : mockDateTime();
        if (body.expireAt !== undefined) doc.expireAt = body.expireAt;
      }
    }
    return ok(null, `已为 ${body.ids.length} 篇文档设置复审`);
  }),

  mock(wikiGovernanceContract.importDocs, ({ body, ok }) => {
    const docIds: number[] = [];
    for (const file of body.files) {
      const headingMatch = /^#\s+(.+)$/m.exec(file.content);
      const doc = newDraftDoc({
        spaceId: body.spaceId,
        parentId: body.parentId ?? null,
        title: (headingMatch?.[1] ?? file.name.replace(/\.(md|markdown|txt)$/i, '')).trim().slice(0, 200),
        summary: null,
        content: file.content,
        tagIds: [],
        requireReadReceipt: false,
        sort: 0,
      });
      mockWikiDocs.push(doc);
      docIds.push(doc.id);
    }
    return ok({ importedCount: docIds.length, docIds }, `已导入 ${docIds.length} 篇草稿`);
  }),
];

export const wikiHandlers = [
  ...spaceHandlers,
  ...docHandlers,
  ...templateHandlers,
  ...tagHandlers,
  ...commentHandlers,
  ...statsHandlers,
  ...governanceHandlers,
];
