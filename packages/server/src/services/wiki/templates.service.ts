import { asc, eq } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { CreateWikiTemplateInput, UpdateWikiTemplateInput } from '@zenith/shared/wiki';
import { wikiTemplateContract } from '@zenith/shared/wiki';
import { db } from '../../db';
import { wikiTemplates, type WikiTemplateRow } from '../../db/schema';
import { formatTimestamps } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';

export function mapWikiTemplate(row: WikiTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    content: row.content,
    status: row.status,
    sort: row.sort,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

type WikiTemplateListFilter = Omit<QueryOutputOf<typeof wikiTemplateContract.list>, 'page' | 'pageSize'>;

interface WikiTemplateWhereInput extends WikiTemplateListFilter {
  id?: number;
}

function buildWikiTemplateWhere(q: WikiTemplateWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(wikiTemplates.id, q.id) : undefined,
    keywordCondition(q.keyword, [wikiTemplates.name, wikiTemplates.description]),
    q.status ? eq(wikiTemplates.status, q.status) : undefined,
  );
}

export async function listWikiTemplates(q: QueryOutputOf<typeof wikiTemplateContract.list>) {
  const { page, pageSize } = q;
  const where = buildWikiTemplateWhere(q);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(wikiTemplates, where),
    rows: () => withPagination(
      db.select().from(wikiTemplates).where(where).orderBy(asc(wikiTemplates.sort), asc(wikiTemplates.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapWikiTemplate,
  });
}

/** 全部启用模板（编辑器选用下拉） */
export async function listAllWikiTemplates() {
  const rows = await db.select().from(wikiTemplates)
    .where(buildWikiTemplateWhere({ status: 'enabled' }))
    .orderBy(asc(wikiTemplates.sort), asc(wikiTemplates.id));
  return rows.map(mapWikiTemplate);
}

export async function ensureWikiTemplateExists(id: number) {
  const [row] = await db.select().from(wikiTemplates).where(buildWikiTemplateWhere({ id })).limit(1);
  return requireRow(row, '模板不存在');
}

export async function getWikiTemplate(id: number) {
  return mapWikiTemplate(await ensureWikiTemplateExists(id));
}

export async function createWikiTemplate(data: CreateWikiTemplateInput) {
  const [row] = await db.insert(wikiTemplates).values(data).returning();
  return mapWikiTemplate(row);
}

export async function updateWikiTemplate(id: number, data: UpdateWikiTemplateInput) {
  const [row] = await db.update(wikiTemplates).set(data).where(buildWikiTemplateWhere({ id })).returning();
  return mapWikiTemplate(requireRow(row, '模板不存在'));
}

export async function deleteWikiTemplate(id: number) {
  await ensureWikiTemplateExists(id);
  await db.delete(wikiTemplates).where(buildWikiTemplateWhere({ id }));
}
