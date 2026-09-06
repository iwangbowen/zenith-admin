import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, and, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsFriendLinkGroups, cmsFriendLinks } from '../../db/schema';
import type { CmsFriendLinkGroupRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsFriendLinkGroupInput, UpdateCmsFriendLinkGroupInput } from '@zenith/shared/cms';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsFriendLinkGroup(row: CmsFriendLinkGroupRow, linkCount?: number) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    code: row.code,
    status: row.status,
    sort: row.sort,
    remark: row.remark ?? null,
    ...(linkCount === undefined ? {} : { linkCount }),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsFriendLinkGroupExists(id: number): Promise<CmsFriendLinkGroupRow> {
  const [row] = await db.select().from(cmsFriendLinkGroups).where(eq(cmsFriendLinkGroups.id, id)).limit(1);
  return requireRow(row, '友链分组不存在');
}

/** 校验分组归属站点：跨站点引用会让前台按组取数取到别站数据 */
export async function ensureFriendLinkGroupInSite(siteId: number, groupId: number | null | undefined): Promise<void> {
  if (groupId == null) return;
  const group = await ensureCmsFriendLinkGroupExists(groupId);
  if (group.siteId !== siteId) throw new HTTPException(400, { message: '友链分组不属于当前站点' });
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsFriendLinkGroupsQuery {
  siteId: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsFriendLinkGroups(q: ListCmsFriendLinkGroupsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: (SQL | undefined)[] = [eq(cmsFriendLinkGroups.siteId, q.siteId)];
  conditions.push(keywordCondition(q.keyword, [cmsFriendLinkGroups.name]));
  if (q.status) conditions.push(eq(cmsFriendLinkGroups.status, q.status));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsFriendLinkGroups, where),
    rows: async () => {
      const list = await withPagination(
        db.select().from(cmsFriendLinkGroups).where(where)
          .orderBy(asc(cmsFriendLinkGroups.sort), asc(cmsFriendLinkGroups.id)).$dynamic(),
        q.page,
        q.pageSize,
      );
      // 组内友链数：一次取回本站友链的 groupId 做内存聚合，避免逐组统计造成 N+1
      const counts = new Map<number, number>();
      const countRows = await db.select({ groupId: cmsFriendLinks.groupId })
        .from(cmsFriendLinks)
        .where(eq(cmsFriendLinks.siteId, q.siteId));
      for (const row of countRows) {
        if (row.groupId == null) continue;
        counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
      }
      return list.map((row) => mapCmsFriendLinkGroup(row, counts.get(row.id) ?? 0));
    },
  });
}

/** 站点全部启用分组（友链编辑下拉 / 前台按组渲染） */
export async function listAllCmsFriendLinkGroups(siteId: number) {
  await assertSiteAccess(siteId);
  const rows = await db.select().from(cmsFriendLinkGroups)
    .where(and(eq(cmsFriendLinkGroups.siteId, siteId), eq(cmsFriendLinkGroups.status, 'enabled')))
    .orderBy(asc(cmsFriendLinkGroups.sort), asc(cmsFriendLinkGroups.id));
  return rows.map((row) => mapCmsFriendLinkGroup(row));
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
export async function createCmsFriendLinkGroup(data: CreateCmsFriendLinkGroupInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsFriendLinkGroups).values(data).returning();
    await refreshCmsPublicConfiguration(row.siteId, '友链分组创建', `friend-group:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsFriendLinkGroup(row, 0);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同标识的友链分组');
  }
}

export async function updateCmsFriendLinkGroup(id: number, data: UpdateCmsFriendLinkGroupInput) {
  const current = await ensureCmsFriendLinkGroupExists(id);
  await assertSiteAccess(current.siteId);
  try {
    const [row] = await db.update(cmsFriendLinkGroups).set(data)
      .where(eq(cmsFriendLinkGroups.id, id)).returning();
    requireRow(row, '友链分组不存在');
    await refreshCmsPublicConfiguration(row.siteId, '友链分组更新', `friend-group:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsFriendLinkGroup(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同标识的友链分组');
  }
}

/** 删除分组：组内友链保留并转为未分组（FK onDelete: set null），不连带删除运营数据 */
export async function deleteCmsFriendLinkGroup(id: number) {
  const current = await ensureCmsFriendLinkGroupExists(id);
  await assertSiteAccess(current.siteId);
  const [row] = await db.delete(cmsFriendLinkGroups).where(eq(cmsFriendLinkGroups.id, id)).returning();
  requireRow(row, '友链分组不存在');
  await refreshCmsPublicConfiguration(current.siteId, '友链分组删除', `friend-group:${current.id}:deleted:${Date.now()}`);
}
