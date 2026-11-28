import { and, desc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { db } from '../../db';
import { chatConversationMembers, chatConversations, chatGroupInvites, chatGroupJoinRequests, users } from '../../db/schema';
import type { ChatGroupInviteRow } from '../../db/schema/chat';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { exactTenantCondition } from '../../lib/tenant';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { scheduleSendToUsers } from '../../lib/ws-manager';
import { invalidateConversationMembers } from '../../lib/chat-member-cache';
import type { ChatGroupInvite, ChatGroupJoinRequest, ChatInviteInfo } from '@zenith/shared/chat';
import { requireChatGroup } from './chat-shared';

const MAX_GROUP_MEMBERS = 20;
const INVITE_TTL_DAYS = 7;

function mapInvite(row: ChatGroupInviteRow): ChatGroupInvite {
  return {
    id: row.id,
    conversationId: row.conversationId,
    token: row.token,
    expiresAt: formatNullableDateTime(row.expiresAt),
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    enabled: row.enabled,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function ensureGroupManager(conversationId: number, userId: number) {
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, userId),
    ),
  });
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    throw new HTTPException(403, { message: '只有群主或管理员才能执行该操作' });
  }
  return member;
}

async function memberIdsOf(conversationId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

async function managerIdsOf(conversationId: number): Promise<number[]> {
  const rows = await db.query.chatConversationMembers.findMany({
    where: eq(chatConversationMembers.conversationId, conversationId),
    columns: { userId: true, role: true },
  });
  return rows.filter((r) => r.role === 'owner' || r.role === 'admin').map((r) => r.userId);
}

/** 获取当前有效邀请（没有则生成，默认 7 天有效、不限次数）；群主/管理员 */
export async function getOrCreateInvite(conversationId: number): Promise<ChatGroupInvite> {
  const me = currentUser();
  await requireChatGroup(conversationId);
  await ensureGroupManager(conversationId, me.userId);

  const existing = await db.query.chatGroupInvites.findFirst({
    where: and(
      eq(chatGroupInvites.conversationId, conversationId),
      eq(chatGroupInvites.enabled, true),
    ),
    orderBy: [desc(chatGroupInvites.id)],
  });
  if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) {
    return mapInvite(existing);
  }

  const [row] = await db.insert(chatGroupInvites).values({
    conversationId,
    token: randomBytes(24).toString('hex'),
    createdBy: me.userId,
    expiresAt: dayjs().add(INVITE_TTL_DAYS, 'day').toDate(),
  }).returning();
  return mapInvite(row);
}

/** 重置邀请链接（作废旧链接并生成新链接）；群主/管理员 */
export async function resetInvite(conversationId: number): Promise<ChatGroupInvite> {
  const me = currentUser();
  await requireChatGroup(conversationId);
  await ensureGroupManager(conversationId, me.userId);

  await db.update(chatGroupInvites)
    .set({ enabled: false })
    .where(eq(chatGroupInvites.conversationId, conversationId));

  const [row] = await db.insert(chatGroupInvites).values({
    conversationId,
    token: randomBytes(24).toString('hex'),
    createdBy: me.userId,
    expiresAt: dayjs().add(INVITE_TTL_DAYS, 'day').toDate(),
  }).returning();
  return mapInvite(row);
}

async function getValidInvite(token: string) {
  const invite = await db.query.chatGroupInvites.findFirst({
    where: eq(chatGroupInvites.token, token),
  });
  if (!invite || !invite.enabled) throw new HTTPException(404, { message: '邀请链接不存在或已失效' });
  if (invite.expiresAt && invite.expiresAt <= new Date()) {
    throw new HTTPException(400, { message: '邀请链接已过期' });
  }
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
    throw new HTTPException(400, { message: '邀请链接使用次数已达上限' });
  }
  return invite;
}

/** 邀请链接落地信息（加入前展示群概况） */
export async function getInviteInfo(token: string): Promise<ChatInviteInfo> {
  const me = currentUser();
  const invite = await getValidInvite(token);
  const conv = await requireChatGroup(invite.conversationId);

  const [memberCount, myMembership] = await Promise.all([
    db.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conv.id)),
    db.query.chatConversationMembers.findFirst({
      where: and(
        eq(chatConversationMembers.conversationId, conv.id),
        eq(chatConversationMembers.userId, me.userId),
      ),
    }),
  ]);

  return {
    conversationId: conv.id,
    groupName: conv.name,
    memberCount,
    joinApproval: conv.joinApproval,
    alreadyMember: !!myMembership,
  };
}

/** 直接入群和审批入群都校验目标账号归属，并原子记录邀请使用次数。 */
async function addMemberViaInvite(conversationId: number, tenantId: number | null, userId: number, inviteId: number | null): Promise<void> {
  const targetUser = await db.transaction(async (tx) => {
    const [group] = await tx.select({ id: chatConversations.id }).from(chatConversations).where(and(
      eq(chatConversations.id, conversationId), exactTenantCondition(chatConversations.tenantId, tenantId),
    )).limit(1).for('update');
    requireRow(group, '会话不存在');
    const memberCount = await tx.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conversationId));
    if (memberCount >= MAX_GROUP_MEMBERS) throw new HTTPException(400, { message: `群成员已达上限（${MAX_GROUP_MEMBERS}人）` });
    const [user] = await tx.select({ id: users.id, nickname: users.nickname, avatar: users.avatar }).from(users).where(and(
      eq(users.id, userId), eq(users.status, 'enabled'), exactTenantCondition(users.tenantId, tenantId),
    )).limit(1).for('share');
    requireRow(user, '用户不存在或已停用');
    const [inserted] = await tx.insert(chatConversationMembers).values({ conversationId, userId })
      .onConflictDoNothing().returning({ userId: chatConversationMembers.userId });
    if (!inserted) return null;
    if (inviteId !== null) {
      await tx.update(chatGroupInvites).set({ usedCount: sql`${chatGroupInvites.usedCount} + 1` })
        .where(and(eq(chatGroupInvites.id, inviteId), eq(chatGroupInvites.conversationId, conversationId)));
    }
    return user;
  });
  if (!targetUser) return;
  invalidateConversationMembers(conversationId);

  // 复用现有系统消息 + WS 事件链路
  const { appendSystemMessage } = await import('./chat.service');
  await appendSystemMessage(conversationId, `${targetUser.nickname} 通过邀请链接加入了群聊`);
  const members = await memberIdsOf(conversationId);
  scheduleSendToUsers(members.map((id) => ({ userId: id })), {
    type: 'chat:member-join',
    payload: { conversationId, user: { id: targetUser.id, nickname: targetUser.nickname, avatar: targetUser.avatar ?? null } },
  });
}

/**
 * 通过邀请链接加入群聊。
 * 群开启入群审批时创建待审批申请（返回 { joined: false }），否则直接入群。
 */
export async function joinByInvite(token: string, message?: string): Promise<{ joined: boolean }> {
  const me = currentUser();
  const invite = await getValidInvite(token);
  const conv = await requireChatGroup(invite.conversationId);

  const existingMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conv.id),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (existingMember) throw new HTTPException(400, { message: '你已在该群聊中' });

  if (!conv.joinApproval) {
    await addMemberViaInvite(conv.id, conv.tenantId, me.userId, invite.id);
    return { joined: true };
  }

  // 需审批：去重后创建申请，并通知群主/管理员刷新
  const pending = await db.query.chatGroupJoinRequests.findFirst({
    where: and(
      eq(chatGroupJoinRequests.conversationId, conv.id),
      eq(chatGroupJoinRequests.userId, me.userId),
      eq(chatGroupJoinRequests.status, 'pending'),
    ),
  });
  if (pending) throw new HTTPException(400, { message: '你已提交过申请，请等待管理员审批' });

  await db.insert(chatGroupJoinRequests).values({
    conversationId: conv.id,
    userId: me.userId,
    inviteId: invite.id,
    message: message?.trim() || null,
  });

  const managers = await managerIdsOf(conv.id);
  scheduleSendToUsers(managers.map((id) => ({ userId: id })), {
    type: 'chat:join-request',
    payload: { conversationId: conv.id },
  });
  return { joined: false };
}

/** 待审批入群申请列表；群主/管理员 */
export async function listJoinRequests(conversationId: number): Promise<ChatGroupJoinRequest[]> {
  const me = currentUser();
  await requireChatGroup(conversationId);
  await ensureGroupManager(conversationId, me.userId);

  const rows = await db.query.chatGroupJoinRequests.findMany({
    where: and(
      eq(chatGroupJoinRequests.conversationId, conversationId),
      eq(chatGroupJoinRequests.status, 'pending'),
    ),
    orderBy: [desc(chatGroupJoinRequests.id)],
    with: { user: { columns: { id: true, nickname: true, avatar: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    userId: r.userId,
    nickname: (r.user as { nickname: string } | null)?.nickname ?? `用户 ${r.userId}`,
    avatar: (r.user as { avatar: string | null } | null)?.avatar ?? null,
    message: r.message,
    status: r.status,
    createdAt: formatDateTime(r.createdAt),
  }));
}

/** 审批入群申请（通过/拒绝）；群主/管理员 */
export async function handleJoinRequest(requestId: number, approve: boolean): Promise<void> {
  const me = currentUser();
  const req = await db.query.chatGroupJoinRequests.findFirst({ where: eq(chatGroupJoinRequests.id, requestId) });
  const request = requireRow(req, '申请不存在');
  const conv = await requireChatGroup(request.conversationId);
  if (request.status !== 'pending') throw new HTTPException(400, { message: '该申请已处理' });
  await ensureGroupManager(request.conversationId, me.userId);

  if (approve) {
    const alreadyIn = await db.query.chatConversationMembers.findFirst({
      where: and(
        eq(chatConversationMembers.conversationId, request.conversationId),
        eq(chatConversationMembers.userId, request.userId),
      ),
    });
    if (!alreadyIn) {
      await addMemberViaInvite(conv.id, conv.tenantId, request.userId, request.inviteId);
    }
  }

  await db.update(chatGroupJoinRequests)
    .set({ status: approve ? 'approved' : 'rejected', handledBy: me.userId, handledAt: new Date() })
    .where(eq(chatGroupJoinRequests.id, requestId));

  const managers = await managerIdsOf(request.conversationId);
  scheduleSendToUsers([...managers, request.userId].map((id) => ({ userId: id })), {
    type: 'chat:member-update',
    payload: { conversationId: request.conversationId },
  });
}

/** 开启/关闭入群审批；群主/管理员 */
export async function setJoinApproval(conversationId: number, enabled: boolean): Promise<void> {
  const me = currentUser();
  const conv = await requireChatGroup(conversationId);
  await ensureGroupManager(conversationId, me.userId);
  if (conv.joinApproval === enabled) return;
  await db.update(chatConversations)
    .set({ joinApproval: enabled })
    .where(eq(chatConversations.id, conversationId));

  const members = await memberIdsOf(conversationId);
  scheduleSendToUsers(members.map((id) => ({ userId: id })), {
    type: 'chat:group-update',
    payload: { conversationId, joinApproval: enabled },
  });
}
