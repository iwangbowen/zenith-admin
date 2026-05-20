import { eq, and, or, ilike, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { inAppTemplates } from '../db/schema';
import type { InAppTemplateRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import type { CreateInAppTemplateInput, UpdateInAppTemplateInput, InAppMessageType } from '@zenith/shared';

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
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureInAppTemplateExists(id: number) {
  const [row] = await db.select().from(inAppTemplates).where(and(eq(inAppTemplates.id, id), tenantScope(inAppTemplates))).limit(1);
  if (!row) throw new HTTPException(404, { message: '站内信模板不存在' });
  return row;
}

export interface ListInAppTemplatesQuery {
  keyword?: string;
  type?: InAppMessageType;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listInAppTemplates(q: ListInAppTemplatesQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(inAppTemplates);
  if (tenant) conditions.push(tenant);
  if (q.keyword) {
    const kw = or(ilike(inAppTemplates.name, `%${escapeLike(q.keyword)}%`), ilike(inAppTemplates.code, `%${escapeLike(q.keyword)}%`));
    if (kw) conditions.push(kw);
  }
  if (q.type) conditions.push(eq(inAppTemplates.type, q.type));
  if (q.status) conditions.push(eq(inAppTemplates.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(inAppTemplates, where),
    withPagination(db.select().from(inAppTemplates).where(where).orderBy(inAppTemplates.id).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapInAppTemplate), total, page: q.page, pageSize: q.pageSize };
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
