import { eq, asc, and, or, like, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsFragments } from '../../db/schema';
import type { CmsFragmentRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsFragmentInput, UpdateCmsFragmentInput, CmsFragmentType } from '@zenith/shared';
import { assertCompleteCmsBatch } from './cms-access';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { sanitizeCmsFragmentContent } from './cms-fragment-content';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsFragment(row: CmsFragmentRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    type: row.type,
    content: row.content ?? null,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsFragmentExists(id: number): Promise<CmsFragmentRow> {
  const [row] = await db.select().from(cmsFragments).where(eq(cmsFragments.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '碎片不存在' });
  return row;
}

export async function getCmsFragment(id: number) {
  const row = await ensureCmsFragmentExists(id);
  await assertSiteAccess(row.siteId);
  return mapCmsFragment(row);
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsFragmentsQuery {
  siteId: number;
  keyword?: string;
  type?: CmsFragmentType;
  page: number;
  pageSize: number;
}

export async function listCmsFragments(q: ListCmsFragmentsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsFragments.siteId, q.siteId)];
  if (q.keyword) {
    const kw = or(
      like(cmsFragments.name, `%${escapeLike(q.keyword)}%`),
      like(cmsFragments.code, `%${escapeLike(q.keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  if (q.type) conditions.push(eq(cmsFragments.type, q.type));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsFragments, where),
    withPagination(
      db.select().from(cmsFragments).where(where).orderBy(asc(cmsFragments.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsFragment), total, page: q.page, pageSize: q.pageSize };
}

/** 前台渲染上下文用：站点全部启用碎片 code → { type, content } 映射 */
export async function getFragmentMap(siteId: number): Promise<Record<string, { type: CmsFragmentType; content: string }>> {
  const rows = await db.select().from(cmsFragments)
    .where(and(eq(cmsFragments.siteId, siteId), eq(cmsFragments.status, 'enabled')));
  const map: Record<string, { type: CmsFragmentType; content: string }> = {};
  for (const row of rows) {
    map[row.code] = { type: row.type, content: row.content ?? '' };
  }
  return map;
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
export async function createCmsFragment(data: CreateCmsFragmentInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsFragments).values({
      ...data,
      content: sanitizeCmsFragmentContent(data.type ?? 'html', data.content),
    }).returning();
    return mapCmsFragment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下碎片标识已存在');
  }
}

export async function updateCmsFragment(id: number, data: UpdateCmsFragmentInput) {
  const current = await ensureCmsFragmentExists(id);
  await assertSiteAccess(current.siteId);
  const type = data.type ?? current.type;
  const content = data.content === undefined ? current.content : data.content;
  try {
    const [row] = await db.update(cmsFragments).set({
      ...data,
      ...((data.type !== undefined || data.content !== undefined)
        ? { content: sanitizeCmsFragmentContent(type, content) }
        : {}),
    }).where(and(
      eq(cmsFragments.id, id),
    )).returning();
    if (!row) throw new HTTPException(404, { message: '碎片不存在' });
    return mapCmsFragment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下碎片标识已存在');
  }
}

export async function deleteCmsFragment(id: number) {
  const current = await ensureCmsFragmentExists(id);
  await assertSiteAccess(current.siteId);
  const [row] = await db.delete(cmsFragments).where(and(
    eq(cmsFragments.id, id),
  )).returning();
  if (!row) throw new HTTPException(404, { message: '碎片不存在' });
}

export async function batchDeleteCmsFragments(ids: number[]) {
  if (ids.length === 0) return;
  const rows = await db.select({ id: cmsFragments.id, siteId: cmsFragments.siteId }).from(cmsFragments)
    .where(inArray(cmsFragments.id, ids));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '碎片');
  for (const siteId of new Set(rows.map((row) => row.siteId))) await assertSiteAccess(siteId);
  await db.delete(cmsFragments).where(inArray(cmsFragments.id, ids));
}
