import { eq, and } from 'drizzle-orm';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { emailTemplates } from '../../db/schema';
import type { EmailTemplateRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import type { CreateEmailTemplateInput, UpdateEmailTemplateInput, emailTemplateContract } from '@zenith/shared/messaging';
import type { QueryOutputOf } from '@zenith/shared/core';

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
  return requireFirstRow(
    db.select().from(emailTemplates).where(and(eq(emailTemplates.id, id), tenantScope(emailTemplates))).limit(1),
    '邮件模板不存在',
  );
}

export async function listEmailTemplates(q: QueryOutputOf<typeof emailTemplateContract.list>) {
  const where = buildWhere(
    tenantScope(emailTemplates),
    keywordCondition(q.keyword, [emailTemplates.name, emailTemplates.code], 'ilike'),
    q.status ? eq(emailTemplates.status, q.status) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(emailTemplates, where),
    rows: () => withPagination(db.select().from(emailTemplates).where(where).orderBy(emailTemplates.id).$dynamic(), q.page, q.pageSize),
    map: mapEmailTemplate,
  });
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
