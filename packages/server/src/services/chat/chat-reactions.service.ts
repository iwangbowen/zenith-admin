import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { chatMessages, users, chatMessageReactions } from '../../db/schema';
import { scheduleSendToUsers } from '../../lib/ws-manager';
import { currentUser } from '../../lib/context';
import { HTTPException } from 'hono/http-exception';
import type { ChatMessage, ChatMessageExtra, ChatReactionGroup, ChatVoteData } from '@zenith/shared/chat';
import { mapChatMessage, fetchUserBrief, listConversationMemberIds, ensureMessageAccessible } from './chat-shared';

// ─── 消息表情回应 ─────────────────────────────────────────────────────────────

export async function aggregateReactions(messageIds: number[]): Promise<Map<number, ChatReactionGroup[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({ messageId: chatMessageReactions.messageId, emoji: chatMessageReactions.emoji, userId: chatMessageReactions.userId })
    .from(chatMessageReactions)
    .where(inArray(chatMessageReactions.messageId, messageIds));

  const map = new Map<number, Map<string, number[]>>();
  for (const row of rows) {
    if (!map.has(row.messageId)) map.set(row.messageId, new Map());
    const emojiMap = map.get(row.messageId)!;
    if (!emojiMap.has(row.emoji)) emojiMap.set(row.emoji, []);
    emojiMap.get(row.emoji)!.push(row.userId);
  }

  const result = new Map<number, ChatReactionGroup[]>();
  for (const [msgId, emojiMap] of map) {
    result.set(msgId, [...emojiMap.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds })));
  }
  return result;
}

export async function toggleReaction(messageId: number, emoji: string): Promise<ChatReactionGroup[]> {
  const me = currentUser();
  const msg = await ensureMessageAccessible(messageId);

  const existing = await db.query.chatMessageReactions.findFirst({
    where: and(
      eq(chatMessageReactions.messageId, messageId),
      eq(chatMessageReactions.userId, me.userId),
      eq(chatMessageReactions.emoji, emoji),
    ),
  });

  if (existing) {
    await db.delete(chatMessageReactions).where(eq(chatMessageReactions.id, existing.id));
  } else {
    await db.insert(chatMessageReactions).values({ messageId, userId: me.userId, emoji });
  }

  // Get updated reactions for this message
  const reactionMap = await aggregateReactions([messageId]);
  const reactions = reactionMap.get(messageId) ?? [];

  // Broadcast to all members of the conversation
  const members = await listConversationMemberIds(msg.conversationId);

  scheduleSendToUsers(members, {
    type: 'chat:reaction',
    payload: { conversationId: msg.conversationId, messageId, reactions },
  });

  return reactions;
}

// ─── 投票 ──────────────────────────────────────────────────────────────────

export async function submitVote(messageId: number, optionIds: string[]): Promise<ChatMessage> {
  const me = currentUser();

  const msg = await ensureMessageAccessible(messageId);
  if (msg.type !== 'vote') throw new HTTPException(400, { message: '该消息不是投票类型' });

  const extra = (msg.extra as ChatMessageExtra | null) ?? {};
  const voteData = extra.voteData;
  if (!voteData) throw new HTTPException(400, { message: '投票数据异常' });

  // 检查是否已关闭或过期
  if (voteData.isClosed) throw new HTTPException(400, { message: '投票已关闭' });
  if (voteData.expireAt) {
    const expireDate = new Date(voteData.expireAt.replace(' ', 'T'));
    if (Date.now() > expireDate.getTime()) throw new HTTPException(400, { message: '投票已结束' });
  }

  // 校验 optionIds
  const validOptionIds = new Set(voteData.options.map((o) => o.id));
  const sanitized = optionIds.filter((id) => validOptionIds.has(id));
  if (sanitized.length === 0) throw new HTTPException(400, { message: '请选择有效选项' });
  if (!voteData.isMultiple && sanitized.length > 1) throw new HTTPException(400, { message: '单选投票只能选择一个选项' });

  // 获取当前用户昵称
  const currentUserRow = await db.query.users.findFirst({
    where: eq(users.id, me.userId),
    columns: { nickname: true },
  });
  const nickname = currentUserRow?.nickname ?? '未知用户';

  // 幂等更新：同一用户重复投票则覆盖
  const existingVotes = voteData.votes.filter((v) => v.userId !== me.userId);
  const updatedVotes = [...existingVotes, { userId: me.userId, optionIds: sanitized, nickname }];

  const nextVoteData: ChatVoteData = { ...voteData, votes: updatedVotes };
  const nextExtra: ChatMessageExtra = { ...extra, voteData: nextVoteData };

  const [updated] = await db.update(chatMessages)
    .set({ extra: nextExtra })
    .where(eq(chatMessages.id, messageId))
    .returning();

  const sender = updated.senderId
    ? await fetchUserBrief(updated.senderId)
    : null;

  const updatedMsg = mapChatMessage(updated, sender ?? null);

  // 广播给会话内所有成员
  const members = await listConversationMemberIds(msg.conversationId);

  scheduleSendToUsers(members, {
    type: 'chat:vote-update',
    payload: { conversationId: msg.conversationId, messageId, voteData: nextVoteData },
  });

  return updatedMsg;
}
