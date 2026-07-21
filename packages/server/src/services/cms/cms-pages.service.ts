/** 可视化页面（区块装配）CRUD 与前台查询 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsPages } from '../../db/schema';
import type { CmsPageRow } from '../../db/schema';
import type { CmsPageBlock } from '@zenith/shared';
import { formatDateTime } from '../../lib/datetime';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { sanitizeCmsPageBlocks } from './cms-page-blocks';

export function mapCmsPage(row: CmsPageRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    slug: row.slug,
    isHome: row.isHome,
    blocks: (row.blocks ?? []) as CmsPageBlock[],
    seoTitle: row.seoTitle ?? null,
    seoKeywords: row.seoKeywords ?? null,
    seoDescription: row.seoDescription ?? null,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listCmsPages(params: { page: number; pageSize: number; siteId: number; keyword?: string }) {
  await ensureCmsSiteExists(params.siteId);
  await assertSiteAccess(params.siteId);
  const conds = [eq(cmsPages.siteId, params.siteId)];
  if (params.keyword) {
    conds.push(sql`(${cmsPages.name} ILIKE ${`%${escapeLike(params.keyword)}%`} OR ${cmsPages.slug} ILIKE ${`%${escapeLike(params.keyword)}%`})`);
  }
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(cmsPages, where),
    withPagination(db.select().from(cmsPages).where(where).orderBy(desc(cmsPages.id)).$dynamic(), params.page, params.pageSize),
  ]);
  return { list: rows.map(mapCmsPage), total, page: params.page, pageSize: params.pageSize };
}

export async function getCmsPage(id: number) {
  const [row] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '页面不存在' });
  await assertSiteAccess(row.siteId);
  return mapCmsPage(row);
}

const SLUG_RE = /^[a-z0-9-]+$/;

export interface CmsPageInput {
  siteId: number;
  name: string;
  slug: string;
  isHome?: boolean;
  blocks?: CmsPageBlock[];
  seoTitle?: string | null;
  seoKeywords?: string | null;
  seoDescription?: string | null;
  status?: 'enabled' | 'disabled';
  remark?: string | null;
}

async function clearOtherHome(siteId: number, exceptId?: number) {
  const conds = [eq(cmsPages.siteId, siteId), eq(cmsPages.isHome, true)];
  if (exceptId) conds.push(ne(cmsPages.id, exceptId));
  await db.update(cmsPages).set({ isHome: false }).where(and(...conds));
}

export async function createCmsPage(input: CmsPageInput) {
  await ensureCmsSiteExists(input.siteId);
  await assertSiteAccess(input.siteId);
  if (!SLUG_RE.test(input.slug)) throw new HTTPException(400, { message: 'slug 仅允许小写字母/数字/中划线' });
  const blocks = input.blocks === undefined ? undefined : sanitizeCmsPageBlocks(input.blocks);
  try {
    if (input.isHome) await clearOtherHome(input.siteId);
    const [created] = await db.insert(cmsPages).values({ ...input, ...(blocks ? { blocks } : {}) }).returning();
    return mapCmsPage(created);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 slug 的页面');
  }
}

export async function updateCmsPage(id: number, input: Partial<CmsPageInput>) {
  const [current] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '页面不存在' });
  await assertSiteAccess(current.siteId);
  if (input.slug && !SLUG_RE.test(input.slug)) throw new HTTPException(400, { message: 'slug 仅允许小写字母/数字/中划线' });
  const blocks = input.blocks === undefined ? undefined : sanitizeCmsPageBlocks(input.blocks);
  const { siteId: _ignored, ...rest } = input;
  try {
    if (rest.isHome) await clearOtherHome(current.siteId, id);
    const [updated] = await db.update(cmsPages).set({
      ...rest,
      ...(blocks ? { blocks } : {}),
    }).where(and(
      eq(cmsPages.id, id),
    )).returning();
    return mapCmsPage(updated);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 slug 的页面');
  }
}

export async function deleteCmsPage(id: number) {
  const [current] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '页面不存在' });
  await assertSiteAccess(current.siteId);
  await db.delete(cmsPages).where(eq(cmsPages.id, id));
  return current;
}

// ─── 前台查询 ─────────────────────────────────────────────────────────────────
export async function getPublishedPageBySlug(siteId: number, slug: string): Promise<CmsPageRow | null> {
  const [row] = await db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.slug, slug), eq(cmsPages.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

export async function getHomeTakeoverPage(siteId: number): Promise<CmsPageRow | null> {
  const [row] = await db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.isHome, true), eq(cmsPages.status, 'enabled')))
    .orderBy(desc(cmsPages.id))
    .limit(1);
  return row ?? null;
}

export async function listPublishedPages(siteId: number): Promise<CmsPageRow[]> {
  return db.select().from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.status, 'enabled')))
    .orderBy(cmsPages.id);
}
