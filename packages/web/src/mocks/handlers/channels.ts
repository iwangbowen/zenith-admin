import { http, HttpResponse } from 'msw';
import type { Channel, ChannelMessage, ChannelMenu, ChannelAutoReply, ChannelConversation, ChannelQuickReply, ChannelMessageStatus, ChatMessageExtra, ChannelSubscriber, ChannelMessageTemplate, ChannelCsPerformance } from '@zenith/shared';
import {
  mockChannels, mockChannelMessages, mockChannelMenus, mockChannelAutoReplies, mockChannelQuickReplies,
  getNextChannelMessageId, getNextAutoReplyId, getNextQuickReplyId, MOCK_CURRENT_USER_ID,
  MOCK_SUBSCRIBER_USERS, mockChannelTemplates, getNextTemplateId,
  type MockChannelMessage,
} from '@/mocks/data/channels';
import { mockDateTime } from '@/mocks/utils/date';

const CURRENT_USER_NAME = '超级管理员';
let nextMenuId = 1000;

/** 会话治理属性内存表（key=`${channelId}:${userId}`），默认 open/未分配/无标签/未评价 */
interface ConvAttr { status: 'open' | 'processing' | 'resolved'; assigneeId: number | null; tags: string[]; resolvedAt: string | null; rating: number | null; ratingComment: string | null; ratedAt: string | null; }
const convAttrs = new Map<string, ConvAttr>();
const convKey = (channelId: number, userId: number) => `${channelId}:${userId}`;
function getConvAttr(channelId: number, userId: number): ConvAttr {
  return convAttrs.get(convKey(channelId, userId)) ?? { status: 'open', assigneeId: null, tags: [], resolvedAt: null, rating: null, ratingComment: null, ratedAt: null };
}
function setConvAttr(channelId: number, userId: number, patch: Partial<ConvAttr>): void {
  convAttrs.set(convKey(channelId, userId), { ...getConvAttr(channelId, userId), ...patch });
}

/** 运营号订阅者内存表（channelId → userId → 订阅时间）；系统号为全员只读 */
const channelSubs = new Map<number, Map<number, string>>();
function seedSubs(): void {
  if (channelSubs.size) return;
  channelSubs.set(3, new Map<number, string>([[1, mockDateTime()], [2, mockDateTime()], [3, mockDateTime()]]));
}
function listSubscribers(channelId: number, isSystem: boolean): ChannelSubscriber[] {
  if (isSystem) {
    return MOCK_SUBSCRIBER_USERS.map((u) => ({ userId: u.userId, name: u.name, avatar: u.avatar, subscribedAt: null, isMuted: false }));
  }
  seedSubs();
  const m = channelSubs.get(channelId) ?? new Map<number, string>();
  return [...m.entries()].map(([uid, at]) => {
    const u = MOCK_SUBSCRIBER_USERS.find((x) => x.userId === uid);
    return { userId: uid, name: u?.name ?? `用户#${uid}`, avatar: u?.avatar ?? null, subscribedAt: at, isMuted: false };
  });
}
function addSubscribers(channelId: number, userIds: number[]): void {
  seedSubs();
  const m = channelSubs.get(channelId) ?? new Map<number, string>();
  userIds.forEach((uid) => { if (!m.has(uid)) m.set(uid, mockDateTime()); });
  channelSubs.set(channelId, m);
}
function removeSubscriber(channelId: number, userId: number): void {
  channelSubs.get(channelId)?.delete(userId);
}

/** Mock 可指派客服 */
const MOCK_CS_AGENTS = [
  { id: 1, name: '超级管理员', avatar: null as string | null },
  { id: 2, name: '张三', avatar: null as string | null },
  { id: 3, name: '李四', avatar: null as string | null },
];
const agentName = (id: number | null): string | null => (id == null ? null : (MOCK_CS_AGENTS.find((a) => a.id === id)?.name ?? null));

/** 管理端群发请求体（文本 / 图片 / 图文 + 受众 + 立即/定时/草稿） */
interface PublishBody {
  type?: 'text' | 'image' | 'news';
  title?: string | null;
  content?: string;
  imageUrl?: string | null;
  cover?: string | null;
  summary?: string | null;
  linkUrl?: string | null;
  audience?: { mode: 'all' | 'users' | 'departments' | 'roles'; userIds?: number[]; departmentIds?: number[]; roleIds?: number[] };
  sendMode?: 'now' | 'scheduled' | 'draft';
  scheduledAt?: string | null;
}

/** 由群发请求体构造消息 extra（仅图文生成卡片，其余为 null） */
function buildPublishExtra(body: PublishBody): ChatMessageExtra | null {
  if (body.type !== 'news') return null;
  const linkUrl = body.linkUrl?.trim();
  return {
    card: {
      title: (body.title ?? '').trim() || '图文消息',
      text: body.summary ?? null,
      cover: body.cover ?? null,
      actions: linkUrl ? [{ key: 'open', label: '查看详情', action: 'link', url: linkUrl }] : null,
      source: '图文',
      status: null,
    },
  };
}

/** 将群发请求体写入消息（复用于新建与编辑），保留 id/channelId/createdAt 等不变字段 */
function applyPublishFields(msg: MockChannelMessage, body: PublishBody): void {
  const sendMode = body.sendMode ?? 'now';
  const audienceMode = body.audience?.mode ?? 'all';
  msg.type = body.type ?? 'text';
  msg.title = body.title ?? null;
  msg.content = body.content ?? '';
  msg.extra = buildPublishExtra(body);
  msg.audienceType = audienceMode === 'all' ? 'broadcast' : 'targeted';
  msg.status = sendMode === 'draft' ? 'draft' : sendMode === 'scheduled' ? 'scheduled' : 'sent';
  msg.scheduledAt = msg.status === 'scheduled' ? (body.scheduledAt ?? null) : null;
}

/** 当前用户（id=1）视角可见的消息：仅已发(sent) 的广播/卡片(convUserId=null) + 本人会话 */
function visibleToCurrentUser(m: MockChannelMessage, channelId: number): boolean {
  return m.channelId === channelId && m.status === 'sent' && (m.convUserId == null || m.convUserId === MOCK_CURRENT_USER_ID);
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
  // ══ 频道功能扩展：消息记录管理 + 客服快捷回复 ══════════════════════════════
  // 注：以下更具体的路由需先于 /api/channels/admin/:id/* 与 /api/channels/cs/:id/* 注册，
  // 避免 MSW 按注册顺序匹配时被通配段抢占。

  // ── 群发消息模板库（需先于 /api/channels/:id/* 注册） ──────
  http.get('/api/channels/templates', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: [...mockChannelTemplates].sort((a, b) => b.id - a.id) });
  }),
  http.post('/api/channels/templates', async ({ request }) => {
    const body = await request.json() as { name: string; type?: 'text' | 'image' | 'news'; title?: string | null; content?: string; extra?: ChatMessageExtra | null };
    const now = mockDateTime();
    const tpl: ChannelMessageTemplate = {
      id: getNextTemplateId(), name: body.name, type: body.type ?? 'text',
      title: body.title ?? null, content: body.content ?? '', extra: body.extra ?? null,
      createdAt: now, updatedAt: now,
    };
    mockChannelTemplates.push(tpl);
    return HttpResponse.json({ code: 0, message: '已创建', data: tpl });
  }),
  http.put('/api/channels/templates/:id', async ({ params, request }) => {
    const tpl = mockChannelTemplates.find((t) => t.id === Number(params.id));
    if (!tpl) return HttpResponse.json({ code: 404, message: '模板不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<{ name: string; type: 'text' | 'image' | 'news'; title: string | null; content: string; extra: ChatMessageExtra | null }>;
    if (body.name !== undefined) tpl.name = body.name;
    if (body.type !== undefined) tpl.type = body.type;
    if (body.title !== undefined) tpl.title = body.title;
    if (body.content !== undefined) tpl.content = body.content;
    if (body.extra !== undefined) tpl.extra = body.extra;
    tpl.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '已保存', data: tpl });
  }),
  http.delete('/api/channels/templates/:id', ({ params }) => {
    const idx = mockChannelTemplates.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '模板不存在', data: null }, { status: 404 });
    mockChannelTemplates.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '已删除', data: null });
  }),

  // ── 客服绩效统计（需先于 /api/channels/cs/:id/* 注册） ──────
  http.get('/api/channels/cs/performance', () => {
    const data: ChannelCsPerformance[] = MOCK_CS_AGENTS.map((a) => {
      const replyCount = mockChannelMessages.filter((m) => m.direction === 'out' && m.senderUserId === a.id).length;
      let resolvedCount = 0;
      let ratingSum = 0;
      let ratingN = 0;
      convAttrs.forEach((attr) => {
        if (attr.status === 'resolved' && attr.assigneeId === a.id) resolvedCount++;
        if (attr.assigneeId === a.id && attr.rating != null) { ratingSum += attr.rating; ratingN++; }
      });
      return {
        agentId: a.id, agentName: a.name, replyCount, resolvedCount,
        avgResponseMinutes: null,
        avgRating: ratingN ? Math.round((ratingSum / ratingN) * 10) / 10 : null,
      };
    });
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // ── 订阅者管理（需先于 /api/channels/admin/:id/messages 与 /api/channels/:id/* 注册） ──
  http.get('/api/channels/admin/:id/subscribers/export', ({ params }) => {
    const channelId = Number(params.id);
    const ch = mockChannels.find((c) => c.id === channelId);
    return HttpResponse.json({ code: 0, message: 'ok', data: listSubscribers(channelId, ch?.type === 'system') });
  }),
  http.get('/api/channels/admin/:id/subscribers', ({ params, request }) => {
    const channelId = Number(params.id);
    const ch = mockChannels.find((c) => c.id === channelId);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
    const keyword = (url.searchParams.get('keyword') ?? '').trim();
    const all = listSubscribers(channelId, ch?.type === 'system');
    const filtered = keyword ? all.filter((s) => s.name.includes(keyword) || String(s.userId).includes(keyword)) : all;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: filtered.length, page, pageSize } });
  }),
  http.post('/api/channels/admin/:id/subscribers', async ({ params, request }) => {
    const channelId = Number(params.id);
    const body = await request.json() as { userIds: number[] };
    addSubscribers(channelId, body.userIds ?? []);
    return HttpResponse.json({ code: 0, message: '已添加', data: null });
  }),
  http.delete('/api/channels/admin/:id/subscribers/:userId', ({ params }) => {
    removeSubscriber(Number(params.id), Number(params.userId));
    return HttpResponse.json({ code: 0, message: '已移除', data: null });
  }),

  // ── 测试发送 / 用户评价客服（需先于 /api/channels/:id 注册） ──
  http.post('/api/channels/:id/test-send', async ({ params, request }) => {
    const channelId = Number(params.id);
    const body = await request.json() as PublishBody;
    const msg: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId, audienceType: 'targeted', type: 'text', title: null, content: '',
      extra: null, publishedById: MOCK_CURRENT_USER_ID, direction: 'out', senderUserId: null, senderUserName: null, isRead: false,
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: MOCK_CURRENT_USER_ID,
    };
    applyPublishFields(msg, body);
    msg.audienceType = 'targeted';
    msg.status = 'sent';
    msg.scheduledAt = null;
    msg.convUserId = MOCK_CURRENT_USER_ID;
    mockChannelMessages.unshift(msg);
    return HttpResponse.json({ code: 0, message: '测试消息已发送，请在消息中心查看', data: msg });
  }),
  http.post('/api/channels/:id/rate', async ({ params, request }) => {
    const channelId = Number(params.id);
    const body = await request.json() as { rating: number; comment?: string | null };
    setConvAttr(channelId, MOCK_CURRENT_USER_ID, { rating: body.rating, ratingComment: body.comment ?? null, ratedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '感谢您的评价', data: null });
  }),

  // ── 客服快捷回复 ──────────────────────────────────────────
  http.get('/api/channels/cs/quick-replies', ({ request }) => {
    const raw = new URL(request.url).searchParams.get('channelId');
    const channelId = raw != null && raw !== '' && raw !== 'null' ? Number(raw) : null;
    const list = mockChannelQuickReplies
      .filter((q) => q.channelId == null || (channelId != null && q.channelId === channelId))
      .sort((a, b) => a.sort - b.sort || a.id - b.id);
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.post('/api/channels/cs/quick-replies', async ({ request }) => {
    const body = await request.json() as Partial<ChannelQuickReply> & { title: string; content: string };
    const channelId = body.channelId ?? null;
    const reply: ChannelQuickReply = {
      id: getNextQuickReplyId(),
      channelId,
      channelName: channelId != null ? (mockChannels.find((c) => c.id === channelId)?.name ?? null) : null,
      title: body.title,
      content: body.content,
      sort: body.sort ?? 0,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockChannelQuickReplies.push(reply);
    return HttpResponse.json({ code: 0, message: '创建成功', data: reply });
  }),

  http.put('/api/channels/cs/quick-replies/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as Partial<ChannelQuickReply>;
    const reply = mockChannelQuickReplies.find((q) => q.id === id);
    if (!reply) return HttpResponse.json({ code: 404, message: '快捷回复不存在', data: null }, { status: 404 });
    if (body.channelId !== undefined) {
      reply.channelId = body.channelId;
      reply.channelName = body.channelId != null ? (mockChannels.find((c) => c.id === body.channelId)?.name ?? null) : null;
    }
    if (body.title !== undefined) reply.title = body.title;
    if (body.content !== undefined) reply.content = body.content;
    if (body.sort !== undefined) reply.sort = body.sort;
    reply.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '更新成功', data: reply });
  }),

  http.delete('/api/channels/cs/quick-replies/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockChannelQuickReplies.findIndex((q) => q.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '快捷回复不存在', data: null }, { status: 404 });
    mockChannelQuickReplies.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ── 消息记录管理（编辑/删除/立即发送单条；需先于 admin/:id/* 注册） ──────────
  http.put('/api/channels/admin/messages/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const msg = mockChannelMessages.find((m) => m.id === id);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    if (msg.status === 'sent') return HttpResponse.json({ code: 400, message: '已发送消息不可编辑', data: null }, { status: 400 });
    const body = await request.json() as PublishBody;
    applyPublishFields(msg, body);
    return HttpResponse.json({ code: 0, message: '更新成功', data: msg });
  }),

  http.delete('/api/channels/admin/messages/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockChannelMessages.findIndex((m) => m.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    if (mockChannelMessages[idx].status === 'sent') return HttpResponse.json({ code: 400, message: '已发送消息不可删除', data: null }, { status: 400 });
    mockChannelMessages.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  http.post('/api/channels/admin/messages/:id/publish', ({ params }) => {
    const id = Number(params.id);
    const msg = mockChannelMessages.find((m) => m.id === id);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    msg.status = 'sent';
    msg.scheduledAt = null;
    msg.createdAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '已发送', data: msg });
  }),

  // 撤回已发送消息（F）
  http.post('/api/channels/admin/messages/:id/retract', ({ params }) => {
    const id = Number(params.id);
    const msg = mockChannelMessages.find((m) => m.id === id);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    if (msg.status !== 'sent') return HttpResponse.json({ code: 400, message: '仅已发送的消息可撤回', data: null }, { status: 400 });
    msg.isRetracted = true;
    msg.retractedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '已撤回', data: null });
  }),

  // 消息记录列表（某频道全部 out 消息，可按状态过滤）
  http.get('/api/channels/admin/:id/messages', ({ params, request }) => {
    const channelId = Number(params.id);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
    const status = url.searchParams.get('status') as ChannelMessageStatus | null;
    const all = mockChannelMessages
      .filter((m) => m.channelId === channelId && m.direction === 'out' && (!status || m.status === status))
      .sort((a, b) => b.id - a.id);
    const total = all.length;
    const list = all.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

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
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: MOCK_CURRENT_USER_ID,
    };
    mockChannelMessages.push(inMsg);
    // 会话治理：用户来信 → 激活会话（resolved 重新打开）
    if (getConvAttr(channelId, MOCK_CURRENT_USER_ID).status === 'resolved') {
      setConvAttr(channelId, MOCK_CURRENT_USER_ID, { status: 'open', resolvedAt: null });
    }

    const matched = matchAutoReply(channelId, body.content, 'message');
    let autoReply: ChannelMessage | null = null;
    if (matched) {
      matched.hitCount += 1;
      const isImage = matched.replyType === 'image';
      const isNews = matched.replyType === 'news';
      const ex = matched.replyExtra;
      const out: MockChannelMessage = {
        id: getNextChannelMessageId(), channelId, audienceType: 'targeted',
        type: matched.replyType === 'card' ? 'text' : matched.replyType, title: null,
        content: isImage ? (ex?.imageUrl ?? '') : (matched.replyContent || ex?.summary || ''),
        extra: isNews ? { card: { title: ex?.title ?? '图文消息', text: ex?.summary ?? null, cover: ex?.cover ?? null, actions: ex?.linkUrl ? [{ key: 'open', label: '查看详情', action: 'link', url: ex.linkUrl }] : null, source: '图文', status: null } } : null,
        publishedById: null, direction: 'out',
        senderUserId: null, senderUserName: null, isRead: true,
        createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: MOCK_CURRENT_USER_ID,
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
    const body = await request.json() as Partial<ChannelAutoReply> & { matchType: ChannelAutoReply['matchType']; replyContent?: string };
    const rule: ChannelAutoReply = {
      id: getNextAutoReplyId(), channelId,
      matchType: body.matchType,
      keyword: body.matchType === 'keyword' ? (body.keyword ?? null) : null,
      keywordMode: body.keywordMode ?? 'contains',
      replyType: body.replyType ?? 'text',
      replyContent: body.replyContent ?? '',
      replyExtra: body.replyExtra ?? null,
      hitCount: 0,
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
    if (body.replyType !== undefined) rule.replyType = body.replyType;
    if (body.replyContent !== undefined) rule.replyContent = body.replyContent;
    if (body.replyExtra !== undefined) rule.replyExtra = body.replyExtra;
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

  http.get('/api/channels/cs/agents', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: MOCK_CS_AGENTS });
  }),

  http.get('/api/channels/cs/:id/conversations', ({ params, request }) => {
    const channelId = Number(params.id);
    const url = new URL(request.url);
    const fStatus = url.searchParams.get('status') as ConvAttr['status'] | null;
    const fAssignee = url.searchParams.get('assignee');
    const fKeyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
    const fTag = url.searchParams.get('tag');
    const ins = mockChannelMessages.filter((m) => m.channelId === channelId && m.direction === 'in').sort((a, b) => a.id - b.id);
    const userIds = [...new Set(ins.map((m) => m.senderUserId).filter((x): x is number => x != null))];
    let list: ChannelConversation[] = userIds.map((uid) => {
      const userIns = ins.filter((m) => m.senderUserId === uid);
      const outs = mockChannelMessages.filter((m) => m.channelId === channelId && m.direction === 'out' && m.convUserId === uid).sort((a, b) => a.id - b.id);
      const lastIn = userIns[userIns.length - 1];
      const lastOut = outs.length ? outs[outs.length - 1] : null;
      const lastAgentOutId = outs.reduce((max, o) => (o.senderUserId != null && o.id > max ? o.id : max), 0);
      const useIn = !lastOut || lastIn.id > lastOut.id;
      const attr = getConvAttr(channelId, uid);
      return {
        channelId, userId: uid,
        userName: lastIn.senderUserName ?? `用户#${uid}`,
        userAvatar: null,
        lastMessage: useIn ? lastIn.content : lastOut!.content,
        lastDirection: useIn ? 'in' as const : 'out' as const,
        lastMessageAt: useIn ? lastIn.createdAt : lastOut!.createdAt,
        unreadCount: userIns.filter((m) => m.id > lastAgentOutId).length,
        messageCount: userIns.length + outs.length,
        status: attr.status,
        assigneeId: attr.assigneeId,
        assigneeName: agentName(attr.assigneeId),
        tags: attr.tags,
        resolvedAt: attr.resolvedAt,
        rating: attr.rating,
        ratingComment: attr.ratingComment,
        ratedAt: attr.ratedAt,
      };
    }).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    if (fStatus) list = list.filter((c) => c.status === fStatus);
    if (fAssignee === 'mine') list = list.filter((c) => c.assigneeId === MOCK_CURRENT_USER_ID);
    else if (fAssignee === 'unassigned') list = list.filter((c) => c.assigneeId == null);
    if (fTag) list = list.filter((c) => c.tags.includes(fTag));
    if (fKeyword) list = list.filter((c) => c.userName.toLowerCase().includes(fKeyword) || c.lastMessage.toLowerCase().includes(fKeyword));
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
    const outIds = all.filter((m) => m.direction === 'out' && m.audienceType === 'targeted').map((m) => m.id);
    const maxOutId = outIds.length ? Math.max(...outIds) : 0;
    // Q3 已读回执：最新一条客服消息显示「已送达」，更早的显示「已读」
    const list = all.slice((page - 1) * pageSize, page * pageSize).map((m) =>
      (m.direction === 'out' && m.audienceType === 'targeted')
        ? { ...m, readByTarget: m.id !== maxOutId }
        : m,
    );
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
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: userId,
    };
    mockChannelMessages.push(out);
    // 会话治理：客服回复 → 处理中
    setConvAttr(channelId, userId, { status: 'processing', resolvedAt: null });
    return HttpResponse.json({ code: 0, message: '已回复', data: out });
  }),

  // ── 会话治理（指派/转接 · 解决 · 标签 · 客服列表） ──────────
  http.post('/api/channels/cs/:id/conversations/:userId/assign', async ({ params, request }) => {
    const channelId = Number(params.id);
    const userId = Number(params.userId);
    const body = await request.json() as { assigneeId: number | null };
    setConvAttr(channelId, userId, { assigneeId: body.assigneeId });
    return HttpResponse.json({ code: 0, message: '已指派', data: null });
  }),

  http.post('/api/channels/cs/:id/conversations/:userId/resolve', ({ params }) => {
    const channelId = Number(params.id);
    const userId = Number(params.userId);
    setConvAttr(channelId, userId, { status: 'resolved', resolvedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '已解决', data: null });
  }),

  http.put('/api/channels/cs/:id/conversations/:userId/tags', async ({ params, request }) => {
    const channelId = Number(params.id);
    const userId = Number(params.userId);
    const body = await request.json() as { tags: string[] };
    setConvAttr(channelId, userId, { tags: body.tags });
    return HttpResponse.json({ code: 0, message: '已保存', data: null });
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
    const channelId = Number(params.id);
    const body = await request.json() as PublishBody;
    const msg: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId, audienceType: 'broadcast', type: 'text', title: null, content: '',
      extra: null, publishedById: MOCK_CURRENT_USER_ID, direction: 'out', senderUserId: null, senderUserName: null, isRead: false,
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: null,
    };
    applyPublishFields(msg, body);
    mockChannelMessages.unshift(msg);
    const okMsg = msg.status === 'draft' ? '已保存草稿' : msg.status === 'scheduled' ? '已设置定时发送' : '已发布';
    return HttpResponse.json({ code: 0, message: okMsg, data: msg });
  }),

  // 群发受众预估
  http.post('/api/channels/audience-estimate', async ({ request }) => {
    const body = await request.json() as { audience: { mode: string; userIds?: number[]; departmentIds?: number[]; roleIds?: number[] } };
    const a = body.audience;
    let count = 88;
    if (a.mode === 'users') count = a.userIds?.length ?? 0;
    else if (a.mode === 'departments') count = (a.departmentIds?.length ?? 0) * 12;
    else if (a.mode === 'roles') count = (a.roleIds?.length ?? 0) * 25;
    return HttpResponse.json({ code: 0, message: 'ok', data: { count } });
  }),

  // 频道数据看板（I）
  http.get('/api/channels/dashboard', () => {
    const outs = mockChannelMessages.filter((m) => m.direction === 'out' && m.status === 'sent' && !m.isRetracted);
    const ins = mockChannelMessages.filter((m) => m.direction === 'in');
    const trend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date, inbound: Math.max(0, Math.round(ins.length / 7) + ((i * 3) % 5)), outbound: Math.max(0, Math.round(outs.length / 7) + ((i * 2) % 4)) };
    });
    const topReplies = [...mockChannelAutoReplies].sort((a, b) => b.hitCount - a.hitCount).slice(0, 5)
      .map((r) => ({ id: r.id, channelName: mockChannels.find((c) => c.id === r.channelId)?.name ?? '', keyword: r.keyword, matchType: r.matchType, hitCount: r.hitCount }));
    const bizChannels = mockChannels.filter((c) => c.type === 'business');
    const channelRank = bizChannels.map((c) => ({
      channelId: c.id, channelName: c.name,
      messageCount: mockChannelMessages.filter((m) => m.channelId === c.id && m.direction === 'out' && !m.isRetracted).length,
      subscriberCount: c.id === 3 ? 3 : 0,
    })).sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
    return HttpResponse.json({
      code: 0, message: 'ok',
      data: {
        overview: { businessChannelCount: bizChannels.length, subscriptionCount: 5, messageCount: outs.length, todayPushCount: 3, openConversationCount: 2, avgResponseMinutes: 8 },
        trend,
        statusDist: { open: 2, processing: 1, resolved: 4 },
        readRate: 76,
        topReplies,
        channelRank,
      },
    });
  }),

  // ── 订阅（运营号） ────────────────────────────────────────
  http.get('/api/channels/discoverable', ({ request }) => {
    const keyword = (new URL(request.url).searchParams.get('keyword') ?? '').trim().toLowerCase();
    let list = mockChannels.filter((ch) => ch.type === 'business' && !ch.isSubscribed);
    if (keyword) list = list.filter((ch) => ch.name.toLowerCase().includes(keyword));
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
