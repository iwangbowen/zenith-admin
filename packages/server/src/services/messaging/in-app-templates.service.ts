import { eq, and } from 'drizzle-orm';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { inAppTemplates } from '../../db/schema';
import type { InAppTemplateRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import type { CreateInAppTemplateInput, UpdateInAppTemplateInput, inAppTemplateContract } from '@zenith/shared/messaging';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapInAppTemplate(row: InAppTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    title: row.title,
    content: row.content,
    type: row.type,
    variables: row.variables ?? null,
    status: row.status,
    remark: row.remark ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureInAppTemplateExists(id: number) {
  return requireFirstRow(
    db.select().from(inAppTemplates).where(and(eq(inAppTemplates.id, id), tenantScope(inAppTemplates))).limit(1),
    '站内信模板不存在',
  );
}

export async function listInAppTemplates(q: QueryOutputOf<typeof inAppTemplateContract.list>) {
  const where = buildWhere(
    tenantScope(inAppTemplates),
    keywordCondition(q.keyword, [inAppTemplates.name, inAppTemplates.code], 'ilike'),
    q.type ? eq(inAppTemplates.type, q.type) : undefined,
    q.status ? eq(inAppTemplates.status, q.status) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(inAppTemplates, where),
    rows: () => withPagination(db.select().from(inAppTemplates).where(where).orderBy(inAppTemplates.id).$dynamic(), q.page, q.pageSize),
    map: mapInAppTemplate,
  });
}

export async function getInAppTemplate(id: number) {
  return mapInAppTemplate(await ensureInAppTemplateExists(id));
}

export async function getInAppTemplateBeforeAudit(id: number) {
  return mapInAppTemplate(await ensureInAppTemplateExists(id));
}

export async function createInAppTemplate(data: CreateInAppTemplateInput) {
  try {
    const [row] = await db.insert(inAppTemplates).values({ ...data, tenantId: currentCreateTenantId() }).returning();
    return mapInAppTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站内信模板编码已存在');
  }
}

export async function updateInAppTemplate(id: number, data: UpdateInAppTemplateInput) {
  await ensureInAppTemplateExists(id);
  try {
    const [row] = await db.update(inAppTemplates).set(data).where(eq(inAppTemplates.id, id)).returning();
    return mapInAppTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站内信模板编码已存在');
  }
}

export async function deleteInAppTemplate(id: number) {
  await ensureInAppTemplateExists(id);
  await db.delete(inAppTemplates).where(eq(inAppTemplates.id, id));
}
