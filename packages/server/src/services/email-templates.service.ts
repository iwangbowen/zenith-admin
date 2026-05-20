import { eq, and, or, ilike, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { emailTemplates } from '../db/schema';
import type { EmailTemplateRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import type { CreateEmailTemplateInput, UpdateEmailTemplateInput } from '@zenith/shared';

export function mapEmailTemplate(row: EmailTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    subject: row.subject,
    content: row.content,
    variables: row.variables ?? null,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureEmailTemplateExists(id: number) {
  const [row] = await db.select().from(emailTemplates).where(and(eq(emailTemplates.id, id), tenantScope(emailTemplates))).limit(1);
  if (!row) throw new HTTPException(404, { message: '邮件模板不存在' });
  return row;
}

export interface ListEmailTemplatesQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listEmailTemplates(q: ListEmailTemplatesQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(emailTemplates);
  if (tenant) conditions.push(tenant);
  if (q.keyword) {
    const kw = or(ilike(emailTemplates.name, `%${escapeLike(q.keyword)}%`), ilike(emailTemplates.code, `%${escapeLike(q.keyword)}%`));
    if (kw) conditions.push(kw);
  }
  if (q.status) conditions.push(eq(emailTemplates.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(emailTemplates, where),
    withPagination(db.select().from(emailTemplates).where(where).orderBy(emailTemplates.id).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapEmailTemplate), total, page: q.page, pageSize: q.pageSize };
}

export async function getEmailTemplate(id: number) {
  const row = await ensureEmailTemplateExists(id);
  return mapEmailTemplate(row);
}

export async function getEmailTemplateBeforeAudit(id: number) {
  const row = await ensureEmailTemplateExists(id);
  return mapEmailTemplate(row);
}

export async function createEmailTemplate(data: CreateEmailTemplateInput) {
  try {
    const [row] = await db.insert(emailTemplates).values({ ...data, tenantId: currentCreateTenantId() }).returning();
    return mapEmailTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '邮件模板编码已存在');
  }
}

export async function updateEmailTemplate(id: number, data: UpdateEmailTemplateInput) {
  await ensureEmailTemplateExists(id);
  try {
    const [row] = await db.update(emailTemplates).set(data).where(eq(emailTemplates.id, id)).returning();
    return mapEmailTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '邮件模板编码已存在');
  }
}

export async function deleteEmailTemplate(id: number) {
  await ensureEmailTemplateExists(id);
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
}

export async function findEmailTemplateByCode(code: string) {
  const [row] = await db.select().from(emailTemplates).where(and(eq(emailTemplates.code, code), tenantScope(emailTemplates))).limit(1);
  return row ?? null;
}
