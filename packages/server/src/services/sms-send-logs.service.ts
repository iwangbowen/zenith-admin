import { eq, and, ilike, desc, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { smsSendLogs, smsTemplates, smsConfigs, users } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { sendSmsByProvider, renderTemplate } from '../lib/sms-sender';
import { streamToExcel, streamToCsv, formatDateTimeForExcel, batchIterable } from '../lib/excel-export';
import { ensureSmsTemplateExists } from './sms-templates.service';
import { findDefaultSmsConfig } from './sms-configs.service';
import type { SmsProvider, SendSource, SendStatus, SendSmsInput } from '@zenith/shared';

export interface ListSmsSendLogsQuery {
  keyword?: string;
  phone?: string;
  provider?: SmsProvider;
  status?: SendStatus;
  source?: SendSource;
  page: number;
  pageSize: number;
}

function buildListWhere(q: ListSmsSendLogsQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(smsSendLogs);
  if (tenant) conditions.push(tenant);
  if (q.keyword) conditions.push(ilike(smsSendLogs.content, `%${escapeLike(q.keyword)}%`));
  if (q.phone) conditions.push(ilike(smsSendLogs.phone, `%${escapeLike(q.phone)}%`));
  if (q.provider) conditions.push(eq(smsSendLogs.provider, q.provider));
  if (q.status) conditions.push(eq(smsSendLogs.status, q.status));
  if (q.source) conditions.push(eq(smsSendLogs.source, q.source));
  return mergeWhere(and(...conditions));
}

export async function listSmsSendLogs(q: ListSmsSendLogsQuery) {
  const where = buildListWhere(q);
  const rows = await withPagination(
    db.select({
      log: smsSendLogs,
      templateName: smsTemplates.name,
      configName: smsConfigs.name,
      username: users.username,
    })
      .from(smsSendLogs)
      .leftJoin(smsTemplates, eq(smsSendLogs.templateId, smsTemplates.id))
      .leftJoin(smsConfigs, eq(smsSendLogs.configId, smsConfigs.id))
      .leftJoin(users, eq(smsSendLogs.userId, users.id))
      .where(where)
      .orderBy(desc(smsSendLogs.id))
      .$dynamic(),
    q.page,
    q.pageSize,
  );
  const total = await db.$count(smsSendLogs, where);
  return {
    list: rows.map((r) => ({
      id: r.log.id,
      configId: r.log.configId,
      configName: r.configName ?? null,
      templateId: r.log.templateId,
      templateName: r.templateName ?? null,
      provider: r.log.provider,
      phone: r.log.phone,
      content: r.log.content,
      status: r.log.status,
      errorMsg: r.log.errorMsg ?? null,
      bizId: r.log.bizId ?? null,
      deliveryStatus: r.log.deliveryStatus ?? null,
      deliveredAt: r.log.deliveredAt ? formatDateTime(r.log.deliveredAt) : null,
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
export async function exportSmsSendLogs(q: Omit<ListSmsSendLogsQuery, 'page' | 'pageSize'>) {
  const where = buildListWhere({ ...q, page: 1, pageSize: 1 });
  const rows = batchIterable((limit, offset) =>
    db.select().from(smsSendLogs).where(where).orderBy(desc(smsSendLogs.id)).limit(limit).offset(offset),
  );
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '手机号', key: 'phone', width: 16 },
      { header: '服务商', key: 'provider', width: 12 },
      { header: '内容', key: 'content', width: 40 },
      { header: '状态', key: 'status', width: 10 },
      { header: '错误信息', key: 'errorMsg', width: 24, transform: (v) => (v as string | null) ?? '' },
      { header: '业务流水号', key: 'bizId', width: 24, transform: (v) => (v as string | null) ?? '' },
      { header: '来源', key: 'source', width: 10 },
      { header: '发送时间', key: 'sentAt', width: 20, transform: (v) => v ? formatDateTimeForExcel(v as Date) : '' },
      { header: '创建时间', key: 'createdAt', width: 20, transform: (v) => formatDateTimeForExcel(v as Date) },
    ],
    rows,
    '短信发送记录',
  );
  return { stream, filename: 'sms-send-logs.xlsx' };
}

export async function exportSmsSendLogsAsCsv(q: Omit<ListSmsSendLogsQuery, 'page' | 'pageSize'>) {
  const where = buildListWhere({ ...q, page: 1, pageSize: 1 });
  const rows = batchIterable((limit, offset) =>
    db.select().from(smsSendLogs).where(where).orderBy(desc(smsSendLogs.id)).limit(limit).offset(offset),
  );
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '手机号', key: 'phone', width: 16 },
      { header: '服务商', key: 'provider', width: 12 },
      { header: '内容', key: 'content', width: 40 },
      { header: '状态', key: 'status', width: 10 },
      { header: '错误信息', key: 'errorMsg', width: 24, transform: (v) => (v as string | null) ?? '' },
      { header: '业务流水号', key: 'bizId', width: 24, transform: (v) => (v as string | null) ?? '' },
      { header: '来源', key: 'source', width: 10 },
      { header: '发送时间', key: 'sentAt', width: 20, transform: (v) => v ? formatDateTimeForExcel(v as Date) : '' },
      { header: '创建时间', key: 'createdAt', width: 20, transform: (v) => formatDateTimeForExcel(v as Date) },
    ],
    rows,
  );
  return { stream, filename: 'sms-send-logs.csv' };
}

export async function getSmsSendLog(id: number) {
  const [row] = await db.select().from(smsSendLogs).where(eq(smsSendLogs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '发送记录不存在' });
  return row;
}

export async function deleteSmsSendLog(id: number) {
  await getSmsSendLog(id);
  await db.delete(smsSendLogs).where(eq(smsSendLogs.id, id));
}

/** 真正发送短信：使用默认配置 + 指定模板 + 变量 */
export async function sendSms(input: SendSmsInput, source: SendSource = 'manual', ip?: string) {
  const template = await ensureSmsTemplateExists(input.templateId);
  if (template.status !== 'enabled') {
    throw new HTTPException(400, { message: '模板已禁用' });
  }
  const config = await findDefaultSmsConfig();
  if (!config) {
    throw new HTTPException(500, { message: '未配置默认短信服务商' });
  }
  if (config.provider !== template.provider) {
    throw new HTTPException(400, { message: `默认短信配置（${config.provider}）与模板服务商（${template.provider}）不匹配` });
  }
  const variables = input.variables ?? {};
  const renderedContent = renderTemplate(template.content, variables);

  const me = currentUser();
  const tenantId = currentCreateTenantId();

  // 先写一条 pending 日志
  const [pending] = await db.insert(smsSendLogs).values({
    configId: config.id,
    templateId: template.id,
    provider: config.provider,
    phone: input.phone,
    content: renderedContent,
    status: 'pending',
    source,
    userId: me.userId,
    ip: ip ?? null,
    tenantId,
  }).returning();

  const result = await sendSmsByProvider({ config, template, phone: input.phone, variables, renderedContent });

  const [updated] = await db.update(smsSendLogs).set({
    status: result.success ? 'success' : 'failed',
    bizId: result.bizId,
    errorMsg: result.errorMsg,
    sentAt: new Date(),
  }).where(eq(smsSendLogs.id, pending.id)).returning();

  return {
    logId: updated.id,
    status: updated.status,
    bizId: updated.bizId ?? null,
    errorMsg: updated.errorMsg ?? null,
  };
}
