import { http, HttpResponse } from 'msw';
import type { Channel, ChannelMessage, ChannelMenu, ChannelAutoReply, ChannelConversation } from '@zenith/shared';
import {
  mockChannels, mockChannelMessages, mockChannelMenus, mockChannelAutoReplies,
  getNextChannelMessageId, getNextAutoReplyId, MOCK_CURRENT_USER_ID,
  type MockChannelMessage,
} from '@/mocks/data/channels';
import { mockDateTime } from '@/mocks/utils/date';

const CURRENT_USER_NAME = '超级管理员';
let nextMenuId = 1000;

/** 当前用户（id=1）视角可见的消息：广播/卡片(convUserId=null) + 本人会话 */
function visibleToCurrentUser(m: MockChannelMessage, channelId: number): boolean {
  return m.channelId === channelId && (m.convUserId == null || m.convUserId === MOCK_CURRENT_USER_ID);
}

/** mock 自动回复匹配：subscribe → keyword(exact 优先 contains) → default */
function matchAutoReply(channelId: number, text: string, event: 'subscribe' | 'message'): ChannelAutoReply | null {
  const rules = mockChannelAutoReplies
    .filter((r) => r.channelId === channelId && r.status === 'enabled')
    .sort((a, b) => a.sort - b.sort);
  if (event === 'subscribe') return rules.find((r) => r.matchType === 'subscribe') ?? null;
  const trimmed = text.trim();
  const exact = rules.find((r) => r.matchType === 'keyword' && r.keywordMode === 'exact' && r.keyword?.trim() === trimmed);
  if (exact) return exact;
  const contains = rules.find((r) => r.matchType === 'keyword' && r.keywordMode === 'contains' && r.keyword && trimmed.includes(r.keyword.trim()));
  if (contains) return contains;
  return rules.find((r) => r.matchType === 'default') ?? null;
}

function topMenus(channelId: number): ChannelMenu[] {
  return mockChannelMenus.filter((m) => m.channelId === channelId && m.parentId == null);
}

export const channelsHandlers = [
  // 我的频道列表（含未读数）
  http.get('/api/channels/mine', () => {
    const list = mockChannels.filter((ch) => ch.isSubscribed).map((ch) => {
      const msgs = mockChannelMessages.filter((m) => visibleToCurrentUser(m, ch.id));
      const last = msgs.length ? [...msgs].sort((a, b) => b.id - a.id)[0] : null;
      return { ...ch, unreadCount: msgs.filter((m) => !m.isRead).length, lastMessage: last };
    });
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  // 频道消息流（分页，按时间倒序）——当前用户视角
  http.get('/api/channels/:id/messages', ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const channelId = Number(params.id);
    const all = mockChannelMessages.filter((m) => visibleToCurrentUser(m, channelId)).sort((a, b) => b.id - a.id);
    const total = all.length;
    const list = all.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 标记频道已读
  http.post('/api/channels/:id/read', ({ params }) => {
    const channelId = Number(params.id);
    mockChannelMessages.forEach((m) => {
      if (m.channelId === channelId) m.isRead = true;
    });
    return HttpResponse.json({ code: 0, message: '已标记已读', data: null });
  }),

  // 用户向运营号发送消息（写 in + 命中自动回复写 out）
  http.post('/api/channels/:id/send', async ({ params, request }) => {
    const channelId = Number(params.id);
    const body = await request.json() as { content: string };
    const ch = mockChannels.find((c) => c.id === channelId);
    if (!ch) return HttpResponse.json({ code: 404, message: '频道不存在', data: null }, { status: 404 });
    if (ch.type !== 'business') return HttpResponse.json({ code: 400, message: '仅运营号支持该操作', data: null }, { status: 400 });

    const inMsg: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId, audienceType: 'targeted', type: 'text', title: null,
      content: body.content, extra: null, publishedById: null, direction: 'in',
      senderUserId: MOCK_CURRENT_USER_ID, senderUserName: CURRENT_USER_NAME, isRead: true,
      createdAt: mockDateTime(), convUserId: MOCK_CURRENT_USER_ID,
    };
    mockChannelMessages.push(inMsg);

    const matched = matchAutoReply(channelId, body.content, 'message');
    let autoReply: ChannelMessage | null = null;
    if (matched) {
      const out: MockChannelMessage = {
        id: getNextChannelMessageId(), channelId, audienceType: 'targeted', type: 'text', title: null,
        content: matched.replyContent, extra: null, publishedById: null, direction: 'out',
        senderUserId: null, senderUserName: null, isRead: true,
        createdAt: mockDateTime(), convUserId: MOCK_CURRENT_USER_ID,
      };
      mockChannelMessages.push(out);
      autoReply = out;
    }
    return HttpResponse.json({ code: 0, message: '已发送', data: { message: inMsg, autoReply } });
  }),

  // ── 底部菜单 ──────────────────────────────────────────────
  http.get('/api/channels/:id/menus', ({ params }) => {
    return HttpResponse.json({ code: 0, message: 'ok', data: topMenus(Number(params.id)) });
  }),

  http.put('/api/channels/:id/menus', async ({ params, request }) => {
    const channelId = Number(params.id);
    const body = await request.json() as { menus: { name: string; type: 'click' | 'view'; value?: string | null; children?: { name: string; type: 'click' | 'view'; value?: string | null }[] }[] };
    // 移除旧菜单
    for (let i = mockChannelMenus.length - 1; i >= 0; i--) {
      if (mockChannelMenus[i].channelId === channelId) mockChannelMenus.splice(i, 1);
    }
    body.menus.forEach((m, i) => {
      const topId = nextMenuId++;
      const children = (m.children ?? []).map((c, j) => ({
        id: nextMenuId++, channelId, parentId: topId, name: c.name, type: c.type, value: c.value ?? null, sort: j,
      }));
      mockChannelMenus.push({ id: topId, channelId, parentId: null, name: m.name, type: m.type, value: m.value ?? null, sort: i, children });
    });
    return HttpResponse.json({ code: 0, message: '保存成功', data: topMenus(channelId) });
  }),

  // ── 自动回复 ──────────────────────────────────────────────
  http.get('/api/channels/:id/auto-replies', ({ params }) => {
    const channelId = Number(params.id);
    const list = mockChannelAutoReplies.filter((r) => r.channelId === channelId).sort((a, b) => a.sort - b.sort);
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.post('/api/channels/:id/auto-replies', async ({ params, request }) => {
    const channelId = Number(params.id);
    const body = await request.json() as Partial<ChannelAutoReply> & { matchType: ChannelAutoReply['matchType']; replyContent: string };
    const rule: ChannelAutoReply = {
      id: getNextAutoReplyId(), channelId,
      matchType: body.matchType,
      keyword: body.matchType === 'keyword' ? (body.keyword ?? null) : null,
      keywordMode: body.keywordMode ?? 'contains',
      replyContent: body.replyContent,
      status: body.status ?? 'enabled',
      sort: body.sort ?? 0,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockChannelAutoReplies.push(rule);
    return HttpResponse.json({ code: 0, message: '创建成功', data: rule });
  }),

  http.put('/api/channels/:channelId/auto-replies/:replyId', async ({ params, request }) => {
    const replyId = Number(params.replyId);
    const body = await request.json() as Partial<ChannelAutoReply>;
    const rule = mockChannelAutoReplies.find((r) => r.id === replyId);
    if (!rule) return HttpResponse.json({ code: 404, message: '自动回复规则不存在', data: null }, { status: 404 });
    if (body.keyword !== undefined) rule.keyword = rule.matchType === 'keyword' ? body.keyword : null;
    if (body.keywordMode !== undefined) rule.keywordMode = body.keywordMode;
    if (body.replyContent !== undefined) rule.replyContent = body.replyContent;
    if (body.status !== undefined) rule.status = body.status;
    if (body.sort !== undefined) rule.sort = body.sort;
    rule.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '更新成功', data: rule });
  }),

  http.delete('/api/channels/:channelId/auto-replies/:replyId', ({ params }) => {
    const replyId = Number(params.replyId);
    const idx = mockChannelAutoReplies.findIndex((r) => r.id === replyId);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '自动回复规则不存在', data: null }, { status: 404 });
    mockChannelAutoReplies.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ── 客服工作台 ────────────────────────────────────────────
  http.get('/api/channels/cs/channels', () => {
    const list = mockChannels.filter((c) => c.type === 'business' && c.status === 'enabled')
      .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }));
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.get('/api/channels/cs/:id/conversations', ({ params }) => {
    const channelId = Number(params.id);
    const ins = mockChannelMessages.filter((m) => m.channelId === channelId && m.direction === 'in').sort((a, b) => a.id - b.id);
    const userIds = [...new Set(ins.map((m) => m.senderUserId).filter((x): x is number => x != null))];
    const list: ChannelConversation[] = userIds.map((uid) => {
      const userIns = ins.filter((m) => m.senderUserId === uid);
      const outs = mockChannelMessages.filter((m) => m.channelId === channelId && m.direction === 'out' && m.convUserId === uid).sort((a, b) => a.id - b.id);
      const lastIn = userIns[userIns.length - 1];
      const lastOut = outs.length ? outs[outs.length - 1] : null;
      // 待人工回复：最近一条人工客服回复（senderUserId 非空）之后的用户消息（自动回复不清除待办）
      const lastAgentOutId = outs.reduce((max, o) => (o.senderUserId != null && o.id > max ? o.id : max), 0);
      const useIn = !lastOut || lastIn.id > lastOut.id;
      return {
        channelId, userId: uid,
        userName: lastIn.senderUserName ?? `用户#${uid}`,
        userAvatar: null,
        lastMessage: useIn ? lastIn.content : lastOut!.content,
        lastDirection: useIn ? 'in' as const : 'out' as const,
        lastMessageAt: useIn ? lastIn.createdAt : lastOut!.createdAt,
        unreadCount: userIns.filter((m) => m.id > lastAgentOutId).length,
        messageCount: userIns.length + outs.length,
      };
    }).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.get('/api/channels/cs/:id/conversations/:userId/messages', ({ params, request }) => {
    const channelId = Number(params.id);
    const userId = Number(params.userId);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '50');
    const all = mockChannelMessages.filter((m) => m.channelId === channelId && m.convUserId === userId).sort((a, b) => b.id - a.id);
    const total = all.length;
    const list = all.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/channels/cs/:id/conversations/:userId/reply', async ({ params, request }) => {
    const channelId = Number(params.id);
    const userId = Number(params.userId);
    const body = await request.json() as { content: string };
    const out: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId, audienceType: 'targeted', type: 'text', title: null,
      content: body.content, extra: null, publishedById: MOCK_CURRENT_USER_ID, direction: 'out',
      senderUserId: MOCK_CURRENT_USER_ID, senderUserName: CURRENT_USER_NAME, isRead: true,
      createdAt: mockDateTime(), convUserId: userId,
    };
    mockChannelMessages.push(out);
    return HttpResponse.json({ code: 0, message: '已回复', data: out });
  }),

  // ── 管理后台 ──────────────────────────────────────────────
  http.get('/api/channels/admin', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
    const keyword = url.searchParams.get('keyword') ?? '';
    const filtered = mockChannels.filter((c) => !keyword || c.name.includes(keyword) || c.code.includes(keyword));
    const list = filtered.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
      id: c.id, code: c.code, name: c.name, avatar: c.avatar, description: c.description,
      type: c.type, builtin: c.builtin, status: c.status,
      subscriberCount: c.type === 'system' ? 4 : (c.id === 3 ? 3 : 0),
      messageCount: mockChannelMessages.filter((m) => m.channelId === c.id).length,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
    }));
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: filtered.length, page, pageSize } });
  }),

  http.post('/api/channels', async ({ request }) => {
    const body = await request.json() as { code: string; name: string; avatar?: string | null; description?: string | null };
    const id = Math.max(0, ...mockChannels.map((c) => c.id)) + 1;
    const now = mockDateTime();
    const ch: Channel = {
      id, code: body.code, name: body.name, avatar: body.avatar ?? null, description: body.description ?? null,
      type: 'business', builtin: false, status: 'enabled', unreadCount: 0, lastMessage: null, isMuted: false, isSubscribed: false,
      createdAt: now, updatedAt: now,
    };
    mockChannels.push(ch);
    return HttpResponse.json({ code: 0, message: '创建成功', data: { ...ch, subscriberCount: 0, messageCount: 0 } });
  }),

  http.put('/api/channels/:id', async ({ params, request }) => {
    const body = await request.json() as Partial<{ name: string; avatar: string | null; description: string | null; status: 'enabled' | 'disabled' }>;
    const ch = mockChannels.find((c) => c.id === Number(params.id));
    if (!ch) return HttpResponse.json({ code: 404, message: '频道不存在', data: null }, { status: 404 });
    if (body.name !== undefined) ch.name = body.name;
    if (body.avatar !== undefined) ch.avatar = body.avatar;
    if (body.description !== undefined) ch.description = body.description;
    if (body.status !== undefined) ch.status = body.status;
    ch.updatedAt = mockDateTime();
    return HttpResponse.json({
      code: 0, message: '更新成功',
      data: { ...ch, subscriberCount: ch.type === 'system' ? 4 : 0, messageCount: mockChannelMessages.filter((m) => m.channelId === ch.id).length },
    });
  }),

  http.delete('/api/channels/:id', ({ params }) => {
    const idx = mockChannels.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '频道不存在', data: null }, { status: 404 });
    if (mockChannels[idx].builtin) return HttpResponse.json({ code: 400, message: '内置系统号不可删除', data: null }, { status: 400 });
    mockChannels.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  http.post('/api/channels/:id/publish', async ({ params, request }) => {
    const body = await request.json() as { title?: string | null; content: string };
    const channelId = Number(params.id);
    const msg: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId, audienceType: 'broadcast', type: 'text', title: body.title ?? null, content: body.content,
      extra: null, publishedById: 1, direction: 'out', senderUserId: null, senderUserName: null, isRead: false,
      createdAt: mockDateTime(), convUserId: null,
    };
    mockChannelMessages.unshift(msg);
    return HttpResponse.json({ code: 0, message: '已发布', data: msg });
  }),

  // ── 订阅（运营号） ────────────────────────────────────────
  http.get('/api/channels/discoverable', () => {
    const list = mockChannels.filter((ch) => ch.type === 'business' && !ch.isSubscribed);
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.post('/api/channels/:id/subscribe', ({ params }) => {
    const ch = mockChannels.find((c) => c.id === Number(params.id));
    if (!ch) return HttpResponse.json({ code: 404, message: '频道不存在', data: null }, { status: 404 });
    if (ch.type === 'system') return HttpResponse.json({ code: 400, message: '系统号默认全员订阅', data: null }, { status: 400 });
    ch.isSubscribed = true;
    return HttpResponse.json({ code: 0, message: '已订阅', data: null });
  }),

  http.delete('/api/channels/:id/subscribe', ({ params }) => {
    const ch = mockChannels.find((c) => c.id === Number(params.id));
    if (!ch) return HttpResponse.json({ code: 404, message: '频道不存在', data: null }, { status: 404 });
    if (ch.type === 'system') return HttpResponse.json({ code: 400, message: '系统号不可退订', data: null }, { status: 400 });
    ch.isSubscribed = false;
    return HttpResponse.json({ code: 0, message: '已退订', data: null });
  }),
];
