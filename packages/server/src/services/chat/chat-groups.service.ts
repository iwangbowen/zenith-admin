import { eq, and, sql, inArray, asc } from 'drizzle-orm';
import { db } from '../../db';
import { chatConversations, chatConversationMembers, users } from '../../db/schema';
import { scheduleSendToUsers } from '../../lib/ws-manager';
import { invalidateConversationMembers } from '../../lib/chat-member-cache';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { HTTPException } from 'hono/http-exception';
import type { ChatConversation } from '@zenith/shared/chat';
import { fetchUserBrief, getUserNickname, listConversationMemberIds } from './chat-shared';
import { appendSystemMessage } from './chat-messages.service';

// ─── 创建群聊 ──────────────────────────────────────────────────────────────────

export async function createGroupConversation(name: string, memberIds: number[] = []): Promise<ChatConversation> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  // 过滤自己 + 去重 + 校验用户存在，容量上限 20（含群主）
  const uniqueIds = [...new Set(memberIds)].filter((id) => id !== me.userId);
  const validMembers = uniqueIds.length > 0
    ? await db.query.users.findMany({
        where: and(inArray(users.id, uniqueIds), eq(users.status, 'enabled')),
        columns: { id: true, nickname: true },
      })
    : [];
  if (validMembers.length + 1 > 20) {
    throw new HTTPException(400, { message: '群成员已达上限（20人）' });
  }

  const [conv] = await db.insert(chatConversations).values({
    type: 'group',
    name,
    tenantId: me.tenantId,
  }).returning();

  await db.insert(chatConversationMembers).values([
    { conversationId: conv.id, userId: me.userId, role: 'owner' as const },
    ...validMembers.map((u) => ({ conversationId: conv.id, userId: u.id })),
  ]);

  await appendSystemMessage(conv.id, `${myNickname ?? '群主'} 创建了群聊`);
  if (validMembers.length > 0) {
    const names = validMembers.slice(0, 5).map((u) => u.nickname).join('、');
    const suffix = validMembers.length > 5 ? ` 等 ${validMembers.length} 人` : '';
    await appendSystemMessage(conv.id, `${myNickname ?? '群主'} 邀请 ${names}${suffix} 加入了群聊`);
  }

  return {
    id: conv.id,
    type: 'group',
    name: conv.name,
    announcement: conv.announcement ?? null,
    targetUser: null,
    lastMessage: null,
    unreadCount: 0,
    hasMentionUnread: false,
    isPinned: false,
    isStarred: false,
    isMuted: false,
    muteAll: false,
    myRole: 'owner',
    myMutedUntil: null,
    createdAt: formatDateTime(conv.createdAt),
    updatedAt: formatDateTime(conv.updatedAt),
  };
}

// ─── 添加群成员 ──────────────────────────────────────────────────────────────

export async function addGroupMember(conversationId: number, targetUserId: number): Promise<void> {
  const me = currentUser();

  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  const conversation = requireRow(conv, '会话不存在');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能添加成员' });

  // 鉴权：操作者需是成员
  const isMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  requireRow(isMember, '无权操作该群聊', 403);

  // 成员上限
  const memberCount = await db.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conversationId));
  if (memberCount >= 20) throw new HTTPException(400, { message: '群成员已达上限（20人）' });

  // 目标用户存在校验
  const target = await fetchUserBrief(targetUserId);
  const targetUser = requireRow(target, '用户不存在');

  // 幂等插入
  const alreadyIn = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, targetUserId),
    ),
  });
  if (alreadyIn) throw new HTTPException(400, { message: '该用户已在群聊中' });

  await db.insert(chatConversationMembers).values({ conversationId, userId: targetUserId });
  invalidateConversationMembers(conversationId);

  await appendSystemMessage(conversationId, `${targetUser.nickname} 加入了群聊`);

  // 推送 WS 通知（群内所有成员）
  const members = await listConversationMemberIds(conversationId);

  scheduleSendToUsers(members, { type: 'chat:member-join', payload: { conversationId, user: targetUser } });
}

// ─── 群成员列表 ──────────────────────────────────────────────────────────────

export async function listGroupMembers(conversationId: number) {
  const me = currentUser();

  const isMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  requireRow(isMember, '无权访问该会话', 403);

  const rows = await db
    .select({
      id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar,
      role: chatConversationMembers.role,
      mutedUntil: chatConversationMembers.mutedUntil,
    })
    .from(chatConversationMembers)
    .innerJoin(users, eq(chatConversationMembers.userId, users.id))
    .where(eq(chatConversationMembers.conversationId, conversationId))
    .orderBy(
      sql`case when ${chatConversationMembers.role} = 'owner' then 0 when ${chatConversationMembers.role} = 'admin' then 1 else 2 end`,
      asc(chatConversationMembers.joinedAt),
      asc(users.id),
    );

  return rows.map((r) => ({ ...r, mutedUntil: formatNullableDateTime(r.mutedUntil) }));
}

// ─── 移除群成员 ──────────────────────────────────────────────────────────────

export async function removeGroupMember(conversationId: number, targetUserId: number): Promise<void> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  const conversation = requireRow(conv, '会话不存在');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能移除成员' });

  // 操作者必须是群主或管理员
  const operatorMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (operatorMember?.role !== 'owner' && operatorMember?.role !== 'admin') {
    throw new HTTPException(403, { message: '只有群主或管理员才能移除成员' });
  }
  if (targetUserId === me.userId) {
    throw new HTTPException(400, { message: '不能移除自己，请使用退出群聊' });
  }

  // 先确认目标用户在群中
  const targetMemberExists = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, targetUserId),
    ),
  });
  const targetMember = requireRow(targetMemberExists, '该用户不在群聊中');
  if (targetMember.role === 'owner') {
    throw new HTTPException(400, { message: '不能移除群主' });
  }
  if (operatorMember.role === 'admin' && targetMember.role === 'admin') {
    throw new HTTPException(403, { message: '管理员不能移除其他管理员' });
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    columns: { nickname: true },
  });

  await db.delete(chatConversationMembers).where(and(
    eq(chatConversationMembers.conversationId, conversationId),
    eq(chatConversationMembers.userId, targetUserId),
  ));
  invalidateConversationMembers(conversationId);

  await appendSystemMessage(
    conversationId,
    `${targetUser?.nickname ?? '成员'} 被 ${myNickname ?? '群主'} 移出群聊`,
  );

  // 推送成员离开通知
  const remaining = await listConversationMemberIds(conversationId);

  scheduleSendToUsers([...remaining, { userId: targetUserId }], { type: 'chat:member-leave', payload: { conversationId, userId: targetUserId } });
}

// ─── 更新群聊信息 ─────────────────────────────────────────────────────────────

export async function updateGroupInfo(
  conversationId: number,
  updates: { name?: string; announcement?: string | null },
): Promise<void> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  const conversation = requireRow(conv, '会话不存在');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能修改信息' });

  // owner / admin 可改
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    throw new HTTPException(403, { message: '只有群主或管理员才能修改群聊信息' });
  }

  const normalizedName = updates.name === undefined ? undefined : (updates.name.trim() || null);
  const normalizedAnnouncement = 'announcement' in updates ? (updates.announcement ?? null) : undefined;
  const nameChanged = normalizedName !== undefined && normalizedName !== (conversation.name ?? null);
  const announcementChanged = normalizedAnnouncement !== undefined && normalizedAnnouncement !== (conversation.announcement ?? null);

  const set: Record<string, unknown> = {};
  if (normalizedName !== undefined) set.name = normalizedName;
  if (normalizedAnnouncement !== undefined) set.announcement = normalizedAnnouncement;
  if (Object.keys(set).length === 0) return;

  await db.update(chatConversations).set(set).where(eq(chatConversations.id, conversationId));

  // 通知所有成员
  const members = await listConversationMemberIds(conversationId);

  scheduleSendToUsers(members, {
    type: 'chat:group-update',
    payload: { conversationId, ...('name' in set ? { name: set.name as string | null } : {}), ...('announcement' in set ? { announcement: set.announcement as string | null } : {}) },
  });

  if (nameChanged) {
    await appendSystemMessage(conversationId, `${myNickname ?? '群主'} 将群聊名称修改为「${normalizedName}」`);
  }
  if (announcementChanged) {
    await appendSystemMessage(conversationId, `${myNickname ?? '群主'} 更新了群公告`, {
      announcementHistory: {
        announcement: normalizedAnnouncement ?? null,
        operatorName: myNickname,
      },
    });
  }
}

// ─── 转让群主 ─────────────────────────────────────────────────────────────────

export async function transferGroupOwnership(conversationId: number, newOwnerId: number): Promise<void> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  if (newOwnerId === me.userId) {
    throw new HTTPException(400, { message: '不能转让给自己' });
  }

  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  const conversation = requireRow(conv, '会话不存在');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能转让群主' });

  const currentMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (currentMember?.role !== 'owner') {
    throw new HTTPException(403, { message: '只有群主才能转让群主' });
  }

  const targetMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, newOwnerId),
    ),
  });
  requireRow(targetMember, '目标用户不在群聊中');

  const newOwner = await db.query.users.findFirst({
    where: eq(users.id, newOwnerId),
    columns: { nickname: true },
  });

  // 事务：当前群主降为 member，新群主升为 owner
  await db.transaction(async (tx) => {
    await tx.update(chatConversationMembers)
      .set({ role: 'member' })
      .where(and(
        eq(chatConversationMembers.conversationId, conversationId),
        eq(chatConversationMembers.userId, me.userId),
      ));
    await tx.update(chatConversationMembers)
      .set({ role: 'owner' })
      .where(and(
        eq(chatConversationMembers.conversationId, conversationId),
        eq(chatConversationMembers.userId, newOwnerId),
      ));
  });

  // 通知所有成员（角色变更走 member-update：前端会刷新会话列表 myRole 与成员面板）
  const members = await listConversationMemberIds(conversationId);

  scheduleSendToUsers(members, { type: 'chat:member-update', payload: { conversationId } });

  await appendSystemMessage(
    conversationId,
    `${myNickname ?? '原群主'} 将群主转让给 ${newOwner?.nickname ?? '新群主'}`,
  );
}

// ─── 群管理员 / 禁言管理 ──────────────────────────────────────────────────────

/** 永久禁言的哨兵时间（年份 >= 9000 视为永久） */
const MUTE_FOREVER = new Date('9999-12-31T00:00:00Z');

async function getGroupConversation(conversationId: number) {
  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  const conversation = requireRow(conv, '会话不存在');
  if (conversation.type !== 'group') throw new HTTPException(400, { message: '仅群聊支持该操作' });
  return conversation;
}

async function getConversationMember(conversationId: number, userId: number) {
  return db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, userId),
    ),
  });
}

async function broadcastMemberUpdate(conversationId: number): Promise<void> {
  const members = await listConversationMemberIds(conversationId);
  scheduleSendToUsers(members, { type: 'chat:member-update', payload: { conversationId } });
}

function formatMuteDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.round(minutes / 1440)} 天`;
}

/** 设置/取消群管理员（群主专属） */
export async function setMemberRole(conversationId: number, targetUserId: number, role: 'admin' | 'member'): Promise<void> {
  const me = currentUser();
  await getGroupConversation(conversationId);

  const operator = await getConversationMember(conversationId, me.userId);
  if (operator?.role !== 'owner') {
    throw new HTTPException(403, { message: '只有群主才能设置管理员' });
  }
  if (targetUserId === me.userId) {
    throw new HTTPException(400, { message: '不能修改自己的角色' });
  }

  const target = await getConversationMember(conversationId, targetUserId);
  const targetMember = requireRow(target, '该用户不在群聊中');
  if (targetMember.role === 'owner') throw new HTTPException(400, { message: '不能修改群主角色' });
  if (targetMember.role === role) return;

  await db.update(chatConversationMembers)
    .set({ role })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, targetUserId),
    ));

  const [myNickname, targetNickname] = await Promise.all([
    getUserNickname(me.userId),
    getUserNickname(targetUserId),
  ]);
  await appendSystemMessage(conversationId, role === 'admin'
    ? `${myNickname ?? '群主'} 将 ${targetNickname ?? '成员'} 设为管理员`
    : `${myNickname ?? '群主'} 取消了 ${targetNickname ?? '成员'} 的管理员身份`);
  await broadcastMemberUpdate(conversationId);
}

/** 禁言/解除禁言群成员（群主/管理员；管理员不能禁言管理员） */
export async function muteMember(conversationId: number, targetUserId: number, mute: boolean, durationMinutes?: number): Promise<void> {
  const me = currentUser();
  await getGroupConversation(conversationId);

  const operator = await getConversationMember(conversationId, me.userId);
  if (operator?.role !== 'owner' && operator?.role !== 'admin') {
    throw new HTTPException(403, { message: '只有群主或管理员才能禁言成员' });
  }
  if (targetUserId === me.userId) {
    throw new HTTPException(400, { message: '不能禁言自己' });
  }

  const target = await getConversationMember(conversationId, targetUserId);
  const targetMember = requireRow(target, '该用户不在群聊中');
  if (targetMember.role === 'owner') throw new HTTPException(400, { message: '不能禁言群主' });
  if (operator.role === 'admin' && targetMember.role === 'admin') {
    throw new HTTPException(403, { message: '管理员不能禁言其他管理员' });
  }

  const mutedUntil = mute
    ? (durationMinutes && durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60_000) : MUTE_FOREVER)
    : null;
  await db.update(chatConversationMembers)
    .set({ mutedUntil })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, targetUserId),
    ));

  const [myNickname, targetNickname] = await Promise.all([
    getUserNickname(me.userId),
    getUserNickname(targetUserId),
  ]);
  const durationText = durationMinutes && durationMinutes > 0 ? `（${formatMuteDuration(durationMinutes)}）` : '（永久）';
  await appendSystemMessage(conversationId, mute
    ? `${targetNickname ?? '成员'} 已被 ${myNickname ?? '管理员'} 禁言${durationText}`
    : `${targetNickname ?? '成员'} 已被 ${myNickname ?? '管理员'} 解除禁言`);
  await broadcastMemberUpdate(conversationId);
}

/** 开启/关闭全员禁言（群主/管理员；群主与管理员不受禁言限制） */
export async function setMuteAll(conversationId: number, muteAll: boolean): Promise<void> {
  const me = currentUser();
  const conv = await getGroupConversation(conversationId);

  const operator = await getConversationMember(conversationId, me.userId);
  if (operator?.role !== 'owner' && operator?.role !== 'admin') {
    throw new HTTPException(403, { message: '只有群主或管理员才能设置全员禁言' });
  }
  if (conv.muteAll === muteAll) return;

  await db.update(chatConversations)
    .set({ muteAll })
    .where(eq(chatConversations.id, conversationId));

  const members = await listConversationMemberIds(conversationId);
  scheduleSendToUsers(members, { type: 'chat:group-update', payload: { conversationId, muteAll } });

  const myNickname = await getUserNickname(me.userId);
  await appendSystemMessage(conversationId, muteAll
    ? `${myNickname ?? '管理员'} 开启了全员禁言`
    : `${myNickname ?? '管理员'} 解除了全员禁言`);
}
