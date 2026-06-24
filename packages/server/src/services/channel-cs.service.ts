/**
 * Channel 双向客服服务（第三期 2D）
 *
 * 在第一二期「系统号广播 / 定向 / 订阅」基础上扩展运营号（business）能力：
 *  - 公众号底部菜单（channel_menus，最多 3 个一级 + 每级 5 个二级）
 *  - 关键词自动回复（channel_auto_replies：subscribe / keyword / default）
 *  - 用户 ↔ 运营号双向消息（channel_messages.direction in/out）
 *  - 客服工作台（按用户聚合会话 + 客服回复）
 *
 * 会话模型：会话 = (channelId[business], endUserId)
 *  - in  消息：direction='in', senderUserId=用户
 *  - out 回复：direction='out', audienceType='targeted'，经 channelMessageTargets 定向到用户
 *  运营号不接收工作流卡片（那些走系统号），故按业务号聚合的 targeted out 即客服回复，干净无污染。
 */
import { and, asc, desc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  channels, channelMessages, channelMenus, channelAutoReplies, channelMessageTargets, channelQuickReplies,
  channelConversations, users, menus, roleMenus, userRoles,
  type ChannelMenuRow, type ChannelAutoReplyRow, type ChannelQuickReplyRow, type ChannelConversationRow, type ChannelRow,
} from '../db/schema';
import type {
  ChannelMenu, ChannelAutoReply, ChannelConversation, ChannelConversationStatus, ChannelMessage, ChannelQuickReply, ChannelCsAgent,
  SaveChannelMenusInput, CreateChannelAutoReplyInput, UpdateChannelAutoReplyInput,
  CreateChannelQuickReplyInput, UpdateChannelQuickReplyInput,
} from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { broadcast, scheduleSendToUsers } from '../lib/ws-manager';
import { mapChannelMessage } from './channel.service';

// ─── 频道前置校验 ──────────────────────────────────────────────────────────────

async function ensureChannel(channelId: number): Promise<ChannelRow> {
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!ch) throw new HTTPException(404, { message: '频道不存在' });
  return ch;
}

async function ensureBusinessChannel(channelId: number): Promise<ChannelRow> {
  const ch = await ensureChannel(channelId);
  if (ch.type !== 'business') throw new HTTPException(400, { message: '仅运营号支持该操作' });
  return ch;
}

// ─── 用户名批量解析 ────────────────────────────────────────────────────────────

async function getUserName(userId: number): Promise<string | null> {
  const u = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { nickname: true, username: true },
  });
  return u?.nickname ?? u?.username ?? null;
}

async function getUserNames(userIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (userIds.length === 0) return map;
  const rows = await db.select({ id: users.id, nickname: users.nickname, username: users.username })
    .from(users).where(inArray(users.id, userIds));
  rows.forEach((u) => map.set(u.id, u.nickname || u.username));
  return map;
}

// ─── 公众号底部菜单 ────────────────────────────────────────────────────────────

function mapMenu(row: ChannelMenuRow): ChannelMenu {
  return {
    id: row.id,
    channelId: row.channelId,
    parentId: row.parentId,
    name: row.name,
    type: row.type,
    value: row.value,
    sort: row.sort,
  };
}

/** 读取某频道的底部菜单（树形：一级 + children 二级）。订阅用户与管理后台共用。 */
export async function getChannelMenus(channelId: number): Promise<ChannelMenu[]> {
  await ensureChannel(channelId);
  const rows = await db.query.channelMenus.findMany({
    where: eq(channelMenus.channelId, channelId),
    orderBy: [asc(channelMenus.sort), asc(channelMenus.id)],
  });
  const tops = rows.filter((r) => r.parentId == null).map(mapMenu);
  for (const top of tops) {
    top.children = rows.filter((r) => r.parentId === top.id).map(mapMenu);
  }
  return tops;
}

/** 整体替换某频道的底部菜单（≤3 一级 + 每级 ≤5 二级，校验已在 zod 完成）。 */
export async function saveChannelMenus(channelId: number, input: SaveChannelMenusInput): Promise<ChannelMenu[]> {
  await ensureBusinessChannel(channelId);
  await db.transaction(async (tx) => {
    await tx.delete(channelMenus).where(eq(channelMenus.channelId, channelId));
    for (let i = 0; i < input.menus.length; i++) {
      const m = input.menus[i];
      const [top] = await tx.insert(channelMenus).values({
        channelId, parentId: null, name: m.name, type: m.type, value: m.value ?? null, sort: i,
      }).returning();
      const children = m.children ?? [];
      for (let j = 0; j < children.length; j++) {
        const c = children[j];
        await tx.insert(channelMenus).values({
          channelId, parentId: top.id, name: c.name, type: c.type, value: c.value ?? null, sort: j,
        });
      }
    }
  });
  return getChannelMenus(channelId);
}

// ─── 自动回复规则 ──────────────────────────────────────────────────────────────

function mapAutoReply(row: ChannelAutoReplyRow): ChannelAutoReply {
  return {
    id: row.id,
    channelId: row.channelId,
    matchType: row.matchType,
    keyword: row.keyword,
    keywordMode: row.keywordMode,
    replyContent: row.replyContent,
    status: row.status,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listChannelAutoReplies(channelId: number): Promise<ChannelAutoReply[]> {
  await ensureChannel(channelId);
  const rows = await db.query.channelAutoReplies.findMany({
    where: eq(channelAutoReplies.channelId, channelId),
    orderBy: [asc(channelAutoReplies.sort), asc(channelAutoReplies.id)],
  });
  return rows.map(mapAutoReply);
}

export async function createChannelAutoReply(channelId: number, input: CreateChannelAutoReplyInput): Promise<ChannelAutoReply> {
  await ensureBusinessChannel(channelId);
  const [row] = await db.insert(channelAutoReplies).values({
    channelId,
    matchType: input.matchType,
    keyword: input.matchType === 'keyword' ? (input.keyword ?? null) : null,
    keywordMode: input.keywordMode,
    replyContent: input.replyContent,
    status: input.status,
    sort: input.sort,
  }).returning();
  return mapAutoReply(row);
}

export async function updateChannelAutoReply(id: number, input: UpdateChannelAutoReplyInput): Promise<ChannelAutoReply> {
  const existing = await db.query.channelAutoReplies.findFirst({ where: eq(channelAutoReplies.id, id) });
  if (!existing) throw new HTTPException(404, { message: '自动回复规则不存在' });
  const [row] = await db.update(channelAutoReplies).set({
    ...(input.keyword === undefined ? {} : { keyword: existing.matchType === 'keyword' ? input.keyword : null }),
    ...(input.keywordMode === undefined ? {} : { keywordMode: input.keywordMode }),
    ...(input.replyContent === undefined ? {} : { replyContent: input.replyContent }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
  }).where(eq(channelAutoReplies.id, id)).returning();
  return mapAutoReply(row);
}

export async function deleteChannelAutoReply(id: number): Promise<void> {
  const existing = await db.query.channelAutoReplies.findFirst({ where: eq(channelAutoReplies.id, id) });
  if (!existing) throw new HTTPException(404, { message: '自动回复规则不存在' });
  await db.delete(channelAutoReplies).where(eq(channelAutoReplies.id, id));
}

/**
 * 匹配自动回复规则。
 * 优先级：subscribe（仅关注事件）→ keyword(exact 优先于 contains，按 sort)→ default。
 */
async function matchAutoReply(
  channelId: number,
  text: string,
  event: 'subscribe' | 'message',
): Promise<ChannelAutoReplyRow | null> {
  const rows = await db.query.channelAutoReplies.findMany({
    where: and(eq(channelAutoReplies.channelId, channelId), eq(channelAutoReplies.status, 'enabled')),
    orderBy: [asc(channelAutoReplies.sort), asc(channelAutoReplies.id)],
  });
  if (event === 'subscribe') {
    return rows.find((r) => r.matchType === 'subscribe') ?? null;
  }
  const trimmed = text.trim();
  const exact = rows.find((r) =>
    r.matchType === 'keyword' && r.keywordMode === 'exact' && r.keyword != null && r.keyword.trim() === trimmed,
  );
  if (exact) return exact;
  const contains = rows.find((r) =>
    r.matchType === 'keyword' && r.keywordMode === 'contains'
    && r.keyword != null && r.keyword.trim().length > 0 && trimmed.includes(r.keyword.trim()),
  );
  if (contains) return contains;
  return rows.find((r) => r.matchType === 'default') ?? null;
}

// ─── 双向消息 ──────────────────────────────────────────────────────────────────

/** 写入一条 out（频道→用户）消息，定向到指定用户并实时推送。 */
async function deliverOut(
  channelId: number,
  targetUserId: number,
  content: string,
  senderUserId: number | null,
  senderUserName: string | null,
): Promise<ChannelMessage> {
  const [row] = await db.insert(channelMessages).values({
    channelId,
    audienceType: 'targeted',
    type: 'text',
    title: null,
    content,
    extra: null,
    publishedById: senderUserId,
    direction: 'out',
    senderUserId,
  }).returning();
  await db.insert(channelMessageTargets).values({ messageId: row.id, userId: targetUserId });
  const msg = mapChannelMessage(row, false, senderUserName);
  scheduleSendToUsers([{ userId: targetUserId }], { type: 'channel:message', payload: msg });
  return msg;
}

/** 用户向运营号发送一条消息：写 in → 匹配自动回复写 out → WS 推送。 */
export async function sendUserMessage(
  channelId: number,
  content: string,
): Promise<{ message: ChannelMessage; autoReply: ChannelMessage | null }> {
  const me = currentUser();
  await ensureBusinessChannel(channelId);

  const [inRow] = await db.insert(channelMessages).values({
    channelId,
    audienceType: 'targeted',
    type: 'text',
    title: null,
    content,
    extra: null,
    publishedById: null,
    direction: 'in',
    senderUserId: me.userId,
  }).returning();

  const myName = await getUserName(me.userId);
  const inMsg = mapChannelMessage(inRow, true, myName);
  // 回推自己（多标签页同步；视图按 id 去重）
  scheduleSendToUsers([{ userId: me.userId }], { type: 'channel:message', payload: inMsg });

  const matched = await matchAutoReply(channelId, content, 'message');
  let autoReply: ChannelMessage | null = null;
  if (matched) {
    autoReply = await deliverOut(channelId, me.userId, matched.replyContent, null, null);
  }
  // 会话治理：用户来信 → upsert 会话；若已解决则重新激活为待处理
  await activateConversationOnUserMessage(channelId, me.userId);
  // 通知在线客服工作台有新用户消息（轻量信号，不含敏感内容；客服端凭权限拉取刷新）
  broadcast({ type: 'channel:cs-message', payload: { channelId } });
  return { message: inMsg, autoReply };
}

/** 用户来信时 upsert 会话：新建为 open；已存在且 resolved 则重新激活为 open。 */
async function activateConversationOnUserMessage(channelId: number, userId: number): Promise<void> {
  await db.insert(channelConversations).values({ channelId, userId, status: 'open' })
    .onConflictDoUpdate({
      target: [channelConversations.channelId, channelConversations.userId],
      set: {
        status: sql`CASE WHEN ${channelConversations.status} = 'resolved' THEN 'open'::channel_conversation_status ELSE ${channelConversations.status} END`,
        resolvedAt: sql`CASE WHEN ${channelConversations.status} = 'resolved' THEN NULL ELSE ${channelConversations.resolvedAt} END`,
      },
    });
}

/** 客服回复某用户：写 out 定向消息 + WS 推送该用户。 */
export async function replyAsAgent(channelId: number, userId: number, content: string): Promise<ChannelMessage> {
  const agent = currentUser();
  await ensureBusinessChannel(channelId);
  const targetUser = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } });
  if (!targetUser) throw new HTTPException(404, { message: '用户不存在' });
  const agentName = await getUserName(agent.userId);
  const msg = await deliverOut(channelId, userId, content, agent.userId, agentName);
  // 会话治理：客服回复 → 待处理转为处理中（已解决的也重新进入处理中）
  await db.insert(channelConversations).values({ channelId, userId, status: 'processing' })
    .onConflictDoUpdate({
      target: [channelConversations.channelId, channelConversations.userId],
      set: { status: 'processing', resolvedAt: null },
    });
  return msg;
}

/** 关注运营号时触发「关注欢迎语」自动回复（首次订阅后由路由层调用）。 */
export async function handleSubscribeAutoReply(channelId: number): Promise<void> {
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, channelId), columns: { type: true } });
  if (!ch || ch.type !== 'business') return;
  const matched = await matchAutoReply(channelId, '', 'subscribe');
  if (!matched) return;
  await deliverOut(channelId, currentUser().userId, matched.replyContent, null, null);
}

// ─── 客服工作台 ────────────────────────────────────────────────────────────────

/** 客服可服务的运营号列表（启用的 business 频道）。 */
export async function listCsChannels(): Promise<{ id: number; name: string; avatar: string | null }[]> {
  const rows = await db.query.channels.findMany({
    where: and(eq(channels.type, 'business'), eq(channels.status, 'enabled')),
    orderBy: [channels.id],
    columns: { id: true, name: true, avatar: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar }));
}

/** 会话列表筛选条件 */
export interface ConversationFilter {
  status?: ChannelConversationStatus;
  assignee?: 'mine' | 'unassigned' | 'all';
  keyword?: string;
  tag?: string;
}

/** 某运营号下的会话列表（按用户聚合 + 治理属性 left join），按最近消息时间倒序。 */
export async function listChannelConversations(channelId: number, filter: ConversationFilter = {}): Promise<ChannelConversation[]> {
  await ensureBusinessChannel(channelId);
  const me = currentUser().userId;

  const inRows = await db.select({
    id: channelMessages.id,
    userId: channelMessages.senderUserId,
    content: channelMessages.content,
    createdAt: channelMessages.createdAt,
  }).from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.direction, 'in')))
    .orderBy(asc(channelMessages.id));

  const userIds = [...new Set(inRows.map((r) => r.userId).filter((x): x is number => x != null))];
  if (userIds.length === 0) return [];

  const outRows = await db.select({
    id: channelMessages.id,
    userId: channelMessageTargets.userId,
    content: channelMessages.content,
    createdAt: channelMessages.createdAt,
    senderUserId: channelMessages.senderUserId,
  }).from(channelMessages)
    .innerJoin(channelMessageTargets, eq(channelMessageTargets.messageId, channelMessages.id))
    .where(and(
      eq(channelMessages.channelId, channelId),
      eq(channelMessages.direction, 'out'),
      eq(channelMessages.audienceType, 'targeted'),
    ))
    .orderBy(asc(channelMessages.id));

  const [userRows, convRows] = await Promise.all([
    db.select({ id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar })
      .from(users).where(inArray(users.id, userIds)),
    db.select().from(channelConversations)
      .where(and(eq(channelConversations.channelId, channelId), inArray(channelConversations.userId, userIds))),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const convMap = new Map(convRows.map((c) => [c.userId, c]));

  // 收集所有指派客服名
  const assigneeIds = [...new Set(convRows.map((c) => c.assigneeId).filter((x): x is number => x != null))];
  const assigneeNameMap = await getUserNames(assigneeIds);

  let convos: ChannelConversation[] = userIds.map((uid) => {
    const ins = inRows.filter((r) => r.userId === uid);
    const outs = outRows.filter((r) => r.userId === uid);
    const lastIn = ins[ins.length - 1];
    const lastOut = outs.length ? outs[outs.length - 1] : null;
    const lastAgentOutId = outs.reduce((max, o) => (o.senderUserId != null && o.id > max ? o.id : max), 0);
    const useIn = !lastOut || lastIn.id > lastOut.id;
    const u = userMap.get(uid);
    const conv = convMap.get(uid);
    return {
      channelId,
      userId: uid,
      userName: u ? (u.nickname || u.username) : `用户#${uid}`,
      userAvatar: u?.avatar ?? null,
      lastMessage: useIn ? lastIn.content : lastOut!.content,
      lastDirection: useIn ? 'in' : 'out',
      lastMessageAt: formatDateTime(useIn ? lastIn.createdAt : lastOut!.createdAt),
      unreadCount: ins.filter((r) => r.id > lastAgentOutId).length,
      messageCount: ins.length + outs.length,
      status: conv?.status ?? 'open',
      assigneeId: conv?.assigneeId ?? null,
      assigneeName: conv?.assigneeId != null ? (assigneeNameMap.get(conv.assigneeId) ?? null) : null,
      tags: (conv?.tags as string[] | null) ?? [],
      resolvedAt: formatNullableDateTime(conv?.resolvedAt ?? null),
    };
  });

  // 筛选
  if (filter.status) convos = convos.filter((c) => c.status === filter.status);
  if (filter.assignee === 'mine') convos = convos.filter((c) => c.assigneeId === me);
  else if (filter.assignee === 'unassigned') convos = convos.filter((c) => c.assigneeId == null);
  if (filter.tag) convos = convos.filter((c) => c.tags.includes(filter.tag!));
  if (filter.keyword) {
    const kw = filter.keyword.trim().toLowerCase();
    convos = convos.filter((c) => c.userName.toLowerCase().includes(kw) || c.lastMessage.toLowerCase().includes(kw));
  }

  convos.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return convos;
}

/** upsert 会话属性行（写操作前确保行存在），返回更新后的行。 */
async function upsertConversation(channelId: number, userId: number, set: Partial<ChannelConversationRow>): Promise<ChannelConversationRow> {
  const [row] = await db.insert(channelConversations)
    .values({ channelId, userId, ...set })
    .onConflictDoUpdate({
      target: [channelConversations.channelId, channelConversations.userId],
      set,
    })
    .returning();
  return row;
}

/** 指派 / 转接会话给某客服（assigneeId 为 null = 取消指派）。 */
export async function assignConversation(channelId: number, userId: number, assigneeId: number | null): Promise<void> {
  await ensureBusinessChannel(channelId);
  if (assigneeId != null) {
    const agent = await db.query.users.findFirst({ where: eq(users.id, assigneeId), columns: { id: true } });
    if (!agent) throw new HTTPException(404, { message: '指派的客服不存在' });
  }
  await upsertConversation(channelId, userId, { assigneeId });
}

/** 标记会话已解决。 */
export async function resolveConversation(channelId: number, userId: number): Promise<void> {
  await ensureBusinessChannel(channelId);
  await upsertConversation(channelId, userId, { status: 'resolved', resolvedAt: new Date() });
}

/** 设置会话标签（整体替换）。 */
export async function setConversationTags(channelId: number, userId: number, tags: string[]): Promise<void> {
  await ensureBusinessChannel(channelId);
  await upsertConversation(channelId, userId, { tags });
}

/** 可指派的客服列表（拥有 channel:cs 权限的用户）。 */
export async function listCsAgents(): Promise<ChannelCsAgent[]> {
  const rows = await db.selectDistinct({ id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roleMenus, eq(roleMenus.roleId, userRoles.roleId))
    .innerJoin(menus, eq(menus.id, roleMenus.menuId))
    .where(and(eq(menus.permission, 'channel:cs'), eq(users.status, 'enabled')));
  return rows.map((u) => ({ id: u.id, name: u.nickname || u.username, avatar: u.avatar }));
}

/** 某会话（channelId + userId）的双向消息流，分页倒序（前端反转为正序展示）。 */

/** 某会话（channelId + userId）的双向消息流，分页倒序（前端反转为正序展示）。 */
export async function listConversationMessages(channelId: number, userId: number, page: number, pageSize: number) {
  await ensureBusinessChannel(channelId);
  const where = and(
    eq(channelMessages.channelId, channelId),
    or(
      and(eq(channelMessages.direction, 'in'), eq(channelMessages.senderUserId, userId)),
      and(
        eq(channelMessages.direction, 'out'),
        eq(channelMessages.audienceType, 'targeted'),
        exists(db.select({ x: sql`1` }).from(channelMessageTargets).where(and(
          eq(channelMessageTargets.messageId, channelMessages.id),
          eq(channelMessageTargets.userId, userId),
        ))),
      ),
    ),
  );

  const [total, rows] = await Promise.all([
    db.$count(channelMessages, where),
    db.select().from(channelMessages).where(where)
      .orderBy(desc(channelMessages.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  // Q3 已读回执：查该用户对本页 out 消息的已读状态（targets.readAt 非空 = 已读）
  const outIds = rows.filter((r) => r.direction === 'out' && r.audienceType === 'targeted').map((r) => r.id);
  const readMap = new Map<number, boolean>();
  if (outIds.length > 0) {
    const tg = await db.select({ messageId: channelMessageTargets.messageId, readAt: channelMessageTargets.readAt })
      .from(channelMessageTargets)
      .where(and(inArray(channelMessageTargets.messageId, outIds), eq(channelMessageTargets.userId, userId)));
    tg.forEach((t) => readMap.set(t.messageId, t.readAt != null));
  }

  const senderIds = [...new Set(rows.map((r) => r.senderUserId).filter((x): x is number => x != null))];
  const nameMap = await getUserNames(senderIds);
  const list = rows.map((r) => {
    const msg = mapChannelMessage(r, true, r.senderUserId != null ? (nameMap.get(r.senderUserId) ?? null) : null);
    if (r.direction === 'out' && r.audienceType === 'targeted') {
      msg.readByTarget = readMap.get(r.id) ?? false;
    }
    return msg;
  });
  return { list, total, page, pageSize };
}

// ─── 客服快捷回复库（D） ────────────────────────────────────────────────────────

function mapQuickReply(row: ChannelQuickReplyRow, channelName: string | null = null): ChannelQuickReply {
  return {
    id: row.id,
    channelId: row.channelId,
    channelName,
    title: row.title,
    content: row.content,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 列出快捷回复（全局 + 指定运营号；channelId 省略时仅返回全局） */
export async function listChannelQuickReplies(channelId?: number): Promise<ChannelQuickReply[]> {
  const rows = await db.query.channelQuickReplies.findMany({
    where: channelId
      ? or(isNull(channelQuickReplies.channelId), eq(channelQuickReplies.channelId, channelId))
      : isNull(channelQuickReplies.channelId),
    orderBy: [asc(channelQuickReplies.sort), asc(channelQuickReplies.id)],
    with: { channel: { columns: { name: true } } },
  });
  return rows.map((r) => mapQuickReply(r, r.channel?.name ?? null));
}

/** 新建快捷回复 */
export async function createChannelQuickReply(input: CreateChannelQuickReplyInput): Promise<ChannelQuickReply> {
  if (input.channelId != null) await ensureBusinessChannel(input.channelId);
  const [row] = await db.insert(channelQuickReplies).values({
    channelId: input.channelId ?? null,
    title: input.title,
    content: input.content,
    sort: input.sort ?? 0,
  }).returning();
  return mapQuickReply(row);
}

/** 更新快捷回复 */
export async function updateChannelQuickReply(id: number, input: UpdateChannelQuickReplyInput): Promise<ChannelQuickReply> {
  const existing = await db.query.channelQuickReplies.findFirst({ where: eq(channelQuickReplies.id, id) });
  if (!existing) throw new HTTPException(404, { message: '快捷回复不存在' });
  if (input.channelId != null) await ensureBusinessChannel(input.channelId);
  const [row] = await db.update(channelQuickReplies).set({
    ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
  }).where(eq(channelQuickReplies.id, id)).returning();
  return mapQuickReply(row);
}

/** 删除快捷回复 */
export async function deleteChannelQuickReply(id: number): Promise<void> {
  const existing = await db.query.channelQuickReplies.findFirst({ where: eq(channelQuickReplies.id, id) });
  if (!existing) throw new HTTPException(404, { message: '快捷回复不存在' });
  await db.delete(channelQuickReplies).where(eq(channelQuickReplies.id, id));
}
