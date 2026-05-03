import { http, HttpResponse } from 'msw';
import type { ChatMessage, ChatMessageExtra } from '@zenith/shared';
import {
  mockChatConversations, mockChatUsers, getMockConvMessages,
  addMockMessage, getNextMsgId, mockChatMessages, mockGroupMembers,
} from '@/mocks/data/chat';
import { mockDateTime } from '@/mocks/utils/date';

// 当前 demo 用户 ID（对应 admin = 1）
const CURRENT_USER_ID = 1;
const CURRENT_USER_NICKNAME = '管理员';

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
    isRecalled: false,
    extra: null,
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

  // 会话列表
  http.get('/api/chat/conversations', () => {
    const data = [...mockChatConversations].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(a.lastMessage?.createdAt ?? a.updatedAt);
    });
    return HttpResponse.json({ code: 0, message: 'ok', data });
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
      isPinned: false,
      isStarred: false,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockChatConversations.unshift(newConv);
    return HttpResponse.json({ code: 0, message: 'ok', data: newConv });
  }),

  // 消息列表（分页，最新在前）
  http.get('/api/chat/conversations/:id/messages', ({ params, request }) => {
    const convId = Number(params.id);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '30');

    const all = getMockConvMessages(convId).slice().reverse(); // 最新在前
    const total = all.length;
    const start = (page - 1) * pageSize;
    const list = all.slice(start, start + pageSize);

    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
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
      isRecalled: false,
      extra: body.extra ?? null,
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

  // 标记已读
  http.post('/api/chat/conversations/:id/read', ({ params }) => {
    const convId = Number(params.id);
    const conv = mockChatConversations.find((c) => c.id === convId);
    if (conv) conv.unreadCount = 0;
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 创建群聊
  http.post('/api/chat/conversations/group', async ({ request }) => {
    const body = await request.json() as { name: string };
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
      isPinned: false,
      isStarred: false,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockChatConversations.unshift(newConv);
    mockGroupMembers[newConv.id] = [
      { id: 1, nickname: '管理员', username: 'admin', avatar: null, role: 'owner' },
    ];
    addSystemMessage(newConv.id, `${CURRENT_USER_NICKNAME} 创建了群聊`);
    return HttpResponse.json({ code: 0, message: 'ok', data: newConv });
  }),

  // 群成员列表
  http.get('/api/chat/conversations/:id/members', ({ params }) => {
    const convId = Number(params.id);
    const members = [...(mockGroupMembers[convId] ?? [])].sort((a, b) => {
      const rank = (m: { role: 'owner' | 'member'; username: string; nickname: string }) => {
        if (m.role === 'owner') return 0;
        if (m.username === 'admin' || m.nickname.includes('管理员')) return 1;
        return 2;
      };
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.id - b.id;
    });
    return HttpResponse.json({ code: 0, message: 'ok', data: members });
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
    mockGroupMembers[convId].push({ ...user, avatar: null, role: 'member' });
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
        addSystemMessage(convId, `${CURRENT_USER_NICKNAME} 更新了群公告`);
      }
    }
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
