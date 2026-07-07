import { http, HttpResponse } from 'msw';
import type { ChatMessage, ChatMessageExtra, ChatReplySnapshot } from '@zenith/shared';
import {
  mockChatConversations, mockChatUsers, getMockConvMessages,
  addMockMessage, getNextMsgId, mockChatMessages, mockGroupMembers,
} from '@/mocks/data/chat';
import { mockDepartments } from '@/mocks/data/departments';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

// 当前 demo 用户 ID（对应 admin = 1）
const CURRENT_USER_ID = 1;
const CURRENT_USER_NICKNAME = '管理员';

// ── 常用语（内存态） ──
interface MockQuickReply { id: number; content: string; sort: number; createdAt: string; updatedAt: string }
const mockQuickReplies: MockQuickReply[] = [
  { id: 1, content: '收到，我马上处理。', sort: 0, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, content: '好的，稍后同步进展。', sort: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 3, content: '这个问题我确认一下再回复你。', sort: 2, createdAt: mockDateTime(), updatedAt: mockDateTime() },
];
let nextQuickReplyId = 4;

// ── 定时消息（内存态） ──
interface MockScheduled {
  id: number; conversationId: number; conversationName: string | null;
  type: 'text'; content: string; extra: null;
  scheduledAt: string; status: 'pending' | 'sent' | 'canceled' | 'failed';
  failReason: string | null; sentMessageId: number | null;
  createdAt: string; updatedAt: string;
}
const mockScheduledMessages: MockScheduled[] = [];
let nextScheduledId = 1;

// ── 自定义表情（内存态） ──
interface MockCustomEmoji { id: number; url: string; fileId: string | null; name: string | null; width: number | null; height: number | null; createdAt: string }
const mockCustomEmojis: MockCustomEmoji[] = [];
let nextEmojiId = 1;

// ── 群邀请 / 入群申请（内存态） ──
const mockInvites: Record<number, { id: number; conversationId: number; token: string; expiresAt: string; maxUses: null; usedCount: number; enabled: boolean; createdAt: string }> = {};
let nextInviteId = 1;
interface MockJoinRequest { id: number; conversationId: number; userId: number; nickname: string; avatar: null; message: string | null; status: 'pending' | 'approved' | 'rejected'; createdAt: string }
const mockJoinRequests: MockJoinRequest[] = [];
let nextJoinRequestId = 1;

function convDisplayName(convId: number): string | null {
  const conv = mockChatConversations.find((c) => c.id === convId);
  if (!conv) return null;
  return conv.type === 'group' ? (conv.name ?? null) : (conv.targetUser?.nickname ?? null);
}

function addSystemMessage(conversationId: number, content: string) {
  const newMsg: ChatMessage = {
    id: getNextMsgId(),
    conversationId,
    senderId: null,
    senderName: null,
    senderAvatar: null,
    type: 'system',
    content,
    replyToId: null,
    replyToMessage: null,
    isRecalled: false,
    isEdited: false,
    extra: null,
    reactions: [],
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  };
  addMockMessage(newMsg);
}

export const chatHandlers = [
  // 链接预览
  http.get('/api/chat/link-preview', ({ request }) => {
    const url = new URL(request.url);
    const raw = url.searchParams.get('url');
    if (!raw) return HttpResponse.json({ code: 400, message: 'url 不能为空', data: null }, { status: 400 });

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return HttpResponse.json({ code: 400, message: '链接格式无效', data: null }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return HttpResponse.json({ code: 400, message: '仅支持 http/https 链接', data: null }, { status: 400 });
    }

    const isImageUrl = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(parsed.pathname);

    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        url: parsed.toString(),
        title: isImageUrl ? (parsed.pathname.split('/').pop() || parsed.hostname) : parsed.hostname,
        description: `这是 ${parsed.hostname} 的链接预览（Demo）`,
        siteName: parsed.hostname,
        image: isImageUrl ? parsed.toString() : null,
        favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
      },
    });
  }),

  // 可聊天用户搜索
  http.get('/api/chat/users', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const filtered = keyword
      ? mockChatUsers.filter((u) =>
          u.nickname.includes(keyword) || u.username.includes(keyword),
        )
      : mockChatUsers;
    return HttpResponse.json({ code: 0, message: 'ok', data: filtered });
  }),

  // 组织架构选人数据（部门 + 用户）
  http.get('/api/chat/org-users', () => {
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        departments: mockDepartments
          .filter((d) => d.status === 'enabled')
          .map((d) => ({ id: d.id, name: d.name, parentId: d.parentId })),
        users: mockUsers
          .filter((u) => u.id !== CURRENT_USER_ID && u.status === 'enabled')
          .map((u) => ({
            id: u.id, nickname: u.nickname, username: u.username,
            avatar: u.avatar ?? null, departmentId: u.departmentId ?? null,
          })),
      },
    });
  }),

  // 会话列表
  http.get('/api/chat/conversations', () => {
    const data = [...mockChatConversations].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(a.lastMessage?.createdAt ?? a.updatedAt);
    });
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  http.get('/api/chat/favorite-messages', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
    const all = mockChatMessages.filter((m) => m.extra?.isFavorited).slice().reverse();
    const start = (page - 1) * pageSize;
    const list = all.slice(start, start + pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: all.length, page, pageSize } });
  }),

  // 全局消息搜索
  http.get('/api/chat/messages/global-search', ({ request }) => {
    const url = new URL(request.url);
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    if (!keyword) {
      return HttpResponse.json({ code: 0, message: 'ok', data: { list: [], total: 0, page, pageSize, conversationNames: {} } });
    }
    const all = mockChatMessages.filter((m) => {
      if (m.isRecalled) return false;
      return (m.content ?? '').toLowerCase().includes(keyword)
        || (m.extra?.asset?.name ?? '').toLowerCase().includes(keyword);
    });
    const total = all.length;
    const start = (page - 1) * pageSize;
    const sliced = all.slice(start, start + pageSize);
    const conversationNames: Record<string, string> = {};
    for (const msg of sliced) {
      const conv = mockChatConversations.find((c) => c.id === msg.conversationId);
      if (conv) {
        conversationNames[String(msg.conversationId)] = conv.type === 'direct'
          ? (conv.targetUser?.nickname ?? '私聊')
          : (conv.name ?? '群聊');
      }
    }
    const list = sliced.map((msg) => {
      let snippet = msg.content;
      if (msg.type === 'image') snippet = `[图片] ${msg.extra?.asset?.name ?? ''}`.trim();
      else if (msg.type === 'file') snippet = `[文件] ${msg.extra?.asset?.name ?? ''}`.trim();
      return { message: msg, snippet };
    });
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize, conversationNames } });
  }),

  // 创建/获取单聊
  http.post('/api/chat/conversations/direct', async ({ request }) => {
    const body = await request.json() as { targetUserId: number };
    const targetUser = mockChatUsers.find((u) => u.id === body.targetUserId);
    if (!targetUser) return HttpResponse.json({ code: 404, message: '用户不存在', data: null }, { status: 404 });

    const existing = mockChatConversations.find(
      (c) => c.type === 'direct' && c.targetUser?.id === body.targetUserId,
    );
    if (existing) return HttpResponse.json({ code: 0, message: 'ok', data: existing });

    const newConv = {
      id: mockChatConversations.length + 100,
      type: 'direct' as const,
      name: null,
      targetUser,
      lastMessage: null,
      unreadCount: 0,
      hasMentionUnread: false,
      isPinned: false,
      isStarred: false,
      isMuted: false,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockChatConversations.unshift(newConv);
    return HttpResponse.json({ code: 0, message: 'ok', data: newConv });
  }),

  // 消息列表（游标分页，最新在前）
  http.get('/api/chat/conversations/:id/messages', ({ params, request }) => {
    const convId = Number(params.id);
    const url = new URL(request.url);
    const beforeId = url.searchParams.get('beforeId') ? Number(url.searchParams.get('beforeId')) : null;
    const limit = Number(url.searchParams.get('limit') ?? '30');

    const all = getMockConvMessages(convId).slice().sort((a, b) => b.id - a.id); // 最新在前（按 id 降序）
    const filtered = beforeId === null ? all : all.filter((m) => m.id < beforeId);
    const batch = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;

    return HttpResponse.json({ code: 0, message: 'ok', data: { list: batch, hasMore } });
  }),

  // 发送消息
  http.post('/api/chat/conversations/:id/messages', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as {
      content: string;
      type?: string;
      replyToId?: number;
      extra?: ChatMessageExtra | null;
    };

    const newMsg: ChatMessage = {
      id: getNextMsgId(),
      conversationId: convId,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER_NICKNAME,
      senderAvatar: null,
      type: (body.type ?? 'text') as ChatMessage['type'],
      content: body.content,
      replyToId: body.replyToId ?? null,
      replyToMessage: body.replyToId
        ? ((): ChatReplySnapshot | null => {
            const orig = mockChatMessages.find((m) => m.id === body.replyToId);
            if (!orig) return null;
            return { id: orig.id, senderId: orig.senderId, senderName: orig.senderName, type: orig.type, content: orig.content, isRecalled: orig.isRecalled, extra: orig.extra };
          })()
        : null,
      isRecalled: false,
    isEdited: false,
      extra: body.extra ?? null,
      reactions: [],
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };

    addMockMessage(newMsg);
    return HttpResponse.json({ code: 0, message: 'ok', data: newMsg });
  }),

  // 撤回消息
  http.patch('/api/chat/messages/:id/recall', ({ params }) => {
    const msgId = Number(params.id);
    const msg = mockChatMessages.find((m) => m.id === msgId);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    if (msg.senderId !== CURRENT_USER_ID) {
      return HttpResponse.json({ code: 403, message: '只能撤回自己的消息', data: null }, { status: 403 });
    }
    msg.isRecalled = true;
    msg.content = '消息已撤回';
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  http.patch('/api/chat/messages/:id/favorite', async ({ params, request }) => {
    const msgId = Number(params.id);
    const body = await request.json() as { favorite: boolean };
    const msg = mockChatMessages.find((m) => m.id === msgId);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    msg.extra = { ...(msg.extra || {}), isFavorited: body.favorite };
    msg.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: 'ok', data: msg });
  }),

  http.patch('/api/chat/messages/:id/pin', async ({ params, request }) => {
    const msgId = Number(params.id);
    const body = await request.json() as { pin: boolean };
    const msg = mockChatMessages.find((m) => m.id === msgId);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    msg.extra = { ...(msg.extra || {}), isPinned: body.pin };
    msg.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: 'ok', data: msg });
  }),

  // 投票
  http.post('/api/chat/messages/:id/vote', async ({ params, request }) => {
    const msgId = Number(params.id);
    const body = await request.json() as { optionIds: string[] };
    const msg = mockChatMessages.find((m) => m.id === msgId);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    if (msg.type !== 'vote') return HttpResponse.json({ code: 400, message: '该消息不是投票类型', data: null }, { status: 400 });

    const voteData = msg.extra?.voteData;
    if (!voteData) return HttpResponse.json({ code: 400, message: '投票数据异常', data: null }, { status: 400 });
    if (voteData.isClosed) return HttpResponse.json({ code: 400, message: '投票已关闭', data: null }, { status: 400 });

    const validIds = new Set(voteData.options.map((o) => o.id));
    const selected = (body.optionIds ?? []).filter((id) => validIds.has(id));
    if (selected.length === 0) {
      return HttpResponse.json({ code: 400, message: '请选择有效选项', data: null }, { status: 400 });
    }
    if (!voteData.isMultiple && selected.length > 1) {
      return HttpResponse.json({ code: 400, message: '单选投票只能选择一个选项', data: null }, { status: 400 });
    }

    voteData.votes = [
      ...voteData.votes.filter((v) => v.userId !== CURRENT_USER_ID),
      { userId: CURRENT_USER_ID, optionIds: selected, nickname: CURRENT_USER_NICKNAME },
    ];
    msg.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: 'ok', data: msg });
  }),

  http.get('/api/chat/conversations/:id/pinned-messages', ({ params }) => {
    const convId = Number(params.id);
    const data = getMockConvMessages(convId)
      .filter((m) => m.extra?.isPinned)
      .slice()
      .reverse()
      .slice(0, 5);
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  http.get('/api/chat/conversations/:id/favorite-messages', ({ params, request }) => {
    const convId = Number(params.id);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
    const all = getMockConvMessages(convId).filter((m) => m.extra?.isFavorited).slice().reverse();
    const start = (page - 1) * pageSize;
    const list = all.slice(start, start + pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: all.length, page, pageSize } });
  }),

  // 标记已读
  http.post('/api/chat/conversations/:id/read', ({ params }) => {
    const convId = Number(params.id);
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (conv) {
      conv.unreadCount = 0;
      conv.hasMentionUnread = false;
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 会话成员已读状态（已读回执）
  http.get('/api/chat/conversations/:id/read-states', ({ params }) => {
    const convId = Number(params.id);
    const conv = mockChatConversations.find((c) => c.id === convId);
    let states: Array<{ userId: number; nickname: string; avatar: string | null; lastReadAt: string | null }> = [];
    if (conv?.type === 'group') {
      states = (mockGroupMembers[convId] ?? [])
        .filter((m) => m.id !== CURRENT_USER_ID)
        .map((m) => ({ userId: m.id, nickname: m.nickname, avatar: m.avatar ?? null, lastReadAt: mockDateTime() }));
    } else if (conv?.targetUser) {
      states = [{ userId: conv.targetUser.id, nickname: conv.targetUser.nickname, avatar: conv.targetUser.avatar ?? null, lastReadAt: mockDateTime() }];
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: states });
  }),

  // 批量在线状态（演示：偶数 ID 在线，奇数离线）
  http.get('/api/chat/presence', ({ request }) => {
    const url = new URL(request.url);
    const ids = (url.searchParams.get('userIds') ?? '')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const data = ids.map((userId) => {
      const online = userId % 2 === 0;
      return { userId, online, lastSeen: online ? null : mockDateTime() };
    });
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // 创建群聊
  http.post('/api/chat/conversations/group', async ({ request }) => {
    const body = await request.json() as { name: string; memberIds?: number[] };
    if (!body.name?.trim()) {
      return HttpResponse.json({ code: 400, message: '群聊名称不能为空', data: null }, { status: 400 });
    }
    const newConv = {
      id: mockChatConversations.length + 200,
      type: 'group' as const,
      name: body.name.trim(),
      announcement: null,
      targetUser: null,
      lastMessage: null,
      unreadCount: 0,
      hasMentionUnread: false,
      isPinned: false,
      isStarred: false,
      isMuted: false,
      muteAll: false,
      myRole: 'owner' as const,
      myMutedUntil: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockChatConversations.unshift(newConv);
    const initialMembers = (body.memberIds ?? [])
      .map((id) => mockUsers.find((u) => u.id === id))
      .filter((u): u is NonNullable<typeof u> => !!u && u.id !== CURRENT_USER_ID)
      .map((u) => ({ id: u.id, nickname: u.nickname, username: u.username, avatar: null, role: 'member' as const, mutedUntil: null }));
    mockGroupMembers[newConv.id] = [
      { id: 1, nickname: '管理员', username: 'admin', avatar: null, role: 'owner', mutedUntil: null },
      ...initialMembers,
    ];
    addSystemMessage(newConv.id, `${CURRENT_USER_NICKNAME} 创建了群聊`);
    if (initialMembers.length > 0) {
      addSystemMessage(newConv.id, `${CURRENT_USER_NICKNAME} 邀请 ${initialMembers.map((m) => m.nickname).join('、')} 加入了群聊`);
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: newConv });
  }),

  // 群成员列表
  http.get('/api/chat/conversations/:id/members', ({ params }) => {
    const convId = Number(params.id);
    const members = [...(mockGroupMembers[convId] ?? [])].sort((a, b) => {
      const rank = (m: { role: 'owner' | 'admin' | 'member' }) => {
        if (m.role === 'owner') return 0;
        if (m.role === 'admin') return 1;
        return 2;
      };
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.id - b.id;
    });
    return HttpResponse.json({ code: 0, message: 'ok', data: members });
  }),

  // 设置/取消群管理员
  http.patch('/api/chat/conversations/:id/members/:userId/role', async ({ params, request }) => {
    const convId = Number(params.id);
    const targetId = Number(params.userId);
    const body = await request.json() as { role: 'admin' | 'member' };
    const target = mockGroupMembers[convId]?.find((m) => m.id === targetId);
    if (!target) return HttpResponse.json({ code: 404, message: '该用户不在群聊中', data: null }, { status: 404 });
    if (target.role === 'owner') return HttpResponse.json({ code: 400, message: '不能修改群主角色', data: null }, { status: 400 });
    target.role = body.role;
    addSystemMessage(convId, body.role === 'admin'
      ? `${CURRENT_USER_NICKNAME} 将 ${target.nickname} 设为管理员`
      : `${CURRENT_USER_NICKNAME} 取消了 ${target.nickname} 的管理员身份`);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 禁言/解除禁言群成员
  http.patch('/api/chat/conversations/:id/members/:userId/mute', async ({ params, request }) => {
    const convId = Number(params.id);
    const targetId = Number(params.userId);
    const body = await request.json() as { mute: boolean; durationMinutes?: number };
    const target = mockGroupMembers[convId]?.find((m) => m.id === targetId);
    if (!target) return HttpResponse.json({ code: 404, message: '该用户不在群聊中', data: null }, { status: 404 });
    if (target.role === 'owner') return HttpResponse.json({ code: 400, message: '不能禁言群主', data: null }, { status: 400 });
    if (body.mute) {
      target.mutedUntil = body.durationMinutes
        ? mockDateTimeOffset(body.durationMinutes * 60 * 1000)
        : '9999-12-31 00:00:00';
      addSystemMessage(convId, `${target.nickname} 已被 ${CURRENT_USER_NICKNAME} 禁言${body.durationMinutes ? '' : '（永久）'}`);
    } else {
      target.mutedUntil = null;
      addSystemMessage(convId, `${target.nickname} 已被 ${CURRENT_USER_NICKNAME} 解除禁言`);
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 全员禁言开关
  http.patch('/api/chat/conversations/:id/mute-all', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { muteAll: boolean };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (!conv) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    conv.muteAll = body.muteAll;
    addSystemMessage(convId, body.muteAll
      ? `${CURRENT_USER_NICKNAME} 开启了全员禁言`
      : `${CURRENT_USER_NICKNAME} 解除了全员禁言`);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 置顶 / 取消置顶
  http.patch('/api/chat/conversations/:id/pin', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { pin: boolean };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (conv) conv.isPinned = body.pin;
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 星标 / 取消星标
  http.patch('/api/chat/conversations/:id/star', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { star: boolean };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (conv) conv.isStarred = body.star;
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 免打扰 / 取消免打扰
  http.patch('/api/chat/conversations/:id/mute', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { mute: boolean };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (conv) conv.isMuted = body.mute;
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 归档 / 取消归档
  http.patch('/api/chat/conversations/:id/archive', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { archive: boolean };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (conv) conv.isArchived = body.archive;
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // ── 常用语 ──
  http.get('/api/chat/quick-replies', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: [...mockQuickReplies].sort((a, b) => a.sort - b.sort || a.id - b.id) }),
  ),

  http.post('/api/chat/quick-replies', async ({ request }) => {
    const body = await request.json() as { content: string; sort?: number };
    if (!body.content?.trim()) return HttpResponse.json({ code: 400, message: '内容不能为空', data: null }, { status: 400 });
    const item: MockQuickReply = { id: nextQuickReplyId++, content: body.content.trim(), sort: body.sort ?? 0, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockQuickReplies.push(item);
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  http.put('/api/chat/quick-replies/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as { content?: string; sort?: number };
    const item = mockQuickReplies.find((q) => q.id === id);
    if (!item) return HttpResponse.json({ code: 404, message: '常用语不存在', data: null }, { status: 404 });
    if (body.content !== undefined) item.content = body.content;
    if (body.sort !== undefined) item.sort = body.sort;
    item.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  http.delete('/api/chat/quick-replies/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockQuickReplies.findIndex((q) => q.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '常用语不存在', data: null }, { status: 404 });
    mockQuickReplies.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // ── 定时消息 ──
  http.post('/api/chat/conversations/:id/scheduled-messages', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { content: string; scheduledAt: string };
    if (!body.content?.trim()) return HttpResponse.json({ code: 400, message: '内容不能为空', data: null }, { status: 400 });
    const item: MockScheduled = {
      id: nextScheduledId++,
      conversationId: convId,
      conversationName: convDisplayName(convId),
      type: 'text',
      content: body.content,
      extra: null,
      scheduledAt: body.scheduledAt,
      status: 'pending',
      failReason: null,
      sentMessageId: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockScheduledMessages.push(item);
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  http.get('/api/chat/scheduled-messages', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const list = mockScheduledMessages
      .filter((m) => !status || m.status === status)
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.patch('/api/chat/scheduled-messages/:id/cancel', ({ params }) => {
    const id = Number(params.id);
    const item = mockScheduledMessages.find((m) => m.id === id);
    if (!item) return HttpResponse.json({ code: 404, message: '定时消息不存在', data: null }, { status: 404 });
    if (item.status !== 'pending') return HttpResponse.json({ code: 400, message: '仅待发送的定时消息可取消', data: null }, { status: 400 });
    item.status = 'canceled';
    item.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // ── 自定义表情 ──
  http.get('/api/chat/custom-emojis', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: [...mockCustomEmojis].sort((a, b) => b.id - a.id) }),
  ),

  http.post('/api/chat/custom-emojis', async ({ request }) => {
    const body = await request.json() as { url: string; fileId?: string | null; name?: string | null; width?: number | null; height?: number | null };
    const dup = mockCustomEmojis.find((e) => e.url === body.url);
    if (dup) return HttpResponse.json({ code: 0, message: 'ok', data: dup });
    const item: MockCustomEmoji = {
      id: nextEmojiId++, url: body.url, fileId: body.fileId ?? null, name: body.name ?? null,
      width: body.width ?? null, height: body.height ?? null, createdAt: mockDateTime(),
    };
    mockCustomEmojis.push(item);
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  http.delete('/api/chat/custom-emojis/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockCustomEmojis.findIndex((e) => e.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '表情不存在', data: null }, { status: 404 });
    mockCustomEmojis.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // ── 群邀请链接 ──
  http.post('/api/chat/conversations/:id/invite', ({ params }) => {
    const convId = Number(params.id);
    let invite = mockInvites[convId];
    if (!invite?.enabled) {
      invite = {
        id: nextInviteId++, conversationId: convId,
        token: `mock-invite-${convId}-${Math.random().toString(16).slice(2, 10)}`,
        expiresAt: mockDateTimeOffset(7 * 24 * 3600 * 1000), maxUses: null, usedCount: 0, enabled: true,
        createdAt: mockDateTime(),
      };
      mockInvites[convId] = invite;
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: invite });
  }),

  http.post('/api/chat/conversations/:id/invite/reset', ({ params }) => {
    const convId = Number(params.id);
    const invite = {
      id: nextInviteId++, conversationId: convId,
      token: `mock-invite-${convId}-${Math.random().toString(16).slice(2, 10)}`,
      expiresAt: mockDateTimeOffset(7 * 24 * 3600 * 1000), maxUses: null, usedCount: 0, enabled: true,
      createdAt: mockDateTime(),
    };
    mockInvites[convId] = invite;
    return HttpResponse.json({ code: 0, message: 'ok', data: invite });
  }),

  http.get('/api/chat/invites/:token', ({ params }) => {
    const token = String(params.token);
    const invite = Object.values(mockInvites).find((i) => i.token === token && i.enabled);
    if (!invite) return HttpResponse.json({ code: 404, message: '邀请链接不存在或已失效', data: null }, { status: 404 });
    const conv = mockChatConversations.find((c) => c.id === invite.conversationId);
    return HttpResponse.json({
      code: 0, message: 'ok',
      data: {
        conversationId: invite.conversationId,
        groupName: conv?.name ?? '群聊',
        memberCount: (mockGroupMembers[invite.conversationId] ?? []).length,
        joinApproval: (conv as { joinApproval?: boolean } | undefined)?.joinApproval ?? false,
        alreadyMember: (mockGroupMembers[invite.conversationId] ?? []).some((m) => m.id === CURRENT_USER_ID),
      },
    });
  }),

  http.post('/api/chat/invites/:token/join', async ({ params, request }) => {
    const token = String(params.token);
    const body = await request.json() as { message?: string };
    const invite = Object.values(mockInvites).find((i) => i.token === token && i.enabled);
    if (!invite) return HttpResponse.json({ code: 404, message: '邀请链接不存在或已失效', data: null }, { status: 404 });
    const conv = mockChatConversations.find((c) => c.id === invite.conversationId);
    const members = mockGroupMembers[invite.conversationId] ?? [];
    if (members.some((m) => m.id === CURRENT_USER_ID)) {
      return HttpResponse.json({ code: 400, message: '你已在该群聊中', data: null }, { status: 400 });
    }
    if ((conv as { joinApproval?: boolean } | undefined)?.joinApproval) {
      mockJoinRequests.push({
        id: nextJoinRequestId++, conversationId: invite.conversationId, userId: CURRENT_USER_ID,
        nickname: CURRENT_USER_NICKNAME, avatar: null, message: body.message ?? null,
        status: 'pending', createdAt: mockDateTime(),
      });
      return HttpResponse.json({ code: 0, message: 'ok', data: { joined: false } });
    }
    members.push({ id: CURRENT_USER_ID, nickname: CURRENT_USER_NICKNAME, username: 'admin', avatar: null, role: 'member', mutedUntil: null });
    invite.usedCount += 1;
    addSystemMessage(invite.conversationId, `${CURRENT_USER_NICKNAME} 通过邀请链接加入了群聊`);
    return HttpResponse.json({ code: 0, message: 'ok', data: { joined: true } });
  }),

  http.get('/api/chat/conversations/:id/join-requests', ({ params }) => {
    const convId = Number(params.id);
    const list = mockJoinRequests.filter((r) => r.conversationId === convId && r.status === 'pending');
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.patch('/api/chat/join-requests/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as { approve: boolean };
    const req = mockJoinRequests.find((r) => r.id === id);
    if (!req) return HttpResponse.json({ code: 404, message: '申请不存在', data: null }, { status: 404 });
    if (req.status !== 'pending') return HttpResponse.json({ code: 400, message: '该申请已处理', data: null }, { status: 400 });
    req.status = body.approve ? 'approved' : 'rejected';
    if (body.approve) {
      const members = mockGroupMembers[req.conversationId] ?? [];
      if (!members.some((m) => m.id === req.userId)) {
        members.push({ id: req.userId, nickname: req.nickname, username: `user${req.userId}`, avatar: null, role: 'member', mutedUntil: null });
      }
      addSystemMessage(req.conversationId, `${req.nickname} 通过邀请链接加入了群聊`);
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  http.patch('/api/chat/conversations/:id/join-approval', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { enabled: boolean };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (!conv) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    (conv as { joinApproval?: boolean }).joinApproval = body.enabled;
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 删除/退出会话
  http.delete('/api/chat/conversations/:id', ({ params }) => {
    const convId = Number(params.id);
    const idx = mockChatConversations.findIndex((c) => c.id === convId);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    mockChatConversations.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 添加群成员
  http.post('/api/chat/conversations/:id/members', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { userId: number };
    const user = mockChatUsers.find((u) => u.id === body.userId);
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null }, { status: 404 });
    if (!mockGroupMembers[convId]) mockGroupMembers[convId] = [];
    const already = mockGroupMembers[convId].some((m) => m.id === body.userId);
    if (already) return HttpResponse.json({ code: 400, message: '已是群成员', data: null }, { status: 400 });
    mockGroupMembers[convId].push({ ...user, avatar: null, role: 'member', mutedUntil: null });
    addSystemMessage(convId, `${user.nickname} 加入了群聊`);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 移除群成员
  http.delete('/api/chat/conversations/:id/members/:userId', ({ params }) => {
    const convId = Number(params.id);
    const targetId = Number(params.userId);
    if (!mockGroupMembers[convId]) return HttpResponse.json({ code: 404, message: '群聊不存在', data: null }, { status: 404 });
    const idx = mockGroupMembers[convId].findIndex((m) => m.id === targetId);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '该用户不在群聊中', data: null }, { status: 404 });
    const target = mockGroupMembers[convId][idx];
    mockGroupMembers[convId].splice(idx, 1);
    addSystemMessage(convId, `${target.nickname} 被 ${CURRENT_USER_NICKNAME} 移出群聊`);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 更新群聊信息（群名/公告）
  http.patch('/api/chat/conversations/:id/group-info', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { name?: string; announcement?: string | null };
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (!conv) return HttpResponse.json({ code: 404, message: '会话不存在', data: null }, { status: 404 });
    const oldName = conv.name ?? null;
    const oldAnnouncement = (conv as unknown as { announcement?: string | null }).announcement ?? null;
    if (body.name !== undefined) conv.name = body.name || null;
    if ('announcement' in body) (conv as unknown as Record<string, unknown>).announcement = body.announcement ?? null;

    if (body.name !== undefined && (conv.name ?? null) !== oldName) {
      addSystemMessage(convId, `${CURRENT_USER_NICKNAME} 将群聊名称修改为「${conv.name ?? '未命名群聊'}」`);
    }
    if ('announcement' in body) {
      const nextAnnouncement = (conv as unknown as { announcement?: string | null }).announcement ?? null;
      if (nextAnnouncement !== oldAnnouncement) {
        const newMsg: ChatMessage = {
          id: getNextMsgId(),
          conversationId: convId,
          senderId: null,
          senderName: null,
          senderAvatar: null,
          type: 'system',
          content: `${CURRENT_USER_NICKNAME} 更新了群公告`,
          replyToId: null,
          replyToMessage: null,
          isRecalled: false,
    isEdited: false,
          extra: {
            announcementHistory: {
              announcement: nextAnnouncement,
              operatorName: CURRENT_USER_NICKNAME,
            },
          },
          reactions: [],
          createdAt: mockDateTime(),
          updatedAt: mockDateTime(),
        };
        addMockMessage(newMsg);
      }
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  http.get('/api/chat/conversations/:id/announcement-history', ({ params }) => {
    const convId = Number(params.id);
    const data = getMockConvMessages(convId)
      .filter((m) => m.type === 'system' && m.extra?.announcementHistory)
      .slice()
      .reverse();
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  http.delete('/api/chat/conversations/:id/announcement-history/:messageId', ({ params }) => {
    const convId = Number(params.id);
    const messageId = Number(params.messageId);
    const idx = mockChatMessages.findIndex((m) => m.id === messageId && m.conversationId === convId && m.type === 'system' && m.extra?.announcementHistory);
    if (idx < 0) return HttpResponse.json({ code: 404, message: '公告历史不存在', data: null }, { status: 404 });
    mockChatMessages.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 转让群主
  http.post('/api/chat/conversations/:id/transfer', async ({ params, request }) => {
    const convId = Number(params.id);
    const body = await request.json() as { newOwnerId: number };
    const members = mockGroupMembers[convId];
    if (!members) return HttpResponse.json({ code: 404, message: '群聊不存在', data: null }, { status: 404 });
    const target = members.find((m) => m.id === body.newOwnerId);
    if (!target) return HttpResponse.json({ code: 404, message: '目标用户不在群聊中', data: null }, { status: 404 });
    members.forEach((m) => { m.role = m.id === body.newOwnerId ? 'owner' : 'member'; });
    addSystemMessage(convId, `${CURRENT_USER_NICKNAME} 将群主转让给 ${target.nickname}`);
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),
];
