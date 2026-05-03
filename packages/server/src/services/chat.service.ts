import { eq, and, desc, sql, inArray, or, ne, max } from 'drizzle-orm';
import { db } from '../db';
import {
  chatConversations, chatConversationMembers, chatMessages, users,
} from '../db/schema';
import { sendToUser } from '../lib/ws-manager';
import { currentUser } from '../lib/context';
import { formatDateTime } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { HTTPException } from 'hono/http-exception';
import type {
  SendChatMessageInput, ChatMessage, ChatConversation, ChatLinkPreview, ChatMessageExtra,
} from '@zenith/shared';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function validatePreviewUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HTTPException(400, { message: '链接格式无效' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HTTPException(400, { message: '仅支持 http/https 链接' });
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '::1'
    || host === '[::1]'
    || host.endsWith('.local')
    || isPrivateIpv4(host)
  ) {
    throw new HTTPException(400, { message: '不支持内网地址预览' });
  }

  return parsed;
}

function inferImageUrl(parsed: URL): string | null {
  return IMAGE_EXT_RE.test(parsed.pathname) ? parsed.toString() : null;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');
}

function stripTags(input: string): string {
  return input.replaceAll(/<[^>]*>/g, '').replaceAll(/\s+/g, ' ').trim();
}

function pickMeta(html: string, attrs: Array<{ key: string; value: string }>): string | null {
  for (const { key, value } of attrs) {
    const pattern = new RegExp(`<meta[^>]*${key}=["']${value}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
    const patternSwap = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${key}=["']${value}["'][^>]*>`, 'i');
    const hit = pattern.exec(html) ?? patternSwap.exec(html);
    if (hit?.[1]) return decodeHtmlEntities(hit[1].trim());
  }
  return null;
}

function pickTitle(html: string): string | null {
  const hit = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!hit?.[1]) return null;
  const text = stripTags(decodeHtmlEntities(hit[1]));
  return text.length > 0 ? text : null;
}

function pickFavicon(html: string): string | null {
  const hit = /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i.exec(html);
  return hit?.[1] ? decodeHtmlEntities(hit[1].trim()) : null;
}

function pickFirstImage(html: string): string | null {
  const hit = /<img[^>]*src=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<img[^>]*src=([^\s>]+)[^>]*>/i.exec(html);
  return hit?.[1] ? decodeHtmlEntities(hit[1].trim()) : null;
}

function toAbsUrl(raw: string | null, base: URL): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

export async function getLinkPreview(rawUrl: string): Promise<ChatLinkPreview> {
  const parsed = validatePreviewUrl(rawUrl.trim());
  const directImage = inferImageUrl(parsed);
  const fallback: ChatLinkPreview = {
    url: parsed.toString(),
    title: parsed.hostname,
    description: null,
    siteName: parsed.hostname,
    image: directImage,
    favicon: null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(parsed, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'ZenithAdminLinkPreviewBot/1.0',
      },
    });

    if (!resp.ok) return fallback;
    const contentType = resp.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.startsWith('image/')) {
      return { ...fallback, image: parsed.toString(), title: parsed.pathname.split('/').pop() || parsed.hostname };
    }
    if (!contentType.includes('text/html')) return fallback;

    const htmlRaw = await resp.text();
    const html = htmlRaw.slice(0, 300_000);

    const siteName = pickMeta(html, [
      { key: 'property', value: 'og:site_name' },
      { key: 'name', value: 'application-name' },
    ]) ?? parsed.hostname;

    const title = pickMeta(html, [
      { key: 'property', value: 'og:title' },
      { key: 'name', value: 'twitter:title' },
    ]) ?? pickTitle(html) ?? parsed.hostname;

    const description = pickMeta(html, [
      { key: 'property', value: 'og:description' },
      { key: 'name', value: 'description' },
      { key: 'name', value: 'twitter:description' },
    ]);

    const image = toAbsUrl(
      pickMeta(html, [
        { key: 'property', value: 'og:image' },
        { key: 'property', value: 'og:image:url' },
        { key: 'property', value: 'og:image:secure_url' },
        { key: 'name', value: 'twitter:image' },
        { key: 'name', value: 'twitter:image:src' },
        { key: 'name', value: 'image' },
      ]),
      parsed,
    ) ?? toAbsUrl(pickFirstImage(html), parsed) ?? directImage;

    const favicon = toAbsUrl(pickFavicon(html), parsed);

    return {
      url: parsed.toString(),
      title: title.trim(),
      description: description?.trim() ?? null,
      siteName: siteName?.trim() ?? null,
      image,
      favicon,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapChatMessage(
  row: typeof chatMessages.$inferSelect,
  sender?: { id: number; nickname: string; avatar: string | null } | null,
): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderName: sender?.nickname ?? null,
    senderAvatar: sender?.avatar ?? null,
    type: row.type as ChatMessage['type'],
    content: row.content,
    replyToId: row.replyToId,
    isRecalled: row.isRecalled,
    extra: (row.extra as ChatMessageExtra | null) ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 会话列表 ─────────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ChatConversation[]> {
  const me = currentUser();

  // 拿当前用户参与的所有会话
  const memberRows = await db
    .select({
      conversationId: chatConversationMembers.conversationId,
      lastReadAt: chatConversationMembers.lastReadAt,
      isPinned: chatConversationMembers.isPinned,
      isStarred: chatConversationMembers.isStarred,
    })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.userId, me.userId));

  if (memberRows.length === 0) return [];

  const convIds = memberRows.map((r) => r.conversationId);
  const lastReadMap = new Map(memberRows.map((r) => [r.conversationId, r.lastReadAt]));
  const pinnedMap = new Map(memberRows.map((r) => [r.conversationId, r.isPinned]));
  const starredMap = new Map(memberRows.map((r) => [r.conversationId, r.isStarred]));

  // 批量拉取会话基本信息
  const convRows = await db
    .select()
    .from(chatConversations)
    .where(inArray(chatConversations.id, convIds));

  // 批量拉取每个会话的最后一条消息（子查询先找最大 id 再 join）
  const latestMsgIdSub = db
    .select({
      conversationId: chatMessages.conversationId,
      latestId: max(chatMessages.id).as('latest_id'),
    })
    .from(chatMessages)
    .where(inArray(chatMessages.conversationId, convIds))
    .groupBy(chatMessages.conversationId)
    .as('latest_msg_id');

  const latestMsgRows = await db
    .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
    .from(latestMsgIdSub)
    .innerJoin(
      chatMessages,
      eq(chatMessages.id, latestMsgIdSub.latestId),
    )
    .leftJoin(users, eq(chatMessages.senderId, users.id));

  const latestMsgMap = new Map(
    latestMsgRows.map((r) => [
      r.msg.conversationId,
      mapChatMessage(r.msg, r.msg.senderId ? { id: r.msg.senderId, nickname: r.nickname ?? '', avatar: r.avatar ?? null } : null),
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
      })
      .from(chatConversationMembers)
      .innerJoin(users, eq(chatConversationMembers.userId, users.id))
      .where(and(
        inArray(chatConversationMembers.conversationId, directConvIds),
        ne(chatConversationMembers.userId, me.userId),
      ))
    : [];

  const directTargetMap = new Map(
    directTargetRows.map((r) => [r.conversationId, { id: r.id, nickname: r.nickname, avatar: r.avatar }]),
  );

  // 批量拉取消息时间（用于本地计算未读，避免逐会话 count 查询）
  const msgTimeRows = await db
    .select({
      conversationId: chatMessages.conversationId,
      senderId: chatMessages.senderId,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(inArray(chatMessages.conversationId, convIds));

  const unreadMap = new Map<number, number>();
  for (const row of msgTimeRows) {
    if (row.senderId === me.userId) continue;
    const lastReadAt = lastReadMap.get(row.conversationId) ?? null;
    if (!lastReadAt || row.createdAt > lastReadAt) {
      unreadMap.set(row.conversationId, (unreadMap.get(row.conversationId) ?? 0) + 1);
    }
  }

  const results: ChatConversation[] = convRows.map((conv) => ({
    id: conv.id,
    type: conv.type as ChatConversation['type'],
    name: conv.name,
    targetUser: conv.type === 'direct' ? (directTargetMap.get(conv.id) ?? null) : null,
    lastMessage: latestMsgMap.get(conv.id) ?? null,
    unreadCount: unreadMap.get(conv.id) ?? 0,
    isPinned: pinnedMap.get(conv.id) ?? false,
    isStarred: starredMap.get(conv.id) ?? false,
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
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    columns: { id: true, nickname: true, avatar: true },
  });
  if (!targetUser) throw new HTTPException(404, { message: '用户不存在' });

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
    createdById: me.userId,
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
    isPinned: false,
    isStarred: false,
    createdAt: formatDateTime(conv.createdAt),
    updatedAt: formatDateTime(conv.updatedAt),
  };
}

// ─── 置顶 / 取消置顶 ────────────────────────────────────────────────────────

export async function pinConversation(conversationId: number, pin: boolean): Promise<void> {
  const me = currentUser();
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(403, { message: '无权操作该会话' });
  await db.update(chatConversationMembers)
    .set({ isPinned: pin })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ));
}

// ─── 标记星标 / 取消星标 ──────────────────────────────────────────────────

export async function starConversation(conversationId: number, star: boolean): Promise<void> {
  const me = currentUser();
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(403, { message: '无权操作该会话' });
  await db.update(chatConversationMembers)
    .set({ isStarred: star })
    .where(and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ));
}

// ─── 消息列表（分页） ─────────────────────────────────────────────────────────

export async function listMessages(conversationId: number, page: number, pageSize: number) {
  const me = currentUser();

  // 鉴权：确认当前用户是会话成员
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(403, { message: '无权访问该会话' });

  const [total, rows] = await Promise.all([
    db.$count(chatMessages, eq(chatMessages.conversationId, conversationId)),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  const list = rows.map((r) =>
    mapChatMessage(r.msg, r.msg.senderId ? { id: r.msg.senderId, nickname: r.nickname ?? '', avatar: r.avatar ?? null } : null),
  );

  return { list, total, page, pageSize };
}

// ─── 发送消息 ─────────────────────────────────────────────────────────────────

export async function sendMessage(conversationId: number, input: SendChatMessageInput): Promise<ChatMessage> {
  const me = currentUser();

  // 鉴权：确认当前用户是会话成员
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(403, { message: '无权向该会话发送消息' });

  const sender = await db.query.users.findFirst({
    where: eq(users.id, me.userId),
    columns: { id: true, nickname: true, avatar: true },
  });

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

  const msg = mapChatMessage(row, sender ?? null);

  // 推送给会话内所有成员（含发送者——方便多端同步）
  const members = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId));

  for (const { userId } of members) {
    sendToUser(userId, { type: 'chat:message', payload: msg });
  }

  return msg;
}

// ─── 撤回消息 ─────────────────────────────────────────────────────────────────

export async function recallMessage(messageId: number): Promise<void> {
  const me = currentUser();

  const msg = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  });
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
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
  const members = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, msg.conversationId));

  for (const { userId } of members) {
    sendToUser(userId, { type: 'chat:recall', payload: { conversationId: msg.conversationId, messageId } });
  }
}

// ─── 标记已读 ─────────────────────────────────────────────────────────────────

export async function markConversationRead(conversationId: number): Promise<void> {
  const me = currentUser();

  await db.update(chatConversationMembers)
    .set({ lastReadAt: new Date() })
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

  for (const { userId } of members) {
    sendToUser(userId, { type: 'chat:read', payload: { conversationId, userId: me.userId } });
  }
}

// ─── 创建群聊 ──────────────────────────────────────────────────────────────────

export async function createGroupConversation(name: string): Promise<ChatConversation> {
  const me = currentUser();

  const [conv] = await db.insert(chatConversations).values({
    type: 'group',
    name,
    createdById: me.userId,
    tenantId: me.tenantId,
  }).returning();

  await db.insert(chatConversationMembers).values([
    { conversationId: conv.id, userId: me.userId },
  ]);

  return {
    id: conv.id,
    type: 'group',
    name: conv.name,
    targetUser: null,
    lastMessage: null,
    unreadCount: 0,
    isPinned: false,
    isStarred: false,
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
  if (!conv) throw new HTTPException(404, { message: '会话不存在' });
  if (conv.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能添加成员' });

  // 鉴权：操作者需是成员
  const isMember = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!isMember) throw new HTTPException(403, { message: '无权操作该群聊' });

  // 成员上限
  const memberCount = await db.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conversationId));
  if (memberCount >= 20) throw new HTTPException(400, { message: '群成员已达上限（20人）' });

  // 目标用户存在校验
  const target = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    columns: { id: true, nickname: true, avatar: true },
  });
  if (!target) throw new HTTPException(404, { message: '用户不存在' });

  // 幂等插入
  const alreadyIn = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, targetUserId),
    ),
  });
  if (alreadyIn) throw new HTTPException(400, { message: '该用户已在群聊中' });

  await db.insert(chatConversationMembers).values({ conversationId, userId: targetUserId });

  // 推送 WS 通知（群内所有成员）
  const members = await db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId));

  for (const { userId } of members) {
    sendToUser(userId, { type: 'chat:member-join', payload: { conversationId, user: target } });
  }
}

// ─── 删除/退出会话（仅对当前用户）─────────────────────────────────────────────

export async function removeConversation(conversationId: number): Promise<void> {
  const me = currentUser();

  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(404, { message: '会话不存在或无权操作' });

  await db.delete(chatConversationMembers).where(and(
    eq(chatConversationMembers.conversationId, conversationId),
    eq(chatConversationMembers.userId, me.userId),
  ));

  const remainCount = await db.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conversationId));
  if (remainCount === 0) {
    await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
  }
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
  if (!isMember) throw new HTTPException(403, { message: '无权访问该会话' });

  const rows = await db
    .select({ id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar })
    .from(chatConversationMembers)
    .innerJoin(users, eq(chatConversationMembers.userId, users.id))
    .where(eq(chatConversationMembers.conversationId, conversationId));

  return rows;
}

// ─── 获取可聊天的用户列表 ──────────────────────────────────────────────────────

export async function listChatUsers(keyword?: string) {
  const me = currentUser();

  const rows = await db
    .select({ id: users.id, nickname: users.nickname, avatar: users.avatar, username: users.username })
    .from(users)
    .where(and(
      ne(users.id, me.userId),
      eq(users.status, 'enabled'),
      me.tenantId ? eq(users.tenantId, me.tenantId) : undefined,
      keyword
        ? or(
            sql`${users.nickname} ILIKE ${'%' + keyword + '%'}`,
            sql`${users.username} ILIKE ${'%' + keyword + '%'}`,
          )
        : undefined,
    ))
    .limit(50);

  return rows;
}
