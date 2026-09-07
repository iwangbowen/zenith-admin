import { eq, and, desc, sql, inArray, ne, asc, gte, lte, lt, gt } from 'drizzle-orm';
import { db } from '../../db';
import { chatConversations, chatConversationMembers, chatMessages, chatMessageFavorites, users } from '../../db/schema';
import { scheduleSendToUsers } from '../../lib/ws-manager';
import { currentUser } from '../../lib/context';
import { formatDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import { HTTPException } from 'hono/http-exception';
import type { ForwardMessagesInput, ChatMessage, ChatMessageExtra, ChatMessageSearchResult, ChatMessageContext, ChatMessageType, ChatForwardedItem, SendChatMessageInput } from '@zenith/shared/chat';
import { notHiddenFor, rowSender, mapChatMessage, fetchUserBrief, listConversationMemberIds, ensureConversationMember, ensureMessageAccessible } from './chat-shared';
import { aggregateReactions } from './chat-reactions.service';
import { keywordCondition } from '../../lib/where-helpers';

async function fetchReplySnapshotMap(
  rows: Array<{ replyToId: number | null }>,
): Promise<Map<number, ChatMessage['replyToMessage']>> {
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((id): id is number => id !== null))];
  if (replyIds.length === 0) return new Map();

  const replyRows = await db
    .select({ msg: chatMessages, nickname: users.nickname })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.senderId, users.id))
    .where(inArray(chatMessages.id, replyIds));

  const map = new Map<number, ChatMessage['replyToMessage']>();
  for (const r of replyRows) {
    map.set(r.msg.id, {
      id: r.msg.id,
      senderId: r.msg.senderId,
      senderName: r.msg.senderId ? (r.nickname ?? null) : null,
      type: r.msg.type,
      content: r.msg.content,
      isRecalled: r.msg.isRecalled,
      extra: r.msg.extra ?? null,
    });
  }
  return map;
}

// ─── 视角化收藏标记 ───────────────────────────────────────────────────────────

/** 当前用户在给定消息集合中的收藏 id 集（单次 IN 查询） */
async function favoritedIdSet(userId: number, messageIds: number[]): Promise<Set<number>> {
  if (messageIds.length === 0) return new Set();
  const rows = await db
    .select({ messageId: chatMessageFavorites.messageId })
    .from(chatMessageFavorites)
    .where(and(
      eq(chatMessageFavorites.userId, userId),
      inArray(chatMessageFavorites.messageId, messageIds),
    ));
  return new Set(rows.map((r) => r.messageId));
}

/** 把当前用户的收藏标记回填到 DTO（仅命中的消息写 true，未收藏保持缺省） */
function attachViewerFavorites(list: ChatMessage[], favIds: Set<number>): ChatMessage[] {
  if (favIds.size === 0) return list;
  for (const m of list) {
    if (favIds.has(m.id)) m.extra = { ...(m.extra ?? {}), isFavorited: true };
  }
  return list;
}

function buildMessageSearchSnippet(message: ChatMessage): string {
  if (message.isRecalled) return '消息已撤回';
  if (message.type === 'image') return `[图片] ${message.extra?.asset?.name ?? ''}`.trim();
  if (message.type === 'file') return `[文件] ${message.extra?.asset?.name ?? ''}`.trim();
  if (message.type === 'voice') return '[语音]';
  if (message.type === 'video') return '[视频]';
  if (message.type === 'card') return `[卡片] ${message.extra?.card?.title ?? ''}`.trim();
  if (message.type === 'system') return `[系统] ${message.content}`;
  return message.content;
}

type MessageSenderRow = {
  msg: typeof chatMessages.$inferSelect;
  nickname: string | null;
  avatar: string | null;
};

function markFavorited(rows: MessageSenderRow[]): ChatMessage[] {
  return rows.map((r) => {
    const mapped = mapChatMessage(r.msg, rowSender(r));
    mapped.extra = { ...(mapped.extra ?? {}), isFavorited: true };
    return mapped;
  });
}

function mapSearchRows(rows: MessageSenderRow[]) {
  return rows.map((r) => {
    const message = mapChatMessage(
      r.msg,
      rowSender(r),
    );
    return {
      message,
      snippet: buildMessageSearchSnippet(message),
    };
  });
}

export async function appendSystemMessage(
  conversationId: number,
  content: string,
  extra: ChatMessageExtra | null = null,
): Promise<ChatMessage> {
  const [row] = await db.insert(chatMessages).values({
    conversationId,
    senderId: null,
    type: 'system',
    content,
    extra,
  }).returning();

  const [, members] = await Promise.all([
    db.update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId)),
    listConversationMemberIds(conversationId),
  ]);

  const msg = mapChatMessage(row, null);

  scheduleSendToUsers(members, { type: 'chat:message', payload: msg });

  return msg;
}

function normalizeMessageExtra(extra: unknown): ChatMessageExtra {
  return (extra as ChatMessageExtra | null) ?? {};
}

// ─── 消息列表（分页） ─────────────────────────────────────────────────────────

export async function listMessages(conversationId: number, beforeId: number | null, limit: number) {
  const me = currentUser();
  await ensureConversationMember(conversationId);

  const where = and(
    eq(chatMessages.conversationId, conversationId),
    notHiddenFor(me.userId),
    beforeId ? lt(chatMessages.id, beforeId) : undefined,
  );

  const rows = await db
    .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.senderId, users.id))
    .where(where)
    .orderBy(desc(chatMessages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const limited = rows.slice(0, limit);

  const msgIds = limited.map((r) => r.msg.id);
  const [reactionMap, replySnapshotMap, favIds] = await Promise.all([
    aggregateReactions(msgIds),
    fetchReplySnapshotMap(limited.map((r) => ({ replyToId: r.msg.replyToId }))),
    favoritedIdSet(me.userId, msgIds),
  ]);

  const list = limited.map((r) =>
    mapChatMessage(
      r.msg,
      rowSender(r),
      reactionMap.get(r.msg.id) ?? [],
      r.msg.replyToId ? (replySnapshotMap.get(r.msg.replyToId) ?? null) : null,
    ),
  );

  return { list: attachViewerFavorites(list, favIds), hasMore };
}

export async function listPinnedMessages(conversationId: number): Promise<ChatMessage[]> {
  const me = currentUser();
  await ensureConversationMember(conversationId);

  const rows = await db
    .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.senderId, users.id))
    .where(and(
      eq(chatMessages.conversationId, conversationId),
      sql`COALESCE((${chatMessages.extra} ->> 'isPinned')::boolean, false) = true`,
      notHiddenFor(me.userId),
    ))
    .orderBy(desc(chatMessages.updatedAt), desc(chatMessages.id))
    .limit(5);

  const favIds = await favoritedIdSet(me.userId, rows.map((r) => r.msg.id));
  return attachViewerFavorites(rows.map((r) => mapChatMessage(
    r.msg,
    rowSender(r),
  )), favIds);
}

export async function listFavoriteMessages(conversationId: number, page: number, pageSize: number) {
  const me = currentUser();
  await ensureConversationMember(conversationId);

  const where = and(
    eq(chatMessages.conversationId, conversationId),
    eq(chatMessageFavorites.userId, me.userId),
    notHiddenFor(me.userId),
  );

  return buildListResult({
    page,
    pageSize,
    count: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .innerJoin(chatMessageFavorites, eq(chatMessageFavorites.messageId, chatMessages.id))
        .where(where);
      return Number(row?.count ?? 0);
    },
    rows: async () => markFavorited(await db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .innerJoin(chatMessageFavorites, eq(chatMessageFavorites.messageId, chatMessages.id))
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessageFavorites.createdAt), desc(chatMessages.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize))),
  });
}

export async function listGlobalFavoriteMessages(page: number, pageSize: number) {
  const me = currentUser();

  // 仍要求当前是会话成员：退群/被移出后无权访问会话内容，收藏随之不可见
  const where = and(
    eq(chatConversationMembers.userId, me.userId),
    eq(chatMessageFavorites.userId, me.userId),
    notHiddenFor(me.userId),
  );

  return buildListResult({
    page,
    pageSize,
    count: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .innerJoin(chatMessageFavorites, eq(chatMessageFavorites.messageId, chatMessages.id))
        .innerJoin(chatConversationMembers, eq(chatConversationMembers.conversationId, chatMessages.conversationId))
        .where(where);
      return Number(row?.count ?? 0);
    },
    rows: async () => markFavorited(await db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .innerJoin(chatMessageFavorites, eq(chatMessageFavorites.messageId, chatMessages.id))
      .innerJoin(chatConversationMembers, eq(chatConversationMembers.conversationId, chatMessages.conversationId))
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessageFavorites.createdAt), desc(chatMessages.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize))),
  });
}

export async function toggleMessageFavorite(messageId: number, favorite: boolean): Promise<ChatMessage> {
  const me = currentUser();
  const msg = await ensureMessageAccessible(messageId);

  if (favorite) {
    await db.insert(chatMessageFavorites)
      .values({ messageId, userId: me.userId })
      .onConflictDoNothing();
  } else {
    await db.delete(chatMessageFavorites).where(and(
      eq(chatMessageFavorites.messageId, messageId),
      eq(chatMessageFavorites.userId, me.userId),
    ));
  }

  const sender = msg.senderId
    ? await fetchUserBrief(msg.senderId)
    : null;
  const mapped = mapChatMessage(msg, sender ?? null);
  if (favorite) mapped.extra = { ...(mapped.extra ?? {}), isFavorited: true };
  return mapped;
}

export async function toggleMessagePin(messageId: number, pin: boolean): Promise<ChatMessage> {
  const me = currentUser();
  const msg = await ensureMessageAccessible(messageId);

  // 置顶是会话级共享操作：群聊仅群主/管理员可执行，单聊双方均可
  const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, msg.conversationId) });
  if (conv?.type === 'group') {
    const member = await db.query.chatConversationMembers.findFirst({
      where: and(
        eq(chatConversationMembers.conversationId, msg.conversationId),
        eq(chatConversationMembers.userId, me.userId),
      ),
    });
    if (member?.role !== 'owner' && member?.role !== 'admin') {
      throw new HTTPException(403, { message: '只有群主或管理员才能置顶消息' });
    }
  }

  const nextExtra: ChatMessageExtra = { ...normalizeMessageExtra(msg.extra), isPinned: pin };
  const [updated] = await db.update(chatMessages)
    .set({ extra: nextExtra, updatedAt: new Date() })
    .where(eq(chatMessages.id, messageId))
    .returning();

  const [sender, favIds] = await Promise.all([
    updated.senderId ? fetchUserBrief(updated.senderId) : Promise.resolve(null),
    favoritedIdSet(me.userId, [messageId]),
  ]);
  return attachViewerFavorites([mapChatMessage(updated, sender ?? null)], favIds)[0];
}

export async function listAnnouncementHistory(conversationId: number): Promise<ChatMessage[]> {
  await ensureConversationMember(conversationId);
  const rows = await db
    .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.senderId, users.id))
    .where(and(
      eq(chatMessages.conversationId, conversationId),
      eq(chatMessages.type, 'system'),
      sql`${chatMessages.extra} ? 'announcementHistory'`,
    ))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id));

  return rows.map((r) => mapChatMessage(
    r.msg,
    rowSender(r),
  ));
}

export async function deleteAnnouncementHistory(conversationId: number, messageId: number): Promise<void> {
  const me = currentUser();
  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  const conversation = requireRow(conv, '会话不存在');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '只有群聊才有公告历史' });

  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    throw new HTTPException(403, { message: '只有群主或管理员才能删除公告历史' });
  }

  const msg = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, messageId) });
  if (msg?.conversationId !== conversationId) {
    throw new HTTPException(404, { message: '公告历史不存在' });
  }
  const extra = normalizeMessageExtra(msg.extra);
  if (!('announcementHistory' in extra)) {
    throw new HTTPException(400, { message: '该消息不是公告历史' });
  }

  await db.delete(chatMessages).where(eq(chatMessages.id, messageId));
}

// ─── 会话消息搜索 ───────────────────────────────────────────────────────────

export async function searchConversationMessages(
  conversationId: number,
  params: {
    keyword?: string;
    types?: ChatMessage['type'][];
    senderId?: number;
    startAt?: string;
    endAt?: string;
    page: number;
    pageSize: number;
  },
): Promise<ChatMessageSearchResult> {
  const me = currentUser();
  await ensureConversationMember(conversationId);

  const keyword = params.keyword?.trim();
  const types = params.types?.filter(Boolean) ?? [];
  const startAt = parseDateRangeStart(params.startAt);
  const endAt = parseDateRangeEnd(params.endAt);

  const where = and(
    eq(chatMessages.conversationId, conversationId),
    notHiddenFor(me.userId),
    params.senderId ? eq(chatMessages.senderId, params.senderId) : undefined,
    types.length > 0 ? inArray(chatMessages.type, types) : undefined,
    startAt ? gte(chatMessages.createdAt, startAt) : undefined,
    endAt ? lte(chatMessages.createdAt, endAt) : undefined,
    keywordCondition(keyword, [
      chatMessages.content,
      sql`COALESCE(${users.nickname}, '')`,
      sql`COALESCE(${users.username}, '')`,
      sql`COALESCE(${chatMessages.extra} -> 'asset' ->> 'name', '')`,
    ], 'ilike'),
  );

  return buildListResult({
    page: params.page,
    pageSize: params.pageSize,
    count: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .leftJoin(users, eq(chatMessages.senderId, users.id))
        .where(where);
      return Number(row?.count ?? 0);
    },
    rows: async () => mapSearchRows(await db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(params.pageSize)
      .offset(pageOffset(params.page, params.pageSize))),
  });
}

// ─── 消息上下文定位 ─────────────────────────────────────────────────────────

export async function getMessageContext(
  conversationId: number,
  messageId: number,
  before = 15,
  after = 15,
): Promise<ChatMessageContext> {
  const me = currentUser();
  await ensureConversationMember(conversationId);

  const target = await db
    .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.senderId, users.id))
    .where(and(
      eq(chatMessages.conversationId, conversationId),
      eq(chatMessages.id, messageId),
    ))
    .limit(1);

  const targetRow = requireRow(target[0], '消息不存在');

  const [beforeRows, afterRows] = await Promise.all([
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(and(
        eq(chatMessages.conversationId, conversationId),
        lt(chatMessages.id, messageId),
      ))
      .orderBy(desc(chatMessages.id))
      .limit(before),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(and(
        eq(chatMessages.conversationId, conversationId),
        gt(chatMessages.id, messageId),
      ))
      .orderBy(asc(chatMessages.id))
      .limit(after),
  ]);

  const reversedBefore = [...beforeRows].reverse();
  const allRows = [
    ...reversedBefore,
    targetRow,
    ...afterRows,
  ];
  const msgIds = allRows.map((r) => r.msg.id);
  const [reactionMap, replySnapshotMap, favIds] = await Promise.all([
    aggregateReactions(msgIds),
    fetchReplySnapshotMap(allRows.map((r) => ({ replyToId: r.msg.replyToId }))),
    favoritedIdSet(me.userId, msgIds),
  ]);

  const list = attachViewerFavorites(allRows.map((r) => mapChatMessage(
    r.msg,
    rowSender(r),
    reactionMap.get(r.msg.id) ?? [],
    r.msg.replyToId ? (replySnapshotMap.get(r.msg.replyToId) ?? null) : null,
  )), favIds);

  const [beforeCount, afterCount] = await Promise.all([
    db.$count(chatMessages, and(eq(chatMessages.conversationId, conversationId), lt(chatMessages.id, messageId))),
    db.$count(chatMessages, and(eq(chatMessages.conversationId, conversationId), gt(chatMessages.id, messageId))),
  ]);

  return {
    list,
    anchorMessageId: messageId,
    hasBefore: beforeCount > before,
    hasAfter: afterCount > after,
  };
}

// ─── 发送消息 ─────────────────────────────────────────────────────────────────

/** 服务端内部发送入参：允许 system / card 等用户不可主动发送的类型（如网盘文件卡片） */
export type InternalSendChatMessageInput = Omit<SendChatMessageInput, 'type'> & { type?: ChatMessageType };

export async function sendMessage(conversationId: number, input: InternalSendChatMessageInput): Promise<ChatMessage> {
  const me = currentUser();

  // 鉴权 & 发送者信息并行查询
  const [member, sender, conv] = await Promise.all([
    db.query.chatConversationMembers.findFirst({
      where: and(
        eq(chatConversationMembers.conversationId, conversationId),
        eq(chatConversationMembers.userId, me.userId),
      ),
    }),
    fetchUserBrief(me.userId),
    db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, conversationId),
      columns: { id: true, muteAll: true },
    }),
  ]);
  const sendMember = requireRow(member, '无权向该会话发送消息', 403);

  // 禁言校验：个人禁言优先，全员禁言豁免群主/管理员
  if (sendMember.mutedUntil && sendMember.mutedUntil > new Date()) {
    throw new HTTPException(403, { message: '你已被禁言，暂时无法发言' });
  }
  if (conv?.muteAll && sendMember.role === 'member') {
    throw new HTTPException(403, { message: '全员禁言中，仅群主和管理员可发言' });
  }

  const [row] = await db.insert(chatMessages).values({
    conversationId,
    senderId: me.userId,
    type: input.type ?? 'text',
    content: input.content,
    replyToId: input.replyToId ?? null,
    extra: input.extra ?? null,
  }).returning();

  // 更新会话 updatedAt
  await db.update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, conversationId));

  let replySnapshot: ChatMessage['replyToMessage'] = null;
  if (row.replyToId) {
    const replyMap = await fetchReplySnapshotMap([{ replyToId: row.replyToId }]);
    replySnapshot = replyMap.get(row.replyToId) ?? null;
  }
  const msg = mapChatMessage(row, sender ?? null, [], replySnapshot);

  // 推送给会话内所有成员（含发送者——方便多端同步）
  const members = await listConversationMemberIds(conversationId);

  scheduleSendToUsers(members, { type: 'chat:message', payload: msg });

  return msg;
}

// ─── 转发消息 ─────────────────────────────────────────────────────────────────

export async function forwardMessages(input: ForwardMessagesInput): Promise<void> {
  const me = currentUser();

  // 鉴权：确认当前用户是所有目标会话的成员（批量查询替代逐个查询）
  const myMemberships = await db
    .select({ conversationId: chatConversationMembers.conversationId })
    .from(chatConversationMembers)
    .where(and(
      inArray(chatConversationMembers.conversationId, input.targetConversationIds),
      eq(chatConversationMembers.userId, me.userId),
    ));
  const accessibleIds = new Set(myMemberships.map((r) => r.conversationId));
  const forbidden = input.targetConversationIds.find((id) => !accessibleIds.has(id));
  if (forbidden) throw new HTTPException(403, { message: `无权向会话 ${forbidden} 发送消息` });

  // 获取原始消息列表（按时间升序）
  const sourceMsgs = await db.query.chatMessages.findMany({
    where: inArray(chatMessages.id, input.messageIds),
  });
  if (sourceMsgs.length === 0) throw new HTTPException(400, { message: '未找到要转发的消息' });

  // 按时间升序排列
  const ordered = [...sourceMsgs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // 查询发送者信息（批量）
  const senderIds = Array.from(new Set(ordered.map((m) => m.senderId).filter((id): id is number => id !== null)));
  const senderRows = senderIds.length > 0
    ? await db.query.users.findMany({ where: inArray(users.id, senderIds), columns: { id: true, nickname: true, avatar: true } })
    : [];
  const senderMap = new Map(senderRows.map((u) => [u.id, u]));

  // 查询来源会话名称（用第一条消息的会话）
  const sourceConvId = ordered[0]?.conversationId;
  let sourceConvName: string | null = null;
  if (sourceConvId) {
    const sourceConv = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, sourceConvId),
      columns: { id: true, type: true, name: true },
      with: { members: { with: { user: { columns: { id: true, nickname: true } } } } },
    });
    if (sourceConv) {
      if (sourceConv.type === 'group') {
        sourceConvName = sourceConv.name;
      } else {
        // 私聊：找对方昵称
        const other = (sourceConv.members as Array<{ userId: number; user: { id: number; nickname: string } }>)
          .find((m) => m.userId !== me.userId);
        sourceConvName = other?.user.nickname ?? null;
      }
    }
  }

  if (input.mode === 'merge') {
    // 合并转发：生成 forwardedMessages 列表，发送单条 forward 类型消息
    const forwardedItems: ChatForwardedItem[] = ordered
      .filter((m) => !m.isRecalled && m.type !== 'system')
      .map((m) => ({
        senderName: senderMap.get(m.senderId ?? -1)?.nickname ?? null,
        type: m.type,
        content: m.content,
        createdAt: formatDateTime(m.createdAt),
        asset: (m.extra as ChatMessageExtra | null)?.asset ?? null,
      }));

    const previewText = forwardedItems.slice(0, 3)
      .map((item) => {
        const name = item.senderName ?? '未知';
        if (item.type === 'image') return `${name}：[图片]`;
        if (item.type === 'file') return `${name}：[文件]`;
        const text = item.content.length > 20 ? `${item.content.slice(0, 20)}…` : item.content;
        return `${name}：${text}`;
      })
      .join('\n');

    for (const targetConvId of input.targetConversationIds) {
      await sendMessage(targetConvId, {
        content: previewText,
        type: 'forward',
        extra: {
          forwardedMessages: forwardedItems,
          forwardSourceConvName: sourceConvName,
        },
      });
    }
  } else {
    // 逐条转发：每条消息单独发送（跳过撤回、系统、转发聚合类型）
    for (const targetConvId of input.targetConversationIds) {
      for (const m of ordered) {
        if (m.isRecalled) continue;
        if (m.type === 'system' || m.type === 'forward' || m.type === 'card') continue;
        const originalExtra = (m.extra as ChatMessageExtra | null) ?? null;
        const extra: ChatMessageExtra = {};
        if (originalExtra?.asset) extra.asset = originalExtra.asset;
        await sendMessage(targetConvId, {
          content: m.content,
          type: m.type,
          extra: Object.keys(extra).length > 0 ? extra : null,
        });
      }
    }
  }
}

// ─── 删除消息（仅对自己） ─────────────────────────────────────────────────────

export async function deleteMessagesForUser(messageIds: number[]): Promise<void> {
  const me = currentUser();
  if (messageIds.length === 0) return;

  const msgs = await db.query.chatMessages.findMany({
    where: inArray(chatMessages.id, messageIds),
  });
  if (msgs.length === 0) return;

  // 校验当前用户是这些消息所在会话的成员（单查询批量校验）
  const convIds = [...new Set(msgs.map((m) => m.conversationId))];
  const memberships = await db.select({ conversationId: chatConversationMembers.conversationId })
    .from(chatConversationMembers)
    .where(and(
      inArray(chatConversationMembers.conversationId, convIds),
      eq(chatConversationMembers.userId, me.userId),
    ));
  const memberConvIds = new Set(memberships.map((m) => m.conversationId));
  if (convIds.some((convId) => !memberConvIds.has(convId))) {
    throw new HTTPException(403, { message: '无权操作该会话的消息' });
  }

  // 事务：追加 hiddenFor 与清理本人收藏必须同时生效，避免「已删除但仍在收藏列表」的中间态
  await db.transaction(async (tx) => {
    // 单条原子 UPDATE 批量追加 extra.hiddenFor（写入形状与读取侧 notHiddenFor 一致）：
    // 逐条读改写不仅是 N 次往返，整体覆写 extra 还会与并发写（表情回应、他人删除）互相丢失更新
    await tx.update(chatMessages)
      .set({
        extra: sql`jsonb_set(
          COALESCE(${chatMessages.extra}, '{}'::jsonb),
          '{hiddenFor}',
          COALESCE(${chatMessages.extra}->'hiddenFor', '[]'::jsonb) || to_jsonb(CAST(${me.userId} AS integer))
        )`,
      })
      .where(and(
        inArray(chatMessages.id, msgs.map((m) => m.id)),
        notHiddenFor(me.userId),
      ));
    await tx.delete(chatMessageFavorites).where(and(
      inArray(chatMessageFavorites.messageId, msgs.map((m) => m.id)),
      eq(chatMessageFavorites.userId, me.userId),
    ));
  });
}

// ─── 撤回消息 ─────────────────────────────────────────────────────────────────

export async function recallMessage(messageId: number): Promise<void> {
  const me = currentUser();

  const msg = requireRow(await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  }), '消息不存在');
  if (msg.senderId !== me.userId) throw new HTTPException(403, { message: '只能撤回自己的消息' });

  // 2 分钟内可撤回
  const TWO_MINUTES = 2 * 60 * 1000;
  if (Date.now() - new Date(msg.createdAt).getTime() > TWO_MINUTES) {
    throw new HTTPException(400, { message: '消息发送超过2分钟，无法撤回' });
  }

  await db.update(chatMessages)
    .set({ isRecalled: true, content: '消息已撤回' })
    .where(eq(chatMessages.id, messageId));

  // 推送撤回通知
  const members = await listConversationMemberIds(msg.conversationId);

  scheduleSendToUsers(members, { type: 'chat:recall', payload: { conversationId: msg.conversationId, messageId } });
}

// ─── 编辑消息 ─────────────────────────────────────────────────────────────────

export async function editMessage(messageId: number, content: string): Promise<ChatMessage> {
  const me = currentUser();

  const msg = requireRow(await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  }), '消息不存在');
  if (msg.senderId !== me.userId) throw new HTTPException(403, { message: '只能编辑自己的消息' });
  if (msg.isRecalled) throw new HTTPException(400, { message: '消息已撤回，无法编辑' });
  if (msg.type !== 'text') throw new HTTPException(400, { message: '只能编辑文本消息' });

  // 24 小时内可编辑
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(msg.createdAt).getTime() > ONE_DAY) {
    throw new HTTPException(400, { message: '消息发送超过24小时，无法编辑' });
  }

  const [updated] = await db.update(chatMessages)
    .set({ content, isEdited: true, updatedAt: new Date() })
    .where(eq(chatMessages.id, messageId))
    .returning();

  const sender = await fetchUserBrief(me.userId);

  const updatedMsg = mapChatMessage(updated, sender ?? null);

  // 推送编辑通知给会话所有成员
  const members = await listConversationMemberIds(msg.conversationId);

  scheduleSendToUsers(members, { type: 'chat:edit', payload: updatedMsg });

  return updatedMsg;
}

// ─── 全局消息搜索 ────────────────────────────────────────────────────────────

export async function searchGlobalMessages(
  params: {
    keyword: string;
    types?: ChatMessage['type'][];
    page: number;
    pageSize: number;
  },
): Promise<ChatMessageSearchResult & { conversationNames: Record<number, string> }> {
  const me = currentUser();

  const keyword = params.keyword.trim();
  if (!keyword) return { list: [], total: 0, page: params.page, pageSize: params.pageSize, conversationNames: {} };

  const types = params.types?.filter(Boolean) ?? [];

  const where = and(
    // 只搜当前用户参与的会话
    eq(chatConversationMembers.userId, me.userId),
    notHiddenFor(me.userId),
    types.length > 0 ? inArray(chatMessages.type, types) : undefined,
    keywordCondition(keyword, [chatMessages.content, sql`COALESCE(${chatMessages.extra} -> 'asset' ->> 'name', '')`], 'ilike'),
  );

  const [countRows, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(distinct ${chatMessages.id})` })
      .from(chatMessages)
      .innerJoin(chatConversationMembers, eq(chatConversationMembers.conversationId, chatMessages.conversationId))
      .where(where),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .innerJoin(chatConversationMembers, eq(chatConversationMembers.conversationId, chatMessages.conversationId))
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(params.pageSize)
      .offset(pageOffset(params.page, params.pageSize)),
  ]);

  // 批量拉取会话名称（direct 会话取对方昵称，group 取 name）
  const convIds = [...new Set(rows.map((r) => r.msg.conversationId))];
  const conversationNames: Record<number, string> = {};

  if (convIds.length > 0) {
    const convRows = await db
      .select({ id: chatConversations.id, type: chatConversations.type, name: chatConversations.name })
      .from(chatConversations)
      .where(inArray(chatConversations.id, convIds));

    const directConvIds = convRows.filter((c) => c.type === 'direct').map((c) => c.id);
    const directTargetRows = directConvIds.length > 0
      ? await db
        .select({ conversationId: chatConversationMembers.conversationId, nickname: users.nickname })
        .from(chatConversationMembers)
        .innerJoin(users, eq(chatConversationMembers.userId, users.id))
        .where(and(
          inArray(chatConversationMembers.conversationId, directConvIds),
          ne(chatConversationMembers.userId, me.userId),
        ))
      : [];
    const directTargetMap = new Map(directTargetRows.map((r) => [r.conversationId, r.nickname]));

    for (const conv of convRows) {
      conversationNames[conv.id] = conv.type === 'group'
        ? (conv.name ?? '群聊')
        : (directTargetMap.get(conv.id) ?? '私聊');
    }
  }

  const list = mapSearchRows(rows);

  return {
    list,
    total: Number(countRows[0]?.count ?? 0),
    page: params.page,
    pageSize: params.pageSize,
    conversationNames,
  };
}
