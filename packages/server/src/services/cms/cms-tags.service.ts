import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import type { QueryOutputOf } from '@zenith/shared/core';
import { eq, asc, and } from 'drizzle-orm';
import { cmsTagContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsTags } from '../../db/schema';
import type { CmsTagRow } from '../../db/schema';
import { formatTimestamps } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsTagInput, UpdateCmsTagInput } from '@zenith/shared/cms';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsTag(row: CmsTagRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    slug: row.slug,
    groupName: row.groupName ?? null,
    contentCount: row.contentCount,
    ...formatTimestamps(row),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsTagExists(id: number): Promise<CmsTagRow> {
  const [row] = await db.select().from(cmsTags).where(eq(cmsTags.id, id)).limit(1);
  return requireRow(row, '标签不存在');
}

export async function getCmsTag(id: number) {
  const row = await ensureCmsTagExists(id);
  await assertSiteAccess(row.siteId);
  return mapCmsTag(row);
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export async function listCmsTags(q: QueryOutputOf<typeof cmsTagContract.list>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildWhere(
    eq(cmsTags.siteId, q.siteId),
    keywordCondition(q.keyword, [cmsTags.name, cmsTags.slug]),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsTags, where),
    rows: () => withPagination(
      db.select().from(cmsTags).where(where).orderBy(asc(cmsTags.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: mapCmsTag,
  });
}

/** 站点全部标签（内容编辑打标下拉用） */
export async function listAllCmsTags(siteId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const rows = await db.select().from(cmsTags).where(and(
    eq(cmsTags.siteId, siteId),
  )).orderBy(asc(cmsTags.id));
  return rows.map(mapCmsTag);
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
export async function createCmsTag(data: CreateCmsTagInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsTags).values(data).returning();
    await refreshCmsPublicConfiguration(row.siteId, '标签创建', `tag:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下标签名称或标识已存在');
  }
}

export async function updateCmsTag(id: number, data: UpdateCmsTagInput) {
  const current = await ensureCmsTagExists(id);
  await assertSiteAccess(current.siteId);
  try {
    const [row] = await db.update(cmsTags).set(data).where(and(
      eq(cmsTags.id, id),
    )).returning();
    requireRow(row, '标签不存在');
    await refreshCmsPublicConfiguration(row.siteId, '标签更新', `tag:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下标签名称或标识已存在');
  }
}

export async function deleteCmsTag(id: number) {
  const current = await ensureCmsTagExists(id);
  await assertSiteAccess(current.siteId);
  const [row] = await db.delete(cmsTags).where(and(
    eq(cmsTags.id, id),
  )).returning();
  requireRow(row, '标签不存在');
  await refreshCmsPublicConfiguration(current.siteId, '标签删除', `tag:${current.id}:deleted:${Date.now()}`);
}
