import { eq, asc, and, or, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsTags } from '../../db/schema';
import type { CmsTagRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsTagInput, UpdateCmsTagInput } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsTag(row: CmsTagRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    slug: row.slug,
    groupName: row.groupName ?? null,
    contentCount: row.contentCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsTagExists(id: number): Promise<CmsTagRow> {
  const [row] = await db.select().from(cmsTags).where(eq(cmsTags.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '标签不存在' });
  return row;
}

export async function getCmsTag(id: number) {
  return mapCmsTag(await ensureCmsTagExists(id));
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsTagsQuery {
  siteId: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listCmsTags(q: ListCmsTagsQuery) {
  const conditions: SQL[] = [eq(cmsTags.siteId, q.siteId)];
  if (q.keyword) {
    const kw = or(
      like(cmsTags.name, `%${escapeLike(q.keyword)}%`),
      like(cmsTags.slug, `%${escapeLike(q.keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsTags, where),
    withPagination(
      db.select().from(cmsTags).where(where).orderBy(asc(cmsTags.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsTag), total, page: q.page, pageSize: q.pageSize };
}

/** 站点全部标签（内容编辑打标下拉用） */
export async function listAllCmsTags(siteId: number) {
  const rows = await db.select().from(cmsTags).where(eq(cmsTags.siteId, siteId)).orderBy(asc(cmsTags.id));
  return rows.map(mapCmsTag);
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
export async function createCmsTag(data: CreateCmsTagInput) {
  try {
    const [row] = await db.insert(cmsTags).values(data).returning();
    return mapCmsTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下标签名称或标识已存在');
  }
}

export async function updateCmsTag(id: number, data: UpdateCmsTagInput) {
  try {
    const [row] = await db.update(cmsTags).set(data).where(eq(cmsTags.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '标签不存在' });
    return mapCmsTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下标签名称或标识已存在');
  }
}

export async function deleteCmsTag(id: number) {
  const [row] = await db.delete(cmsTags).where(eq(cmsTags.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '标签不存在' });
}
