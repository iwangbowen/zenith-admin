import { desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { WikiSettings } from '@zenith/shared/settings';
import { db } from '../../db';
import { users, wikiComments, wikiDocViews, wikiDocs, wikiSpaces } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { getSettings } from '../../lib/settings';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { wikiDocStatusVisibilityCondition, wikiSpaceAccessCondition } from './access';

// ─── 统计 ─────────────────────────────────────────────────────────────────────

export async function getWikiStatsOverview() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const tenantDocs = tenantCondition(wikiDocs, currentUser());
  const spaceAccess = wikiSpaceAccessCondition();
  const statusVisible = wikiDocStatusVisibilityCondition();
  const notDeleted = isNull(wikiDocs.deletedAt);
  const docScope = buildWhere(notDeleted, tenantDocs, spaceAccess, statusVisible);

  // 评论与浏览量跟随文档的租户与访问边界（追加型日志表自身无 tenant_id）
  const countComments = async () => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(wikiComments)
      .innerJoin(wikiDocs, eq(wikiComments.docId, wikiDocs.id))
      .where(buildWhere(eq(wikiComments.status, 'visible'), docScope));
    return row?.count ?? 0;
  };
  const countWeekViews = async () => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(wikiDocViews)
      .innerJoin(wikiDocs, eq(wikiDocViews.docId, wikiDocs.id))
      .where(buildWhere(gte(wikiDocViews.createdAt, weekAgo), docScope));
    return row?.count ?? 0;
  };

  const [spaceCount, docCount, publishedCount, pendingCount, commentCount, weekNewDocs, weekViews] = await Promise.all([
    db.$count(wikiSpaces, tenantCondition(wikiSpaces, currentUser())),
    db.$count(wikiDocs, docScope),
    db.$count(wikiDocs, buildWhere(eq(wikiDocs.status, 'published'), docScope)),
    db.$count(wikiDocs, buildWhere(eq(wikiDocs.status, 'pending'), docScope)),
    countComments(),
    db.$count(wikiDocs, buildWhere(gte(wikiDocs.createdAt, weekAgo), docScope)),
    countWeekViews(),
  ]);

  return { spaceCount, docCount, publishedCount, pendingCount, commentCount, weekNewDocs, weekViews };
}

/** 热门文档 Top N（按浏览量） */
export async function listWikiHotDocs(limit = 10) {
  const rows = await db.select({
    id: wikiDocs.id,
    title: wikiDocs.title,
    spaceName: wikiSpaces.name,
    viewCount: wikiDocs.viewCount,
  }).from(wikiDocs)
    .innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
    .where(buildWhere(
      isNull(wikiDocs.deletedAt),
      eq(wikiDocs.status, 'published'),
      tenantCondition(wikiDocs, currentUser()),
      wikiSpaceAccessCondition(),
    ))
    .orderBy(desc(wikiDocs.viewCount), desc(wikiDocs.id))
    .limit(limit);
  return rows;
}

/** 贡献榜 Top N（按创建文档数） */
export async function listWikiContributors(limit = 10) {
  const rows = await db.select({
    userId: wikiDocs.createdBy,
    nickname: users.nickname,
    docCount: sql<number>`count(*)::int`,
  }).from(wikiDocs)
    .innerJoin(users, eq(wikiDocs.createdBy, users.id))
    .where(buildWhere(
      isNull(wikiDocs.deletedAt),
      tenantCondition(wikiDocs, currentUser()),
      wikiSpaceAccessCondition(),
      wikiDocStatusVisibilityCondition(),
    ))
    .groupBy(wikiDocs.createdBy, users.nickname)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows
    .filter((r): r is typeof r & { userId: number } => r.userId !== null)
    .map((r) => ({ userId: r.userId, nickname: r.nickname, docCount: r.docCount }));
}

/** 沉睡文档：已发布但超过 staleDays 未更新 */
export async function listWikiStaleDocs(limit = 10, staleDays = 90) {
  const threshold = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const rows = await db.select({
    id: wikiDocs.id,
    title: wikiDocs.title,
    spaceName: wikiSpaces.name,
    updatedAt: wikiDocs.updatedAt,
  }).from(wikiDocs)
    .innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
    .where(buildWhere(
      isNull(wikiDocs.deletedAt),
      eq(wikiDocs.status, 'published'),
      lt(wikiDocs.updatedAt, threshold),
      tenantCondition(wikiDocs, currentUser()),
      wikiSpaceAccessCondition(),
    ))
    .orderBy(wikiDocs.updatedAt)
    .limit(limit);
  return rows.map((r) => ({ ...r, updatedAt: formatDateTime(r.updatedAt) }));
}

// ─── 全局设置 ─────────────────────────────────────────────────────────────────

/** 知识库全局设置由运行时设置 `wiki` 模块承载（平台级）；管理界面读写走 `/api/settings/wiki`，这里保留域内语义别名 */
export async function getWikiSettings(): Promise<WikiSettings> {
  return getSettings('wiki');
}