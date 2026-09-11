// chat 域内部共享 helper：仅供 services/chat 下各模块引用；对外统一走 chat.service.ts facade
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { chatConversationMembers, chatConversations, chatMessages, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import type { ChatMessage, ChatReactionGroup } from '@zenith/shared/chat';

/** 生成排除当前用户已删除消息的 SQL 条件 */
export function notHiddenFor(userId: number) {
  // to_jsonb 是多态函数，prepared statement 参数需要显式 CAST 才能正确推断类型
  return sql`NOT COALESCE(${chatMessages.extra}->'hiddenFor', '[]'::jsonb) @> to_jsonb(CAST(${userId} AS integer))`;
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

/**
 * 剥离历史遗留的消息级收藏标记：收藏已迁移到 chat_message_favorites 按人隔离，
 * 旧数据残留在 extra.isFavorited 的共享值不得泄漏给任何查看者；
 * 各读取路径按当前用户回填视角化的 isFavorited。
 */
function sanitizeStoredExtra(extra: unknown): ChatMessage['extra'] {
  const e = (extra as ChatMessage['extra'] | null) ?? null;
  if (!e || e.isFavorited === undefined) return e;
  const { isFavorited: _legacy, ...rest } = e;
  return rest;
}

export function mapChatMessage(
  row: typeof chatMessages.$inferSelect,
  sender?: { id: number; nickname: string; avatar: string | null } | null,
  reactions: ChatReactionGroup[] = [],
  replyToMessage: ChatMessage['replyToMessage'] = null,
): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderName: sender?.nickname ?? null,
    senderAvatar: sender?.avatar ?? null,
    type: row.type,
    content: row.content,
    replyToId: row.replyToId,
    replyToMessage,
    isRecalled: row.isRecalled,
    isEdited: row.isEdited,
    extra: sanitizeStoredExtra(row.extra),
    reactions,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 联表查询行中的发送人信息（senderId 为空时返回 null，供 mapChatMessage 使用） */
export function rowSender(r: { msg: { senderId: number | null }; nickname: string | null; avatar: string | null }) {
  return r.msg.senderId
    ? { id: r.msg.senderId, nickname: r.nickname ?? '', avatar: r.avatar ?? null }
    : null;
}

/** 按 id 加载用户的展示信息（昵称/头像） */
export function fetchUserBrief(userId: number) {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, nickname: true, avatar: true },
  });
}

/** 会话全部成员的 userId 列表（用于 WS 推送） */
export function listConversationMemberIds(conversationId: number) {
  return db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId));
}

/**
 * 「触碰」会话：新消息 / 通话记录落库后刷新 updatedAt，会话列表据此按最近活动排序。
 * 除时间戳外没有别的字段要写，`$onUpdate` 只随非空 set 触发，因此这里是唯一允许手写 updatedAt 的地方。
 */
export function touchConversation(conversationId: number) {
  return db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, conversationId));
}

export async function ensureConversationMember(conversationId: number) {
  const me = currentUser();
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  return requireRow(member, '无权访问该会话', 403);
}

export async function getUserNickname(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { nickname: true },
  });
  return user?.nickname ?? null;
}

export async function ensureMessageAccessible(messageId: number) {
  const msg = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, messageId) });
  const message = requireRow(msg, '消息不存在');
  await ensureConversationMember(message.conversationId);
  return message;
}
