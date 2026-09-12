import { eq, and, desc, inArray, isNotNull, lte } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpBroadcasts, mpTags, mpAccounts } from '../../db/schema';
import type { MpBroadcastRow } from '../../db/schema';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { assertContentSafe } from './mp-security.service';
import { massSend, previewMassSend, getMassSendResult, WechatApiError } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import type { CreateMpBroadcastInput, UpdateMpBroadcastInput, mpBroadcastContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpBroadcast(row: MpBroadcastRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    msgType: row.msgType,
    target: row.target,
    tagId: row.tagId ?? null,
    content: row.content ?? null,
    mediaId: row.mediaId ?? null,
    status: row.status,
    wechatMsgId: row.wechatMsgId ?? null,
    scheduledAt: formatNullableDateTime(row.scheduledAt),
    errorMsg: row.errorMsg ?? null,
    sentAt: formatNullableDateTime(row.sentAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureMpBroadcastExists(id: number): Promise<MpBroadcastRow> {
  const [row] = await db.select().from(mpBroadcasts).where(and(eq(mpBroadcasts.id, id), tenantScope(mpBroadcasts))).limit(1);
  return requireRow(row, '群发记录不存在');
}

export async function getMpBroadcastBeforeAudit(id: number) {
  return mapMpBroadcast(await ensureMpBroadcastExists(id));
}

export async function listMpBroadcasts(q: QueryOutputOf<typeof mpBroadcastContract.list>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpBroadcasts.accountId, q.accountId),
    tenantScope(mpBroadcasts),
    q.status ? eq(mpBroadcasts.status, q.status) : undefined,
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpBroadcasts, where),
    rows: () => withPagination(db.select().from(mpBroadcasts).where(where).orderBy(desc(mpBroadcasts.id)).$dynamic(), q.page, q.pageSize),
    map: mapMpBroadcast,
  });
}

export async function createMpBroadcast(data: CreateMpBroadcastInput) {
  await ensureMpAccountExists(data.accountId);
  const tenantId = currentCreateTenantId();
  const [row] = await db.insert(mpBroadcasts).values({
    accountId: data.accountId,
    msgType: data.msgType,
    target: data.target,
    tagId: data.target === 'tag' ? (data.tagId ?? null) : null,
    content: data.msgType === 'text' ? (data.content ?? null) : null,
    mediaId: data.msgType === 'text' ? null : (data.mediaId ?? null),
    scheduledAt: parseDateTimeInput(data.scheduledAt),
    status: 'draft',
    tenantId,
  }).returning();
  return mapMpBroadcast(row);
}

export async function updateMpBroadcast(id: number, data: UpdateMpBroadcastInput) {
  const existing = await ensureMpBroadcastExists(id);
  if (existing.status === 'sent') throw new HTTPException(400, { message: '已发送的群发不可修改' });
  const { scheduledAt, ...rest } = data;
  const patch: Partial<typeof mpBroadcasts.$inferInsert> = { ...rest };
  // 规范化关联字段
  if (data.target === 'all') patch.tagId = null;
  if (data.msgType === 'text') patch.mediaId = null;
  else if (data.msgType === 'image' || data.msgType === 'mpnews') patch.content = null;
  if (scheduledAt !== undefined) patch.scheduledAt = parseDateTimeInput(scheduledAt);
  if (Object.keys(patch).length === 0) return mapMpBroadcast(existing);
  const [row] = await db.update(mpBroadcasts).set(patch).where(eq(mpBroadcasts.id, id)).returning();
  return mapMpBroadcast(row);
}

export async function deleteMpBroadcast(id: number) {
  await ensureMpBroadcastExists(id);
  await db.delete(mpBroadcasts).where(eq(mpBroadcasts.id, id));
}

/** 发送群发：解析标签 → 调微信 mass/sendall；成功回填 msg_id/sentAt，失败落 errorMsg 并抛错。 */
export async function sendMpBroadcast(id: number) {
  const broadcast = await ensureMpBroadcastExists(id);
  if (broadcast.status === 'sent') throw new HTTPException(400, { message: '该群发已发送' });
  const account = await ensureMpAccountExists(broadcast.accountId);

  let wechatTagId: number | null = null;
  if (broadcast.target === 'tag') {
    if (!broadcast.tagId) throw new HTTPException(400, { message: '请先指定群发标签' });
    const [tag] = await db.select({ wechatTagId: mpTags.wechatTagId }).from(mpTags)
      .where(and(eq(mpTags.id, broadcast.tagId), tenantScope(mpTags))).limit(1);
    requireRow(tag, '群发标签不存在', 400);
    if (tag.wechatTagId == null) throw new HTTPException(400, { message: '该标签尚未同步到微信，无法按标签群发' });
    wechatTagId = tag.wechatTagId;
  }

  try {
    await assertContentSafe(account, broadcast.content);
    const { msgId } = await massSend(account, {
      isToAll: broadcast.target === 'all',
      tagId: wechatTagId,
      msgType: broadcast.msgType,
      content: broadcast.content,
      mediaId: broadcast.mediaId,
    });
    const [row] = await db.update(mpBroadcasts)
      .set({ status: 'sent', wechatMsgId: msgId, errorMsg: null, sentAt: new Date() })
      .where(eq(mpBroadcasts.id, id)).returning();
    return mapMpBroadcast(row);
  } catch (err) {
    const message = err instanceof WechatApiError ? err.message : '调用微信接口失败，请检查网络或稍后重试';
    await db.update(mpBroadcasts).set({ status: 'failed', errorMsg: message }).where(eq(mpBroadcasts.id, id));
    mapWechatError(err);
  }
}

/** 群发预览：发送给指定 openid 预览（不改变群发状态） */
export async function previewMpBroadcast(id: number, openid: string) {
  const broadcast = await ensureMpBroadcastExists(id);
  const account = await ensureMpAccountExists(broadcast.accountId);
  try {
    await assertContentSafe(account, broadcast.content);
    await previewMassSend(account, { msgType: broadcast.msgType, content: broadcast.content, mediaId: broadcast.mediaId, openid });
  } catch (err) {
    mapWechatError(err);
  }
  return { success: true };
}

/** 查询群发发送结果与统计 */
export async function getMpBroadcastResult(id: number) {
  const broadcast = await ensureMpBroadcastExists(id);
  if (!broadcast.wechatMsgId) throw new HTTPException(400, { message: '该群发尚未发送，无发送结果' });
  const account = await ensureMpAccountExists(broadcast.accountId);
  try {
    return await getMassSendResult(account, broadcast.wechatMsgId);
  } catch (err) {
    return mapWechatError(err);
  }
}

/** 定时群发扫描：发送所有到期（scheduledAt<=now）且仍为草稿的群发。供 mp-broadcast-tick 调用（无登录上下文）。 */
export async function runDueMpBroadcasts(): Promise<{ sent: number; failed: number }> {
  const due = await db.select().from(mpBroadcasts)
    .where(and(eq(mpBroadcasts.status, 'draft'), isNotNull(mpBroadcasts.scheduledAt), lte(mpBroadcasts.scheduledAt, new Date())));
  if (due.length === 0) return { sent: 0, failed: 0 };
  // 批量预取账号与标签，避免循环内逐条查询（N+1）
  const accountIds = [...new Set(due.map((b) => b.accountId))];
  const tagIds = [...new Set(due.map((b) => (b.target === 'tag' ? b.tagId : null)).filter((id): id is number => id != null))];
  const [accounts, tags] = await Promise.all([
    db.select().from(mpAccounts).where(inArray(mpAccounts.id, accountIds)),
    tagIds.length > 0
      ? db.select({ id: mpTags.id, wechatTagId: mpTags.wechatTagId }).from(mpTags).where(inArray(mpTags.id, tagIds))
      : Promise.resolve([]),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const wechatTagIdByTagId = new Map(tags.map((t) => [t.id, t.wechatTagId]));
  let sent = 0;
  let failed = 0;
  for (const b of due) {
    try {
      const account = accountById.get(b.accountId);
      if (!account || account.status === 'disabled') continue;
      const wechatTagId = b.target === 'tag' && b.tagId ? (wechatTagIdByTagId.get(b.tagId) ?? null) : null;
      await assertContentSafe(account, b.content);
      const { msgId } = await massSend(account, { isToAll: b.target === 'all', tagId: wechatTagId, msgType: b.msgType, content: b.content, mediaId: b.mediaId });
      await db.update(mpBroadcasts).set({ status: 'sent', wechatMsgId: msgId, errorMsg: null, sentAt: new Date() }).where(eq(mpBroadcasts.id, b.id));
      sent += 1;
    } catch (err) {
      await db.update(mpBroadcasts).set({ status: 'failed', errorMsg: (err as Error).message.slice(0, 500) }).where(eq(mpBroadcasts.id, b.id));
      failed += 1;
    }
  }
  return { sent, failed };
}
