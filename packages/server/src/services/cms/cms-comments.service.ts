import { eq, asc, desc, and, inArray, isNull, isNotNull, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsComments, cmsContents, members } from '../../db/schema';
import type { CmsCommentRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, withPagination } from '../../lib/where-helpers';
import { config } from '../../config';
import redis from '../../lib/redis';
import { sanitizeUserText } from './cms-sensitive-words.service';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsCommentStatus } from '@zenith/shared';
import { alias } from 'drizzle-orm/pg-core';

const SUBMIT_RL_PREFIX = `${config.redis.keyPrefix}cms:submit:`;
const SUBMIT_RL_WINDOW_SECONDS = 60;
const SUBMIT_RL_MAX = 5;

/** 前台提交限流：同 IP 每分钟最多 5 次（评论/表单共用） */
export async function throttleFrontSubmit(ip: string): Promise<void> {
  const key = `${SUBMIT_RL_PREFIX}${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, SUBMIT_RL_WINDOW_SECONDS);
  if (count > SUBMIT_RL_MAX) {
    throw new HTTPException(429, { message: '提交过于频繁，请稍后再试' });
  }
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsComment(row: CmsCommentRow, extra?: { contentTitle?: string | null; parentNickname?: string | null; memberUsername?: string | null }) {
  return {
    id: row.id,
    siteId: row.siteId,
    contentId: row.contentId,
    contentTitle: extra?.contentTitle ?? null,
    parentId: row.parentId,
    parentNickname: extra?.parentNickname ?? null,
    memberId: row.memberId ?? null,
    memberUsername: extra?.memberUsername ?? null,
    nickname: row.nickname,
    content: row.content,
    likeCount: row.likeCount,
    status: row.status,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前台提交 ─────────────────────────────────────────────────────────────────
export interface SubmitCommentInput {
  contentId: number;
  nickname: string;
  content: string;
  /** 回复的父评论 id（0/缺省 = 顶级评论） */
  parentId?: number;
  /** 登录会员提交时携带（昵称仍写入 nickname 快照） */
  memberId?: number | null;
  ip: string;
  userAgent: string | null;
}

/** 前台评论提交：限流 + 敏感词过滤 → 待审核；回复统一挂到顶级评论下（两级树） */
export async function submitCmsComment(input: SubmitCommentInput) {
  await throttleFrontSubmit(input.ip);
  const [content] = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId, status: cmsContents.status, deletedAt: cmsContents.deletedAt })
    .from(cmsContents).where(eq(cmsContents.id, input.contentId)).limit(1);
  if (!content || content.status !== 'published' || content.deletedAt) {
    throw new HTTPException(404, { message: '内容不存在或未发布' });
  }
  let parentId = 0;
  if (input.parentId && input.parentId > 0) {
    const [parent] = await db.select({ id: cmsComments.id, contentId: cmsComments.contentId, parentId: cmsComments.parentId, status: cmsComments.status })
      .from(cmsComments).where(eq(cmsComments.id, input.parentId)).limit(1);
    if (!parent || parent.contentId !== input.contentId || parent.status !== 'approved') {
      throw new HTTPException(400, { message: '回复的评论不存在' });
    }
    // 两级树：回复"回复"时挂到其顶级评论下
    parentId = parent.parentId > 0 ? parent.parentId : parent.id;
  }
  const nickname = await sanitizeUserText(input.nickname.trim());
  const text = await sanitizeUserText(input.content.trim());
  const [row] = await db.insert(cmsComments).values({
    siteId: content.siteId,
    contentId: input.contentId,
    parentId,
    memberId: input.memberId ?? null,
    nickname,
    content: text,
    status: 'pending',
    ip: input.ip,
    userAgent: input.userAgent,
  }).returning();
  return mapCmsComment(row);
}

/** 前台匿名点赞：同 IP 对同评论 24h 去重；返回最新点赞数（null = 评论不存在/重复点赞） */
export async function likeCmsComment(commentId: number, ip: string): Promise<number | null> {
  const dedupeKey = `${config.redis.keyPrefix}cms:comment-like:${commentId}:${ip}`;
  const first = await redis.set(dedupeKey, '1', 'EX', 86_400, 'NX').catch(() => 'OK');
  if (!first) return null;
  const [row] = await db.update(cmsComments)
    .set({ likeCount: sql`${cmsComments.likeCount} + 1` })
    .where(and(eq(cmsComments.id, commentId), eq(cmsComments.status, 'approved')))
    .returning({ likeCount: cmsComments.likeCount });
  return row?.likeCount ?? null;
}

/** 前台渲染：内容的已审核评论（旧→新） */
export async function listApprovedComments(contentId: number, limit = 100) {
  const rows = await db.select().from(cmsComments)
    .where(and(eq(cmsComments.contentId, contentId), eq(cmsComments.status, 'approved')))
    .orderBy(asc(cmsComments.id))
    .limit(limit);
  return rows.map((r) => mapCmsComment(r));
}

// ─── 后台管理 ─────────────────────────────────────────────────────────────────
export interface ListCmsCommentsQuery {
  siteId: number;
  status?: CmsCommentStatus;
  /** 来源筛选：member = 会员评论；guest = 游客评论 */
  source?: 'member' | 'guest';
  page: number;
  pageSize: number;
}

export async function listCmsComments(q: ListCmsCommentsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsComments.siteId, q.siteId)];
  if (q.status) conditions.push(eq(cmsComments.status, q.status));
  if (q.source === 'member') conditions.push(isNotNull(cmsComments.memberId));
  if (q.source === 'guest') conditions.push(isNull(cmsComments.memberId));
  const where = mergeWhere(and(...conditions));
  // 注意：不能用 RQB `with: { content: ... }`——关系名与评论正文列 content 同名，会覆盖正文字段
  const parentComments = alias(cmsComments, 'parent_comments');
  const [total, rows] = await Promise.all([
    db.$count(cmsComments, where),
    withPagination(
      db.select({ comment: cmsComments, contentTitle: cmsContents.title, parentNickname: parentComments.nickname, memberUsername: members.username })
        .from(cmsComments)
        .leftJoin(cmsContents, eq(cmsComments.contentId, cmsContents.id))
        .leftJoin(parentComments, eq(cmsComments.parentId, parentComments.id))
        .leftJoin(members, eq(cmsComments.memberId, members.id))
        .where(where)
        .orderBy(desc(cmsComments.id))
        .$dynamic(),
      q.page, q.pageSize,
    ),
  ]);
  return {
    list: rows.map((r) => mapCmsComment(r.comment, { contentTitle: r.contentTitle, parentNickname: r.parentNickname, memberUsername: r.memberUsername })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** 批量审核（通过/拒绝），返回受影响内容 id（供路由触发静态刷新） */
export async function auditCmsComments(ids: number[], status: 'approved' | 'rejected'): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(cmsComments).where(inArray(cmsComments.id, ids));
  for (const siteId of new Set(rows.map((r) => r.siteId))) {
    await assertSiteAccess(siteId);
  }
  await db.update(cmsComments).set({ status }).where(inArray(cmsComments.id, ids));
  return [...new Set(rows.map((r) => r.contentId))];
}

/** 批量删除，返回受影响内容 id */
export async function deleteCmsComments(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(cmsComments).where(inArray(cmsComments.id, ids));
  for (const siteId of new Set(rows.map((r) => r.siteId))) {
    await assertSiteAccess(siteId);
  }
  await db.delete(cmsComments).where(inArray(cmsComments.id, ids));
  return [...new Set(rows.filter((r) => r.status === 'approved').map((r) => r.contentId))];
}

/** 待审核评论数（角标） */
export async function countPendingComments(siteId: number): Promise<number> {
  return db.$count(cmsComments, and(eq(cmsComments.siteId, siteId), eq(cmsComments.status, 'pending')));
}
