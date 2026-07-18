import { eq, and, desc, sql, inArray, or, ne, max, asc, gte, lte, lt, gt } from 'drizzle-orm';
import { db } from '../../db';
import {
  chatConversations, chatConversationMembers, chatMessages, users, chatMessageReactions,
  departments, positions, userPositions,
} from '../../db/schema';
import { scheduleSendToUsers, isUserOnline, getUserLastSeen } from '../../lib/ws-manager';
import { invalidateConversationMembers } from '../../lib/chat-member-cache';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { httpGet } from '../../lib/http-client';
import { config } from '../../config';
import { HTTPException } from 'hono/http-exception';
import type {
  SendChatMessageInput, ForwardMessagesInput, ChatMessage, ChatConversation, ChatLinkPreview, ChatMessageExtra, ChatMessageSearchResult, ChatMessageContext, ChatForwardedItem, ChatReactionGroup, ChatVoteData, ChatReadState, ChatPresence, ChatMessageType, ChatCallRecordInput, RtcConfig,
} from '@zenith/shared';

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

/** 生成排除当前用户已删除消息的 SQL 条件 */
function notHiddenFor(userId: number) {
  // to_jsonb 是多态函数，prepared statement 参数需要显式 CAST 才能正确推断类型
  return sql`NOT COALESCE(${chatMessages.extra}->'hiddenFor', '[]'::jsonb) @> to_jsonb(CAST(${userId} AS integer))`;
}

function isPrivateIpv4(ipv4: string): boolean {
  const parts = ipv4.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 共享地址
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replaceAll(/^\[|\]$/g, '');
  // IPv4 私网地址
  if (isPrivateIpv4(lower)) return true;
  // IPv6 loopback / 链路本地 / 唯一本地地址
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower.startsWith('fe80:')) return true; // 链路本地 fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.slice(7);
    if (isPrivateIpv4(ipv4)) return true;
  }
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
    || host.endsWith('.local')
    || isPrivateHost(host)
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

/** 转义字符串中的正则元字符，防止将外部值拼入 RegExp 时产生注入或 ReDoS */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function pickMeta(html: string, attrs: Array<{ key: string; value: string }>): string | null {
  for (const { key, value } of attrs) {
    const k = escapeRegExp(key);
    const v = escapeRegExp(value);
    const pattern = new RegExp(`<meta[^>]*${k}=["']${v}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
    const patternSwap = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${k}=["']${v}["'][^>]*>`, 'i');
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
    const resp = await httpGet(parsed.toString(), {
      // 解析 DNS 并逐个校验解析出的 IP（私网/保留/链路本地/云元数据地址），防 SSRF 与 DNS rebinding。
      // 开启后 http-client 会强制 redirect:'error'，任何跳转都会抛错并被下方 catch 兜底为 fallback，
      // 从而堵死"重定向跳内网"这类绕过。
      ssrfProtection: true,
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
    extra: row.extra ?? null,
    reactions,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 联表查询行中的发送人信息（senderId 为空时返回 null，供 mapChatMessage 使用） */
function rowSender(r: { msg: { senderId: number | null }; nickname: string | null; avatar: string | null }) {
  return r.msg.senderId
    ? { id: r.msg.senderId, nickname: r.nickname ?? '', avatar: r.avatar ?? null }
    : null;
}

/** 按 id 加载用户的展示信息（昵称/头像） */
function fetchUserBrief(userId: number) {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, nickname: true, avatar: true },
  });
}

/** 会话全部成员的 userId 列表（用于 WS 推送） */
function listConversationMemberIds(conversationId: number) {
  return db
    .select({ userId: chatConversationMembers.userId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.conversationId, conversationId));
}

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

async function ensureConversationMember(conversationId: number) {
  const me = currentUser();
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(403, { message: '无权访问该会话' });
  return member;
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

async function getUserNickname(userId: number): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { nickname: true },
  });
  return user?.nickname ?? null;
}

async function ensureMessageAccessible(messageId: number) {
  const msg = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, messageId) });
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
  await ensureConversationMember(msg.conversationId);
  return msg;
}

function normalizeMessageExtra(extra: unknown): ChatMessageExtra {
  return (extra as ChatMessageExtra | null) ?? {};
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
      isMuted: chatConversationMembers.isMuted,
      isArchived: chatConversationMembers.isArchived,
      role: chatConversationMembers.role,
      mutedUntil: chatConversationMembers.mutedUntil,
    })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.userId, me.userId));

  if (memberRows.length === 0) return [];

  const convIds = memberRows.map((r) => r.conversationId);
  const lastReadMap = new Map(memberRows.map((r) => [r.conversationId, r.lastReadAt]));
  const pinnedMap = new Map(memberRows.map((r) => [r.conversationId, r.isPinned]));
  const starredMap = new Map(memberRows.map((r) => [r.conversationId, r.isStarred]));
  const mutedMap = new Map(memberRows.map((r) => [r.conversationId, r.isMuted]));
  const archivedMap = new Map(memberRows.map((r) => [r.conversationId, r.isArchived]));
  const myRoleMap = new Map(memberRows.map((r) => [r.conversationId, r.role]));
  const myMutedUntilMap = new Map(memberRows.map((r) => [r.conversationId, r.mutedUntil]));

  // 批量拉取会话基本信息 & 最后消息 & 消息时间（三者都只依赖 convIds，并行执行）
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

  const [convRows, latestMsgRows, msgTimeRows] = await Promise.all([
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
        conversationId: chatMessages.conversationId,
        senderId: chatMessages.senderId,
        createdAt: chatMessages.createdAt,
        extra: chatMessages.extra,
      })
      .from(chatMessages)
      .where(inArray(chatMessages.conversationId, convIds)),
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

  const unreadMap = new Map<number, number>();
  const mentionUnreadMap = new Map<number, boolean>();
  for (const row of msgTimeRows) {
    if (row.senderId === me.userId) continue;
    const lastReadAt = lastReadMap.get(row.conversationId) ?? null;
    if (!lastReadAt || row.createdAt > lastReadAt) {
      unreadMap.set(row.conversationId, (unreadMap.get(row.conversationId) ?? 0) + 1);
      const extra = row.extra as ChatMessageExtra | null;
      if ((extra?.mentions ?? []).some((item) => item.userId === me.userId)) {
        mentionUnreadMap.set(row.conversationId, true);
      }
    }
  }

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
  if (!targetUserRow) throw new HTTPException(404, { message: '用户不存在' });
  const targetUser = {
    id: targetUserRow.id,
    nickname: targetUserRow.nickname,
    avatar: targetUserRow.avatar,
    phone: targetUserRow.phone ?? null,
    email: targetUserRow.email ?? null,
    departmentName: targetUserRow.department?.name ?? null,
    positionNames: (targetUserRow.userPositions as Array<{ position: { name: string } }>).map((up) => up.position.name),
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
  if (!updated) throw new HTTPException(403, { message: '无权操作该会话' });
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
  if (!updated) throw new HTTPException(403, { message: '无权操作该会话' });
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
  if (!updated) throw new HTTPException(403, { message: '无权操作该会话' });
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
  if (!updated) throw new HTTPException(403, { message: '无权操作该会话' });
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
  const [reactionMap, replySnapshotMap] = await Promise.all([
    aggregateReactions(msgIds),
    fetchReplySnapshotMap(limited.map((r) => ({ replyToId: r.msg.replyToId }))),
  ]);

  const list = limited.map((r) =>
    mapChatMessage(
      r.msg,
      rowSender(r),
      reactionMap.get(r.msg.id) ?? [],
      r.msg.replyToId ? (replySnapshotMap.get(r.msg.replyToId) ?? null) : null,
    ),
  );

  return { list, hasMore };
}

export async function listPinnedMessages(conversationId: number): Promise<ChatMessage[]> {
  await ensureConversationMember(conversationId);

  const rows = await db
    .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
    .from(chatMessages)
    .leftJoin(users, eq(chatMessages.senderId, users.id))
    .where(and(
      eq(chatMessages.conversationId, conversationId),
      sql`COALESCE((${chatMessages.extra} ->> 'isPinned')::boolean, false) = true`,
    ))
    .orderBy(desc(chatMessages.updatedAt), desc(chatMessages.id))
    .limit(5);

  return rows.map((r) => mapChatMessage(
    r.msg,
    rowSender(r),
  ));
}

export async function listFavoriteMessages(conversationId: number, page: number, pageSize: number) {
  await ensureConversationMember(conversationId);

  const where = and(
    eq(chatMessages.conversationId, conversationId),
    sql`COALESCE((${chatMessages.extra} ->> 'isFavorited')::boolean, false) = true`,
  );

  const [total, rows] = await Promise.all([
    db.$count(chatMessages, where),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  return {
    list: rows.map((r) => mapChatMessage(
      r.msg,
      rowSender(r),
    )),
    total,
    page,
    pageSize,
  };
}

export async function listGlobalFavoriteMessages(page: number, pageSize: number) {
  const me = currentUser();

  const where = and(
    eq(chatConversationMembers.userId, me.userId),
    sql`COALESCE((${chatMessages.extra} ->> 'isFavorited')::boolean, false) = true`,
  );

  const [countRows, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(chatConversationMembers, eq(chatConversationMembers.conversationId, chatMessages.conversationId))
      .where(where),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .innerJoin(chatConversationMembers, eq(chatConversationMembers.conversationId, chatMessages.conversationId))
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessages.updatedAt), desc(chatMessages.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  return {
    list: rows.map((r) => mapChatMessage(
      r.msg,
      rowSender(r),
    )),
    total: Number(countRows[0]?.count ?? 0),
    page,
    pageSize,
  };
}

export async function toggleMessageFavorite(messageId: number, favorite: boolean): Promise<ChatMessage> {
  const msg = await ensureMessageAccessible(messageId);
  const nextExtra: ChatMessageExtra = { ...normalizeMessageExtra(msg.extra), isFavorited: favorite };
  const [updated] = await db.update(chatMessages)
    .set({ extra: nextExtra, updatedAt: new Date() })
    .where(eq(chatMessages.id, messageId))
    .returning();

  const sender = updated.senderId
    ? await fetchUserBrief(updated.senderId)
    : null;
  return mapChatMessage(updated, sender ?? null);
}

export async function toggleMessagePin(messageId: number, pin: boolean): Promise<ChatMessage> {
  const msg = await ensureMessageAccessible(messageId);
  const nextExtra: ChatMessageExtra = { ...normalizeMessageExtra(msg.extra), isPinned: pin };
  const [updated] = await db.update(chatMessages)
    .set({ extra: nextExtra, updatedAt: new Date() })
    .where(eq(chatMessages.id, messageId))
    .returning();

  const sender = updated.senderId
    ? await fetchUserBrief(updated.senderId)
    : null;
  return mapChatMessage(updated, sender ?? null);
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
  if (!conv) throw new HTTPException(404, { message: '会话不存在' });
  if (conv.type !== 'group') throw new HTTPException(400, { message: '只有群聊才有公告历史' });

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
    keyword
      ? or(
          ...(() => { const p = `%${keyword}%`; return [
            sql`${chatMessages.content} ILIKE ${p}`,
            sql`COALESCE(${users.nickname}, '') ILIKE ${p}`,
            sql`COALESCE(${users.username}, '') ILIKE ${p}`,
            sql`COALESCE(${chatMessages.extra} -> 'asset' ->> 'name', '') ILIKE ${p}`,
          ]; })(),
        )
      : undefined,
  );

  const [countRows, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where),
    db
      .select({ msg: chatMessages, nickname: users.nickname, avatar: users.avatar })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(params.pageSize)
      .offset(pageOffset(params.page, params.pageSize)),
  ]);

  const list = rows.map((r) => {
    const message = mapChatMessage(
      r.msg,
      rowSender(r),
    );
    return {
      message,
      snippet: buildMessageSearchSnippet(message),
    };
  });

  return {
    list,
    total: Number(countRows[0]?.count ?? 0),
    page: params.page,
    pageSize: params.pageSize,
  };
}

// ─── 消息上下文定位 ─────────────────────────────────────────────────────────

export async function getMessageContext(
  conversationId: number,
  messageId: number,
  before = 15,
  after = 15,
): Promise<ChatMessageContext> {
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

  if (target.length === 0) throw new HTTPException(404, { message: '消息不存在' });

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
    ...target,
    ...afterRows,
  ];
  const msgIds = allRows.map((r) => r.msg.id);
  const [reactionMap, replySnapshotMap] = await Promise.all([
    aggregateReactions(msgIds),
    fetchReplySnapshotMap(allRows.map((r) => ({ replyToId: r.msg.replyToId }))),
  ]);

  const list = allRows.map((r) => mapChatMessage(
    r.msg,
    rowSender(r),
    reactionMap.get(r.msg.id) ?? [],
    r.msg.replyToId ? (replySnapshotMap.get(r.msg.replyToId) ?? null) : null,
  ));

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

export async function sendMessage(conversationId: number, input: SendChatMessageInput): Promise<ChatMessage> {
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
  if (!member) throw new HTTPException(403, { message: '无权向该会话发送消息' });

  // 禁言校验：个人禁言优先，全员禁言豁免群主/管理员
  if (member.mutedUntil && member.mutedUntil > new Date()) {
    throw new HTTPException(403, { message: '你已被禁言，暂时无法发言' });
  }
  if (conv?.muteAll && member.role === 'member') {
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

  // 批量更新 extra.hiddenFor，追加当前用户 ID
  await Promise.all(msgs.map(async (msg) => {
    const extra = normalizeMessageExtra(msg.extra);
    const hiddenFor = extra.hiddenFor ?? [];
    if (hiddenFor.includes(me.userId)) return;
    const nextExtra: ChatMessageExtra = { ...extra, hiddenFor: [...hiddenFor, me.userId] };
    await db.update(chatMessages)
      .set({ extra: nextExtra, updatedAt: new Date() })
      .where(eq(chatMessages.id, msg.id));
  }));
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
  const members = await listConversationMemberIds(msg.conversationId);

  scheduleSendToUsers(members, { type: 'chat:recall', payload: { conversationId: msg.conversationId, messageId } });
}

// ─── 编辑消息 ─────────────────────────────────────────────────────────────────

export async function editMessage(messageId: number, content: string): Promise<ChatMessage> {
  const me = currentUser();

  const msg = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  });
  if (!msg) throw new HTTPException(404, { message: '消息不存在' });
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

// ─── 在线状态：批量查询用户在线/最近在线 ───────────────────────────────────────

export function getPresenceForUsers(userIds: number[]): ChatPresence[] {
  const unique = [...new Set(userIds)];
  return unique.map((userId) => {
    const online = isUserOnline(userId);
    const lastSeenMs = online ? null : getUserLastSeen(userId);
    return {
      userId,
      online,
      lastSeen: lastSeenMs ? formatDateTime(new Date(lastSeenMs)) : null,
    };
  });
}

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
  const target = await fetchUserBrief(targetUserId);
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
  invalidateConversationMembers(conversationId);

  await appendSystemMessage(conversationId, `${target.nickname} 加入了群聊`);

  // 推送 WS 通知（群内所有成员）
  const members = await listConversationMemberIds(conversationId);

  scheduleSendToUsers(members, { type: 'chat:member-join', payload: { conversationId, user: target } });
}

// ─── 删除/退出会话（仅对当前用户）─────────────────────────────────────────────

export async function removeConversation(conversationId: number): Promise<void> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  const conv = await db.query.chatConversations.findFirst({ where: eq(chatConversations.id, conversationId) });
  if (!conv) throw new HTTPException(404, { message: '会话不存在或无权操作' });

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
  invalidateConversationMembers(conversationId);

  const remainCount = await db.$count(chatConversationMembers, eq(chatConversationMembers.conversationId, conversationId));
  if (conv.type === 'group' && remainCount > 0) {
    await appendSystemMessage(conversationId, `${myNickname ?? '成员'} 退出了群聊`);
  }
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

// ─── 组织架构选人数据 ─────────────────────────────────────────────────────────

export async function getChatOrgData() {
  const me = currentUser();

  const [deptRows, userRows] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name, parentId: departments.parentId })
      .from(departments)
      .where(and(
        eq(departments.status, 'enabled'),
        me.tenantId ? eq(departments.tenantId, me.tenantId) : undefined,
      ))
      .orderBy(asc(departments.sort), asc(departments.id)),
    db
      .select({
        id: users.id, nickname: users.nickname, username: users.username,
        avatar: users.avatar, departmentId: users.departmentId,
      })
      .from(users)
      .where(and(
        ne(users.id, me.userId),
        eq(users.status, 'enabled'),
        me.tenantId ? eq(users.tenantId, me.tenantId) : undefined,
      ))
      .orderBy(asc(users.id)),
  ]);

  return { departments: deptRows, users: userRows };
}

// ─── 移除群成员 ──────────────────────────────────────────────────────────────

export async function removeGroupMember(conversationId: number, targetUserId: number): Promise<void> {
  const me = currentUser();
  const myNickname = await getUserNickname(me.userId);

  const conv = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, conversationId),
  });
  if (!conv) throw new HTTPException(404, { message: '会话不存在' });
  if (conv.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能移除成员' });

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
  if (!targetMemberExists) {
    throw new HTTPException(404, { message: '该用户不在群聊中' });
  }
  if (targetMemberExists.role === 'owner') {
    throw new HTTPException(400, { message: '不能移除群主' });
  }
  if (operatorMember.role === 'admin' && targetMemberExists.role === 'admin') {
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
  if (!conv) throw new HTTPException(404, { message: '会话不存在' });
  if (conv.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能修改信息' });

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
  const nameChanged = normalizedName !== undefined && normalizedName !== (conv.name ?? null);
  const announcementChanged = normalizedAnnouncement !== undefined && normalizedAnnouncement !== (conv.announcement ?? null);

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
  if (!conv) throw new HTTPException(404, { message: '会话不存在' });
  if (conv.type !== 'group') throw new HTTPException(400, { message: '只有群聊才能转让群主' });

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
  if (!targetMember) {
    throw new HTTPException(404, { message: '目标用户不在群聊中' });
  }

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

  // 通知所有成员
  const members = await listConversationMemberIds(conversationId);

  scheduleSendToUsers(members, { type: 'chat:group-update', payload: { conversationId } });

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
  if (!conv) throw new HTTPException(404, { message: '会话不存在' });
  if (conv.type !== 'group') throw new HTTPException(400, { message: '仅群聊支持该操作' });
  return conv;
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
  if (!target) throw new HTTPException(404, { message: '该用户不在群聊中' });
  if (target.role === 'owner') throw new HTTPException(400, { message: '不能修改群主角色' });
  if (target.role === role) return;

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
  if (!target) throw new HTTPException(404, { message: '该用户不在群聊中' });
  if (target.role === 'owner') throw new HTTPException(400, { message: '不能禁言群主' });
  if (operator.role === 'admin' && target.role === 'admin') {
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
    .set({ extra: nextExtra, updatedAt: new Date() })
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
  const p = `%${keyword}%`;

  const where = and(
    // 只搜当前用户参与的会话
    eq(chatConversationMembers.userId, me.userId),
    notHiddenFor(me.userId),
    types.length > 0 ? inArray(chatMessages.type, types) : undefined,
    or(
      sql`${chatMessages.content} ILIKE ${p}`,
      sql`COALESCE(${chatMessages.extra} -> 'asset' ->> 'name', '') ILIKE ${p}`,
    ),
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

  const list = rows.map((r) => {
    const message = mapChatMessage(
      r.msg,
      rowSender(r),
    );
    return {
      message,
      snippet: buildMessageSearchSnippet(message),
    };
  });

  return {
    list,
    total: Number(countRows[0]?.count ?? 0),
    page: params.page,
    pageSize: params.pageSize,
    conversationNames,
  };
}

// ─── 机器人 / 系统消息（无请求上下文，供事件订阅器与 Webhook 调用）─────────────

// ─── 以机器人/系统身份向会话投递消息 ─────────────────────────────────────────

/**
 * 以机器人/系统身份向会话投递一条消息（无上下文、不校验成员）。
 * senderId 为用户 ID 时显示该用户身份；为 null 时由 extra.bot 提供展示身份。
 */
export async function postBotMessage(
  conversationId: number,
  senderId: number | null,
  input: { type: ChatMessageType; content: string; extra?: ChatMessageExtra | null },
): Promise<ChatMessage> {
  const [row] = await db.insert(chatMessages).values({
    conversationId,
    senderId,
    type: input.type,
    content: input.content,
    extra: input.extra ?? null,
  }).returning();

  let sender: { id: number; nickname: string; avatar: string | null } | null = null;
  if (senderId) {
    const u = await fetchUserBrief(senderId);
    if (u) sender = { id: u.id, nickname: u.nickname, avatar: u.avatar ?? null };
  }

  const [, members] = await Promise.all([
    db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, conversationId)),
    listConversationMemberIds(conversationId),
  ]);

  const msg = mapChatMessage(row, sender);
  scheduleSendToUsers(members, { type: 'chat:message', payload: msg });
  return msg;
}

/** 将某张卡片标记为已处理（置灰按钮 + 结果文案），并广播 chat:edit 实时更新 */
export async function markCardMessageDone(messageId: number, statusText: string): Promise<void> {
  const row = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, messageId) });
  if (!row || row.type !== 'card') return;
  const extra = (row.extra as ChatMessageExtra | null) ?? {};
  if (!extra.card || extra.card.status === 'done') return;

  const newExtra: ChatMessageExtra = { ...extra, card: { ...extra.card, status: 'done', statusText } };
  const [updated] = await db.update(chatMessages).set({ extra: newExtra }).where(eq(chatMessages.id, messageId)).returning();

  let sender: { id: number; nickname: string; avatar: string | null } | null = null;
  if (updated.senderId) {
    const u = await fetchUserBrief(updated.senderId);
    if (u) sender = { id: u.id, nickname: u.nickname, avatar: u.avatar ?? null };
  }

  const members = await listConversationMemberIds(updated.conversationId);
  scheduleSendToUsers(members, { type: 'chat:edit', payload: mapChatMessage(updated, sender) });
}

/**
 * 将某个工作流任务对应的待审批卡片标记为已处理。
 *
 * 通过 jsonb 包含查询按 taskId 直接从 DB 定位卡片消息，不依赖内存映射，
 * 因此服务重启后（待办创建与审批完成之间）仍能可靠置灰卡片。
 */
export async function markTaskCardsDone(taskId: number, statusText: string): Promise<void> {
  const match = JSON.stringify({ card: { status: 'pending', actions: [{ taskId }] } });
  const rows = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.type, 'card'),
      sql`${chatMessages.extra} @> ${match}::jsonb`,
    ));
  for (const r of rows) {
    await markCardMessageDone(r.id, statusText);
  }
}

// ─── WebRTC 音视频通话 ───────────────────────────────────────────────────────

/** 返回 ICE 服务器配置（STUN 默认 + 可选 TURN） */
export function getRtcConfig(): RtcConfig {
  const iceServers: RtcConfig['iceServers'] = [];
  if (config.webrtc.stunUrls.length > 0) {
    iceServers.push({ urls: config.webrtc.stunUrls });
  }
  if (config.webrtc.turnUrls.length > 0) {
    iceServers.push({
      urls: config.webrtc.turnUrls,
      username: config.webrtc.turnUsername || undefined,
      credential: config.webrtc.turnCredential || undefined,
    });
  }
  return { iceServers };
}

function buildCallRecordText(input: ChatCallRecordInput): string {
  const label = input.callType === 'video' ? '视频通话' : (input.mode === 'group' ? '群语音通话' : '语音通话');
  if (input.status === 'completed') {
    const m = Math.floor(input.durationSec / 60);
    const s = input.durationSec % 60;
    const dur = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${label}结束 · 时长 ${dur}`;
  }
  if (input.status === 'missed') return `未接听的${label}`;
  if (input.status === 'rejected') return `对方已拒绝${label}`;
  return `已取消的${label}`;
}

/** 通话结束后向会话写入一条系统消息（通话记录） */
export async function postCallRecord(conversationId: number, input: ChatCallRecordInput): Promise<void> {
  const me = currentUser();
  const member = await db.query.chatConversationMembers.findFirst({
    where: and(
      eq(chatConversationMembers.conversationId, conversationId),
      eq(chatConversationMembers.userId, me.userId),
    ),
  });
  if (!member) throw new HTTPException(403, { message: '无权访问该会话' });

  const [row] = await db.insert(chatMessages).values({
    conversationId,
    senderId: null,
    type: 'system',
    content: buildCallRecordText(input),
  }).returning();

  const [, members] = await Promise.all([
    db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, conversationId)),
    listConversationMemberIds(conversationId),
  ]);

  scheduleSendToUsers(members, { type: 'chat:message', payload: mapChatMessage(row, null) });
}
