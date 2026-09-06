import { eq, desc, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { smsSendLogs, smsTemplates, smsConfigs, users } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { sendSmsByProvider, renderTemplate } from '../../lib/sms-sender';
import { ensureSmsTemplateExists } from './sms-templates.service';
import { findDefaultSmsConfig } from './sms-configs.service';
import type { SmsProvider, SendSource, SendStatus, SendSmsInput } from '@zenith/shared/messaging';

export interface ListSmsSendLogsQuery {
  keyword?: string;
  phone?: string;
  provider?: SmsProvider;
  status?: SendStatus;
  source?: SendSource;
  page: number;
  pageSize: number;
}

export function buildListWhere(q: ListSmsSendLogsQuery) {
  const conditions: (SQL | undefined)[] = [];
  const tenant = tenantScope(smsSendLogs);
  if (tenant) conditions.push(tenant);
  conditions.push(keywordCondition(q.keyword, [smsSendLogs.content], 'ilike'));
  conditions.push(keywordCondition(q.phone, [smsSendLogs.phone], 'ilike'));
  if (q.provider) conditions.push(eq(smsSendLogs.provider, q.provider));
  if (q.status) conditions.push(eq(smsSendLogs.status, q.status));
  if (q.source) conditions.push(eq(smsSendLogs.source, q.source));
  return buildWhere(...conditions);
}

export async function listSmsSendLogs(q: ListSmsSendLogsQuery) {
  const where = buildListWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(smsSendLogs, where),
    rows: () => withPagination(
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
    ),
    map: (r) => ({
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
    }),
  });
}

export async function getSmsSendLog(id: number) {
  return requireFirstRow(
    db.select().from(smsSendLogs).where(eq(smsSendLogs.id, id)).limit(1),
    '发送记录不存在',
  );
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
