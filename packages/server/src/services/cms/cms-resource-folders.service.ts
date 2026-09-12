import { requireFirstRow } from '../../lib/db-assert';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsResourceFolders, cmsResources } from '../../db/schema';
import type { CmsResourceFolderRow } from '../../db/schema';
import { formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CmsResourceFolder, CreateCmsResourceFolderInput, UpdateCmsResourceFolderInput } from '@zenith/shared/cms';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { buildTree } from '@zenith/shared/core';

export function mapCmsResourceFolder(row: CmsResourceFolderRow, resourceCount = 0): CmsResourceFolder {
  return {
    id: row.id,
    siteId: row.siteId,
    parentId: row.parentId,
    name: row.name,
    sort: row.sort,
    resourceCount,
    ...formatTimestamps(row),
  };
}

export async function ensureCmsResourceFolderExists(id: number): Promise<CmsResourceFolderRow> {
  return requireFirstRow(db.select().from(cmsResourceFolders).where(eq(cmsResourceFolders.id, id)).limit(1), '素材文件夹不存在');
}

async function ensureParent(siteId: number, parentId: number | null, selfId?: number): Promise<void> {
  if (parentId === null) return;
  if (parentId === selfId) throw new HTTPException(400, { message: '父文件夹不能是自身' });
  let cursor: number | null = parentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === selfId || seen.has(cursor)) throw new HTTPException(400, { message: '文件夹层级不能形成循环' });
    seen.add(cursor);
    const parent = await ensureCmsResourceFolderExists(cursor);
    if (parent.siteId !== siteId) throw new HTTPException(400, { message: '父文件夹不属于当前站点' });
    cursor = parent.parentId;
  }
}

export async function listCmsResourceFolderTree(siteId: number): Promise<CmsResourceFolder[]> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  // 资源数按目录分组后 LEFT JOIN（sql`` 裸列名不带表限定，禁止模板内跨表比较）
  const resourceCounts = db
    .select({ folderId: cmsResources.folderId, cnt: sql<number>`count(*)::int`.as('cnt') })
    .from(cmsResources)
    .groupBy(cmsResources.folderId)
    .as('resource_counts');
  const rows = await db.select({
    folder: cmsResourceFolders,
    resourceCount: sql<number>`coalesce(${resourceCounts.cnt}, 0)`,
  }).from(cmsResourceFolders)
    .leftJoin(resourceCounts, eq(resourceCounts.folderId, cmsResourceFolders.id))
    .where(eq(cmsResourceFolders.siteId, siteId))
    .orderBy(asc(cmsResourceFolders.sort), asc(cmsResourceFolders.id));
  return buildTree(rows.map(({ folder, resourceCount }) => mapCmsResourceFolder(folder, resourceCount)));
}

export async function createCmsResourceFolder(input: CreateCmsResourceFolderInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  await ensureParent(input.siteId, input.parentId ?? null);
  try {
    const [row] = await db.insert(cmsResourceFolders).values({
      ...input,
      parentId: input.parentId ?? null,
    }).returning();
    return mapCmsResourceFolder(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同级目录下已存在同名文件夹');
  }
}

export async function updateCmsResourceFolder(id: number, input: UpdateCmsResourceFolderInput) {
  const current = await ensureCmsResourceFolderExists(id);
  await assertSiteAccess(current.siteId);
  const parentId = input.parentId ?? current.parentId;
  await ensureParent(current.siteId, parentId, id);
  try {
    const [row] = await db.update(cmsResourceFolders).set(input)
      .where(and(eq(cmsResourceFolders.id, id), eq(cmsResourceFolders.siteId, current.siteId)))
      .returning();
    return mapCmsResourceFolder(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同级目录下已存在同名文件夹');
  }
}

export async function deleteCmsResourceFolder(id: number): Promise<void> {
  const current = await ensureCmsResourceFolderExists(id);
  await assertSiteAccess(current.siteId);
  const [childCount, resourceCount] = await Promise.all([
    db.$count(cmsResourceFolders, eq(cmsResourceFolders.parentId, id)),
    db.$count(cmsResources, eq(cmsResources.folderId, id)),
  ]);
  if (childCount > 0 || resourceCount > 0) {
    throw new HTTPException(400, { message: '文件夹非空，请先移动其中的子文件夹和素材' });
  }
  await db.delete(cmsResourceFolders).where(eq(cmsResourceFolders.id, id));
}
