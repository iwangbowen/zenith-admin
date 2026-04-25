import { eq, and, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { messageTemplates } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { AppError } from '../lib/errors';
import { rethrowPgUniqueViolation } from '../lib/db-errors';

export function mapMessageTemplate(row: typeof messageTemplates.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export function interpolate(content: string, vars: Record<string, string>): string {
  return content.replaceAll(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const k = key.trim();
    return Object.hasOwn(vars, k) ? vars[k] : `{{${k}}}`;
  });
}

export interface ListMessageTemplatesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: 'email' | 'sms' | 'in_app';
  status?: 'active' | 'disabled';
}

export async function listMessageTemplates(q: ListMessageTemplatesQuery) {
  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 10)));
  const conditions = [];
  if (q.keyword) conditions.push(or(ilike(messageTemplates.name, `%${q.keyword}%`), ilike(messageTemplates.code, `%${q.keyword}%`)));
  if (q.channel) conditions.push(eq(messageTemplates.channel, q.channel));
  if (q.status) conditions.push(eq(messageTemplates.status, q.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, list] = await Promise.all([
    db.$count(messageTemplates, where),
    db.select().from(messageTemplates).where(where).orderBy(messageTemplates.id).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: list.map(mapMessageTemplate), total, page, pageSize };
}

export async function getMessageTemplate(id: number) {
  const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
  if (!row) throw new AppError('模板不存在', 404);
  return mapMessageTemplate(row);
}

export async function createMessageTemplate(data: typeof messageTemplates.$inferInsert) {
  try {
    const [row] = await db.insert(messageTemplates).values(data).returning();
    return mapMessageTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模板编码已存在');
  }
}

export async function updateMessageTemplate(id: number, data: Partial<typeof messageTemplates.$inferInsert>) {
  try {
    const [row] = await db.update(messageTemplates).set({ ...data }).where(eq(messageTemplates.id, id)).returning();
    if (!row) throw new AppError('模板不存在', 404);
    return mapMessageTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模板编码已存在');
  }
}

export async function deleteMessageTemplate(id: number) {
  const [row] = await db.delete(messageTemplates).where(eq(messageTemplates.id, id)).returning();
  if (!row) throw new AppError('模板不存在', 404);
}

export async function previewMessageTemplate(id: number, vars: Record<string, string>) {
  const [row] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1);
  if (!row) throw new AppError('模板不存在', 404);
  const subject = row.subject ? interpolate(row.subject, vars) : null;
  const content = interpolate(row.content, vars);
  return { subject, content };
}
