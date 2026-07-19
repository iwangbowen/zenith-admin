import { eq, asc, desc, and, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsComments, cmsContents } from '../../db/schema';
import type { CmsCommentRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere } from '../../lib/where-helpers';
import { config } from '../../config';
import redis from '../../lib/redis';
import { sanitizeUserText } from './cms-sensitive-words.service';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsCommentStatus } from '@zenith/shared';

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
export function mapCmsComment(row: CmsCommentRow, contentTitle?: string | null) {
  return {
    id: row.id,
    siteId: row.siteId,
    contentId: row.contentId,
    contentTitle: contentTitle ?? null,
    nickname: row.nickname,
    content: row.content,
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
  ip: string;
  userAgent: string | null;
}

/** 前台评论提交：限流 + 敏感词过滤 → 待审核 */
export async function submitCmsComment(input: SubmitCommentInput) {
  await throttleFrontSubmit(input.ip);
  const [content] = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId, status: cmsContents.status, deletedAt: cmsContents.deletedAt })
    .from(cmsContents).where(eq(cmsContents.id, input.contentId)).limit(1);
  if (!content || content.status !== 'published' || content.deletedAt) {
    throw new HTTPException(404, { message: '内容不存在或未发布' });
  }
  const nickname = await sanitizeUserText(input.nickname.trim());
  const text = await sanitizeUserText(input.content.trim());
  const [row] = await db.insert(cmsComments).values({
    siteId: content.siteId,
    contentId: input.contentId,
    nickname,
    content: text,
    status: 'pending',
    ip: input.ip,
    userAgent: input.userAgent,
  }).returning();
  return mapCmsComment(row);
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
  page: number;
  pageSize: number;
}

export async function listCmsComments(q: ListCmsCommentsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsComments.siteId, q.siteId)];
  if (q.status) conditions.push(eq(cmsComments.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsComments, where),
    db.query.cmsComments.findMany({
      where,
      with: { content: { columns: { title: true } } },
      orderBy: desc(cmsComments.id),
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    }),
  ]);
  return { list: rows.map((r) => mapCmsComment(r, r.content?.title)), total, page: q.page, pageSize: q.pageSize };
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
