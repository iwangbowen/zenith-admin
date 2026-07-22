import { eq, asc, and, inArray, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSearchWords } from '../../db/schema';
import type { CmsSearchWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { reloadCmsSearchDict } from './cms-search.service';
import type { CreateCmsSearchWordInput, UpdateCmsSearchWordInput } from '@zenith/shared';
import type { BatchUpdateCmsSearchWordsInput } from '@zenith/shared';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertCompleteCmsBatch } from './cms-access';
import { assertCmsSearchDictionaryWord } from './cms-search-dictionary';

// ─── 数据映射 / CRUD ──────────────────────────────────────────────────────────
export function mapCmsSearchWord(row: CmsSearchWordRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    word: row.word,
    type: row.type,
    groupName: row.groupName,
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
  siteId: number;
  type?: 'extension' | 'stop';
  groupName?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsSearchWords(q: ListCmsSearchWordsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsSearchWords.siteId, q.siteId)];
  if (q.keyword) conditions.push(like(cmsSearchWords.word, `%${escapeLike(q.keyword)}%`));
  if (q.type) conditions.push(eq(cmsSearchWords.type, q.type));
  if (q.groupName) conditions.push(eq(cmsSearchWords.groupName, q.groupName));
  if (q.status) conditions.push(eq(cmsSearchWords.status, q.status));
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
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  const word = assertCmsSearchDictionaryWord(data.word);
  try {
    const [row] = await db.insert(cmsSearchWords).values({ ...data, word }).returning();
    await reloadCmsSearchDict(data.siteId);
    return mapCmsSearchWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该词条已存在');
  }
}

export async function updateCmsSearchWord(id: number, data: UpdateCmsSearchWordInput) {
  const current = await ensureCmsSearchWordExists(id);
  await assertSiteAccess(current.siteId);
  const word = data.word === undefined ? undefined : assertCmsSearchDictionaryWord(data.word);
  try {
    const [row] = await db.update(cmsSearchWords).set({ ...data, ...(word !== undefined ? { word } : {}) }).where(eq(cmsSearchWords.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '词条不存在' });
    await reloadCmsSearchDict(current.siteId);
    return mapCmsSearchWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该词条已存在');
  }
}

export async function deleteCmsSearchWord(id: number) {
  const current = await ensureCmsSearchWordExists(id);
  await assertSiteAccess(current.siteId);
  const [row] = await db.delete(cmsSearchWords).where(eq(cmsSearchWords.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '词条不存在' });
  await reloadCmsSearchDict(current.siteId);
}

export async function batchUpdateCmsSearchWords(input: BatchUpdateCmsSearchWordsInput): Promise<number> {
  const ids = [...new Set(input.ids)];
  const rows = await db.select().from(cmsSearchWords).where(inArray(cmsSearchWords.id, ids));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '词条');
  const siteIds = [...new Set(rows.map((row) => row.siteId))];
  for (const siteId of siteIds) await assertSiteAccess(siteId);
  const patch = {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.groupName !== undefined ? { groupName: input.groupName } : {}),
  };
  const updated = await db.update(cmsSearchWords).set(patch).where(inArray(cmsSearchWords.id, ids)).returning({ id: cmsSearchWords.id });
  await Promise.all(siteIds.map((siteId) => reloadCmsSearchDict(siteId)));
  return updated.length;
}

export async function batchDeleteCmsSearchWords(ids: number[]): Promise<number> {
  const unique = [...new Set(ids)];
  const rows = await db.select().from(cmsSearchWords).where(inArray(cmsSearchWords.id, unique));
  assertCompleteCmsBatch(unique, rows.map((row) => row.id), '词条');
  const siteIds = [...new Set(rows.map((row) => row.siteId))];
  for (const siteId of siteIds) await assertSiteAccess(siteId);
  const deleted = await db.delete(cmsSearchWords).where(inArray(cmsSearchWords.id, unique)).returning({ id: cmsSearchWords.id });
  await Promise.all(siteIds.map((siteId) => reloadCmsSearchDict(siteId)));
  return deleted.length;
}
