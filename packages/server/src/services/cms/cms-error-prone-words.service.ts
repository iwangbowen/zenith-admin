import { eq, asc, and, like, or, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsErrorProneWords } from '../../db/schema';
import type { CmsErrorProneWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { invalidateWordCheckCache } from './cms-word-check.service';
import type { CreateCmsErrorProneWordInput, UpdateCmsErrorProneWordInput } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsErrorProneWord(row: CmsErrorProneWordRow) {
  return {
    id: row.id,
    word: row.word,
    correction: row.correction,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsErrorProneWordExists(id: number): Promise<CmsErrorProneWordRow> {
  const [row] = await db.select().from(cmsErrorProneWords).where(eq(cmsErrorProneWords.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '易错词不存在' });
  return row;
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
export interface ListCmsErrorProneWordsQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsErrorProneWords(q: ListCmsErrorProneWordsQuery) {
  const conditions: SQL[] = [];
  if (q.keyword) {
    const kw = or(
      like(cmsErrorProneWords.word, `%${escapeLike(q.keyword)}%`),
      like(cmsErrorProneWords.correction, `%${escapeLike(q.keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  if (q.status) conditions.push(eq(cmsErrorProneWords.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsErrorProneWords, where),
    withPagination(
      db.select().from(cmsErrorProneWords).where(where).orderBy(asc(cmsErrorProneWords.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsErrorProneWord), total, page: q.page, pageSize: q.pageSize };
}

// ─── 写入 ─────────────────────────────────────────────────────────────────────
export async function createCmsErrorProneWord(data: CreateCmsErrorProneWordInput) {
  try {
    const [row] = await db.insert(cmsErrorProneWords).values(data).returning();
    invalidateWordCheckCache();
    return mapCmsErrorProneWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该易错词已存在');
  }
}

export async function updateCmsErrorProneWord(id: number, data: UpdateCmsErrorProneWordInput) {
  try {
    const [row] = await db.update(cmsErrorProneWords).set(data).where(eq(cmsErrorProneWords.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '易错词不存在' });
    invalidateWordCheckCache();
    return mapCmsErrorProneWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该易错词已存在');
  }
}

export async function deleteCmsErrorProneWord(id: number) {
  const [row] = await db.delete(cmsErrorProneWords).where(eq(cmsErrorProneWords.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '易错词不存在' });
  invalidateWordCheckCache();
}
