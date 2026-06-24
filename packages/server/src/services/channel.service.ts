/**
 * Channel（站内公众号 / 系统号）服务
 *
 * 两种投递语义：
 *  - broadcast：全员可见（系统公告）
 *  - targeted ：仅指定用户可见（工作流待办等定向通知）
 *
 * 发送者身份由频道（name/avatar）承载，消息 publishedById 仅记录触发的管理员/系统（可空），
 * 不再依赖 users 表的机器人假用户。
 */
import { and, desc, eq, exists, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  channels, channelMessages, channelSubscriptions, channelMessageTargets, users, userRoles,
  type ChannelRow, type ChannelMessageRow,
} from '../db/schema';
import type { Channel, ChannelAdmin, ChannelMessage, ChannelMessageType, ChatCard, ChatMessageExtra, CreateChannelInput, UpdateChannelInput, PublishChannelInput, ChannelPublishAudienceInput, PaginatedResponse } from '@zenith/shared';
import { SYSTEM_CHANNEL_CODE } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { currentUser } from '../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { scheduleSendToUsers } from '../lib/ws-manager';
import { escapeLike } from '../lib/where-helpers';
import logger from '../lib/logger';

interface PublishInput {
  type: ChannelMessageType;
  content: string;
  title?: string | null;
  extra?: ChatMessageExtra | null;
  publishedById?: number | null;
}

export function mapChannelMessage(row: ChannelMessageRow, isRead: boolean, senderUserName: string | null = null): ChannelMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    audienceType: row.audienceType,
    type: row.type,
    title: row.title,
    content: row.content,
    extra: (row.extra as ChatMessageExtra | null) ?? null,
    publishedById: row.publishedById,
    direction: row.direction,
    senderUserId: row.senderUserId,
    senderUserName,
    isRead,
    status: row.status,
    scheduledAt: formatNullableDateTime(row.scheduledAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 当前用户对某频道可见消息的 WHERE 条件（broadcast 全员 ∪ targeted 命中本人 ∪ 本人发出的 in 消息） */
function visibleMessageWhere(channelId: number, userId: number) {
  return and(
    eq(channelMessages.channelId, channelId),
    eq(channelMessages.status, 'sent'),
    or(
      eq(channelMessages.audienceType, 'broadcast'),
      and(eq(channelMessages.direction, 'in'), eq(channelMessages.senderUserId, userId)),
      exists(
        db.select({ x: sql`1` }).from(channelMessageTargets).where(and(
          eq(channelMessageTargets.messageId, channelMessages.id),
          eq(channelMessageTargets.userId, userId),
        )),
      ),
    ),
  );
}

// ─── 系统号定位 ──────────────────────────────────────────────────────────────
let cachedSystemChannelId: number | null = null;

/** 内置「Zenith 助手」系统号 ID（种子写入，缓存命中后不再查库） */
export async function getSystemChannelId(): Promise<number | null> {
  if (cachedSystemChannelId != null) return cachedSystemChannelId;
  const ch = await db.query.channels.findFirst({
    where: eq(channels.code, SYSTEM_CHANNEL_CODE),
    columns: { id: true },
  });
  cachedSystemChannelId = ch?.id ?? null;
  return cachedSystemChannelId;
}

// ─── 发布 ────────────────────────────────────────────────────────────────────

/** 广播：发布一条全员可见的频道消息，并实时推送给所有用户 */
export async function publishBroadcast(channelId: number, input: PublishInput): Promise<ChannelMessage> {
  const [row] = await db.insert(channelMessages).values({
    channelId,
    audienceType: 'broadcast',
    type: input.type,
    title: input.title ?? null,
    content: input.content,
    extra: input.extra ?? null,
    publishedById: input.publishedById ?? null,
  }).returning();

  const msg = mapChannelMessage(row, false);
  const allUsers = await db.select({ userId: users.id }).from(users);
  scheduleSendToUsers(allUsers, { type: 'channel:message', payload: msg });
  return msg;
}

/** 定向：发布一条仅指定用户可见的频道消息，写入收件人并实时推送 */
export async function publishTargeted(
  channelId: number,
  userIds: number[],
  input: PublishInput,
): Promise<ChannelMessage | null> {
  const unique = [...new Set(userIds)].filter((id) => id > 0);
  if (unique.length === 0) return null;

  const [row] = await db.insert(channelMessages).values({
    channelId,
    audienceType: 'targeted',
    type: input.type,
    title: input.title ?? null,
    content: input.content,
    extra: input.extra ?? null,
    publishedById: input.publishedById ?? null,
  }).returning();

  await db.insert(channelMessageTargets).values(unique.map((userId) => ({ messageId: row.id, userId })));

  const msg = mapChannelMessage(row, false);
  scheduleSendToUsers(unique.map((userId) => ({ userId })), { type: 'channel:message', payload: msg });
  return msg;
}

// ─── 查询（HTTP 上下文） ───────────────────────────────────────────────────────

async function buildChannelView(ch: ChannelRow, userId: number, isSubscribed: boolean): Promise<Channel> {
  const sub = await db.query.channelSubscriptions.findFirst({
    where: and(eq(channelSubscriptions.channelId, ch.id), eq(channelSubscriptions.userId, userId)),
  });
  const lastReadAt = sub?.lastReadAt ?? null;

  const targetedMsgIds = db.select({ id: channelMessages.id }).from(channelMessages)
    .where(and(eq(channelMessages.channelId, ch.id), eq(channelMessages.audienceType, 'targeted'), eq(channelMessages.status, 'sent')));

  const [broadcastUnread, targetedUnread, lastRows] = await Promise.all([
    db.$count(channelMessages, and(
      eq(channelMessages.channelId, ch.id),
      eq(channelMessages.audienceType, 'broadcast'),
      eq(channelMessages.status, 'sent'),
      lastReadAt ? gt(channelMessages.createdAt, lastReadAt) : undefined,
    )),
    db.$count(channelMessageTargets, and(
      eq(channelMessageTargets.userId, userId),
      isNull(channelMessageTargets.readAt),
      inArray(channelMessageTargets.messageId, targetedMsgIds),
    )),
    db.select().from(channelMessages)
      .where(visibleMessageWhere(ch.id, userId))
      .orderBy(desc(channelMessages.id))
      .limit(1),
  ]);

  const last = lastRows[0];
  return {
    id: ch.id,
    code: ch.code,
    name: ch.name,
    avatar: ch.avatar,
    description: ch.description,
    type: ch.type,
    builtin: ch.builtin,
    status: ch.status,
    unreadCount: broadcastUnread + targetedUnread,
    lastMessage: last ? mapChannelMessage(last, true) : null,
    isMuted: sub?.isMuted ?? false,
    isSubscribed,
    tenantId: ch.tenantId,
    createdAt: formatDateTime(ch.createdAt),
    updatedAt: formatDateTime(ch.updatedAt),
  };
}

/** 我的频道列表（系统号全部强制可见 + 已订阅的运营号） */
export async function listMyChannels(): Promise<Channel[]> {
  const me = currentUser().userId;
  const subRows = await db.select({ channelId: channelSubscriptions.channelId })
    .from(channelSubscriptions).where(eq(channelSubscriptions.userId, me));
  const subscribedIds = new Set(subRows.map((r) => r.channelId));
  const chs = await db.query.channels.findMany({
    where: eq(channels.status, 'enabled'),
    orderBy: [desc(channels.builtin), channels.id],
  });
  const visible = chs.filter((ch) => ch.type === 'system' || subscribedIds.has(ch.id));
  return Promise.all(visible.map((ch) => buildChannelView(ch, me, ch.type === 'system' || subscribedIds.has(ch.id))));
}

/** 频道消息流（仅当前用户可见的消息，分页，按时间倒序） */
export async function listChannelMessages(channelId: number, page: number, pageSize: number) {
  const me = currentUser().userId;
  const sub = await db.query.channelSubscriptions.findFirst({
    where: and(eq(channelSubscriptions.channelId, channelId), eq(channelSubscriptions.userId, me)),
    columns: { lastReadAt: true },
  });
  const lastReadAt = sub?.lastReadAt ?? null;
  const where = visibleMessageWhere(channelId, me);

  const [total, rows] = await Promise.all([
    db.$count(channelMessages, where),
    db.select().from(channelMessages).where(where)
      .orderBy(desc(channelMessages.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  const targetedIds = rows.filter((r) => r.audienceType === 'targeted').map((r) => r.id);
  const readMap = new Map<number, Date | null>();
  if (targetedIds.length > 0) {
    const tg = await db.select({ messageId: channelMessageTargets.messageId, readAt: channelMessageTargets.readAt })
      .from(channelMessageTargets)
      .where(and(inArray(channelMessageTargets.messageId, targetedIds), eq(channelMessageTargets.userId, me)));
    tg.forEach((t) => readMap.set(t.messageId, t.readAt));
  }

  const list = rows.map((r) => {
    const isRead = r.audienceType === 'broadcast'
      ? (lastReadAt != null && r.createdAt <= lastReadAt)
      : (readMap.get(r.id) != null);
    return mapChannelMessage(r, isRead);
  });
  return { list, total, page, pageSize };
}

/** 标记频道已读：更新订阅已读基线 + 把定向消息收件人标记已读 */
export async function markChannelRead(channelId: number): Promise<void> {
  const me = currentUser().userId;
  const now = new Date();

  await db.insert(channelSubscriptions).values({ channelId, userId: me, lastReadAt: now })
    .onConflictDoUpdate({
      target: [channelSubscriptions.channelId, channelSubscriptions.userId],
      set: { lastReadAt: now },
    });

  const targetedMsgIds = db.select({ id: channelMessages.id }).from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.audienceType, 'targeted')));
  await db.update(channelMessageTargets).set({ readAt: now }).where(and(
    inArray(channelMessageTargets.messageId, targetedMsgIds),
    eq(channelMessageTargets.userId, me),
    isNull(channelMessageTargets.readAt),
  ));
}

/** 将某条卡片消息标记为已处理（置灰按钮 + 结果文案），并广播实时更新 */
export async function markChannelCardDone(messageId: number, statusText: string): Promise<void> {
  const row = await db.query.channelMessages.findFirst({ where: eq(channelMessages.id, messageId) });
  if (!row || row.type !== 'card') return;
  const extra = (row.extra as ChatMessageExtra | null) ?? {};
  if (!extra.card || extra.card.status === 'done') return;

  const newExtra: ChatMessageExtra = { ...extra, card: { ...extra.card, status: 'done', statusText } };
  const [updated] = await db.update(channelMessages).set({ extra: newExtra })
    .where(eq(channelMessages.id, messageId)).returning();

  const msg = mapChannelMessage(updated, false);
  if (updated.audienceType === 'broadcast') {
    const allUsers = await db.select({ userId: users.id }).from(users);
    scheduleSendToUsers(allUsers, { type: 'channel:message', payload: msg });
  } else {
    const tg = await db.select({ userId: channelMessageTargets.userId })
      .from(channelMessageTargets).where(eq(channelMessageTargets.messageId, messageId));
    scheduleSendToUsers(tg, { type: 'channel:message', payload: msg });
  }
}

/** 将某工作流任务对应的待审批卡片置灰（jsonb 包含查询定位，重启后仍可靠） */
export async function markChannelTaskCardsDone(taskId: number, statusText: string): Promise<void> {
  const match = JSON.stringify({ card: { status: 'pending', actions: [{ taskId }] } });
  const rows = await db.select({ id: channelMessages.id }).from(channelMessages)
    .where(and(eq(channelMessages.type, 'card'), sql`${channelMessages.extra} @> ${match}::jsonb`));
  for (const r of rows) {
    await markChannelCardDone(r.id, statusText);
  }
}

// ─── 管理后台 ────────────────────────────────────────────────────────────────

function mapChannelAdmin(ch: ChannelRow, subscriberCount: number, messageCount: number): ChannelAdmin {
  return {
    id: ch.id,
    code: ch.code,
    name: ch.name,
    avatar: ch.avatar,
    description: ch.description,
    type: ch.type,
    builtin: ch.builtin,
    status: ch.status,
    subscriberCount,
    messageCount,
    createdAt: formatDateTime(ch.createdAt),
    updatedAt: formatDateTime(ch.updatedAt),
  };
}

/** 系统号订阅数按全员计（懒创建订阅行不可靠），运营号按订阅表计 */
async function countSubscribers(ch: ChannelRow, userCount: number): Promise<number> {
  return ch.type === 'system'
    ? userCount
    : db.$count(channelSubscriptions, eq(channelSubscriptions.channelId, ch.id));
}

export async function listChannelsAdmin(page: number, pageSize: number, keyword?: string) {
  const where = keyword
    ? sql`(${channels.name} ILIKE ${'%' + keyword + '%'} OR ${channels.code} ILIKE ${'%' + keyword + '%'})`
    : undefined;
  const [total, rows, userCount] = await Promise.all([
    db.$count(channels, where),
    db.select().from(channels).where(where)
      .orderBy(desc(channels.builtin), channels.id)
      .limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(users),
  ]);
  const list = await Promise.all(rows.map(async (ch) => {
    const [subscriberCount, messageCount] = await Promise.all([
      countSubscribers(ch, userCount),
      db.$count(channelMessages, eq(channelMessages.channelId, ch.id)),
    ]);
    return mapChannelAdmin(ch, subscriberCount, messageCount);
  }));
  return { list, total, page, pageSize };
}

export async function createChannel(input: CreateChannelInput): Promise<ChannelAdmin> {
  try {
    const [row] = await db.insert(channels).values({
      code: input.code,
      name: input.name,
      avatar: input.avatar ?? null,
      description: input.description ?? null,
      type: 'business',
      builtin: false,
      status: 'enabled',
    }).returning();
    return mapChannelAdmin(row, 0, 0);
  } catch (err) {
    rethrowPgUniqueViolation(err, '频道 code 已存在');
    throw err;
  }
}

export async function updateChannel(id: number, input: UpdateChannelInput): Promise<ChannelAdmin> {
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, id) });
  if (!ch) throw new HTTPException(404, { message: '频道不存在' });
  const [row] = await db.update(channels).set({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.status === undefined ? {} : { status: input.status }),
  }).where(eq(channels.id, id)).returning();
  const userCount = await db.$count(users);
  const [subscriberCount, messageCount] = await Promise.all([
    countSubscribers(row, userCount),
    db.$count(channelMessages, eq(channelMessages.channelId, id)),
  ]);
  return mapChannelAdmin(row, subscriberCount, messageCount);
}

export async function deleteChannel(id: number): Promise<void> {
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, id) });
  if (!ch) throw new HTTPException(404, { message: '频道不存在' });
  if (ch.builtin) throw new HTTPException(400, { message: '内置系统号不可删除' });
  await db.delete(channels).where(eq(channels.id, id));
}

// ─── 群发受众展开 ──────────────────────────────────────────────────────────────

/** 将受众定义展开为目标用户 id 列表；mode=all 返回 null（走全员广播） */
async function resolveAudienceUserIds(audience: ChannelPublishAudienceInput): Promise<number[] | null> {
  switch (audience.mode) {
    case 'all':
      return null;
    case 'users':
      return [...new Set(audience.userIds ?? [])];
    case 'departments': {
      const ids = audience.departmentIds ?? [];
      if (ids.length === 0) return [];
      const rows = await db.select({ id: users.id }).from(users).where(inArray(users.departmentId, ids));
      return rows.map((r) => r.id);
    }
    case 'roles': {
      const ids = audience.roleIds ?? [];
      if (ids.length === 0) return [];
      const rows = await db.select({ userId: userRoles.userId }).from(userRoles).where(inArray(userRoles.roleId, ids));
      return [...new Set(rows.map((r) => r.userId))];
    }
    default:
      return null;
  }
}

/** 预估群发受众触达人数（all=全员数；其余=展开去重后的用户数） */
export async function estimateAudience(audience: ChannelPublishAudienceInput): Promise<number> {
  const ids = await resolveAudienceUserIds(audience);
  if (ids === null) return db.$count(users);
  return new Set(ids).size;
}

/** 由群发入参构造底层消息载荷（type + content + extra） */
function buildPublishPayload(input: PublishChannelInput, publishedById: number): PublishInput {
  if (input.type === 'image') {
    return { type: 'image', title: null, content: (input.imageUrl ?? '').trim(), extra: null, publishedById };
  }
  if (input.type === 'news') {
    const card: ChatCard = {
      title: (input.title ?? '').trim(),
      text: input.summary ?? null,
      cover: input.cover ?? null,
      actions: input.linkUrl ? [{ key: 'open', label: '查看详情', action: 'link', url: input.linkUrl }] : null,
      source: '图文',
      status: null,
    };
    return { type: 'news', title: card.title, content: input.content || input.summary || '', extra: { card }, publishedById };
  }
  return { type: 'text', title: input.title ?? null, content: input.content, extra: null, publishedById };
}

/** 管理员群发：文本/图片/图文 + 受众(全员/用户/部门/角色) + 立即/定时/草稿 */
export async function publishToChannel(id: number, input: PublishChannelInput): Promise<ChannelMessage> {
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, id) });
  if (!ch) throw new HTTPException(404, { message: '频道不存在' });
  const me = currentUser();
  const payload = buildPublishPayload(input, me.userId);

  if (input.sendMode !== 'now') {
    return saveDeferredMessage(id, input, payload);
  }
  if (input.audience.mode === 'all') {
    return publishBroadcast(id, payload);
  }
  const userIds = await resolveAudienceUserIds(input.audience);
  const msg = await publishTargeted(id, userIds ?? [], payload);
  if (!msg) throw new HTTPException(400, { message: '目标受众为空，无法发送' });
  return msg;
}

// ─── 草稿 / 定时群发 ────────────────────────────────────────────────────────────

/** 写入一条草稿/定时消息（不投递；定时由扫描任务到点发布） */
async function saveDeferredMessage(channelId: number, input: PublishChannelInput, payload: PublishInput): Promise<ChannelMessage> {
  const audienceType = input.audience.mode === 'all' ? 'broadcast' : 'targeted';
  const scheduledAt = input.sendMode === 'scheduled' ? parseDateTimeInput(input.scheduledAt) : null;
  const [row] = await db.insert(channelMessages).values({
    channelId,
    audienceType,
    type: payload.type,
    title: payload.title ?? null,
    content: payload.content,
    extra: payload.extra ?? null,
    publishedById: payload.publishedById ?? null,
    status: input.sendMode === 'draft' ? 'draft' : 'scheduled',
    scheduledAt,
    targetSpec: input.audience,
  }).returning();
  return mapChannelMessage(row, false);
}

/** 真正投递一条延迟消息：改 sent + 写 targets + WS 推送 */
async function deliverDeferredRow(row: ChannelMessageRow): Promise<void> {
  await db.update(channelMessages).set({ status: 'sent' }).where(eq(channelMessages.id, row.id));
  const msg = mapChannelMessage({ ...row, status: 'sent' }, false);
  if (row.audienceType === 'broadcast') {
    const allUsers = await db.select({ userId: users.id }).from(users);
    scheduleSendToUsers(allUsers, { type: 'channel:message', payload: msg });
    return;
  }
  const spec = (row.targetSpec as ChannelPublishAudienceInput | null) ?? { mode: 'all' };
  const userIds = [...new Set((await resolveAudienceUserIds(spec)) ?? [])].filter((x) => x > 0);
  if (userIds.length > 0) {
    await db.insert(channelMessageTargets).values(userIds.map((userId) => ({ messageId: row.id, userId })));
    scheduleSendToUsers(userIds.map((userId) => ({ userId })), { type: 'channel:message', payload: msg });
  }
}

/** 系统定时任务：扫描到期的定时消息并发布（registerSystemRecurringJob 每分钟触发） */
export async function publishDueScheduledMessages(): Promise<void> {
  const due = await db.query.channelMessages.findMany({
    where: and(eq(channelMessages.status, 'scheduled'), lte(channelMessages.scheduledAt, new Date())),
    orderBy: [channelMessages.scheduledAt],
    limit: 50,
  });
  for (const row of due) {
    try {
      await deliverDeferredRow(row);
    } catch (err) {
      logger.error(`channel scheduled publish failed (msg ${row.id}):`, err);
    }
  }
}

// ─── 消息记录管理（已发 / 草稿 / 定时） ────────────────────────────────────────

/** 管理端：某频道的群发消息记录列表（direction=out，含已发/草稿/定时） */
export async function listChannelMessageRecords(
  channelId: number,
  page: number,
  pageSize: number,
  status?: 'sent' | 'draft' | 'scheduled',
): Promise<PaginatedResponse<ChannelMessage>> {
  const where = and(
    eq(channelMessages.channelId, channelId),
    eq(channelMessages.direction, 'out'),
    status ? eq(channelMessages.status, status) : undefined,
  );
  const [total, rows] = await Promise.all([
    db.$count(channelMessages, where),
    db.select().from(channelMessages).where(where)
      .orderBy(desc(channelMessages.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((r) => mapChannelMessage(r, true)), total, page, pageSize };
}

/** 取出一条可编辑的延迟消息（草稿/定时），已发拒绝 */
async function ensureDeferredMessage(messageId: number): Promise<ChannelMessageRow> {
  const row = await db.query.channelMessages.findFirst({ where: eq(channelMessages.id, messageId) });
  if (!row) throw new HTTPException(404, { message: '消息不存在' });
  if (row.status === 'sent') throw new HTTPException(400, { message: '已发送的消息不可修改' });
  return row;
}

/** 编辑草稿/定时消息 */
export async function updateDeferredMessage(messageId: number, input: PublishChannelInput): Promise<ChannelMessage> {
  const row = await ensureDeferredMessage(messageId);
  const me = currentUser();
  const payload = buildPublishPayload(input, me.userId);
  const audienceType = input.audience.mode === 'all' ? 'broadcast' : 'targeted';
  const scheduledAt = input.sendMode === 'scheduled' ? parseDateTimeInput(input.scheduledAt) : null;
  const [updated] = await db.update(channelMessages).set({
    audienceType,
    type: payload.type,
    title: payload.title ?? null,
    content: payload.content,
    extra: payload.extra ?? null,
    status: input.sendMode === 'draft' ? 'draft' : 'scheduled',
    scheduledAt,
    targetSpec: input.audience,
  }).where(eq(channelMessages.id, row.id)).returning();
  return mapChannelMessage(updated, false);
}

/** 删除草稿 / 取消定时 */
export async function deleteDeferredMessage(messageId: number): Promise<void> {
  await ensureDeferredMessage(messageId);
  await db.delete(channelMessages).where(eq(channelMessages.id, messageId));
}

/** 立即发送一条草稿/定时消息 */
export async function publishDeferredMessageNow(messageId: number): Promise<ChannelMessage> {
  const row = await ensureDeferredMessage(messageId);
  await deliverDeferredRow(row);
  const sent = await db.query.channelMessages.findFirst({ where: eq(channelMessages.id, messageId) });
  return mapChannelMessage(sent!, true);
}

// ─── 订阅（运营号） ───────────────────────────────────────────────────────────

export async function subscribeChannel(channelId: number): Promise<boolean> {
  const me = currentUser().userId;
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!ch) throw new HTTPException(404, { message: '频道不存在' });
  if (ch.type === 'system') throw new HTTPException(400, { message: '系统号默认全员订阅，无需操作' });
  const inserted = await db.insert(channelSubscriptions)
    .values({ channelId, userId: me, lastReadAt: null })
    .onConflictDoNothing()
    .returning({ channelId: channelSubscriptions.channelId });
  // 返回是否为首次订阅，由路由层据此触发「关注欢迎语」自动回复
  return inserted.length > 0;
}

export async function unsubscribeChannel(channelId: number): Promise<void> {
  const me = currentUser().userId;
  const ch = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!ch) throw new HTTPException(404, { message: '频道不存在' });
  if (ch.type === 'system') throw new HTTPException(400, { message: '系统号不可退订' });
  await db.delete(channelSubscriptions).where(and(
    eq(channelSubscriptions.channelId, channelId),
    eq(channelSubscriptions.userId, me),
  ));
}

/** 可发现（未订阅）的运营号列表 */
export async function listDiscoverableChannels(keyword?: string): Promise<Channel[]> {
  const me = currentUser().userId;
  const subRows = await db.select({ channelId: channelSubscriptions.channelId })
    .from(channelSubscriptions).where(eq(channelSubscriptions.userId, me));
  const subscribedIds = new Set(subRows.map((r) => r.channelId));
  const kw = keyword?.trim();
  const chs = await db.query.channels.findMany({
    where: and(
      eq(channels.status, 'enabled'),
      eq(channels.type, 'business'),
      kw
        ? sql`(${channels.name} ILIKE ${'%' + escapeLike(kw) + '%'} OR ${channels.description} ILIKE ${'%' + escapeLike(kw) + '%'})`
        : undefined,
    ),
    orderBy: [channels.id],
  });
  const discoverable = chs.filter((ch) => !subscribedIds.has(ch.id));
  return Promise.all(discoverable.map((ch) => buildChannelView(ch, me, false)));
}
