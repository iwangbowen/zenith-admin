import { eq, asc, and, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsFriendLinks } from '../../db/schema';
import type { CmsFriendLinkRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import type { CreateCmsFriendLinkInput, UpdateCmsFriendLinkInput } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsFriendLink(row: CmsFriendLinkRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    url: row.url,
    logo: row.logo ?? null,
    status: row.status,
    sort: row.sort,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsFriendLinkExists(id: number): Promise<CmsFriendLinkRow> {
  const [row] = await db.select().from(cmsFriendLinks).where(eq(cmsFriendLinks.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '友情链接不存在' });
  return row;
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsFriendLinksQuery {
  siteId: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsFriendLinks(q: ListCmsFriendLinksQuery) {
  const conditions: SQL[] = [eq(cmsFriendLinks.siteId, q.siteId)];
  if (q.keyword) conditions.push(like(cmsFriendLinks.name, `%${escapeLike(q.keyword)}%`));
  if (q.status) conditions.push(eq(cmsFriendLinks.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsFriendLinks, where),
    withPagination(
      db.select().from(cmsFriendLinks).where(where).orderBy(asc(cmsFriendLinks.sort), asc(cmsFriendLinks.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsFriendLink), total, page: q.page, pageSize: q.pageSize };
}

/** 前台渲染上下文用：站点全部启用友链 */
export async function listEnabledFriendLinks(siteId: number) {
  const rows = await db.select().from(cmsFriendLinks)
    .where(and(eq(cmsFriendLinks.siteId, siteId), eq(cmsFriendLinks.status, 'enabled')))
    .orderBy(asc(cmsFriendLinks.sort), asc(cmsFriendLinks.id));
  return rows.map(mapCmsFriendLink);
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
export async function createCmsFriendLink(data: CreateCmsFriendLinkInput) {
  const [row] = await db.insert(cmsFriendLinks).values(data).returning();
  return mapCmsFriendLink(row);
}

export async function updateCmsFriendLink(id: number, data: UpdateCmsFriendLinkInput) {
  const [row] = await db.update(cmsFriendLinks).set(data).where(eq(cmsFriendLinks.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '友情链接不存在' });
  return mapCmsFriendLink(row);
}

export async function deleteCmsFriendLink(id: number) {
  const [row] = await db.delete(cmsFriendLinks).where(eq(cmsFriendLinks.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '友情链接不存在' });
}
