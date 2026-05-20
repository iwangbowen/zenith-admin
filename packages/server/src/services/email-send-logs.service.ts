import { eq, and, ilike, desc, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { emailSendLogs, emailTemplates, users } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { sendMail } from '../lib/email';
import { renderTemplate } from '../lib/sms-sender';
import { streamToExcel, formatDateTimeForExcel, batchIterable } from '../lib/excel-export';
import { ensureEmailTemplateExists } from './email-templates.service';
import type { SendStatus, SendSource, SendEmailInput } from '@zenith/shared';

export interface ListEmailSendLogsQuery {
  keyword?: string;
  toEmail?: string;
  status?: SendStatus;
  source?: SendSource;
  page: number;
  pageSize: number;
}

function buildListWhere(q: ListEmailSendLogsQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(emailSendLogs);
  if (tenant) conditions.push(tenant);
  if (q.keyword) conditions.push(ilike(emailSendLogs.subject, `%${escapeLike(q.keyword)}%`));
  if (q.toEmail) conditions.push(ilike(emailSendLogs.toEmail, `%${escapeLike(q.toEmail)}%`));
  if (q.status) conditions.push(eq(emailSendLogs.status, q.status));
  if (q.source) conditions.push(eq(emailSendLogs.source, q.source));
  return mergeWhere(and(...conditions));
}

export async function listEmailSendLogs(q: ListEmailSendLogsQuery) {
  const where = buildListWhere(q);
  const rows = await withPagination(
    db.select({
      log: emailSendLogs,
      templateName: emailTemplates.name,
      username: users.username,
    })
      .from(emailSendLogs)
      .leftJoin(emailTemplates, eq(emailSendLogs.templateId, emailTemplates.id))
      .leftJoin(users, eq(emailSendLogs.userId, users.id))
      .where(where)
      .orderBy(desc(emailSendLogs.id))
      .$dynamic(),
    q.page,
    q.pageSize,
  );
  const total = await db.$count(emailSendLogs, where);
  return {
    list: rows.map((r) => ({
      id: r.log.id,
      templateId: r.log.templateId,
      templateName: r.templateName ?? null,
      toEmail: r.log.toEmail,
      subject: r.log.subject,
      content: r.log.content,
      status: r.log.status,
      errorMsg: r.log.errorMsg ?? null,
      source: r.log.source,
      userId: r.log.userId,
      username: r.username ?? null,
      ip: r.log.ip ?? null,
      sentAt: r.log.sentAt ? formatDateTime(r.log.sentAt) : null,
      createdAt: formatDateTime(r.log.createdAt),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Excel 导出 */
export async function exportEmailSendLogs(q: Omit<ListEmailSendLogsQuery, 'page' | 'pageSize'>) {
  const where = buildListWhere({ ...q, page: 1, pageSize: 1 });
  const rows = batchIterable((limit, offset) =>
    db.select().from(emailSendLogs).where(where).orderBy(desc(emailSendLogs.id)).limit(limit).offset(offset),
  );
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '收件邮箱', key: 'toEmail', width: 26 },
      { header: '主题', key: 'subject', width: 30 },
      { header: '状态', key: 'status', width: 10 },
      { header: '错误信息', key: 'errorMsg', width: 24, transform: (v) => (v as string | null) ?? '' },
      { header: '来源', key: 'source', width: 10 },
      { header: '发送时间', key: 'sentAt', width: 20, transform: (v) => v ? formatDateTimeForExcel(v as Date) : '' },
      { header: '创建时间', key: 'createdAt', width: 20, transform: (v) => formatDateTimeForExcel(v as Date) },
    ],
    rows,
    '邮件发送记录',
  );
  return { stream, filename: 'email-send-logs.xlsx' };
}

export async function getEmailSendLog(id: number) {
  const [row] = await db.select().from(emailSendLogs).where(and(eq(emailSendLogs.id, id), tenantScope(emailSendLogs))).limit(1);
  if (!row) throw new HTTPException(404, { message: '发送记录不存在' });
  return row;
}

export async function deleteEmailSendLog(id: number) {
  await getEmailSendLog(id);
  await db.delete(emailSendLogs).where(eq(emailSendLogs.id, id));
}

/** 真正发送邮件 */
export async function sendEmail(input: SendEmailInput, source: SendSource = 'manual', ip?: string) {
  let subject = input.subject ?? '';
  let content = input.content ?? '';
  let templateId: number | null = null;
  if (input.templateId) {
    const tpl = await ensureEmailTemplateExists(input.templateId);
    if (tpl.status !== 'enabled') {
      throw new HTTPException(400, { message: '模板已禁用' });
    }
    templateId = tpl.id;
    const vars = input.variables ?? {};
    subject = renderTemplate(tpl.subject, vars);
    content = renderTemplate(tpl.content, vars);
  }
  if (!subject || !content) {
    throw new HTTPException(400, { message: '邮件主题与内容不能为空' });
  }

  const me = currentUser();
  const tenantId = currentCreateTenantId();

  const [pending] = await db.insert(emailSendLogs).values({
    templateId,
    toEmail: input.toEmail,
    subject,
    content,
    status: 'pending',
    source,
    userId: me.userId,
    ip: ip ?? null,
    tenantId,
  }).returning();

  let success = false;
  let errorMsg: string | null = null;
  try {
    await sendMail(input.toEmail, subject, content);
    success = true;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  const [updated] = await db.update(emailSendLogs).set({
    status: success ? 'success' : 'failed',
    errorMsg,
    sentAt: new Date(),
  }).where(eq(emailSendLogs.id, pending.id)).returning();

  return {
    logId: updated.id,
    status: updated.status,
    errorMsg: updated.errorMsg ?? null,
  };
}
