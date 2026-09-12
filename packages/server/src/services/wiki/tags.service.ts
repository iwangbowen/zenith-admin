import { asc, eq, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { CreateWikiTagInput, UpdateWikiTagInput } from '@zenith/shared/wiki';
import { wikiTagContract } from '@zenith/shared/wiki';
import { db } from '../../db';
import { wikiDocTags, wikiTags, type WikiTagRow } from '../../db/schema';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatTimestamps } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';

export function mapWikiTag(row: WikiTagRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

type WikiTagListFilter = Omit<QueryOutputOf<typeof wikiTagContract.list>, 'page' | 'pageSize'>;

interface WikiTagWhereInput extends WikiTagListFilter {
  id?: number;
}

function buildWikiTagWhere(q: WikiTagWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(wikiTags.id, q.id) : undefined,
    keywordCondition(q.keyword, [wikiTags.name]),
  );
}

export async function listWikiTags(q: QueryOutputOf<typeof wikiTagContract.list>) {
  const { page, pageSize } = q;
  const where = buildWikiTagWhere(q);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(wikiTags, where),
    rows: () => withPagination(
      db.select({
        tag: wikiTags,
        docCount: sql<number>`count(${wikiDocTags.docId})::int`,
      }).from(wikiTags)
        .leftJoin(wikiDocTags, eq(wikiTags.id, wikiDocTags.tagId))
        .where(where)
        .groupBy(wikiTags.id)
        .orderBy(asc(wikiTags.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => ({ ...mapWikiTag(r.tag), docCount: r.docCount }),
  });
}

/** 全部标签（编辑器打标下拉） */
export async function listAllWikiTags() {
  const rows = await db.select().from(wikiTags).orderBy(asc(wikiTags.id));
  return rows.map(mapWikiTag);
}

export async function ensureWikiTagExists(id: number) {
  const [row] = await db.select().from(wikiTags).where(buildWikiTagWhere({ id })).limit(1);
  return requireRow(row, '标签不存在');
}

export async function createWikiTag(data: CreateWikiTagInput) {
  try {
    const [row] = await db.insert(wikiTags).values(data).returning();
    return mapWikiTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
    throw err;
  }
}

export async function updateWikiTag(id: number, data: UpdateWikiTagInput) {
  try {
    const [row] = await db.update(wikiTags).set(data).where(buildWikiTagWhere({ id })).returning();
    return mapWikiTag(requireRow(row, '标签不存在'));
  } catch (err) {
    rethrowPgUniqueViolation(err, '标签名称已存在');
    throw err;
  }
}

export async function deleteWikiTag(id: number) {
  await ensureWikiTagExists(id);
  await db.delete(wikiTags).where(buildWikiTagWhere({ id }));
}
