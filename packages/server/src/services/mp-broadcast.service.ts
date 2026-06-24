import { eq, and, desc, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpBroadcasts, mpTags } from '../db/schema';
import type { MpBroadcastRow } from '../db/schema';
import { mergeWhere, withPagination } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { massSend, WechatApiError } from '../lib/wechat';
import { mapWechatError } from '../lib/wechat-error';
import type { CreateMpBroadcastInput, UpdateMpBroadcastInput, MpBroadcastStatus } from '@zenith/shared';

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
    errorMsg: row.errorMsg ?? null,
    sentAt: formatNullableDateTime(row.sentAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpBroadcastExists(id: number): Promise<MpBroadcastRow> {
  const [row] = await db.select().from(mpBroadcasts).where(and(eq(mpBroadcasts.id, id), tenantScope(mpBroadcasts))).limit(1);
  if (!row) throw new HTTPException(404, { message: '群发记录不存在' });
  return row;
}

export async function getMpBroadcastBeforeAudit(id: number) {
  return mapMpBroadcast(await ensureMpBroadcastExists(id));
}

export interface ListMpBroadcastsQuery {
  accountId: number;
  status?: MpBroadcastStatus;
  page: number;
  pageSize: number;
}

export async function listMpBroadcasts(q: ListMpBroadcastsQuery) {
  await ensureMpAccountExists(q.accountId);
  const conditions: SQL[] = [eq(mpBroadcasts.accountId, q.accountId)];
  const tenant = tenantScope(mpBroadcasts);
  if (tenant) conditions.push(tenant);
  if (q.status) conditions.push(eq(mpBroadcasts.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(mpBroadcasts, where),
    withPagination(db.select().from(mpBroadcasts).where(where).orderBy(desc(mpBroadcasts.id)).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapMpBroadcast), total, page: q.page, pageSize: q.pageSize };
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
    status: 'draft',
    tenantId,
  }).returning();
  return mapMpBroadcast(row);
}

export async function updateMpBroadcast(id: number, data: UpdateMpBroadcastInput) {
  const existing = await ensureMpBroadcastExists(id);
  if (existing.status === 'sent') throw new HTTPException(400, { message: '已发送的群发不可修改' });
  const patch: Partial<typeof mpBroadcasts.$inferInsert> = { ...data };
  // 规范化关联字段
  if (data.target === 'all') patch.tagId = null;
  if (data.msgType === 'text') patch.mediaId = null;
  else if (data.msgType === 'image' || data.msgType === 'mpnews') patch.content = null;
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
    if (!tag) throw new HTTPException(400, { message: '群发标签不存在' });
    if (tag.wechatTagId == null) throw new HTTPException(400, { message: '该标签尚未同步到微信，无法按标签群发' });
    wechatTagId = tag.wechatTagId;
  }

  try {
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
