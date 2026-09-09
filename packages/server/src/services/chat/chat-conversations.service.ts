import { eq, and, inArray, ne, max, count, gt, or, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  chatConversations, chatConversationMembers, chatMessages, users,
  departments, positions, userPositions,
} from '../../db/schema';
import { scheduleSendToUsers } from '../../lib/ws-manager';
import { invalidateConversationMembers } from '../../lib/chat-member-cache';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { HTTPException } from 'hono/http-exception';
import type { ChatConversation, ChatReadState } from '@zenith/shared/chat';
import { notHiddenFor, rowSender, mapChatMessage, ensureConversationMember, getUserNickname } from './chat-shared';
import { appendSystemMessage } from './chat-messages.service';

// ─── 会话列表 ─────────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ChatConversation[]> {
  const me = currentUser();

  // 拿当前用户参与的所有会话
  const memberRows = await db
    .select({
      conversationId: chatConversationMembers.conversationId,
      isPinned: chatConversationMembers.isPinned,
      isStarred: chatConversationMembers.isStarred,
      isMuted: chatConversationMembers.isMuted,
      isArchived: chatConversationMembers.isArchived,
      role: chatConversationMembers.role,
      mutedUntil: chatConversationMembers.mutedUntil,
    })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.userId, me.userId));

  if (memberRows.length === 0) return [];

  const convIds = memberRows.map((r) => r.conversationId);
  const pinnedMap = new Map(memberRows.map((r) => [r.conversationId, r.isPinned]));
  const starredMap = new Map(memberRows.map((r) => [r.conversationId, r.isStarred]));
  const mutedMap = new Map(memberRows.map((r) => [r.conversationId, r.isMuted]));
  const archivedMap = new Map(memberRows.map((r) => [r.conversationId, r.isArchived]));
  const myRoleMap = new Map(memberRows.map((r) => [r.conversationId, r.role]));
  const myMutedUntilMap = new Map(memberRows.map((r) => [r.conversationId, r.mutedUntil]));

  // 批量拉取会话基本信息 & 最后消息 & 未读聚合（三者互不依赖，并行执行）
  const latestMsgIdSub = db
    .select({
      conversationId: chatMessages.conversationId,
      latestId: max(chatMessages.id).as('latest_id'),
    })
    .from(chatMessages)
    .where(and(
      inArray(chatMessages.conversationId, convIds),
      notHiddenFor(me.userId),
    ))
    .groupBy(chatMessages.conversationId)
    .as('latest_msg_id');

  // 未读 = 非本人发送且晚于我在该会话 last_read_at 的消息。写成 LATERAL 子查询让规划器按会话逐个参数化：
  // conversation_id = ? AND created_at > coalesce(last_read_at, -infinity) 直接命中 (conversation_id, created_at) 索引，
  // 只扫未读段；若写成普通 JOIN，规划器对「与外表列比较」只能按默认 1/3 选择率估算而退回全表扫描。
  // 「是否有 @我」用 jsonb 包含在 SQL 内聚合，不再把全部消息拉到内存逐条判断
  const mentionProbe = JSON.stringify([{ userId: me.userId }]);
  const unreadAgg = db
    .select({
      unreadCount: count().as('unread_count'),
      hasMentionUnread: sql<boolean>`coalesce(bool_or(${chatMessages.extra} -> 'mentions' @> ${mentionProbe}::jsonb), false)`.as('has_mention_unread'),
    })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.conversationId, chatConversationMembers.conversationId),
      gt(chatMessages.createdAt, sql`coalesce(${chatConversationMembers.lastReadAt}, '-infinity'::timestamptz)`),
      or(isNull(chatMessages.senderId), ne(chatMessages.senderId, me.userId)),
    ))
    .as('unread_agg');

  const [convRows, latestMsgRows, unreadRows] = await Promise.all([
    db
      .select()
      .from(chatConversations)
      .where(inArray(chatConversations.id, convIds)),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(latestMsgIdSub)
      .innerJoin(
        chatMessages,
        eq(chatMessages.id, latestMsgIdSub.latestId),
      )
      .leftJoin(users, eq(chatMessages.senderId, users.id)),
    db
      .select({
        conversationId: chatConversationMembers.conversationId,
        unreadCount: unreadAgg.unreadCount,
        hasMentionUnread: unreadAgg.hasMentionUnread,
      })
      .from(chatConversationMembers)
      .crossJoinLateral(unreadAgg)
      .where(eq(chatConversationMembers.userId, me.userId)),
  ]);

  const latestMsgMap = new Map(
    latestMsgRows.map((r) => [
      r.msg.conversationId,
      mapChatMessage(r.msg, rowSender(r)),
    ]),
  );

  // 批量拉取 direct 会话的对方用户
  const directConvIds = convRows.filter((c) => c.type === 'direct').map((c) => c.id);
  const directTargetRows = directConvIds.length > 0
    ? await db
      .select({
        conversationId: chatConversationMembers.conversationId,
        id: users.id,
        nickname: users.nickname,
        avatar: users.avatar,
        phone: users.phone,
        email: users.email,
        departmentId: users.departmentId,
      })
      .from(chatConversationMembers)
      .innerJoin(users, eq(chatConversationMembers.userId, users.id))
      .where(and(
        inArray(chatConversationMembers.conversationId, directConvIds),
        ne(chatConversationMembers.userId, me.userId),
      ))
    : [];

  // 批量查部门名称 & 岗位名称（并行执行）
  const deptIds = [...new Set(directTargetRows.map((r) => r.departmentId).filter((id): id is number => id != null))];
  const targetUserIds = directTargetRows.map((r) => r.id);
  const [deptRows, positionRows] = await Promise.all([
    deptIds.length > 0
      ? db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds))
      : Promise.resolve([]),
    targetUserIds.length > 0
      ? db
        .select({ userId: userPositions.userId, name: positions.name })
        .from(userPositions)
        .innerJoin(positions, eq(userPositions.positionId, positions.id))
        .where(inArray(userPositions.userId, targetUserIds))
      : Promise.resolve([]),
  ]);
  const deptNameMap = new Map(deptRows.map((d) => [d.id, d.name]));
  const positionNamesMap = new Map<number, string[]>();
  for (const r of positionRows) {
    const arr = positionNamesMap.get(r.userId) ?? [];
    arr.push(r.name);
    positionNamesMap.set(r.userId, arr);
  }

  const directTargetMap = new Map(
    directTargetRows.map((r) => [r.conversationId, {
      id: r.id,
      nickname: r.nickname,
      avatar: r.avatar,
      phone: r.phone ?? null,
      email: r.email ?? null,
      departmentName: r.departmentId ? (deptNameMap.get(r.departmentId) ?? null) : null,
      positionNames: positionNamesMap.get(r.id) ?? [],
    }]),
  );

  const unreadMap = new Map(unreadRows.map((r) => [r.conversationId, r.unreadCount]));
  const mentionUnreadMap = new Map(unreadRows.map((r) => [r.conversationId, r.hasMentionUnread]));

  const results: ChatConversation[] = convRows.map((conv) => ({
    id: conv.id,
    type: conv.type,
    name: conv.name,
    announcement: conv.announcement ?? null,
    targetUser: conv.type === 'direct' ? (directTargetMap.get(conv.id) ?? null) : null,
    lastMessage: latestMsgMap.get(conv.id) ?? null,
    unreadCount: unreadMap.get(conv.id) ?? 0,
    hasMentionUnread: mentionUnreadMap.get(conv.id) ?? false,
    isPinned: pinnedMap.get(conv.id) ?? false,
    isStarred: starredMap.get(conv.id) ?? false,
    isMuted: mutedMap.get(conv.id) ?? false,
    isArchived: archivedMap.get(conv.id) ?? false,
    muteAll: conv.muteAll,
    joinApproval: conv.joinApproval,
    myRole: myRoleMap.get(conv.id) ?? 'member',
    myMutedUntil: formatNullableDateTime(myMutedUntilMap.get(conv.id) ?? null),
    createdAt: formatDateTime(conv.createdAt),
    updatedAt: formatDateTime(conv.updatedAt),
  }));

  // 置顶优先，然后按最新消息时间排序
  results.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });

  return results;
}

// ─── 获取/创建单聊会话 ──────────────────────────────────────────────────────

export async function getOrCreateDirectConversation(targetUserId: number): Promise<ChatConversation> {
  const me = currentUser();
  if (targetUserId === me.userId) {
    throw new HTTPException(400, { message: '不能与自己创建会话' });
  }

  // 检查对方用户是否存在
  const targetUserRow = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    columns: { id: true, nickname: true, avatar: true, phone: true, email: true, departmentId: true },
    with: {
      department: { columns: { name: true } },
      userPositions: { with: { position: { columns: { name: true } } } },
    },
  });
  const targetUserEntity = requireRow(targetUserRow, '用户不存在');
  const targetUser = {
    id: targetUserEntity.id,
    nickname: targetUserEntity.nickname,
    avatar: targetUserEntity.avatar,
    phone: targetUserEntity.phone ?? null,
    email: targetUserEntity.email ?? null,
    departmentName: targetUserEntity.department?.name ?? null,
    positionNames: (targetUserEntity.userPositions as Array<{ position: { name: string } }>).map((up) => up.position.name),
  };

  // 查找已有的 direct 会话（双方都在的）
  const existingConvIds = await db
    .select({ conversationId: chatConversationMembers.conversationId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.userId, me.userId));

  const myConvIds = existingConvIds.map((r) => r.conversationId);

  if (myConvIds.length > 0) {
    const [existing] = await db
      .select({ conversationId: chatConversationMembers.conversationId })
      .from(chatConversationMembers)
      .innerJoin(chatConversations, eq(chatConversationMembers.conversationId, chatConversations.id))
      .where(and(
        eq(chatConversationMembers.userId, targetUserId),
        inArray(chatConversationMembers.conversationId, myConvIds),
        eq(chatConversations.type, 'direct'),
      ))
      .limit(1);

    if (existing) {
      // 会话已存在，走 listConversations 并返回对应的
      const all = await listConversations();
      const found = all.find((c) => c.id === existing.conversationId);
      if (found) return found;
    }
  }

  // 创建新会话
  const [conv] = await db.insert(chatConversations).values({
    type: 'direct',
    tenantId: me.tenantId,
  }).returning();

  await db.insert(chatConversationMembers).values([
    { conversationId: conv.id, userId: me.userId },
    { conversationId: conv.id, userId: targetUserId },
  ]);

  return {
    id: conv.id,
    type: 'direct',
    name: null,
    targetUser,
    lastMessage: null,
    unreadCount: 0,
    hasMentionUnread: false,
    isPinned: false,
    isStarred: false,
    isMuted: false,
    muteAll: false,
    myRole: 'member',
    myMutedUntil: null,
    createdAt: formatDateTime(conv.createdAt),
    updatedAt: formatDateTime(conv.updatedAt),
  };
}

// ─── 置顶 / 取消置顶 ────────────────────────────────────────────────────────

export async function pinConversation(conversationId: number, pin: boolean): Promise<void> {
  const me = currentUser();
  const [updated] = await db.update(chatConversationMembers)
    .set({ isPinned: pin })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ))
    .returning({ id: chatConversationMembers.conversationId });
  requireRow(updated, '无权操作该会话', 403);
}

// ─── 标记星标 / 取消星标 ──────────────────────────────────────────────────

export async function starConversation(conversationId: number, star: boolean): Promise<void> {
  const me = currentUser();
  const [updated] = await db.update(chatConversationMembers)
    .set({ isStarred: star })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ))
    .returning({ id: chatConversationMembers.conversationId });
  requireRow(updated, '无权操作该会话', 403);
}

// ─── 免打扰 / 取消免打扰 ──────────────────────────────────────────────────

export async function muteConversation(conversationId: number, mute: boolean): Promise<void> {
  const me = currentUser();
  const [updated] = await db.update(chatConversationMembers)
    .set({ isMuted: mute })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ))
    .returning({ id: chatConversationMembers.conversationId });
  requireRow(updated, '无权操作该会话', 403);
}

// ─── 归档 / 取消归档 ──────────────────────────────────────────────────────────

export async function archiveConversation(conversationId: number, archive: boolean): Promise<void> {
  const me = currentUser();
  const [updated] = await db.update(chatConversationMembers)
    .set({ isArchived: archive })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ))
    .returning({ id: chatConversationMembers.conversationId });
  requireRow(updated, '无权操作该会话', 403);
}

// ─── 标记已读 ─────────────────────────────────────────────────────────────────

export async function markConversationRead(conversationId: number): Promise<void> {
  const me = currentUser();
  const readAt = new Date();

  await db.update(chatConversationMembers)
    .set({ lastReadAt: readAt })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ));

  // 通知会话内其他成员（用于显示"已读"）
  const members = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      ne(chatConversationMembers.userId, me.userId),
    ));

  scheduleSendToUsers(members, {
    type: 'chat:read',
    payload: { conversationId, userId: me.userId, readAt: formatDateTime(readAt) },
  });
}

// ─── 已读回执：会话成员已读状态 ──────────────────────────────────────────────

export async function getConversationReadStates(conversationId: number): Promise<ChatReadState[]> {
  const me = currentUser();
  await ensureConversationMember(conversationId);

  const rows = await db
    .select({
      userId: chatConversationMembers.userId,
      nickname: users.nickname,
      avatar: users.avatar,
      lastReadAt: chatConversationMembers.lastReadAt,
    })
    .from(chatConversationMembers)
    .innerJoin(users, eq(chatConversationMembers.userId, users.id))
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      ne(chatConversationMembers.userId, me.userId),
    ));

  return rows.map((r) => ({
    userId: r.userId,
    nickname: r.nickname,
    avatar: r.avatar ?? null,
    lastReadAt: formatNullableDateTime(r.lastReadAt),
  }));
}

// ─── 删除/退出会话（仅对当前用户）─────────────────────────────────────────────

export async function removeConversation(conversationId: number): Promise<void> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, conversationId) });
  const conversation = requireRow(conv, '会话不存在或无权操作');

  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  const membership = requireRow(member, '会话不存在或无权操作');

  // 群主退群守卫：还有其他成员时必须先转让群主或解散群聊，避免产生无主群
  if (conversation.type === 'group' && membership.role === 'owner') {
    const otherCount = await db.$count(chatConversationMembers, and(
      eq(chatConversationMembers.conversationId, conversationId),
      ne(chatConversationMembers.userId, me.userId),
    ));
    if (otherCount > 0) {
      throw new HTTPException(400, { message: '你是群主，请先转让群主或解散群聊' });
    }
  }

  await db.delete(chatConversationMembers).where(and(
    eq(chatConversationMembers.conversationId, conversationId),
    eq(chatConversationMembers.userId, me.userId),
  ));
  invalidateConversationMembers(conversationId);

  const remainCount = await db.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conversationId));
  if (conversation.type === 'group' && remainCount > 0) {
    await appendSystemMessage(conversationId, `${myNickname ?? '成员'} 退出了群聊`);
  }
  if (remainCount === 0) {
    await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
  }
}

// ─── 解散群聊（群主专属） ─────────────────────────────────────────────────────

export async function disbandConversation(conversationId: number): Promise<void> {
  const me = currentUser();

  const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, conversationId) });
  const conversation = requireRow(conv, '会话不存在或无权操作');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '仅群聊支持解散' });

  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (member?.role !== 'owner') throw new HTTPException(403, { message: '只有群主才能解散群聊' });

  // 广播目标需在删除前收集；成员/消息/邀请/申请由外键级联删除
  const members = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId));

  await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
  invalidateConversationMembers(conversationId);

  scheduleSendToUsers(members, {
    type: 'chat:conversation-removed',
    payload: { conversationId, reason: 'disbanded' },
  });
}
