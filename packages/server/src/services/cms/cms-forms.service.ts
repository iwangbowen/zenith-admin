import { eq, asc, desc, and, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsForms, cmsFormSubmissions } from '../../db/schema';
import type { CmsFormRow, CmsFormSubmissionRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { like } from 'drizzle-orm';
import { sanitizeUserText } from './cms-sensitive-words.service';
import { assertSiteAccess } from './cms-sites.service';
import { throttleFrontSubmit } from './cms-comments.service';
import { sendMail } from '../../lib/email';
import logger from '../../lib/logger';
import type { CreateCmsFormInput, UpdateCmsFormInput } from '@zenith/shared';
import { assertCompleteCmsBatch } from './cms-access';
import { ensureCmsSiteExists } from './cms-sites.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsForm(row: CmsFormRow, submissionCount?: number) {
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    fields: row.fields ?? [],
    successMessage: row.successMessage ?? null,
    notifyEmail: row.notifyEmail ?? null,
    status: row.status,
    ...(submissionCount !== undefined ? { submissionCount } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapCmsFormSubmission(row: CmsFormSubmissionRow) {
  return {
    id: row.id,
    formId: row.formId,
    data: row.data ?? {},
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function ensureCmsFormExists(id: number): Promise<CmsFormRow> {
  const [row] = await db.select().from(cmsForms).where(eq(cmsForms.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '表单不存在' });
  return row;
}

/** 前台渲染/提交：按站点+标识取启用表单 */
export async function getCmsFormByCode(siteId: number, code: string): Promise<CmsFormRow | null> {
  const [row] = await db.select().from(cmsForms)
    .where(and(eq(cmsForms.siteId, siteId), eq(cmsForms.code, code), eq(cmsForms.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

// ─── 前台提交 ─────────────────────────────────────────────────────────────────
export interface SubmitFormInput {
  form: CmsFormRow;
  raw: Record<string, unknown>;
  ip: string;
  userAgent: string | null;
}

/** 前台表单提交：限流 + 按字段定义校验 + 敏感词过滤 */
export async function submitCmsForm(input: SubmitFormInput) {
  await throttleFrontSubmit(input.ip);
  const data: Record<string, unknown> = {};
  for (const field of input.form.fields ?? []) {
    const rawValue = input.raw[field.name];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (field.required && !value) {
      throw new HTTPException(400, { message: `请填写「${field.label}」` });
    }
    if (value.length > 2000) {
      throw new HTTPException(400, { message: `「${field.label}」内容过长` });
    }
    if ((field.fieldType === 'select' || field.fieldType === 'radio') && value) {
      const allowed = (field.options ?? []).map((o) => o.value);
      if (!allowed.includes(value)) throw new HTTPException(400, { message: `「${field.label}」选项无效` });
    }
    data[field.name] = value ? await sanitizeUserText(value) : '';
  }
  const [row] = await db.insert(cmsFormSubmissions).values({
    formId: input.form.id,
    data,
    ip: input.ip,
    userAgent: input.userAgent,
  }).returning();
  notifyFormSubmission(input.form, data);
  return mapCmsFormSubmission(row);
}

/** 新提交邮件通知（异步 fire-and-forget，不阻塞前台响应） */
function notifyFormSubmission(form: CmsFormRow, data: Record<string, unknown>): void {
  const recipients = (form.notifyEmail ?? '')
    .split(/[,;，；]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
  if (recipients.length === 0) return;
  const escapeHtml = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const rows = (form.fields ?? [])
    .map((f) => `<tr><td style="padding:4px 16px 4px 0;color:#595959">${escapeHtml(f.label)}</td><td style="padding:4px 0">${escapeHtml(String(data[f.name] ?? ''))}</td></tr>`)
    .join('');
  const html = `<h3 style="margin:0 0 12px">表单「${escapeHtml(form.name)}」收到新提交</h3><table>${rows}</table>`;
  void Promise.allSettled(recipients.map((to) => sendMail(to, `【表单通知】${form.name} 收到新提交`, html)))
    .then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) logger.warn(`[CMS] 表单 ${form.code} 提交通知邮件 ${failed}/${recipients.length} 发送失败`);
    });
}

// ─── 表单 CRUD ────────────────────────────────────────────────────────────────
export interface ListCmsFormsQuery {
  siteId: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listCmsForms(q: ListCmsFormsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsForms.siteId, q.siteId)];
  if (q.keyword) conditions.push(like(cmsForms.name, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsForms, where),
    withPagination(
      db.select({
        form: cmsForms,
        submissionCount: sql<number>`(select count(*)::int from ${cmsFormSubmissions} where ${cmsFormSubmissions.formId} = ${cmsForms.id})`,
      }).from(cmsForms).where(where).orderBy(asc(cmsForms.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: rows.map((r) => mapCmsForm(r.form, r.submissionCount)), total, page: q.page, pageSize: q.pageSize };
}

type FormFieldInput = { name: string; label: string; fieldType?: string; required?: boolean; options?: { label: string; value: string }[] | null };

/** zod input 的可选默认值 → DB 非空结构 */
function normalizeFormFields(fields: FormFieldInput[] | undefined) {
  return (fields ?? []).map((f) => ({
    name: f.name,
    label: f.label,
    fieldType: f.fieldType ?? 'text',
    required: f.required ?? false,
    options: f.options ?? null,
  }));
}

export async function createCmsForm(data: CreateCmsFormInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsForms).values({
      ...data,
      fields: normalizeFormFields(data.fields),
    }).returning();
    return mapCmsForm(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下表单标识已存在');
  }
}

export async function updateCmsForm(id: number, data: UpdateCmsFormInput) {
  const current = await ensureCmsFormExists(id);
  await assertSiteAccess(current.siteId);
  const { fields, ...rest } = data;
  try {
    const [row] = await db.update(cmsForms).set({
      ...rest,
      ...(fields !== undefined ? { fields: normalizeFormFields(fields) } : {}),
    }).where(eq(cmsForms.id, id)).returning();
    return mapCmsForm(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下表单标识已存在');
  }
}

export async function deleteCmsForm(id: number) {
  const current = await ensureCmsFormExists(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsForms).where(eq(cmsForms.id, id));
}

// ─── 提交数据管理 ─────────────────────────────────────────────────────────────
export async function listCmsFormSubmissions(formId: number, page: number, pageSize: number) {
  const form = await ensureCmsFormExists(formId);
  await assertSiteAccess(form.siteId);
  const where = and(
    eq(cmsFormSubmissions.formId, formId),
  );
  const [total, list] = await Promise.all([
    db.$count(cmsFormSubmissions, where),
    withPagination(
      db.select().from(cmsFormSubmissions).where(where).orderBy(desc(cmsFormSubmissions.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: list.map(mapCmsFormSubmission), total, page, pageSize };
}

export async function deleteCmsFormSubmissions(formId: number, ids: number[]) {
  const form = await ensureCmsFormExists(formId);
  await assertSiteAccess(form.siteId);
  if (ids.length === 0) return;
  const rows = await db.select({ id: cmsFormSubmissions.id }).from(cmsFormSubmissions).where(and(
    eq(cmsFormSubmissions.formId, formId),
    inArray(cmsFormSubmissions.id, ids),
  ));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '表单提交');
  await db.delete(cmsFormSubmissions).where(and(
    eq(cmsFormSubmissions.formId, formId),
    inArray(cmsFormSubmissions.id, ids),
  ));
}
