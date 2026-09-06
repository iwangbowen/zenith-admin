import { and, desc, eq, lte, ne, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { db } from '../../db';
import { chatConversations, chatConversationMembers, chatScheduledMessages, users } from '../../db/schema';
import type { ChatScheduledMessageRow } from '../../db/schema/chat';
import { currentUser, runWithCurrentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import logger from '../../lib/logger';
import { sendMessage } from './chat.service';
import type { ChatMessageExtra, ChatScheduledMessage, SendChatMessageInput } from '@zenith/shared/chat';

const MAX_PENDING_PER_USER = 20;
const MAX_AHEAD_DAYS = 30;

function mapScheduled(row: ChatScheduledMessageRow, conversationName: string | null = null): ChatScheduledMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    conversationName,
    type: row.type,
    content: row.content,
    extra: (row.extra as ChatMessageExtra | null) ?? null,
    scheduledAt: formatDateTime(row.scheduledAt),
    status: row.status,
    failReason: row.failReason,
    sentMessageId: row.sentMessageId,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 解析目标会话展示名（群名或单聊对方昵称），批量 */
async function resolveConversationNames(convIds: number[], viewerId: number): Promise<Map<number, string | null>> {
  if (convIds.length === 0) return new Map();
  const convs = await db.query.chatConversations.findMany({
    where: inArray(chatConversations.id, convIds),
    columns: { id: true, type: true, name: true },
  });
  const directIds = convs.filter((c) => c.type === 'direct').map((c) => c.id);
  const targetRows = directIds.length > 0
    ? await db
        .select({ conversationId: chatConversationMembers.conversationId, nickname: users.nickname })
        .from(chatConversationMembers)
        .innerJoin(users, eq(chatConversationMembers.userId, users.id))
        .where(and(
          inArray(chatConversationMembers.conversationId, directIds),
          ne(chatConversationMembers.userId, viewerId),
        ))
    : [];
  const directNameMap = new Map(targetRows.map((r) => [r.conversationId, r.nickname]));
  return new Map(convs.map((c) => [c.id, c.type === 'group' ? c.name : (directNameMap.get(c.id) ?? null)]));
}

/** 创建定时消息（需为会话成员；1 分钟后 ~ 30 天内；每人最多 20 条待发送） */
export async function createScheduledMessage(
  conversationId: number,
  input: { content: string; scheduledAt: string; extra?: ChatMessageExtra | null },
): Promise<ChatScheduledMessage> {
  const me = currentUser();

  const scheduledAt = parseDateTimeInput(input.scheduledAt);
  if (!scheduledAt) throw new HTTPException(400, { message: '定时时间格式无效' });

  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  requireRow(member, '无权向该会话发送消息', 403);

  const now = dayjs();
  const at = dayjs(scheduledAt);
  if (!at.isValid() || at.isBefore(now.add(1, 'minute'))) {
    throw new HTTPException(400, { message: '定时时间至少需在 1 分钟之后' });
  }
  if (at.isAfter(now.add(MAX_AHEAD_DAYS, 'day'))) {
    throw new HTTPException(400, { message: `定时时间最多提前 ${MAX_AHEAD_DAYS} 天` });
  }

  const pendingCount = await db.$count(chatScheduledMessages, and(
    eq(chatScheduledMessages.senderId, me.userId),
    eq(chatScheduledMessages.status, 'pending'),
  ));
  if (pendingCount >= MAX_PENDING_PER_USER) {
    throw new HTTPException(400, { message: `待发送的定时消息最多 ${MAX_PENDING_PER_USER} 条` });
  }

  const [row] = await db.insert(chatScheduledMessages).values({
    conversationId,
    senderId: me.userId,
    type: 'text',
    content: input.content,
    extra: input.extra ?? null,
    scheduledAt,
  }).returning();

  const names = await resolveConversationNames([conversationId], me.userId);
  return mapScheduled(row, names.get(conversationId) ?? null);
}

/** 我的定时消息列表（默认全部状态，最近优先） */
export async function listMyScheduledMessages(status?: ChatScheduledMessage['status']): Promise<ChatScheduledMessage[]> {
  const me = currentUser();
  const rows = await db.query.chatScheduledMessages.findMany({
    where: and(
      eq(chatScheduledMessages.senderId, me.userId),
      status ? eq(chatScheduledMessages.status, status) : undefined,
    ),
    orderBy: [desc(chatScheduledMessages.scheduledAt)],
    limit: 100,
  });
  const names = await resolveConversationNames([...new Set(rows.map((r) => r.conversationId))], me.userId);
  return rows.map((r) => mapScheduled(r, names.get(r.conversationId) ?? null));
}

/** 取消定时消息（仅本人、仅待发送状态） */
export async function cancelScheduledMessage(id: number): Promise<void> {
  const me = currentUser();
  const row = await db.query.chatScheduledMessages.findFirst({
    where: and(eq(chatScheduledMessages.id, id), eq(chatScheduledMessages.senderId, me.userId)),
  });
  const scheduled = requireRow(row, '定时消息不存在');
  if (scheduled.status !== 'pending') throw new HTTPException(400, { message: '仅待发送的定时消息可取消' });
  await db.update(chatScheduledMessages)
    .set({ status: 'canceled' })
    .where(eq(chatScheduledMessages.id, id));
}

/**
 * 派发到期的定时消息（由系统周期任务每分钟调用）。
 * 以发送者身份复用 sendMessage：成员校验/禁言校验/WS 推送全部生效；
 * 校验失败（已退群、被禁言等）标记 failed 并记录原因。
 */
export async function dispatchDueScheduledMessages(): Promise<void> {
  const due = await db.query.chatScheduledMessages.findMany({
    where: and(
      eq(chatScheduledMessages.status, 'pending'),
      lte(chatScheduledMessages.scheduledAt, new Date()),
    ),
    orderBy: [chatScheduledMessages.scheduledAt],
    limit: 50,
    with: { sender: { columns: { id: true, username: true, tenantId: true } } },
  });

  for (const row of due) {
    try {
      const sender = row.sender as { id: number; username: string; tenantId: number | null } | null;
      if (!sender) throw new Error('发送者不存在');
      // 定时消息目前仅支持文本
      const input: SendChatMessageInput = {
        type: 'text',
        content: row.content,
        extra: (row.extra as ChatMessageExtra | null) ?? null,
      };
      const msg = await runWithCurrentUser(
        { userId: sender.id, username: sender.username, roles: [], tenantId: sender.tenantId },
        () => sendMessage(row.conversationId, input),
      );
      await db.update(chatScheduledMessages)
        .set({ status: 'sent', sentMessageId: msg.id, failReason: null })
        .where(eq(chatScheduledMessages.id, row.id));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(`[chat-scheduled] dispatch failed (id ${row.id}): ${reason}`);
      await db.update(chatScheduledMessages)
        .set({ status: 'failed', failReason: reason.slice(0, 255) })
        .where(eq(chatScheduledMessages.id, row.id));
    }
  }
}
