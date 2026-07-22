import { eq, asc, desc, and, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsForms, cmsFormSubmissions } from '../../db/schema';
import type { CmsFormRow, CmsFormSubmissionRow, CmsSiteRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { like } from 'drizzle-orm';
import { sanitizeUserText } from './cms-sensitive-words.service';
import { assertSiteAccess } from './cms-sites.service';
import { throttleFrontSubmit } from './cms-comments.service';
import { sendMail } from '../../lib/email';
import logger from '../../lib/logger';
import { CMS_SECRET_MASK, type CmsFormField, type CreateCmsFormInput, type UpdateCmsFormInput } from '@zenith/shared';
import { assertCompleteCmsBatch } from './cms-access';
import { ensureCmsSiteExists } from './cms-sites.service';
import { validateCmsFormFields } from './cms-form-validation';
import { verifyCmsFormCaptcha } from './cms-form-captcha.service';
import { compileCmsFormPattern } from './cms-form-pattern';

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
    captchaProvider: row.captchaProvider,
    turnstileSiteKey: row.turnstileSiteKey ?? null,
    turnstileSecret: row.turnstileSecret ? CMS_SECRET_MASK : null,
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
  site: CmsSiteRow;
  raw: Record<string, unknown>;
  ip: string;
  userAgent: string | null;
}

/** 前台表单提交：限流 + 按字段定义校验 + 敏感词过滤 */
export async function submitCmsForm(input: SubmitFormInput) {
  await throttleFrontSubmit(input.ip);
  await verifyCmsFormCaptcha(input);
  const validated = validateCmsFormFields(input.form.fields as CmsFormField[], input.raw);
  const data: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(validated)) {
    data[name] = value ? await sanitizeUserText(value) : '';
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

export type FormFieldInput = {
  name: string;
  label: string;
  fieldType?: CmsFormField['fieldType'];
  required?: boolean;
  options?: { label: string; value: string }[] | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  min?: number | null;
  max?: number | null;
  errorMessage?: string | null;
};

/** zod input 的可选默认值 → DB 非空结构 */
export function normalizeCmsFormFields(fields: FormFieldInput[] | undefined) {
  return (fields ?? []).map((field) => {
    const pattern = field.pattern?.trim() || null;
    if (pattern) {
      try {
        compileCmsFormPattern(pattern);
      } catch {
        throw new HTTPException(400, { message: `字段「${field.label}」不是有效的 RE2-compatible 规则` });
      }
    }
    return {
      name: field.name,
      label: field.label,
      fieldType: field.fieldType ?? 'text',
      required: field.required ?? false,
      options: field.options ?? null,
      minLength: field.minLength ?? null,
      maxLength: field.maxLength ?? null,
      pattern,
      min: field.min ?? null,
      max: field.max ?? null,
      errorMessage: field.errorMessage?.trim() || null,
    };
  });
}

function mergeTurnstileSecret(current: string | null, incoming: string | null | undefined): string | null {
  if (incoming === undefined || incoming === '' || incoming === CMS_SECRET_MASK) return current;
  return incoming;
}

function assertCaptchaConfig(input: {
  captchaProvider: CmsFormRow['captchaProvider'];
  turnstileSiteKey: string | null;
  turnstileSecret: string | null;
}) {
  if (input.captchaProvider === 'turnstile' && (!input.turnstileSiteKey?.trim() || !input.turnstileSecret?.trim())) {
    throw new HTTPException(400, { message: 'Turnstile 必须同时配置 Site Key 和服务端 Secret' });
  }
}

export async function createCmsForm(data: CreateCmsFormInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  const turnstileSecret = mergeTurnstileSecret(null, data.turnstileSecret);
  assertCaptchaConfig({
    captchaProvider: data.captchaProvider ?? 'inherit',
    turnstileSiteKey: data.turnstileSiteKey ?? null,
    turnstileSecret,
  });
  try {
    const [row] = await db.insert(cmsForms).values({
      ...data,
      fields: normalizeCmsFormFields(data.fields),
      turnstileSecret,
    }).returning();
    return mapCmsForm(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下表单标识已存在');
  }
}

export async function updateCmsForm(id: number, data: UpdateCmsFormInput) {
  const current = await ensureCmsFormExists(id);
  await assertSiteAccess(current.siteId);
  const { fields, turnstileSecret: incomingSecret, ...rest } = data;
  const turnstileSecret = mergeTurnstileSecret(current.turnstileSecret, incomingSecret);
  assertCaptchaConfig({
    captchaProvider: rest.captchaProvider ?? current.captchaProvider,
    turnstileSiteKey: rest.turnstileSiteKey === undefined ? current.turnstileSiteKey : rest.turnstileSiteKey,
    turnstileSecret,
  });
  try {
    const [row] = await db.update(cmsForms).set({
      ...rest,
      ...(fields !== undefined ? { fields: normalizeCmsFormFields(fields) } : {}),
      ...(incomingSecret !== undefined ? { turnstileSecret } : {}),
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
