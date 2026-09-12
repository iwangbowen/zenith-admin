import { eq, and, desc } from 'drizzle-orm';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpMessageTemplates, mpTemplateSendLogs } from '../../db/schema';
import type { MpMessageTemplateRow, MpTemplateSendLogRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { getAllPrivateTemplates, sendTemplateMessage, setTemplateIndustry, getTemplateIndustry, WechatApiError } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import type { SendMpTemplateInput } from '@zenith/shared/messaging';
import type { MpTemplateSendStatus, mpTemplateContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpTemplate(row: MpMessageTemplateRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    templateId: row.templateId,
    title: row.title,
    content: row.content ?? null,
    example: row.example ?? null,
    ...formatTimestamps(row),
  };
}

export function mapMpTemplateSendLog(row: MpTemplateSendLogRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    templateId: row.templateId,
    openid: row.openid,
    data: (row.data ?? null) as Record<string, unknown> | null,
    url: row.url ?? null,
    status: row.status,
    errorMsg: row.errorMsg ?? null,
    msgId: row.msgId ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function ensureMpTemplateExists(id: number): Promise<MpMessageTemplateRow> {
  return requireFirstRow(db.select().from(mpMessageTemplates).where(and(eq(mpMessageTemplates.id, id), tenantScope(mpMessageTemplates))).limit(1), '模板不存在');
}

export async function getMpTemplateBeforeAudit(id: number) {
  return mapMpTemplate(await ensureMpTemplateExists(id));
}

export async function getMpTemplateIndustryBeforeAudit(accountId: number) {
  return {
    accountId,
    industry: await getMpTemplateIndustry(accountId),
  };
}

export async function listMpTemplates(q: QueryOutputOf<typeof mpTemplateContract.list>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpMessageTemplates.accountId, q.accountId),
    tenantScope(mpMessageTemplates),
    keywordCondition(q.keyword, [mpMessageTemplates.title], 'ilike'),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpMessageTemplates, where),
    rows: () => withPagination(db.select().from(mpMessageTemplates).where(where).orderBy(mpMessageTemplates.id).$dynamic(), q.page, q.pageSize),
    map: mapMpTemplate,
  });
}

export async function deleteMpTemplate(id: number) {
  await ensureMpTemplateExists(id);
  await db.delete(mpMessageTemplates).where(eq(mpMessageTemplates.id, id));
}

/** 从微信同步模板库 */
export async function syncMpTemplates(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  const tenantId = currentCreateTenantId();
  let templates;
  try {
    templates = await getAllPrivateTemplates(account);
  } catch (err) {
    return mapWechatError(err);
  }
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const t of templates) {
      const [existing] = await tx.select({ id: mpMessageTemplates.id }).from(mpMessageTemplates)
        .where(and(eq(mpMessageTemplates.accountId, accountId), eq(mpMessageTemplates.templateId, t.template_id))).limit(1);
      if (existing) {
        await tx.update(mpMessageTemplates).set({ title: t.title, content: t.content, example: t.example }).where(eq(mpMessageTemplates.id, existing.id));
        updated += 1;
      } else {
        await tx.insert(mpMessageTemplates).values({ accountId, templateId: t.template_id, title: t.title, content: t.content, example: t.example, tenantId });
        created += 1;
      }
    }
  });
  return { success: true, created, updated, total: templates.length };
}

/** 发送模板消息，记录发送日志（成功/失败均落库） */
export async function sendMpTemplate(input: SendMpTemplateInput) {
  const account = await ensureMpAccountExists(input.accountId);
  const tenantId = currentCreateTenantId();
  try {
    const msgId = await sendTemplateMessage(account, { openid: input.openid, templateId: input.templateId, url: input.url, data: input.data });
    const [log] = await db.insert(mpTemplateSendLogs).values({
      accountId: input.accountId, templateId: input.templateId, openid: input.openid,
      data: input.data, url: input.url ?? null, status: 'success', msgId, tenantId,
    }).returning();
    return mapMpTemplateSendLog(log);
  } catch (err) {
    const message = err instanceof WechatApiError ? err.message : '调用微信接口失败，请检查网络或稍后重试';
    await db.insert(mpTemplateSendLogs).values({
      accountId: input.accountId, templateId: input.templateId, openid: input.openid,
      data: input.data, url: input.url ?? null, status: 'failed', errorMsg: message, tenantId,
    });
    mapWechatError(err);
  }
}

export async function listMpTemplateSendLogs(q: QueryOutputOf<typeof mpTemplateContract.logs>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpTemplateSendLogs.accountId, q.accountId),
    tenantScope(mpTemplateSendLogs),
    q.status ? eq(mpTemplateSendLogs.status, q.status) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpTemplateSendLogs, where),
    rows: () => withPagination(db.select().from(mpTemplateSendLogs).where(where).orderBy(desc(mpTemplateSendLogs.id)).$dynamic(), q.page, q.pageSize),
    map: mapMpTemplateSendLog,
  });
}

/** 设置账号所属行业（模板消息行业，影响可选模板范围） */
export async function setMpTemplateIndustry(accountId: number, industryId1: string, industryId2: string) {
  const account = await ensureMpAccountExists(accountId);
  try {
    await setTemplateIndustry(account, industryId1, industryId2);
  } catch (err) {
    return mapWechatError(err);
  }
  return { success: true };
}

export async function getMpTemplateIndustry(accountId: number) {
  const account = await ensureMpAccountExists(accountId);
  try {
    return await getTemplateIndustry(account);
  } catch (err) {
    return mapWechatError(err);
  }
}

/** 批量发送模板消息：对多个 openid 逐一下发，逐条落库，返回成功/失败计数。 */
export async function batchSendMpTemplate(input: { accountId: number; templateId: string; openids: string[]; url?: string; data: Record<string, { value: string; color?: string }> }) {
  const account = await ensureMpAccountExists(input.accountId);
  const tenantId = currentCreateTenantId();
  let success = 0;
  let failed = 0;
  for (const openid of input.openids) {
    try {
      const msgId = await sendTemplateMessage(account, { openid, templateId: input.templateId, url: input.url, data: input.data });
      await db.insert(mpTemplateSendLogs).values({ accountId: input.accountId, templateId: input.templateId, openid, data: input.data, url: input.url ?? null, status: 'success', msgId, tenantId });
      success += 1;
    } catch (err) {
      const message = err instanceof WechatApiError ? err.message : '调用微信接口失败';
      await db.insert(mpTemplateSendLogs).values({ accountId: input.accountId, templateId: input.templateId, openid, data: input.data, url: input.url ?? null, status: 'failed', errorMsg: message, tenantId });
      failed += 1;
    }
  }
  if (success === 0 && failed > 0) throw new HTTPException(400, { message: '全部发送失败，请检查模板与公众号配置' });
  return { success, failed, total: input.openids.length };
}

/**
 * 处理模板消息送达回执（公开回调 TEMPLATESENDJOBFINISH 事件，无登录上下文）。
 * 按 accountId + msgId 匹配发送日志，依据微信 Status 更新最终状态。
 */
export async function handleTemplateSendReceipt(accountId: number, msgId: string, status: string): Promise<void> {
  const finalStatus: MpTemplateSendStatus = status === 'success' ? 'success' : 'failed';
  await db.update(mpTemplateSendLogs)
    .set({ status: finalStatus, errorMsg: finalStatus === 'failed' ? `送达失败：${status}` : null })
    .where(and(eq(mpTemplateSendLogs.accountId, accountId), eq(mpTemplateSendLogs.msgId, msgId)));
}
