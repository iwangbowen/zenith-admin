import { eq, and, type SQL } from 'drizzle-orm';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { smsTemplates } from '../../db/schema';
import type { SmsTemplateRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import type { CreateSmsTemplateInput, UpdateSmsTemplateInput, SmsProvider } from '@zenith/shared/messaging';

export function mapSmsTemplate(row: SmsTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    templateCode: row.templateCode,
    signName: row.signName ?? null,
    content: row.content,
    variables: row.variables ?? null,
    provider: row.provider,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureSmsTemplateExists(id: number) {
  return requireFirstRow(
    db.select().from(smsTemplates).where(and(eq(smsTemplates.id, id), tenantScope(smsTemplates))).limit(1),
    '短信模板不存在',
  );
}

export interface ListSmsTemplatesQuery {
  keyword?: string;
  provider?: SmsProvider;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listSmsTemplates(q: ListSmsTemplatesQuery) {
  const conditions: (SQL | undefined)[] = [tenantScope(smsTemplates), keywordCondition(q.keyword, [smsTemplates.name, smsTemplates.code], 'ilike')];
  if (q.provider) conditions.push(eq(smsTemplates.provider, q.provider));
  if (q.status) conditions.push(eq(smsTemplates.status, q.status));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(smsTemplates, where),
    rows: () => withPagination(db.select().from(smsTemplates).where(where).orderBy(smsTemplates.id).$dynamic(), q.page, q.pageSize),
    map: mapSmsTemplate,
  });
}

export async function getSmsTemplate(id: number) {
  return mapSmsTemplate(await ensureSmsTemplateExists(id));
}

export async function getSmsTemplateBeforeAudit(id: number) {
  return mapSmsTemplate(await ensureSmsTemplateExists(id));
}

export async function createSmsTemplate(data: CreateSmsTemplateInput) {
  try {
    const [row] = await db.insert(smsTemplates).values({ ...data, tenantId: currentCreateTenantId() }).returning();
    return mapSmsTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '短信模板编码已存在');
  }
}

export async function updateSmsTemplate(id: number, data: UpdateSmsTemplateInput) {
  await ensureSmsTemplateExists(id);
  try {
    const [row] = await db.update(smsTemplates).set(data).where(eq(smsTemplates.id, id)).returning();
    return mapSmsTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '短信模板编码已存在');
  }
}

export async function deleteSmsTemplate(id: number) {
  await ensureSmsTemplateExists(id);
  await db.delete(smsTemplates).where(eq(smsTemplates.id, id));
}
