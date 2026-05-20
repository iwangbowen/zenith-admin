import { eq, and, or, ilike, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { smsTemplates } from '../db/schema';
import type { SmsTemplateRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import type { CreateSmsTemplateInput, UpdateSmsTemplateInput, SmsProvider } from '@zenith/shared';

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
  const [row] = await db.select().from(smsTemplates).where(and(eq(smsTemplates.id, id), tenantScope(smsTemplates))).limit(1);
  if (!row) throw new HTTPException(404, { message: '短信模板不存在' });
  return row;
}

export interface ListSmsTemplatesQuery {
  keyword?: string;
  provider?: SmsProvider;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listSmsTemplates(q: ListSmsTemplatesQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(smsTemplates);
  if (tenant) conditions.push(tenant);
  if (q.keyword) {
    const kw = or(ilike(smsTemplates.name, `%${escapeLike(q.keyword)}%`), ilike(smsTemplates.code, `%${escapeLike(q.keyword)}%`));
    if (kw) conditions.push(kw);
  }
  if (q.provider) conditions.push(eq(smsTemplates.provider, q.provider));
  if (q.status) conditions.push(eq(smsTemplates.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(smsTemplates, where),
    withPagination(db.select().from(smsTemplates).where(where).orderBy(smsTemplates.id).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapSmsTemplate), total, page: q.page, pageSize: q.pageSize };
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
