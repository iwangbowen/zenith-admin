import { and, desc, eq, sql, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsContents, cmsContentLikes, cmsContentFavorites, cmsMemberViewHistory, cmsChannels, cmsComments,
} from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { formatDateTime } from '../../lib/datetime';
import { currentMemberId } from '../../lib/member-context';
import { changePoints } from '../member/member-points.service';
import { submitCmsComment } from './cms-comments.service';
import { withPagination } from '../../lib/where-helpers';
import { CMS_INTERACTION_POINTS, CMS_INTERACTION_DAILY_LIMITS } from '@zenith/shared';
import type { CmsInteractionState, CmsMemberContentItem, CmsMemberComment, PaginatedResponse } from '@zenith/shared';

/** 每位会员保留的浏览历史上限（超出裁剪最旧） */
const VIEW_HISTORY_LIMIT = 100;

// ─── 积分联动（earn 记账 bizType='cms_interaction'；Redis NX 防重 + 日限额）──────
type InteractionAction = 'view' | 'like' | 'favorite' | 'contribution';

/**
 * 互动加积分（fire-and-forget，失败不影响主流程）：
 * - 每内容防重：{prefix}cms:pts:{action}:{memberId}:{contentId} SET NX（30 天窗口）
 * - 每日限额：{prefix}cms:pts:daily:{action}:{memberId}:{yyyymmdd} INCR（view/like/favorite）
 */
export async function awardInteractionPoints(memberId: number, contentId: number, action: InteractionAction): Promise<void> {
  const amount = CMS_INTERACTION_POINTS[action];
  if (!amount) return;
  try {
    const onceKey = `${config.redis.keyPrefix}cms:pts:${action}:${memberId}:${contentId}`;
    const acquired = await redis.set(onceKey, '1', 'EX', 30 * 24 * 3600, 'NX');
    if (!acquired) return;
    const dailyLimit = (CMS_INTERACTION_DAILY_LIMITS as Record<string, number>)[action];
    if (dailyLimit) {
      const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const dailyKey = `${config.redis.keyPrefix}cms:pts:daily:${action}:${memberId}:${today}`;
      const count = await redis.incr(dailyKey);
      if (count === 1) await redis.expire(dailyKey, 26 * 3600);
      if (count > dailyLimit) return;
    }
    await changePoints({
      memberId,
      type: 'earn',
      amount,
      bizType: 'cms_interaction',
      bizId: `${action}:${contentId}`,
      remark: `CMS 互动奖励（${action}）`,
    });
  } catch (err) {
    logger.warn(`[CMS] 互动积分发放失败 member=${memberId} content=${contentId} action=${action}`, err);
  }
}

/** 投稿发布积分（publishCmsContent 调用；每内容仅一次） */
export function awardContributionPoints(row: Pick<CmsContentRow, 'id' | 'memberId'>): void {
  if (!row.memberId) return;
  void awardInteractionPoints(row.memberId, row.id, 'contribution');
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
async function ensureInteractableContent(contentId: number): Promise<CmsContentRow> {
  const [row] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!row || row.deletedAt || row.status !== 'published') {
    throw new HTTPException(404, { message: '内容不存在或未发布' });
  }
  return row;
}

// ─── 点赞 / 收藏 ──────────────────────────────────────────────────────────────
export async function likeContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  await ensureInteractableContent(contentId);
  const inserted = await db.insert(cmsContentLikes)
    .values({ memberId, contentId })
    .onConflictDoNothing()
    .returning({ memberId: cmsContentLikes.memberId });
  if (inserted.length > 0) {
    await db.update(cmsContents).set({ likeCount: sql`${cmsContents.likeCount} + 1` }).where(eq(cmsContents.id, contentId));
    void awardInteractionPoints(memberId, contentId, 'like');
  }
  return getInteractionState(contentId);
}

export async function unlikeContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  const deleted = await db.delete(cmsContentLikes)
    .where(and(eq(cmsContentLikes.memberId, memberId), eq(cmsContentLikes.contentId, contentId)))
    .returning({ memberId: cmsContentLikes.memberId });
  if (deleted.length > 0) {
    await db.update(cmsContents)
      .set({ likeCount: sql`greatest(${cmsContents.likeCount} - 1, 0)` })
      .where(eq(cmsContents.id, contentId));
  }
  return getInteractionState(contentId);
}

export async function favoriteContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  await ensureInteractableContent(contentId);
  const inserted = await db.insert(cmsContentFavorites)
    .values({ memberId, contentId })
    .onConflictDoNothing()
    .returning({ memberId: cmsContentFavorites.memberId });
  if (inserted.length > 0) {
    await db.update(cmsContents).set({ favoriteCount: sql`${cmsContents.favoriteCount} + 1` }).where(eq(cmsContents.id, contentId));
    void awardInteractionPoints(memberId, contentId, 'favorite');
  }
  return getInteractionState(contentId);
}

export async function unfavoriteContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  const deleted = await db.delete(cmsContentFavorites)
    .where(and(eq(cmsContentFavorites.memberId, memberId), eq(cmsContentFavorites.contentId, contentId)))
    .returning({ memberId: cmsContentFavorites.memberId });
  if (deleted.length > 0) {
    await db.update(cmsContents)
      .set({ favoriteCount: sql`greatest(${cmsContents.favoriteCount} - 1, 0)` })
      .where(eq(cmsContents.id, contentId));
  }
  return getInteractionState(contentId);
}

/** 当前会员对内容的互动状态 + 最新计数（详情页交互条轮询/操作后回显） */
export async function getInteractionState(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  const [row, liked, favorited] = await Promise.all([
    db.select({ likeCount: cmsContents.likeCount, favoriteCount: cmsContents.favoriteCount })
      .from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1).then((r) => r[0]),
    db.$count(cmsContentLikes, and(eq(cmsContentLikes.memberId, memberId), eq(cmsContentLikes.contentId, contentId))),
    db.$count(cmsContentFavorites, and(eq(cmsContentFavorites.memberId, memberId), eq(cmsContentFavorites.contentId, contentId))),
  ]);
  if (!row) throw new HTTPException(404, { message: '内容不存在' });
  return { liked: liked > 0, favorited: favorited > 0, likeCount: row.likeCount, favoriteCount: row.favoriteCount };
}

// ─── 浏览历史 ─────────────────────────────────────────────────────────────────
/** 记录浏览（去重累计 + 裁剪 100 条 + 阅读积分） */
export async function recordMemberView(contentId: number): Promise<void> {
  const memberId = currentMemberId();
  const content = await ensureInteractableContent(contentId);
  await db.insert(cmsMemberViewHistory)
    .values({ memberId, contentId, siteId: content.siteId })
    .onConflictDoUpdate({
      target: [cmsMemberViewHistory.memberId, cmsMemberViewHistory.contentId],
      set: { viewCount: sql`${cmsMemberViewHistory.viewCount} + 1`, updatedAt: new Date() },
    });
  // 裁剪最旧记录（超出上限时）
  const staleIds = db.select({ id: cmsMemberViewHistory.id })
    .from(cmsMemberViewHistory)
    .where(eq(cmsMemberViewHistory.memberId, memberId))
    .orderBy(desc(cmsMemberViewHistory.updatedAt), desc(cmsMemberViewHistory.id))
    .offset(VIEW_HISTORY_LIMIT);
  await db.delete(cmsMemberViewHistory).where(inArray(cmsMemberViewHistory.id, staleIds));
  void awardInteractionPoints(memberId, contentId, 'view');
}

/** 内容行 → 会员中心条目（URL 拼站内详情路径） */
function toMemberContentItem(
  content: Pick<CmsContentRow, 'id' | 'title' | 'slug' | 'coverThumb' | 'coverImage' | 'contentType' | 'status' | 'deletedAt'>,
  channelPath: string | undefined,
  extra: { createdAt: Date; updatedAt?: Date; viewCount?: number },
): CmsMemberContentItem {
  const available = content.status === 'published' && !content.deletedAt && channelPath;
  return {
    contentId: content.id,
    title: content.title,
    url: available ? `/${channelPath}/${content.slug ?? content.id}.html` : null,
    coverThumb: content.coverThumb ?? content.coverImage ?? null,
    contentType: content.contentType,
    ...(extra.viewCount !== undefined ? { viewCount: extra.viewCount } : {}),
    createdAt: formatDateTime(extra.createdAt),
    ...(extra.updatedAt ? { updatedAt: formatDateTime(extra.updatedAt) } : {}),
  };
}

async function loadChannelPaths(channelIds: number[]): Promise<Map<number, string>> {
  if (channelIds.length === 0) return new Map();
  const rows = await db.select({ id: cmsChannels.id, path: cmsChannels.path })
    .from(cmsChannels).where(inArray(cmsChannels.id, [...new Set(channelIds)]));
  return new Map(rows.map((r) => [r.id, r.path]));
}

/** 我的收藏（分页，新→旧） */
export async function listMyFavorites(page: number, pageSize: number) {
  const memberId = currentMemberId();
  const where = eq(cmsContentFavorites.memberId, memberId);
  const [total, rows] = await Promise.all([
    db.$count(cmsContentFavorites, where),
    db.query.cmsContentFavorites.findMany({
      where,
      with: { content: true },
      orderBy: desc(cmsContentFavorites.createdAt),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const paths = await loadChannelPaths(rows.map((r) => r.content.channelId));
  return {
    list: rows.map((r) => toMemberContentItem(r.content, paths.get(r.content.channelId), { createdAt: r.createdAt })),
    total, page, pageSize,
  };
}

/** 我的浏览历史（分页，最近浏览优先） */
export async function listMyViewHistory(page: number, pageSize: number) {
  const memberId = currentMemberId();
  const where = eq(cmsMemberViewHistory.memberId, memberId);
  const [total, rows] = await Promise.all([
    db.$count(cmsMemberViewHistory, where),
    db.query.cmsMemberViewHistory.findMany({
      where,
      with: { content: true },
      orderBy: desc(cmsMemberViewHistory.updatedAt),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const paths = await loadChannelPaths(rows.map((r) => r.content.channelId));
  return {
    list: rows.map((r) => toMemberContentItem(r.content, paths.get(r.content.channelId), {
      createdAt: r.createdAt, updatedAt: r.updatedAt, viewCount: r.viewCount,
    })),
    total, page, pageSize,
  };
}

/** 清空我的浏览历史 */
export async function clearMyViewHistory(): Promise<number> {
  const memberId = currentMemberId();
  const rows = await db.delete(cmsMemberViewHistory)
    .where(eq(cmsMemberViewHistory.memberId, memberId))
    .returning({ id: cmsMemberViewHistory.id });
  return rows.length;
}

/** 取消收藏（收藏列表页操作，等价 unfavorite） */
export async function removeFavorite(contentId: number): Promise<void> {
  await unfavoriteContent(contentId);
}

// ─── 会员评论（P1 评论会员化）──────────────────────────────────────────────────
/** 会员提交评论：昵称自动取会员资料快照，复用游客评论管道（限流+敏感词+待审核） */
export async function submitMemberComment(contentId: number, input: { content: string; parentId?: number }, meta: { ip: string; userAgent: string | null }) {
  const memberId = currentMemberId();
  const member = await db.query.members.findFirst({
    columns: { id: true, nickname: true, username: true, status: true },
    where: (m, { eq: eq_ }) => eq_(m.id, memberId),
  });
  if (!member || member.status !== 'active') throw new HTTPException(403, { message: '会员状态异常，无法评论' });
  return submitCmsComment({
    contentId,
    nickname: member.nickname || member.username || `会员${member.id}`,
    content: input.content,
    parentId: input.parentId,
    memberId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** 我的评论（分页，新→旧；含内容标题与前台地址） */
export async function listMyComments(page: number, pageSize: number): Promise<PaginatedResponse<CmsMemberComment>> {
  const memberId = currentMemberId();
  const where = eq(cmsComments.memberId, memberId);
  const [total, rows] = await Promise.all([
    db.$count(cmsComments, where),
    withPagination(
      db.select({ comment: cmsComments, content: { id: cmsContents.id, title: cmsContents.title, slug: cmsContents.slug, channelId: cmsContents.channelId, status: cmsContents.status, deletedAt: cmsContents.deletedAt } })
        .from(cmsComments)
        .leftJoin(cmsContents, eq(cmsComments.contentId, cmsContents.id))
        .where(where)
        .orderBy(desc(cmsComments.id))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  const paths = await loadChannelPaths(rows.flatMap((r) => (r.content ? [r.content.channelId] : [])));
  return {
    list: rows.map((r) => {
      const path = r.content ? paths.get(r.content.channelId) : undefined;
      const available = r.content && r.content.status === 'published' && !r.content.deletedAt && path;
      return {
        id: r.comment.id,
        contentId: r.comment.contentId,
        contentTitle: r.content?.title ?? null,
        contentUrl: available ? `/${path}/${r.content!.slug ?? r.content!.id}.html` : null,
        parentId: r.comment.parentId,
        content: r.comment.content,
        likeCount: r.comment.likeCount,
        status: r.comment.status,
        createdAt: formatDateTime(r.comment.createdAt),
      };
    }),
    total, page, pageSize,
  };
}

/** 删除自己的评论；返回内容 id（已审核评论删除需刷新详情页静态文件，否则 null） */
export async function deleteMyComment(commentId: number): Promise<number | null> {
  const memberId = currentMemberId();
  const [row] = await db.delete(cmsComments)
    .where(and(eq(cmsComments.id, commentId), eq(cmsComments.memberId, memberId)))
    .returning({ contentId: cmsComments.contentId, status: cmsComments.status });
  if (!row) throw new HTTPException(404, { message: '评论不存在或无权删除' });
  return row.status === 'approved' ? row.contentId : null;
}
