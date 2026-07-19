import { eq, asc, and, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSearchWords } from '../../db/schema';
import type { CmsSearchWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { reloadCmsSearchDict } from './cms-search.service';
import type { CreateCmsSearchWordInput, UpdateCmsSearchWordInput } from '@zenith/shared';

// ─── 数据映射 / CRUD ──────────────────────────────────────────────────────────
export function mapCmsSearchWord(row: CmsSearchWordRow) {
  return {
    id: row.id,
    word: row.word,
    weight: row.weight,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsSearchWordExists(id: number): Promise<CmsSearchWordRow> {
  const [row] = await db.select().from(cmsSearchWords).where(eq(cmsSearchWords.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '词条不存在' });
  return row;
}

export interface ListCmsSearchWordsQuery {
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listCmsSearchWords(q: ListCmsSearchWordsQuery) {
  const conditions: SQL[] = [];
  if (q.keyword) conditions.push(like(cmsSearchWords.word, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsSearchWords, where),
    withPagination(
      db.select().from(cmsSearchWords).where(where).orderBy(asc(cmsSearchWords.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsSearchWord), total, page: q.page, pageSize: q.pageSize };
}

export async function createCmsSearchWord(data: CreateCmsSearchWordInput) {
  try {
    const [row] = await db.insert(cmsSearchWords).values(data).returning();
    await reloadCmsSearchDict();
    return mapCmsSearchWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该词条已存在');
  }
}

export async function updateCmsSearchWord(id: number, data: UpdateCmsSearchWordInput) {
  try {
    const [row] = await db.update(cmsSearchWords).set(data).where(eq(cmsSearchWords.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '词条不存在' });
    await reloadCmsSearchDict();
    return mapCmsSearchWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该词条已存在');
  }
}

export async function deleteCmsSearchWord(id: number) {
  const [row] = await db.delete(cmsSearchWords).where(eq(cmsSearchWords.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '词条不存在' });
  // 注意：jieba 词典为追加模式，删除词条需重启进程或重建索引后才完全失效
}
