import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type {
  CreateWikiDocInput,
  MoveWikiDocInput,
  ReviewWikiDocInput,
  UpdateWikiDocInput,
  WikiDocStatus,
  WikiDocTreeNode,
} from '@zenith/shared/wiki';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  businessFiles,
  users,
  wikiComments,
  wikiDocFavorites,
  wikiDocReadReceipts,
  wikiDocSubscriptions,
  wikiDocTags,
  wikiDocVersions,
  wikiDocViews,
  wikiDocs,
  wikiReviewRecords,
  wikiSearchLogs,
  wikiSpaceMembers,
  wikiSpaces,
  wikiTags,
  type WikiDocRow,
} from '../../db/schema';
import { currentUser, currentUserId, isSuperAdmin, setAuditBefore } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { getSettings } from '../../lib/settings';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { listBusinessFiles, saveBusinessFiles } from '../files/business-files.service';
import { wikiDeletedDocVisibilityCondition, wikiDocStatusVisibilityCondition, wikiSpaceAccessCondition } from './access';
import { notifyWikiDocPublished, notifyWikiDocReviewed } from './notifications.service';
import { removeWikiDocFromAiKb, syncPublishedWikiDocToAiKb } from './ai-sync.service';
import { ensureSpaceRole, getMySpaceRole, spaceRoleAtLeast } from './spaces.service';
import { buildTree } from '@zenith/shared/core';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapWikiDoc(row: WikiDocRow) {
  return {
    id: row.id,
    spaceId: row.spaceId,
    parentId: row.parentId ?? null,
    title: row.title,
    summary: row.summary ?? null,
    status: row.status,
    rejectReason: row.rejectReason ?? null,
    sort: row.sort,
    isPinned: row.isPinned,
    viewCount: row.viewCount,
    currentVersion: row.currentVersion,
    revision: row.revision,
    requireReadReceipt: row.requireReadReceipt,
    ownerId: row.ownerId ?? null,
    expireAt: formatNullableDateTime(row.expireAt),
    reviewCycleDays: row.reviewCycleDays ?? null,
    nextReviewAt: formatNullableDateTime(row.nextReviewAt),
    isArchived: row.isArchived,
    publishedAt: formatNullableDateTime(row.publishedAt),
    deletedAt: formatNullableDateTime(row.deletedAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListWikiDocsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  spaceId?: number;
  status?: WikiDocStatus;
  tagId?: number;
  /** true = 只查回收站；默认只查未删除 */
  deleted?: boolean;
  /** 只查当前用户创建的 */
  mine?: boolean;
  /** 只查当前用户提交过审核的 */
  submitted?: boolean;
  /** true = 只查已归档；默认排除已归档 */
  archived?: boolean;
}

interface WikiDocWhereInput extends ListWikiDocsQuery {
  id?: number;
}

function buildWikiDocWhere(q: WikiDocWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(wikiDocs.id, q.id) : undefined,
    keywordCondition(q.keyword, [wikiDocs.title, wikiDocs.summary, wikiDocs.content]),
    q.spaceId !== undefined ? eq(wikiDocs.spaceId, q.spaceId) : undefined,
    q.status ? eq(wikiDocs.status, q.status) : undefined,
    q.deleted ? isNotNull(wikiDocs.deletedAt) : isNull(wikiDocs.deletedAt),
    q.mine ? eq(wikiDocs.createdBy, currentUserId()) : undefined,
    q.submitted
      ? inArray(
        wikiDocs.id,
        db.select({ id: wikiReviewRecords.docId }).from(wikiReviewRecords).where(buildWhere(
          eq(wikiReviewRecords.actorId, currentUserId()),
          eq(wikiReviewRecords.action, 'submit'),
        )),
      )
      : undefined,
    // 归档文档默认从所有读取口隐藏，仅治理页显式查询
    q.id === undefined ? eq(wikiDocs.isArchived, q.archived ?? false) : undefined,
    tenantCondition(wikiDocs, currentUser()),
    // 统一访问边界：私有空间元数据不得被非成员枚举；未发布内容仅作者 / editor+ 可见
    wikiSpaceAccessCondition(),
    q.deleted ? wikiDeletedDocVisibilityCondition() : wikiDocStatusVisibilityCondition(),
  );
}

async function attachDocExtras(rows: WikiDocRow[], opts: { spaceName?: boolean } = {}) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const [tagRows, authorRows, spaceRows] = await Promise.all([
    db.select({ docId: wikiDocTags.docId, id: wikiTags.id, name: wikiTags.name, color: wikiTags.color })
      .from(wikiDocTags)
      .innerJoin(wikiTags, eq(wikiDocTags.tagId, wikiTags.id))
      .where(inArray(wikiDocTags.docId, ids)),
    db.select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, [...new Set(
        rows.flatMap((r) => [r.createdBy, r.ownerId]).filter((v): v is number => v !== null),
      )])),
    opts.spaceName
      ? db.select({ id: wikiSpaces.id, name: wikiSpaces.name })
        .from(wikiSpaces)
        .where(inArray(wikiSpaces.id, [...new Set(rows.map((r) => r.spaceId))]))
      : Promise.resolve([]),
  ]);

  const tagMap = new Map<number, { id: number; name: string; color: string | null }[]>();
  for (const t of tagRows) {
    const list = tagMap.get(t.docId) ?? [];
    list.push({ id: t.id, name: t.name, color: t.color ?? null });
    tagMap.set(t.docId, list);
  }
  const authorMap = new Map(authorRows.map((u) => [u.id, u.nickname]));
  const spaceMap = new Map(spaceRows.map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    ...mapWikiDoc(r),
    tags: tagMap.get(r.id) ?? [],
    tagIds: (tagMap.get(r.id) ?? []).map((t) => t.id),
    authorName: (r.createdBy !== null ? authorMap.get(r.createdBy) : null) ?? null,
    ownerName: (r.ownerId !== null ? authorMap.get(r.ownerId) : null) ?? null,
    ...(opts.spaceName ? { spaceName: spaceMap.get(r.spaceId) ?? '' } : {}),
  }));
}

// ─── 列表与详情 ───────────────────────────────────────────────────────────────

export async function listWikiDocs(q: ListWikiDocsQuery) {
  const { page = 1, pageSize = 10 } = q;
  let where = buildWikiDocWhere(q);
  if (q.tagId !== undefined) {
    where = and(
      where,
      inArray(wikiDocs.id, db.select({ id: wikiDocTags.docId }).from(wikiDocTags).where(eq(wikiDocTags.tagId, q.tagId))),
    );
  }

  const [total, rows] = await Promise.all([
    db.$count(wikiDocs, where),
    withPagination(
      db.select().from(wikiDocs).where(where)
        .orderBy(desc(wikiDocs.isPinned), asc(wikiDocs.sort), desc(wikiDocs.updatedAt)).$dynamic(),
      page,
      pageSize,
    ),
  ]);

  return { list: await attachDocExtras(rows, { spaceName: true }), total, page, pageSize };
}

export async function ensureWikiDocExists(id: number, opts: { allowDeleted?: boolean } = {}) {
  const [row] = await db.select().from(wikiDocs)
    .where(buildWhere(eq(wikiDocs.id, id), tenantCondition(wikiDocs, currentUser())))
    .limit(1);
  if (!row || (!opts.allowDeleted && row.deletedAt !== null)) {
    throw new HTTPException(404, { message: '文档不存在' });
  }
  return row;
}

/** 读取详情：viewer 只能看已发布文档，editor 及以上可见全部状态 */
export async function getWikiDoc(id: number) {
  const row = await ensureWikiDocExists(id);
  const role = await getMySpaceRole(row.spaceId);
  if (!role) throw new HTTPException(403, { message: '没有该知识空间的访问权限' });
  const isAuthor = row.createdBy === currentUserId();
  if (row.status !== 'published' && !spaceRoleAtLeast(role, 'editor') && !isAuthor) {
    throw new HTTPException(403, { message: '文档尚未发布' });
  }

  const [extras] = await attachDocExtras([row], { spaceName: true });
  const uid = currentUserId();
  const [
    favorited,
    favoriteCount,
    commentCount,
    attachments,
    subscribed,
    readConfirmed,
    readReceiptCount,
    commentsEnabled,
  ] = await Promise.all([
    db.$count(wikiDocFavorites, and(eq(wikiDocFavorites.docId, id), eq(wikiDocFavorites.userId, uid))),
    db.$count(wikiDocFavorites, eq(wikiDocFavorites.docId, id)),
    db.$count(wikiComments, and(eq(wikiComments.docId, id), eq(wikiComments.status, 'visible'))),
    listBusinessFiles('wiki_doc', id),
    db.$count(wikiDocSubscriptions, and(eq(wikiDocSubscriptions.docId, id), eq(wikiDocSubscriptions.userId, uid))),
    db.$count(wikiDocReadReceipts, and(eq(wikiDocReadReceipts.docId, id), eq(wikiDocReadReceipts.userId, uid))),
    db.$count(wikiDocReadReceipts, eq(wikiDocReadReceipts.docId, id)),
    getSettings('wiki').then((s) => s.commentsEnabled),
  ]);

  return {
    ...extras,
    content: row.content,
    favorited: favorited > 0,
    favoriteCount,
    commentCount,
    commentsEnabled,
    attachments,
    subscribed: subscribed > 0,
    readConfirmed: readConfirmed > 0,
    readReceiptCount,
  };
}

// ─── 目录树 ───────────────────────────────────────────────────────────────────

export async function getWikiDocTree(spaceId: number): Promise<WikiDocTreeNode[]> {
  const role = await getMySpaceRole(spaceId);
  if (!role) throw new HTTPException(403, { message: '没有该知识空间的访问权限' });

  const canSeeAll = spaceRoleAtLeast(role, 'editor');
  const rows = await db.select({
    id: wikiDocs.id,
    parentId: wikiDocs.parentId,
    title: wikiDocs.title,
    status: wikiDocs.status,
    isPinned: wikiDocs.isPinned,
    sort: wikiDocs.sort,
    createdBy: wikiDocs.createdBy,
  }).from(wikiDocs)
    .where(buildWhere(
      eq(wikiDocs.spaceId, spaceId),
      isNull(wikiDocs.deletedAt),
      eq(wikiDocs.isArchived, false),
      canSeeAll ? undefined : sql`(${wikiDocs.status} = 'published' or ${wikiDocs.createdBy} = ${currentUserId()})`,
    ))
    .orderBy(desc(wikiDocs.isPinned), asc(wikiDocs.sort), asc(wikiDocs.id));

  // 父节点被过滤掉（未发布等）时提升为根节点，保证子文档可达
  return buildTree<WikiDocTreeNode>(
    rows.map((r) => ({ id: r.id, parentId: r.parentId ?? null, title: r.title, status: r.status, isPinned: r.isPinned, sort: r.sort, createdBy: r.createdBy ?? null })),
    { keepEmptyChildren: true },
  );
}

// ─── 创建与更新 ───────────────────────────────────────────────────────────────

/** 先删后插，原子性替换文档标签 */
async function setWikiDocTags(executor: DbExecutor, docId: number, tagIds: number[]) {
  await executor.delete(wikiDocTags).where(eq(wikiDocTags.docId, docId));
  if (tagIds.length > 0) {
    await executor.insert(wikiDocTags).values(tagIds.map((tagId) => ({ docId, tagId })));
  }
}

async function ensureParentValid(spaceId: number, parentId: number | null | undefined, selfId?: number) {
  if (!parentId) return;
  const [parent] = await db.select({ id: wikiDocs.id, spaceId: wikiDocs.spaceId, parentId: wikiDocs.parentId })
    .from(wikiDocs)
    .where(buildWhere(eq(wikiDocs.id, parentId), isNull(wikiDocs.deletedAt)))
    .limit(1);
  if (!parent || parent.spaceId !== spaceId) {
    throw new HTTPException(400, { message: '父文档不存在或不在同一空间' });
  }
  if (selfId === undefined) return;
  // 防环：父链上不得出现自身
  let cursor: number | null = parent.id;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === selfId) throw new HTTPException(400, { message: '不能把文档移动到自己的子层级下' });
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const [row]: { parentId: number | null }[] = await db.select({ parentId: wikiDocs.parentId })
      .from(wikiDocs).where(eq(wikiDocs.id, cursor)).limit(1);
    cursor = row?.parentId ?? null;
  }
}

export async function createWikiDoc(data: CreateWikiDocInput) {
  await ensureSpaceRole(data.spaceId, 'editor');
  await ensureParentValid(data.spaceId, data.parentId);

  const row = await db.transaction(async (tx) => {
    // 新文档追加到目标层级末尾，保持手工排序不被打乱
    const [{ maxSort }] = await tx.select({ maxSort: sql<number>`coalesce(max(${wikiDocs.sort}), -1)` })
      .from(wikiDocs)
      .where(buildWhere(
        eq(wikiDocs.spaceId, data.spaceId),
        data.parentId ? eq(wikiDocs.parentId, data.parentId) : isNull(wikiDocs.parentId),
        isNull(wikiDocs.deletedAt),
      ));
    const [created] = await tx.insert(wikiDocs).values({
      spaceId: data.spaceId,
      parentId: data.parentId ?? null,
      title: data.title,
      summary: data.summary ?? null,
      content: data.content,
      sort: maxSort + 1,
      requireReadReceipt: data.requireReadReceipt,
      ownerId: currentUserId(),
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    await setWikiDocTags(tx, created.id, data.tagIds);
    if (data.fileIds.length > 0) await saveBusinessFiles(tx, 'wiki_doc', created.id, data.fileIds);
    await tx.insert(wikiDocVersions).values({
      docId: created.id,
      version: 1,
      title: created.title,
      content: created.content,
      changeNote: '创建文档',
      authorId: currentUserId(),
    });
    return created;
  });
  return getWikiDoc(row.id);
}

async function ensureDocEditable(row: WikiDocRow) {
  const role = await getMySpaceRole(row.spaceId);
  if (spaceRoleAtLeast(role, 'admin')) return;
  const isAuthor = row.createdBy === currentUserId();
  if (spaceRoleAtLeast(role, 'editor') && isAuthor) return;
  throw new HTTPException(403, { message: '只有文档作者或空间管理员可以操作' });
}

export async function updateWikiDoc(id: number, data: UpdateWikiDocInput) {
  const before = await ensureWikiDocExists(id);
  await ensureDocEditable(before);
  // 审核中锁定：审批必须绑定提交时的版本，撤回后才能继续编辑
  if (before.status === 'pending') {
    throw new HTTPException(400, { message: '文档正在审核中，请先撤回再编辑' });
  }
  // 乐观锁：前端携带其加载时的 revision，不一致说明已被他人修改
  if (data.revision !== undefined && data.revision !== before.revision) {
    throw new HTTPException(409, { message: '文档已被他人修改，请刷新后重试' });
  }

  const contentChanged = data.content !== undefined && data.content !== before.content;
  const titleChanged = data.title !== undefined && data.title !== before.title;
  const nextVersion = contentChanged || titleChanged ? before.currentVersion + 1 : before.currentVersion;

  await db.transaction(async (tx) => {
    const [updated] = await tx.update(wikiDocs).set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.sort !== undefined ? { sort: data.sort } : {}),
      ...(data.isPinned !== undefined ? { isPinned: data.isPinned } : {}),
      ...(data.requireReadReceipt !== undefined ? { requireReadReceipt: data.requireReadReceipt } : {}),
      currentVersion: nextVersion,
      revision: sql`${wikiDocs.revision} + 1`,
      // 已发布文档编辑正文后回到草稿，需重新走发布流程
      ...(contentChanged && before.status === 'published' ? { status: 'draft' as const } : {}),
    }).where(buildWhere(
      eq(wikiDocs.id, id),
      // DB 层双保险：条件更新防止校验与写入之间的竞态
      data.revision !== undefined ? eq(wikiDocs.revision, data.revision) : undefined,
    )).returning({ id: wikiDocs.id });
    if (!updated) {
      throw new HTTPException(data.revision !== undefined ? 409 : 404, {
        message: data.revision !== undefined ? '文档已被他人修改，请刷新后重试' : '文档不存在',
      });
    }

    if (data.tagIds !== undefined) await setWikiDocTags(tx, id, data.tagIds);
    if (data.fileIds !== undefined) await saveBusinessFiles(tx, 'wiki_doc', id, data.fileIds);
    if (contentChanged || titleChanged) {
      await tx.insert(wikiDocVersions).values({
        docId: id,
        version: nextVersion,
        title: data.title ?? before.title,
        content: data.content ?? before.content,
        changeNote: data.changeNote ?? null,
        authorId: currentUserId(),
      });
    }
  });
  // 已发布文档被打回草稿后，移除 AI 知识库中的旧副本
  if (contentChanged && before.status === 'published') await removeWikiDocFromAiKb(id);
  return getWikiDoc(id);
}

export async function moveWikiDoc(id: number, data: MoveWikiDocInput) {
  const row = await ensureWikiDocExists(id);
  await ensureSpaceRole(row.spaceId, 'editor');
  await ensureParentValid(row.spaceId, data.parentId, id);

  await db.transaction(async (tx) => {
    // 目标层级兄弟（不含自身；排除回收站与归档，与拖拽方看到的树一致），按展示序取出
    const siblings = await tx.select({
      id: wikiDocs.id,
      sort: wikiDocs.sort,
      updatedAt: wikiDocs.updatedAt,
      updatedBy: wikiDocs.updatedBy,
    }).from(wikiDocs)
      .where(buildWhere(
        eq(wikiDocs.spaceId, row.spaceId),
        data.parentId === null ? isNull(wikiDocs.parentId) : eq(wikiDocs.parentId, data.parentId),
        isNull(wikiDocs.deletedAt),
        eq(wikiDocs.isArchived, false),
        ne(wikiDocs.id, id),
      ))
      .orderBy(desc(wikiDocs.isPinned), asc(wikiDocs.sort), asc(wikiDocs.id));

    const ordered = siblings.map((s) => s.id);
    const insertAt = data.index === undefined ? ordered.length : Math.min(data.index, ordered.length);
    ordered.splice(insertAt, 0, id);

    for (const [position, docId] of ordered.entries()) {
      if (docId === id) {
        await tx.update(wikiDocs).set({ parentId: data.parentId, sort: position }).where(eq(wikiDocs.id, id));
        continue;
      }
      const sibling = siblings.find((s) => s.id === docId)!;
      if (sibling.sort === position) continue;
      // 兄弟文档只是让位重排，不算内容变更：显式回填原 updatedAt/updatedBy，
      // 覆盖 $onUpdate 与审计代理的自动注入，避免「更新于」被批量刷新
      await tx.update(wikiDocs)
        .set({ sort: position, updatedAt: sibling.updatedAt, updatedBy: sibling.updatedBy })
        .where(eq(wikiDocs.id, docId));
    }
  });
  return getWikiDoc(id);
}

// ─── 发布状态机 ───────────────────────────────────────────────────────────────

/** 提交发布：draft/rejected → pending；审批关闭时直接 published */
export async function submitWikiDoc(id: number) {
  const row = await ensureWikiDocExists(id);
  await ensureDocEditable(row);
  if (row.status !== 'draft' && row.status !== 'rejected') {
    throw new HTTPException(400, { message: '只有草稿或已驳回的文档可以提交发布' });
  }

  const { requireApproval } = await getSettings('wiki');
  const next = requireApproval
    ? { status: 'pending' as const, rejectReason: null }
    : { status: 'published' as const, rejectReason: null, publishedAt: new Date() };
  await db.transaction(async (tx) => {
    await tx.update(wikiDocs).set(next).where(eq(wikiDocs.id, id));
    await tx.insert(wikiReviewRecords).values({
      docId: id, version: row.currentVersion, action: 'submit', actorId: currentUserId(),
    });
    if (next.status === 'published') {
      // 审批关闭：提交即发布，补一条自动通过记录使时间线完整
      await tx.insert(wikiReviewRecords).values({
        docId: id, version: row.currentVersion, action: 'approve', actorId: currentUserId(), reason: '审批未开启，提交即发布',
      });
    }
  });
  if (next.status === 'published') {
    await syncPublishedWikiDocToAiKb(id);
    await notifyWikiDocPublished(id);
  }
  return getWikiDoc(id);
}

/** 撤回审核：pending → draft，仅提交人本人可撤回 */
export async function withdrawWikiDoc(id: number) {
  const row = await ensureWikiDocExists(id);
  if (row.status !== 'pending') throw new HTTPException(400, { message: '只有待审核的文档可以撤回' });
  if (row.createdBy !== currentUserId() && !isSuperAdmin()) {
    throw new HTTPException(403, { message: '只有提交人可以撤回审核' });
  }
  await db.transaction(async (tx) => {
    await tx.update(wikiDocs).set({ status: 'draft' }).where(eq(wikiDocs.id, id));
    await tx.insert(wikiReviewRecords).values({
      docId: id, version: row.currentVersion, action: 'withdraw', actorId: currentUserId(),
    });
  });
  return getWikiDoc(id);
}

/** 审核：pending → published / rejected */
export async function reviewWikiDoc(id: number, data: ReviewWikiDocInput) {
  const row = await ensureWikiDocExists(id);
  if (row.status !== 'pending') throw new HTTPException(400, { message: '只有待审核的文档可以审核' });
  setAuditBefore(mapWikiDoc(row));

  const next = data.action === 'approve'
    ? { status: 'published' as const, rejectReason: null, publishedAt: new Date() }
    : { status: 'rejected' as const, rejectReason: data.reason ?? null };
  await db.transaction(async (tx) => {
    await tx.update(wikiDocs).set(next).where(eq(wikiDocs.id, id));
    await tx.insert(wikiReviewRecords).values({
      docId: id,
      version: row.currentVersion,
      action: data.action === 'approve' ? 'approve' : 'reject',
      actorId: currentUserId(),
      reason: data.reason ?? null,
    });
  });
  if (next.status === 'published') {
    await syncPublishedWikiDocToAiKb(id);
    await notifyWikiDocPublished(id);
  }
  await notifyWikiDocReviewed(id, data.action === 'approve', data.reason);
  return getWikiDoc(id);
}

// ─── 审核时间线 ───────────────────────────────────────────────────────────────

/** 文档的审核时间线（提交/通过/驳回/撤回全记录） */
export async function listWikiDocReviewRecords(docId: number) {
  await getWikiDoc(docId); // 复用详情访问控制
  const rows = await db.select({
    id: wikiReviewRecords.id,
    docId: wikiReviewRecords.docId,
    version: wikiReviewRecords.version,
    action: wikiReviewRecords.action,
    actorId: wikiReviewRecords.actorId,
    actorName: users.nickname,
    reason: wikiReviewRecords.reason,
    createdAt: wikiReviewRecords.createdAt,
  }).from(wikiReviewRecords)
    .leftJoin(users, eq(wikiReviewRecords.actorId, users.id))
    .where(eq(wikiReviewRecords.docId, docId))
    .orderBy(desc(wikiReviewRecords.id));
  return rows.map((r) => ({
    ...r,
    actorId: r.actorId ?? null,
    actorName: r.actorName ?? null,
    reason: r.reason ?? null,
    createdAt: formatDateTime(r.createdAt),
  }));
}

/** 我处理过的审核记录（通过/驳回），供审核中心「已处理」视图 */
export async function listMyProcessedReviews(q: { page?: number; pageSize?: number }) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildWhere(
    eq(wikiReviewRecords.actorId, currentUserId()),
    inArray(wikiReviewRecords.action, ['approve', 'reject']),
  );

  const [total, rows] = await Promise.all([
    db.$count(wikiReviewRecords, where),
    withPagination(
      db.select({
        id: wikiReviewRecords.id,
        docId: wikiReviewRecords.docId,
        docTitle: wikiDocs.title,
        version: wikiReviewRecords.version,
        action: wikiReviewRecords.action,
        reason: wikiReviewRecords.reason,
        createdAt: wikiReviewRecords.createdAt,
      }).from(wikiReviewRecords)
        .innerJoin(wikiDocs, eq(wikiReviewRecords.docId, wikiDocs.id))
        .where(where)
        .orderBy(desc(wikiReviewRecords.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return {
    list: rows.map((r) => ({ ...r, reason: r.reason ?? null, createdAt: formatDateTime(r.createdAt) })),
    total,
    page,
    pageSize,
  };
}

// ─── 订阅与阅读确认 ───────────────────────────────────────────────────────────

export async function subscribeWikiDoc(docId: number, subscribe: boolean) {
  await getWikiDoc(docId); // 复用访问控制
  if (subscribe) {
    await db.insert(wikiDocSubscriptions).values({ docId, userId: currentUserId() }).onConflictDoNothing();
  } else {
    await db.delete(wikiDocSubscriptions)
      .where(and(eq(wikiDocSubscriptions.docId, docId), eq(wikiDocSubscriptions.userId, currentUserId())));
  }
}

/** 确认已读（仅 requireReadReceipt 且已发布的文档） */
export async function confirmWikiDocRead(docId: number) {
  const doc = await getWikiDoc(docId);
  if (!doc.requireReadReceipt || doc.status !== 'published') {
    throw new HTTPException(400, { message: '该文档不需要阅读确认' });
  }
  await db.insert(wikiDocReadReceipts).values({ docId, userId: currentUserId() }).onConflictDoNothing();
}

/** 阅读确认名单：已确认用户 + 未确认的空间成员（作者或空间管理员可见） */
export async function getWikiDocReadReceipts(docId: number) {
  const row = await ensureWikiDocExists(docId);
  const role = await getMySpaceRole(row.spaceId);
  const isAuthor = row.createdBy === currentUserId();
  if (!isAuthor && !spaceRoleAtLeast(role, 'admin')) {
    throw new HTTPException(403, { message: '只有文档作者或空间管理员可以查看已读名单' });
  }

  const [confirmedRows, memberRows] = await Promise.all([
    db.select({
      userId: wikiDocReadReceipts.userId,
      nickname: users.nickname,
      confirmedAt: wikiDocReadReceipts.createdAt,
    }).from(wikiDocReadReceipts)
      .innerJoin(users, eq(wikiDocReadReceipts.userId, users.id))
      .where(eq(wikiDocReadReceipts.docId, docId))
      .orderBy(desc(wikiDocReadReceipts.createdAt)),
    db.select({ userId: wikiSpaceMembers.userId, nickname: users.nickname })
      .from(wikiSpaceMembers)
      .innerJoin(users, eq(wikiSpaceMembers.userId, users.id))
      .where(eq(wikiSpaceMembers.spaceId, row.spaceId)),
  ]);

  const confirmedIds = new Set(confirmedRows.map((r) => r.userId));
  return {
    confirmed: confirmedRows.map((r) => ({ ...r, confirmedAt: formatDateTime(r.confirmedAt) })),
    unconfirmed: memberRows.filter((m) => !confirmedIds.has(m.userId)),
  };
}

// ─── 版本 ─────────────────────────────────────────────────────────────────────

export async function listWikiDocVersions(docId: number, q: { page?: number; pageSize?: number }) {
  await getWikiDoc(docId); // 复用详情访问控制
  const { page = 1, pageSize = 10 } = q;
  const where = eq(wikiDocVersions.docId, docId);

  const [total, rows] = await Promise.all([
    db.$count(wikiDocVersions, where),
    withPagination(
      db.select({
        id: wikiDocVersions.id,
        docId: wikiDocVersions.docId,
        version: wikiDocVersions.version,
        title: wikiDocVersions.title,
        changeNote: wikiDocVersions.changeNote,
        authorId: wikiDocVersions.authorId,
        authorName: users.nickname,
        createdAt: wikiDocVersions.createdAt,
      }).from(wikiDocVersions)
        .leftJoin(users, eq(wikiDocVersions.authorId, users.id))
        .where(where)
        .orderBy(desc(wikiDocVersions.version)).$dynamic(),
      page,
      pageSize,
    ),
  ]);

  return {
    list: rows.map((r) => ({
      id: r.id,
      docId: r.docId,
      version: r.version,
      title: r.title,
      changeNote: r.changeNote ?? null,
      authorId: r.authorId ?? null,
      authorName: r.authorName ?? null,
      createdAt: formatDateTime(r.createdAt),
    })),
    total,
    page,
    pageSize,
  };
}

export async function getWikiDocVersion(docId: number, version: number) {
  await getWikiDoc(docId);
  const row = await db.query.wikiDocVersions.findFirst({
    where: and(eq(wikiDocVersions.docId, docId), eq(wikiDocVersions.version, version)),
    with: { author: { columns: { nickname: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '版本不存在' });
  return {
    id: row.id,
    docId: row.docId,
    version: row.version,
    title: row.title,
    content: row.content,
    changeNote: row.changeNote ?? null,
    authorId: row.authorId ?? null,
    authorName: row.author?.nickname ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function rollbackWikiDoc(docId: number, version: number) {
  const row = await ensureWikiDocExists(docId);
  await ensureDocEditable(row);
  const target = await db.query.wikiDocVersions.findFirst({
    where: and(eq(wikiDocVersions.docId, docId), eq(wikiDocVersions.version, version)),
  });
  if (!target) throw new HTTPException(404, { message: '版本不存在' });

  const nextVersion = row.currentVersion + 1;
  await db.transaction(async (tx) => {
    await tx.update(wikiDocs).set({
      title: target.title,
      content: target.content,
      currentVersion: nextVersion,
      // 回滚后回到草稿，需重新发布
      status: 'draft',
    }).where(eq(wikiDocs.id, docId));
    await tx.insert(wikiDocVersions).values({
      docId,
      version: nextVersion,
      title: target.title,
      content: target.content,
      changeNote: `回滚自 v${version}`,
      authorId: currentUserId(),
    });
  });
  // 回滚后退回草稿，移除 AI 知识库中的旧副本
  await removeWikiDocFromAiKb(docId);
  return getWikiDoc(docId);
}

// ─── 回收站 ───────────────────────────────────────────────────────────────────

export async function deleteWikiDoc(id: number) {
  const row = await ensureWikiDocExists(id);
  await ensureDocEditable(row);
  const childCount = await db.$count(wikiDocs, and(eq(wikiDocs.parentId, id), isNull(wikiDocs.deletedAt)));
  if (childCount > 0) throw new HTTPException(400, { message: '该文档下还有子文档，请先移动或删除子文档' });
  await db.update(wikiDocs).set({ deletedAt: new Date() }).where(eq(wikiDocs.id, id));
  await removeWikiDocFromAiKb(id);
}

export async function restoreWikiDoc(id: number) {
  const row = await ensureWikiDocExists(id, { allowDeleted: true });
  if (row.deletedAt === null) throw new HTTPException(400, { message: '文档不在回收站中' });
  // 父节点已被删除时还原到空间根级
  let parentId = row.parentId;
  if (parentId !== null) {
    const [parent] = await db.select({ id: wikiDocs.id }).from(wikiDocs)
      .where(and(eq(wikiDocs.id, parentId), isNull(wikiDocs.deletedAt))).limit(1);
    if (!parent) parentId = null;
  }
  await db.update(wikiDocs).set({ deletedAt: null, parentId }).where(eq(wikiDocs.id, id));
  // 已发布文档还原后恢复 AI 知识库同步
  if (row.status === 'published') await syncPublishedWikiDocToAiKb(id);
  return getWikiDoc(id);
}

export async function purgeWikiDoc(id: number) {
  const row = await ensureWikiDocExists(id, { allowDeleted: true });
  if (row.deletedAt === null) throw new HTTPException(400, { message: '只能彻底删除回收站中的文档' });
  setAuditBefore(mapWikiDoc(row));
  await db.transaction(async (tx) => {
    // business_files 是多态关联，无 FK 级联，需随文档一并清理
    await tx.delete(businessFiles).where(and(eq(businessFiles.businessType, 'wiki_doc'), eq(businessFiles.businessId, id)));
    await tx.delete(wikiDocs).where(eq(wikiDocs.id, id));
  });
  await removeWikiDocFromAiKb(id);
}

// ─── 收藏与浏览 ───────────────────────────────────────────────────────────────

export async function favoriteWikiDoc(docId: number, favorite: boolean) {
  await getWikiDoc(docId); // 复用访问控制
  if (favorite) {
    await db.insert(wikiDocFavorites).values({ docId, userId: currentUserId() }).onConflictDoNothing();
  } else {
    await db.delete(wikiDocFavorites)
      .where(and(eq(wikiDocFavorites.docId, docId), eq(wikiDocFavorites.userId, currentUserId())));
  }
}

export async function listMyFavoriteWikiDocs(q: { page?: number; pageSize?: number; keyword?: string }) {
  const { page = 1, pageSize = 10 } = q;
  const favoriteIds = db.select({ id: wikiDocFavorites.docId }).from(wikiDocFavorites)
    .where(eq(wikiDocFavorites.userId, currentUserId()));
  const where = buildWhere(
    inArray(wikiDocs.id, favoriteIds),
    isNull(wikiDocs.deletedAt),
    keywordCondition(q.keyword, [wikiDocs.title, wikiDocs.summary]),
    tenantCondition(wikiDocs, currentUser()),
    // 被移出私有空间成员后，收藏列表同样不可再泄露元数据
    wikiSpaceAccessCondition(),
    wikiDocStatusVisibilityCondition(),
  );

  const [total, rows] = await Promise.all([
    db.$count(wikiDocs, where),
    withPagination(
      db.select().from(wikiDocs).where(where).orderBy(desc(wikiDocs.updatedAt)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: await attachDocExtras(rows, { spaceName: true }), total, page, pageSize };
}

/** 浏览上报：写浏览日志并累加计数 */
export async function recordWikiDocView(docId: number) {
  const row = await ensureWikiDocExists(docId);
  if (row.status !== 'published') return;
  await Promise.all([
    db.insert(wikiDocViews).values({ docId, userId: currentUserId() }),
    db.update(wikiDocs).set({ viewCount: sql`${wikiDocs.viewCount} + 1` }).where(eq(wikiDocs.id, docId)),
  ]);
}

// ─── 全文检索与最近访问 ───────────────────────────────────────────────────────

/** 从正文提取关键词命中片段（前后各 60 字符） */
function extractSnippet(content: string, keyword: string): string {
  const plain = content.replace(/[#>*`\-|[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const idx = plain.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return plain.slice(0, 120);
  const start = Math.max(0, idx - 60);
  const end = Math.min(plain.length, idx + keyword.length + 60);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

export interface SearchWikiDocsQuery {
  page?: number;
  pageSize?: number;
  keyword: string;
  spaceId?: number;
  status?: WikiDocStatus;
  tagId?: number;
}

/** 全文检索：标题 > 摘要 > 正文加权排序，返回命中片段；首页时写入搜索日志 */
export async function searchWikiDocs(q: SearchWikiDocsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const kw = q.keyword.trim();
  let where = buildWikiDocWhere({ keyword: kw, spaceId: q.spaceId, status: q.status });
  if (q.tagId !== undefined) {
    where = and(
      where,
      inArray(wikiDocs.id, db.select({ id: wikiDocTags.docId }).from(wikiDocTags).where(eq(wikiDocTags.tagId, q.tagId))),
    );
  }

  const titleHit = keywordCondition(kw, [wikiDocs.title], 'ilike') ?? sql`false`;
  const summaryHit = keywordCondition(kw, [sql`coalesce(${wikiDocs.summary}, '')`], 'ilike') ?? sql`false`;
  const contentHit = keywordCondition(kw, [wikiDocs.content], 'ilike') ?? sql`false`;
  const rank = sql<number>`(
    (case when ${titleHit} then 4 else 0 end) +
    (case when ${summaryHit} then 2 else 0 end) +
    (case when ${contentHit} then 1 else 0 end)
  )`;

  const [total, rows] = await Promise.all([
    db.$count(wikiDocs, where),
    withPagination(
      db.select().from(wikiDocs).where(where)
        .orderBy(desc(rank), desc(wikiDocs.updatedAt)).$dynamic(),
      page,
      pageSize,
    ),
  ]);

  // 仅首页记录搜索日志，翻页不重复计数
  if (page === 1) {
    await db.insert(wikiSearchLogs).values({
      keyword: kw.slice(0, 200),
      resultCount: total,
      userId: currentUserId(),
      tenantId: getCreateTenantId(currentUser()),
    });
  }

  const list = (await attachDocExtras(rows, { spaceName: true }))
    .map((doc, i) => ({ ...doc, snippet: extractSnippet(rows[i].content, kw) }));
  return { list, total, page, pageSize };
}

/** 搜索点击回报：把当前用户最近一条同关键词日志标记为已点击 */
export async function reportWikiSearchClick(keyword: string, docId: number) {
  const [latest] = await db.select({ id: wikiSearchLogs.id }).from(wikiSearchLogs)
    .where(and(eq(wikiSearchLogs.userId, currentUserId()), eq(wikiSearchLogs.keyword, keyword.trim().slice(0, 200))))
    .orderBy(desc(wikiSearchLogs.id))
    .limit(1);
  if (latest) {
    await db.update(wikiSearchLogs).set({ clickedDocId: docId }).where(eq(wikiSearchLogs.id, latest.id));
  }
}

/** 最近访问：按当前用户浏览记录去重取最近 N 篇（经访问边界过滤） */
export async function listRecentWikiDocs(limit = 20) {
  const recent = await db.select({
    docId: wikiDocViews.docId,
    lastViewedAt: sql<string>`max(${wikiDocViews.createdAt})`,
  }).from(wikiDocViews)
    .where(eq(wikiDocViews.userId, currentUserId()))
    .groupBy(wikiDocViews.docId)
    .orderBy(desc(sql`max(${wikiDocViews.createdAt})`))
    .limit(limit);
  if (recent.length === 0) return [];

  const ids = recent.map((r) => r.docId);
  const rows = await db.select().from(wikiDocs)
    .where(buildWhere(inArray(wikiDocs.id, ids), buildWikiDocWhere({})));
  const orderMap = new Map(ids.map((id, i) => [id, i]));
  const sorted = [...rows].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  return attachDocExtras(sorted, { spaceName: true });
}
