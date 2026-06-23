import { eq, and, ilike, desc, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpMessages, mpFans } from '../db/schema';
import type { MpMessageRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { sendCustomTextMessage, WechatApiError } from '../lib/wechat';
import type { SendMpMessageInput, MpMessageType, MpMessageDirection } from '@zenith/shared';

export function mapMpMessage(row: MpMessageRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    openid: row.openid,
    direction: row.direction,
    msgType: row.msgType,
    content: row.content ?? null,
    mediaId: row.mediaId ?? null,
    mediaUrl: row.mediaUrl ?? null,
    event: row.event ?? null,
    msgId: row.msgId ?? null,
    status: row.status,
    errorMsg: row.errorMsg ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface ListMpMessagesQuery {
  accountId: number;
  openid?: string;
  direction?: MpMessageDirection;
  msgType?: MpMessageType;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listMessages(q: ListMpMessagesQuery) {
  await ensureMpAccountExists(q.accountId);
  const conditions: SQL[] = [eq(mpMessages.accountId, q.accountId)];
  const tenant = tenantScope(mpMessages);
  if (tenant) conditions.push(tenant);
  if (q.openid) conditions.push(eq(mpMessages.openid, q.openid));
  if (q.direction) conditions.push(eq(mpMessages.direction, q.direction));
  if (q.msgType) conditions.push(eq(mpMessages.msgType, q.msgType));
  if (q.keyword) conditions.push(ilike(mpMessages.content, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(mpMessages, where),
    withPagination(db.select().from(mpMessages).where(where).orderBy(desc(mpMessages.id)).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapMpMessage), total, page: q.page, pageSize: q.pageSize };
}

/** 会话列表：按 openid 聚合，取每个会话最后一条消息 + 消息总数 + 粉丝信息 */
export async function listConversations(accountId: number) {
  await ensureMpAccountExists(accountId);
  const scope = tenantScope(mpMessages);
  const where = scope ? and(eq(mpMessages.accountId, accountId), scope) : eq(mpMessages.accountId, accountId);

  const [rows, counts] = await Promise.all([
    db.selectDistinctOn([mpMessages.openid], {
      openid: mpMessages.openid,
      lastContent: mpMessages.content,
      lastMsgType: mpMessages.msgType,
      lastDirection: mpMessages.direction,
      lastTime: mpMessages.createdAt,
      nickname: mpFans.nickname,
      avatar: mpFans.avatar,
    })
      .from(mpMessages)
      .leftJoin(mpFans, and(eq(mpFans.accountId, mpMessages.accountId), eq(mpFans.openid, mpMessages.openid)))
      .where(where)
      .orderBy(mpMessages.openid, desc(mpMessages.createdAt), desc(mpMessages.id)),
    db.select({ openid: mpMessages.openid, n: sql<number>`count(*)::int` })
      .from(mpMessages).where(where).groupBy(mpMessages.openid),
  ]);

  const countMap = new Map(counts.map((c) => [c.openid, c.n]));
  return rows
    .map((r) => ({
      openid: r.openid,
      nickname: r.nickname ?? null,
      avatar: r.avatar ?? null,
      lastContent: r.lastContent ?? null,
      lastMsgType: r.lastMsgType,
      lastDirection: r.lastDirection,
      lastTime: formatDateTime(r.lastTime),
      messageCount: countMap.get(r.openid) ?? 0,
    }))
    .sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1));
}

/** 发送客服文本消息：调微信下发，成功后落库为出站消息 */
export async function sendCustomMessage(input: SendMpMessageInput) {
  const account = await ensureMpAccountExists(input.accountId);
  const tenantId = currentCreateTenantId();
  try {
    await sendCustomTextMessage(account, input.openid, input.content);
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }
  const [row] = await db.insert(mpMessages).values({
    accountId: input.accountId,
    openid: input.openid,
    direction: 'out',
    msgType: 'text',
    content: input.content,
    status: 'sent',
    tenantId,
  }).returning();
  return mapMpMessage(row);
}

export interface InboundMessageParams {
  accountId: number;
  tenantId: number | null;
  openid: string;
  msgType: MpMessageType;
  content?: string | null;
  mediaId?: string | null;
  mediaUrl?: string | null;
  event?: string | null;
  msgId?: string | null;
}

/** 落库入站消息（由公开回调调用，无登录上下文，tenantId 由账号传入）。返回是否新增。 */
export async function storeInboundMessage(p: InboundMessageParams): Promise<boolean> {
  if (p.msgId) {
    const [dup] = await db.select({ id: mpMessages.id }).from(mpMessages)
      .where(and(eq(mpMessages.accountId, p.accountId), eq(mpMessages.msgId, p.msgId))).limit(1);
    if (dup) return false;
  }
  await db.insert(mpMessages).values({
    accountId: p.accountId,
    openid: p.openid,
    direction: 'in',
    msgType: p.msgType,
    content: p.content ?? null,
    mediaId: p.mediaId ?? null,
    mediaUrl: p.mediaUrl ?? null,
    event: p.event ?? null,
    msgId: p.msgId ?? null,
    status: 'received',
    tenantId: p.tenantId,
  });
  return true;
}
