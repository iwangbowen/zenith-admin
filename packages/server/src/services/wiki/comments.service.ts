import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { CreateWikiCommentInput, WikiCommentStatus } from '@zenith/shared/wiki';
import { db } from '../../db';
import { users, wikiComments, wikiDocs, type WikiCommentRow } from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { getSettings } from '../../lib/settings';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { getWikiDoc } from './docs.service';
import { notifyWikiDocCommented, notifyWikiMentioned } from './notifications.service';
import { getMySpaceRole, spaceRoleAtLeast } from './spaces.service';

interface CommentExtras {
  authorName?: string | null;
  docTitle?: string;
}

export function mapWikiComment(row: WikiCommentRow, extras: CommentExtras = {}) {
  return {
    id: row.id,
    docId: row.docId,
    parentId: row.parentId ?? null,
    content: row.content,
    status: row.status,
    mentionedUserIds: row.mentionedUserIds ?? [],
    isQuestion: row.isQuestion,
    resolvedAt: row.resolvedAt ? formatDateTime(row.resolvedAt) : null,
    authorId: row.authorId ?? null,
    authorName: extras.authorName ?? null,
    ...(extras.docTitle !== undefined ? { docTitle: extras.docTitle } : {}),
    createdAt: formatDateTime(row.createdAt),
  };
}

// ─── 文档下的评论（用户端）────────────────────────────────────────────────────

/** 文档评论树：顶层评论 + 二级回复，只展示 visible */
export async function listWikiDocComments(docId: number) {
  await getWikiDoc(docId); // 复用文档访问控制
  const rows = await db.select({
    comment: wikiComments,
    authorName: users.nickname,
  }).from(wikiComments)
    .leftJoin(users, eq(wikiComments.authorId, users.id))
    .where(and(eq(wikiComments.docId, docId), eq(wikiComments.status, 'visible')))
    .orderBy(desc(wikiComments.id));

  const mapped = rows.map((r) => ({ ...mapWikiComment(r.comment, { authorName: r.authorName }), replies: [] as ReturnType<typeof mapWikiComment>[] }));
  const byId = new Map(mapped.map((c) => [c.id, c]));
  const roots: typeof mapped = [];
  for (const c of mapped) {
    const parent = c.parentId !== null ? byId.get(c.parentId) : undefined;
    if (parent) parent.replies.push(c);
    else roots.push(c);
  }
  // 回复按时间正序更符合阅读习惯
  for (const r of roots) r.replies.reverse();
  return roots;
}

export async function createWikiComment(data: CreateWikiCommentInput) {
  const { commentsEnabled } = await getSettings('wiki');
  if (!commentsEnabled) throw new HTTPException(400, { message: '评论功能已关闭' });
  const doc = await getWikiDoc(data.docId);
  if (doc.status !== 'published') throw new HTTPException(400, { message: '只能评论已发布的文档' });
  if (data.parentId) {
    const [parent] = await db.select({ id: wikiComments.id, docId: wikiComments.docId }).from(wikiComments)
      .where(eq(wikiComments.id, data.parentId)).limit(1);
    if (!parent || parent.docId !== data.docId) {
      throw new HTTPException(400, { message: '回复的评论不存在' });
    }
  }
  const [row] = await db.insert(wikiComments).values({
    docId: data.docId,
    parentId: data.parentId ?? null,
    content: data.content,
    mentionedUserIds: data.mentionedUserIds,
    isQuestion: data.isQuestion,
    authorId: currentUserId(),
  }).returning();
  // 通知：作者与订阅者收到新评论；被 @ 的人单独通知
  await notifyWikiDocCommented(data.docId, data.content);
  await notifyWikiMentioned(data.docId, data.mentionedUserIds);
  return mapWikiComment(row, { authorName: null });
}

/** 标记问题评论为已解决：评论作者、文档作者或空间管理员可操作 */
export async function resolveWikiComment(id: number) {
  const row = await ensureWikiCommentExists(id);
  if (!row.isQuestion) throw new HTTPException(400, { message: '只有标记为问题的评论可以解决' });
  if (row.resolvedAt) throw new HTTPException(400, { message: '该问题已解决' });
  const doc = await db.query.wikiDocs.findFirst({
    where: eq(wikiDocs.id, row.docId),
    columns: { spaceId: true, createdBy: true },
  });
  const me = currentUserId();
  const allowed = row.authorId === me
    || doc?.createdBy === me
    || spaceRoleAtLeast(doc ? await getMySpaceRole(doc.spaceId) : null, 'admin');
  if (!allowed) throw new HTTPException(403, { message: '只有提问人、文档作者或空间管理员可以标记解决' });
  const [updated] = await db.update(wikiComments).set({ resolvedAt: new Date() })
    .where(eq(wikiComments.id, id)).returning();
  return mapWikiComment(updated);
}

/** 删除自己的评论；空间管理员可删任意评论（管理端走 removeWikiComment） */
export async function deleteMyWikiComment(id: number) {
  const row = await ensureWikiCommentExists(id);
  if (row.authorId !== currentUserId()) {
    const doc = await db.query.wikiDocs.findFirst({ where: eq(wikiDocs.id, row.docId), columns: { spaceId: true } });
    const role = doc ? await getMySpaceRole(doc.spaceId) : null;
    if (!spaceRoleAtLeast(role, 'admin')) {
      throw new HTTPException(403, { message: '只能删除自己的评论' });
    }
  }
  await db.delete(wikiComments).where(eq(wikiComments.id, id));
}

// ─── 管理端 ───────────────────────────────────────────────────────────────────

export interface ListWikiCommentsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: WikiCommentStatus;
  docId?: number;
  startTime?: string;
  endTime?: string;
}

export async function listWikiComments(q: ListWikiCommentsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [wikiComments.content]),
    q.status ? eq(wikiComments.status, q.status) : undefined,
    q.docId !== undefined ? eq(wikiComments.docId, q.docId) : undefined,
    ...dateRangeConditions(wikiComments.createdAt, q.startTime, q.endTime),
    // 评论跟随文档的租户边界
    isNull(wikiDocs.deletedAt),
    tenantCondition(wikiDocs, currentUser()),
  );

  const listQuery = db.select({
    comment: wikiComments,
    authorName: users.nickname,
    docTitle: wikiDocs.title,
  }).from(wikiComments)
    .innerJoin(wikiDocs, eq(wikiComments.docId, wikiDocs.id))
    .leftJoin(users, eq(wikiComments.authorId, users.id))
    .where(where)
    .orderBy(desc(wikiComments.id));

  const countQuery = db.select({ count: sql<number>`count(*)::int` }).from(wikiComments)
    .innerJoin(wikiDocs, eq(wikiComments.docId, wikiDocs.id))
    .where(where);

  const [countRows, rows] = await Promise.all([
    countQuery,
    withPagination(listQuery.$dynamic(), page, pageSize),
  ]);

  return {
    list: rows.map((r) => mapWikiComment(r.comment, { authorName: r.authorName, docTitle: r.docTitle })),
    total: countRows[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function ensureWikiCommentExists(id: number) {
  const [row] = await db.select().from(wikiComments).where(eq(wikiComments.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '评论不存在' });
  return row;
}

export async function updateWikiCommentStatus(id: number, status: WikiCommentStatus) {
  const row = await ensureWikiCommentExists(id);
  await db.update(wikiComments).set({ status }).where(eq(wikiComments.id, id));
  return mapWikiComment({ ...row, status });
}

export async function removeWikiComment(id: number) {
  await ensureWikiCommentExists(id);
  await db.delete(wikiComments).where(eq(wikiComments.id, id));
}
