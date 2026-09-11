import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, and, isNull } from 'drizzle-orm';
import { cmsFriendLinkContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsFriendLinkGroups, cmsFriendLinks } from '../../db/schema';
import type { CmsFriendLinkRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import type { CreateCmsFriendLinkInput, UpdateCmsFriendLinkInput } from '@zenith/shared/cms';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { canonicalizeCmsResourceFields, deleteCmsResourceRefsForOwner, syncCmsResourceRefs, resolveCmsResourcePayload } from './cms-resource-refs.service';
import { ensureFriendLinkGroupInSite } from './cms-friend-link-groups.service';
import { buildCmsLinkResolver } from './cms-link.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsFriendLink(row: CmsFriendLinkRow, groupName?: string | null) {
  return {
    id: row.id,
    siteId: row.siteId,
    groupId: row.groupId ?? null,
    groupName: groupName ?? null,
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
  return requireRow(row, '友情链接不存在');
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export async function listCmsFriendLinks(q: QueryOutputOf<typeof cmsFriendLinkContract.list>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildWhere(
    eq(cmsFriendLinks.siteId, q.siteId),
    keywordCondition(q.keyword, [cmsFriendLinks.name]),
    q.status ? eq(cmsFriendLinks.status, q.status) : undefined,
    q.groupId !== undefined ? (q.groupId === 0 ? isNull(cmsFriendLinks.groupId) : eq(cmsFriendLinks.groupId, q.groupId)) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsFriendLinks, where),
    rows: async () => {
      const list = await withPagination(
        db.select({ link: cmsFriendLinks, groupName: cmsFriendLinkGroups.name })
          .from(cmsFriendLinks)
          .leftJoin(cmsFriendLinkGroups, eq(cmsFriendLinks.groupId, cmsFriendLinkGroups.id))
          .where(where)
          .orderBy(asc(cmsFriendLinks.sort), asc(cmsFriendLinks.id)).$dynamic(),
        q.page,
        q.pageSize,
      );
      return resolveCmsResourcePayload(list.map((row) => mapCmsFriendLink(row.link, row.groupName)), q.siteId);
    },
  });
}

/**
 * 前台渲染上下文用：站点全部启用友链，按分组聚合。
 * 未分组的友链归入 `code: ''` 的兜底组，主题可据此决定是否展示组标题。
 */
export async function listEnabledFriendLinkGroups(siteId: number, baseUrl = '') {
  const [links, groups] = await Promise.all([
    db.select().from(cmsFriendLinks)
      .where(and(eq(cmsFriendLinks.siteId, siteId), eq(cmsFriendLinks.status, 'enabled')))
      .orderBy(asc(cmsFriendLinks.sort), asc(cmsFriendLinks.id)),
    db.select().from(cmsFriendLinkGroups)
      .where(and(eq(cmsFriendLinkGroups.siteId, siteId), eq(cmsFriendLinkGroups.status, 'enabled')))
      .orderBy(asc(cmsFriendLinkGroups.sort), asc(cmsFriendLinkGroups.id)),
  ]);
  const resolver = await buildCmsLinkResolver(siteId, baseUrl, links.map((link) => link.url));
  const byGroup = new Map<number | null, (typeof links[number])[]>();
  for (const link of links) {
    const resolvedUrl = resolver(link.url)?.url;
    if (!resolvedUrl) continue;
    // 引用了已停用/已删分组的友链降级为未分组，避免整条消失
    const key = link.groupId != null && groups.some((g) => g.id === link.groupId) ? link.groupId : null;
    byGroup.set(key, [...(byGroup.get(key) ?? []), { ...link, url: resolvedUrl }]);
  }
  const result = groups
    .map((group) => ({
      code: group.code,
      name: group.name,
      links: (byGroup.get(group.id) ?? []).map((l) => ({ name: l.name, url: l.url, logo: l.logo ?? null })),
    }))
    .filter((group) => group.links.length > 0);
  const ungrouped = byGroup.get(null) ?? [];
  if (ungrouped.length > 0) {
    result.push({ code: '', name: '', links: ungrouped.map((l) => ({ name: l.name, url: l.url, logo: l.logo ?? null })) });
  }
  return result;
}

/** 前台渲染上下文用：站点全部启用友链（平铺，兼容不分组的主题） */
export async function listEnabledFriendLinks(siteId: number, baseUrl = '') {
  const rows = await db.select().from(cmsFriendLinks)
    .where(and(eq(cmsFriendLinks.siteId, siteId), eq(cmsFriendLinks.status, 'enabled')))
    .orderBy(asc(cmsFriendLinks.sort), asc(cmsFriendLinks.id));
  const resolver = await buildCmsLinkResolver(siteId, baseUrl, rows.map((row) => row.url));
  return rows.flatMap((row) => {
    const url = resolver(row.url)?.url;
    return url ? [mapCmsFriendLink({ ...row, url })] : [];
  });
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
/** 写操作返回体也要带 groupName，避免前端拿到与列表不一致的结构 */
async function resolveGroupName(groupId: number | null): Promise<string | null> {
  if (!groupId) return null;
  const [row] = await db.select({ name: cmsFriendLinkGroups.name }).from(cmsFriendLinkGroups)
    .where(eq(cmsFriendLinkGroups.id, groupId)).limit(1);
  return row?.name ?? null;
}

export async function createCmsFriendLink(data: CreateCmsFriendLinkInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  await ensureFriendLinkGroupInSite(data.siteId, data.groupId);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(cmsFriendLinks)
      .values(await canonicalizeCmsResourceFields(tx, data.siteId, data, 'friendLink'))
      .returning();
    await syncCmsResourceRefs(tx, 'friendLink', created.id, created.siteId, created);
    return created;
  });
  await refreshCmsPublicConfiguration(row.siteId, '友情链接创建', `friend-link:${row.id}:${row.updatedAt.getTime()}`);
  return resolveCmsResourcePayload(mapCmsFriendLink(row, await resolveGroupName(row.groupId)), row.siteId);
}

export async function updateCmsFriendLink(id: number, data: UpdateCmsFriendLinkInput) {
  const current = await ensureCmsFriendLinkExists(id);
  await assertSiteAccess(current.siteId);
  if (data.groupId !== undefined) await ensureFriendLinkGroupInSite(current.siteId, data.groupId);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(cmsFriendLinks)
      .set(await canonicalizeCmsResourceFields(tx, current.siteId, data, 'friendLink'))
      .where(and(
        eq(cmsFriendLinks.id, id),
      )).returning();
    requireRow(updated, '友情链接不存在');
    await syncCmsResourceRefs(tx, 'friendLink', updated.id, updated.siteId, updated);
    return updated;
  });
  await refreshCmsPublicConfiguration(row.siteId, '友情链接更新', `friend-link:${row.id}:${row.updatedAt.getTime()}`);
  return resolveCmsResourcePayload(mapCmsFriendLink(row, await resolveGroupName(row.groupId)), row.siteId);
}

export async function deleteCmsFriendLink(id: number) {
  const current = await ensureCmsFriendLinkExists(id);
  await assertSiteAccess(current.siteId);
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(cmsFriendLinks).where(and(
      eq(cmsFriendLinks.id, id),
    )).returning();
    requireRow(row, '友情链接不存在');
    await deleteCmsResourceRefsForOwner(tx, 'friendLink', [row.id], current.siteId);
  });
  await refreshCmsPublicConfiguration(current.siteId, '友情链接删除', `friend-link:${current.id}:deleted:${Date.now()}`);
}
