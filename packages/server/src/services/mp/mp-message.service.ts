import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpMessages, mpFans } from '../../db/schema';
import type { MpMessageRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { assertContentSafe } from './mp-security.service';
import { sendCustomServiceMessage, WechatApiError } from '../../lib/wechat';
import type { SendMpMessageInput } from '@zenith/shared/messaging';
import type { MpMessageType, MpMessageDirection } from '@zenith/shared/mp';

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
  const conditions: (SQL | undefined)[] = [eq(mpMessages.accountId, q.accountId)];
  const tenant = tenantScope(mpMessages);
  if (tenant) conditions.push(tenant);
  if (q.openid) conditions.push(eq(mpMessages.openid, q.openid));
  if (q.direction) conditions.push(eq(mpMessages.direction, q.direction));
  if (q.msgType) conditions.push(eq(mpMessages.msgType, q.msgType));
  conditions.push(keywordCondition(q.keyword, [mpMessages.content], 'ilike'));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpMessages, where),
    rows: () => withPagination(db.select().from(mpMessages).where(where).orderBy(desc(mpMessages.id)).$dynamic(), q.page, q.pageSize),
    map: mapMpMessage,
  });
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

/** 发送客服消息（文本/图片/语音/视频/图文）：调微信下发，成功后落库为出站消息 */
export async function sendCustomMessage(input: SendMpMessageInput) {
  const account = await ensureMpAccountExists(input.accountId);
  const tenantId = currentCreateTenantId();
  try {
    await assertContentSafe(account, input.content);
    await sendCustomServiceMessage(account, input.openid, { msgType: input.msgType, content: input.content, mediaId: input.mediaId });
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }
  // 出站落库（mp_messages 枚举无 news，图文记为 text 摘要）
  const storedType: MpMessageType = input.msgType === 'news' ? 'text' : input.msgType;
  const storedContent = input.msgType === 'text' ? (input.content ?? '')
    : input.msgType === 'image' ? '[图片消息]'
      : input.msgType === 'voice' ? '[语音消息]'
        : input.msgType === 'video' ? (input.content ? `[视频] ${input.content}` : '[视频消息]')
          : '[图文消息]';
  const [row] = await db.insert(mpMessages).values({
    accountId: input.accountId,
    openid: input.openid,
    direction: 'out',
    msgType: storedType,
    content: storedContent,
    mediaId: input.msgType === 'text' ? null : (input.mediaId ?? null),
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

/** 落库入站消息（由公开回调调用，无登录上下文，tenantId 由账号传入）。返回是否新增（false=微信重试的重复消息）。 */
export async function storeInboundMessage(p: InboundMessageParams): Promise<boolean> {
  // 有 msgId：依赖 (account_id, msg_id) 部分唯一索引原子去重，避免 SELECT→INSERT 竞态
  if (p.msgId) {
    const inserted = await db.insert(mpMessages).values({
      accountId: p.accountId,
      openid: p.openid,
      direction: 'in',
      msgType: p.msgType,
      content: p.content ?? null,
      mediaId: p.mediaId ?? null,
      mediaUrl: p.mediaUrl ?? null,
      event: p.event ?? null,
      msgId: p.msgId,
      status: 'received',
      tenantId: p.tenantId,
    }).onConflictDoNothing({
      target: [mpMessages.accountId, mpMessages.msgId],
      where: sql`${mpMessages.msgId} IS NOT NULL`,
    }).returning({ id: mpMessages.id });
    return inserted.length > 0;
  }
  // 无 msgId（理论上仅极少数场景）：直接插入
  await db.insert(mpMessages).values({
    accountId: p.accountId,
    openid: p.openid,
    direction: 'in',
    msgType: p.msgType,
    content: p.content ?? null,
    mediaId: p.mediaId ?? null,
    mediaUrl: p.mediaUrl ?? null,
    event: p.event ?? null,
    msgId: null,
    status: 'received',
    tenantId: p.tenantId,
  });
  return true;
}

/** 落库出站自动回复消息（由公开回调调用，无登录上下文）。 */
export async function storeOutboundAutoReply(
  accountId: number,
  tenantId: number | null,
  openid: string,
  reply: { msgType?: MpMessageType; content: string; mediaId?: string | null },
): Promise<void> {
  await db.insert(mpMessages).values({
    accountId,
    openid,
    direction: 'out',
    msgType: reply.msgType ?? 'text',
    content: reply.content,
    mediaId: reply.mediaId ?? null,
    status: 'sent',
    tenantId,
  });
}
