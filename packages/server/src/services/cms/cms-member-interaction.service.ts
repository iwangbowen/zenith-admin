import { and, desc, eq, sql, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsContents, cmsContentLikes, cmsContentFavorites, cmsMemberViewHistory, cmsChannels, cmsComments, cmsSites,
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
import { pageOffset } from '../../lib/pagination';
import { CMS_INTERACTION_POINTS, CMS_INTERACTION_DAILY_LIMITS } from '@zenith/shared/cms';
import { resolveCmsResourceCovers } from './cms-resource-refs.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';
import { isCmsContentPubliclyVisible } from './cms-content-state';
import { contentUrl, type CmsUrlChannel } from './cms-urls';
import type { CmsChannelDetailPathRule } from '@zenith/shared/cms';
import type { CmsInteractionState, CmsMemberContentItem, CmsMemberComment } from '@zenith/shared/cms';
import type { PaginatedResponse } from '@zenith/shared/core';
import { formatDate } from '../../lib/datetime';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { resolveEffectiveCmsSite } from './cms-site-inheritance.service';

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
      const today = formatDate(new Date()).replaceAll('-', '');
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
  if (!row || !isCmsContentPubliclyVisible(row)) {
    throw new HTTPException(404, { message: '内容不存在或未发布' });
  }
  const [site] = await db.select({ id: cmsSites.id, status: cmsSites.status }).from(cmsSites).where(eq(cmsSites.id, row.siteId)).limit(1);
  const effectiveSite = site ? await resolveEffectiveCmsSite(row.siteId).catch(() => null) : null;
  const channels = await getEffectivelyEnabledCmsChannelIds(row.siteId);
  if (!site || site.status !== 'enabled' || !effectiveSite || !effectiveSite.chain.every((item) => item.status === 'enabled') || !channels.has(row.channelId)) {
    throw new HTTPException(404, { message: '内容不存在或未发布' });
  }
  return row;
}

// ─── 点赞 / 收藏 ──────────────────────────────────────────────────────────────
export async function likeContent(contentId: number): Promise<CmsInteractionState> {
 const memberId = currentMemberId();
 const content = await ensureInteractableContent(contentId);
 const inserted = await db.insert(cmsContentLikes)
    .values({ memberId, contentId })
    .onConflictDoNothing()
    .returning({ memberId: cmsContentLikes.memberId });
  if (inserted.length > 0) {
    await db.execute(sql`update ${cmsContents} set like_count = like_count + 1 where id = ${contentId}`);
    await invalidateCmsSiteCaches(content.siteId);
    void awardInteractionPoints(memberId, contentId, 'like');
  }
  return getInteractionState(contentId);
}

export async function unlikeContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  const content = await ensureInteractableContent(contentId);
  const deleted = await db.delete(cmsContentLikes)
    .where(and(eq(cmsContentLikes.memberId, memberId), eq(cmsContentLikes.contentId, contentId)))
    .returning({ memberId: cmsContentLikes.memberId });
  if (deleted.length > 0) {
    await db.execute(sql`update ${cmsContents} set like_count = greatest(like_count - 1, 0) where id = ${contentId}`);
    await invalidateCmsSiteCaches(content.siteId);
  }
  return getInteractionState(contentId);
}

export async function favoriteContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  const content = await ensureInteractableContent(contentId);
  const inserted = await db.insert(cmsContentFavorites)
    .values({ memberId, contentId })
    .onConflictDoNothing()
    .returning({ memberId: cmsContentFavorites.memberId });
  if (inserted.length > 0) {
    await db.execute(sql`update ${cmsContents} set favorite_count = favorite_count + 1 where id = ${contentId}`);
    await invalidateCmsSiteCaches(content.siteId);
    void awardInteractionPoints(memberId, contentId, 'favorite');
  }
  return getInteractionState(contentId);
}

export async function unfavoriteContent(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  const content = await ensureInteractableContent(contentId);
  const deleted = await db.delete(cmsContentFavorites)
    .where(and(eq(cmsContentFavorites.memberId, memberId), eq(cmsContentFavorites.contentId, contentId)))
    .returning({ memberId: cmsContentFavorites.memberId });
  if (deleted.length > 0) {
    await db.execute(sql`update ${cmsContents} set favorite_count = greatest(favorite_count - 1, 0) where id = ${contentId}`);
    await invalidateCmsSiteCaches(content.siteId);
  }
  return getInteractionState(contentId);
}

/** 当前会员对内容的互动状态 + 最新计数（详情页交互条轮询/操作后回显） */
export async function getInteractionState(contentId: number): Promise<CmsInteractionState> {
  const memberId = currentMemberId();
  await ensureInteractableContent(contentId);
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
  await db.delete(cmsMemberViewHistory).where(and(
    inArray(cmsMemberViewHistory.id, staleIds),
  ));
  void awardInteractionPoints(memberId, contentId, 'view');
}

/** 内容行 → 会员中心条目（URL 拼站内详情路径） */
function toMemberContentItem(
  content: Pick<CmsContentRow, 'id' | 'title' | 'slug' | 'staticPath' | 'publishedAt' | 'createdAt' | 'coverImage' | 'contentType' | 'status' | 'deletedAt' | 'archivedAt' | 'expireAt'>,
  channel: CmsUrlChannel | undefined,
  extra: { createdAt: Date; updatedAt?: Date; viewCount?: number },
  cover: { coverImage: string | null; coverThumb: string | null },
): CmsMemberContentItem {
  const available = isCmsContentPubliclyVisible(content) && channel;
  return {
    contentId: content.id,
    title: content.title,
    url: available ? contentUrl('', channel, content) : null,
    coverThumb: cover.coverThumb ?? cover.coverImage,
    contentType: content.contentType,
    ...(extra.viewCount !== undefined ? { viewCount: extra.viewCount } : {}),
    createdAt: formatDateTime(extra.createdAt),
    ...(extra.updatedAt ? { updatedAt: formatDateTime(extra.updatedAt) } : {}),
  };
}

async function resolveMemberCovers(
  rows: readonly { content: Pick<CmsContentRow, 'siteId' | 'coverImage'> }[],
): Promise<{ coverImage: string | null; coverThumb: string | null }[]> {
  const resolved = new Array<{ coverImage: string | null; coverThumb: string | null }>(rows.length);
  const groups = new Map<number, number[]>();
  rows.forEach((row, index) => groups.set(row.content.siteId, [...(groups.get(row.content.siteId) ?? []), index]));
  await Promise.all([...groups].map(async ([siteId, indexes]) => {
    const covers = await resolveCmsResourceCovers(indexes.map((index) => rows[index].content.coverImage), siteId);
    indexes.forEach((index, offset) => { resolved[index] = covers[offset]; });
  }));
  return resolved;
}

async function loadChannelPaths(channelIds: number[]): Promise<Map<number, CmsUrlChannel>> {
  if (channelIds.length === 0) return new Map();
  const rows = await db.select({ id: cmsChannels.id, siteId: cmsChannels.siteId, path: cmsChannels.path, detailPathRule: cmsChannels.detailPathRule })
    .from(cmsChannels).where(inArray(cmsChannels.id, [...new Set(channelIds)]));
  const bySite = new Map<number, Set<number>>();
  for (const siteId of new Set(rows.map((row) => row.siteId))) {
    const effectiveSite = await resolveEffectiveCmsSite(siteId).catch(() => null);
    bySite.set(siteId, effectiveSite?.chain.every((site) => site.status === 'enabled')
      ? await getEffectivelyEnabledCmsChannelIds(siteId)
      : new Set());
  }
  return new Map(rows.filter((row) => bySite.get(row.siteId)?.has(row.id)).map((r) => [r.id, {
    path: r.path,
    detailPathRule: r.detailPathRule as CmsChannelDetailPathRule,
  }]));
}

/** 我的收藏（分页，新→旧） */
export async function listMyFavorites(page: number, pageSize: number) {
  const memberId = currentMemberId();
  const where = eq(cmsContentFavorites.memberId, memberId);
  const [total, rows] = await Promise.all([
    db.$count(cmsContentFavorites, where),
    db.query.cmsContentFavorites.findMany({
      where,
      with: { content: { columns: { body: false, searchVector: false, extend: false, mediaData: false, attachments: false } } },
      orderBy: desc(cmsContentFavorites.createdAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const paths = await loadChannelPaths(rows.map((r) => r.content.channelId));
  const covers = await resolveMemberCovers(rows);
  return {
    list: rows.map((r, index) => toMemberContentItem(r.content, paths.get(r.content.channelId), { createdAt: r.createdAt }, covers[index])),
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
      with: { content: { columns: { body: false, searchVector: false, extend: false, mediaData: false, attachments: false } } },
      orderBy: desc(cmsMemberViewHistory.updatedAt),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const paths = await loadChannelPaths(rows.map((r) => r.content.channelId));
  const covers = await resolveMemberCovers(rows);
  return {
    list: rows.map((r, index) => toMemberContentItem(r.content, paths.get(r.content.channelId), {
      createdAt: r.createdAt, updatedAt: r.updatedAt, viewCount: r.viewCount,
    }, covers[index])),
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
        db.select({ comment: cmsComments, content: {
          id: cmsContents.id,
          title: cmsContents.title,
          slug: cmsContents.slug,
          staticPath: cmsContents.staticPath,
          publishedAt: cmsContents.publishedAt,
          createdAt: cmsContents.createdAt,
          channelId: cmsContents.channelId,
          status: cmsContents.status,
          deletedAt: cmsContents.deletedAt,
          archivedAt: cmsContents.archivedAt,
          expireAt: cmsContents.expireAt,
        } })
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
      const channel = r.content ? paths.get(r.content.channelId) : undefined;
      const available = r.content && isCmsContentPubliclyVisible(r.content) && channel;
      return {
        id: r.comment.id,
        contentId: r.comment.contentId,
        contentTitle: r.content?.title ?? null,
        contentUrl: available ? contentUrl('', channel, r.content!) : null,
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
