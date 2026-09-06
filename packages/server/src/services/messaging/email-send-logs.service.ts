import { eq, and, desc, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { emailSendLogs, emailTemplates, users } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { sendMail } from '../../lib/email';
import { renderTemplate } from '../../lib/sms-sender';
import { ensureEmailTemplateExists } from './email-templates.service';
import type { SendStatus, SendSource, SendEmailInput } from '@zenith/shared/messaging';

export interface ListEmailSendLogsQuery {
  keyword?: string;
  toEmail?: string;
  status?: SendStatus;
  source?: SendSource;
  page: number;
  pageSize: number;
}

export function buildListWhere(q: ListEmailSendLogsQuery) {
  const conditions: (SQL | undefined)[] = [];
  const tenant = tenantScope(emailSendLogs);
  if (tenant) conditions.push(tenant);
  conditions.push(keywordCondition(q.keyword, [emailSendLogs.subject], 'ilike'));
  conditions.push(keywordCondition(q.toEmail, [emailSendLogs.toEmail], 'ilike'));
  if (q.status) conditions.push(eq(emailSendLogs.status, q.status));
  if (q.source) conditions.push(eq(emailSendLogs.source, q.source));
  return buildWhere(...conditions);
}

export async function listEmailSendLogs(q: ListEmailSendLogsQuery) {
  const where = buildListWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(emailSendLogs, where),
    rows: () => withPagination(
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
    ),
    map: (r) => ({
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
    }),
  });
}

export async function getEmailSendLog(id: number) {
  return requireFirstRow(
    db.select().from(emailSendLogs).where(and(eq(emailSendLogs.id, id), tenantScope(emailSendLogs))).limit(1),
    '发送记录不存在',
  );
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
