import { channelContract, channelCsContract, channelDashboardContract, channelMessageContract } from '@zenith/shared/messaging';
import type {
  Channel, ChannelAdmin, ChannelAutoReply, ChannelConversation, ChannelConversationStatus, ChannelCsPerformance,
  ChannelDashboard, ChannelMenu, ChannelMessage, ChannelMessageTemplate, ChannelQuickReply, ChannelSubscriber,
} from '@zenith/shared/messaging';
import type { PublishChannelInput } from '@zenith/shared/mp';
import type { ChatMessageExtra } from '@zenith/shared/chat';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
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
interface ConvAttr { status: ChannelConversationStatus; assigneeId: number | null; tags: string[]; resolvedAt: string | null; rating: number | null; ratingComment: string | null; ratedAt: string | null; }
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

/** 由群发请求体构造消息 extra（仅图文生成卡片，其余为 null） */
function buildPublishExtra(body: PublishChannelInput): ChatMessageExtra | null {
  if (body.type !== 'news') return null;
  const linkUrl = body.linkUrl?.trim();
  return {
    card: {
      title: (body.title ?? '').trim() || '图文消息',
      text: body.summary ?? null,
      cover: body.cover ?? null,
      bodyHtml: body.bodyHtml?.trim() || null,
      actions: linkUrl ? [{ key: 'open', label: '查看详情', action: 'link', url: linkUrl }] : null,
      source: '图文',
      status: null,
    },
  };
}

/** 将群发请求体写入消息（复用于新建与编辑），保留 id/channelId/createdAt 等不变字段 */
function applyPublishFields(msg: MockChannelMessage, body: PublishChannelInput): void {
  msg.type = body.type;
  msg.title = body.title ?? null;
  // 图文的 content 为正文纯文本摘录（与真实后端一致）
  msg.content = body.type === 'news'
    ? (body.bodyHtml ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) || (body.summary ?? '')
    : body.content;
  msg.extra = buildPublishExtra(body);
  msg.audienceType = body.audience.mode === 'all' ? 'broadcast' : 'targeted';
  msg.status = body.sendMode === 'draft' ? 'draft' : body.sendMode === 'scheduled' ? 'scheduled' : 'sent';
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

function toAdminView(c: Channel): ChannelAdmin {
  return {
    id: c.id, code: c.code, name: c.name, avatar: c.avatar, description: c.description,
    type: c.type, builtin: c.builtin, status: c.status,
    subscriberCount: c.type === 'system' ? 4 : (c.id === 3 ? 3 : 0),
    messageCount: mockChannelMessages.filter((m) => m.channelId === c.id).length,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

function buildDashboard(): ChannelDashboard {
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
  // 近 30 天新增订阅：确定性伪随机波动（无真实订阅时间数据）
  const subscriptionTrend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, count: (i * 7) % 5 + (i % 3 === 0 ? 2 : 0) };
  });
  const typeCounts = new Map<ChannelMessage['type'], number>();
  for (const m of outs) typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1);
  const messageTypeDist = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  const hourlyDist = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hour >= 9 && hour <= 18 ? (hour * 5) % 7 + 3 : (hour % 3 === 0 ? 1 : 0),
  }));
  const ratedAttrs = [...convAttrs.values()].filter((a) => a.rating != null);
  const ratingCounts = new Map<number, number>([[4, 2], [5, 3]]);
  for (const a of ratedAttrs) ratingCounts.set(a.rating as number, (ratingCounts.get(a.rating as number) ?? 0) + 1);
  const ratingDistArr = Array.from({ length: 5 }, (_, i) => ({ rating: i + 1, count: ratingCounts.get(i + 1) ?? 0 }));
  const ratingTotal = ratingDistArr.reduce((s, d) => s + d.count, 0);
  const avgRating = ratingTotal === 0 ? null : Math.round((ratingDistArr.reduce((s, d) => s + d.rating * d.count, 0) / ratingTotal) * 10) / 10;
  const matchCounts = new Map<ChannelAutoReply['matchType'], number>();
  for (const r of mockChannelAutoReplies) {
    if (r.hitCount > 0) matchCounts.set(r.matchType, (matchCounts.get(r.matchType) ?? 0) + r.hitCount);
  }
  const autoReplyMatchDist = [...matchCounts.entries()].map(([matchType, count]) => ({ matchType, count }));
  return {
    overview: { businessChannelCount: bizChannels.length, subscriptionCount: 5, messageCount: outs.length, todayPushCount: 3, openConversationCount: 2, avgResponseMinutes: 8 },
    trend,
    statusDist: { open: 2, processing: 1, resolved: 4 },
    readRate: 76,
    topReplies,
    channelRank,
    subscriptionTrend,
    messageTypeDist,
    hourlyDist,
    ratingDist: { avgRating, dist: ratingDistArr },
    autoReplyMatchDist,
  };
}

export const channelsHandlers = [
  // ══ 频道功能扩展：消息记录管理 + 客服快捷回复 ══════════════════════════════
  // 注：MSW 按注册顺序匹配，静态路径（/templates、/cs/*、/admin/*）须先于同段位的 /:id/* 注册。

  // ── 群发消息模板库 ──────
  mock(channelMessageContract.templates, ({ ok }) => ok([...mockChannelTemplates].sort((a, b) => b.id - a.id))),
  mock(channelMessageContract.createTemplate, ({ body, ok }) => {
    const now = mockDateTime();
    const tpl: ChannelMessageTemplate = {
      id: getNextTemplateId(), name: body.name, type: body.type,
      title: body.title ?? null, content: body.content, extra: (body.extra as ChatMessageExtra | null | undefined) ?? null,
      createdAt: now, updatedAt: now,
    };
    mockChannelTemplates.push(tpl);
    return ok(tpl, '已创建');
  }),
  mock(channelMessageContract.updateTemplate, ({ params, body, ok }) => {
    const tpl = mockChannelTemplates.find((t) => t.id === params.id);
    if (!tpl) return notFound('模板不存在', { status: 404 });
    if (body.name !== undefined) tpl.name = body.name;
    if (body.type !== undefined) tpl.type = body.type;
    if (body.title !== undefined) tpl.title = body.title;
    if (body.content !== undefined) tpl.content = body.content;
    if (body.extra !== undefined) tpl.extra = body.extra as ChatMessageExtra | null;
    tpl.updatedAt = mockDateTime();
    return ok(tpl, '已保存');
  }),
  mock(channelMessageContract.removeTemplate, ({ params, ok }) => {
    const idx = mockChannelTemplates.findIndex((t) => t.id === params.id);
    if (idx === -1) return notFound('模板不存在', { status: 404 });
    mockChannelTemplates.splice(idx, 1);
    return ok(null, '已删除');
  }),

  // ── 客服绩效统计 ──────
  mock(channelCsContract.csPerformance, ({ ok }) => {
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
    return ok(data);
  }),

  // ── 订阅者管理 ──
  mock(channelContract.subscribers, ({ params, query, ok, paginate }) => {
    const ch = mockChannels.find((c) => c.id === params.id);
    const keyword = (query.keyword ?? '').trim();
    const all = listSubscribers(params.id, ch?.type === 'system');
    const filtered = keyword ? all.filter((s) => s.name.includes(keyword) || String(s.userId).includes(keyword)) : all;
    return ok(paginate(filtered));
  }),
  mock(channelContract.addSubscribers, ({ params, body, ok }) => {
    addSubscribers(params.id, body.userIds);
    return ok(null, '已添加');
  }),
  mock(channelContract.removeSubscriber, ({ params, ok }) => {
    removeSubscriber(params.id, params.userId);
    return ok(null, '已移除');
  }),

  // ── 测试发送 / 用户评价客服 ──
  mock(channelMessageContract.testSend, ({ params, body, ok }) => {
    const msg: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId: params.id, audienceType: 'targeted', type: 'text', title: null, content: '',
      extra: null, publishedById: MOCK_CURRENT_USER_ID, direction: 'out', senderUserId: null, senderUserName: null, isRead: false,
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: MOCK_CURRENT_USER_ID,
    };
    applyPublishFields(msg, body);
    msg.audienceType = 'targeted';
    msg.status = 'sent';
    msg.scheduledAt = null;
    msg.convUserId = MOCK_CURRENT_USER_ID;
    mockChannelMessages.unshift(msg);
    return ok(msg, '测试消息已发送，请在消息中心查看');
  }),
  mock(channelContract.rate, ({ params, body, ok }) => {
    setConvAttr(params.id, MOCK_CURRENT_USER_ID, { rating: body.rating, ratingComment: body.comment ?? null, ratedAt: mockDateTime() });
    return ok(null, '感谢您的评价');
  }),

  // ── 客服快捷回复 ──────────────────────────────────────────
  mock(channelCsContract.quickReplies, ({ query, ok }) => {
    const channelId = query.channelId ?? null;
    const list = mockChannelQuickReplies
      .filter((q) => q.channelId == null || (channelId != null && q.channelId === channelId))
      .sort((a, b) => a.sort - b.sort || a.id - b.id);
    return ok(list);
  }),

  mock(channelCsContract.createQuickReply, ({ body, ok }) => {
    const channelId = body.channelId ?? null;
    const reply: ChannelQuickReply = {
      id: getNextQuickReplyId(),
      channelId,
      channelName: channelId != null ? (mockChannels.find((c) => c.id === channelId)?.name ?? null) : null,
      title: body.title,
      content: body.content,
      sort: body.sort,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockChannelQuickReplies.push(reply);
    return ok(reply, '创建成功');
  }),

  mock(channelCsContract.updateQuickReply, ({ params, body, ok }) => {
    const reply = mockChannelQuickReplies.find((q) => q.id === params.id);
    if (!reply) return notFound('快捷回复不存在', { status: 404 });
    if (body.channelId !== undefined) {
      reply.channelId = body.channelId;
      reply.channelName = body.channelId != null ? (mockChannels.find((c) => c.id === body.channelId)?.name ?? null) : null;
    }
    if (body.title !== undefined) reply.title = body.title;
    if (body.content !== undefined) reply.content = body.content;
    if (body.sort !== undefined) reply.sort = body.sort;
    reply.updatedAt = mockDateTime();
    return ok(reply, '更新成功');
  }),

  mock(channelCsContract.removeQuickReply, ({ params, ok }) => {
    const idx = mockChannelQuickReplies.findIndex((q) => q.id === params.id);
    if (idx === -1) return notFound('快捷回复不存在', { status: 404 });
    mockChannelQuickReplies.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ── 消息记录管理（编辑/删除/立即发送单条）──────────
  mock(channelMessageContract.updateDraft, ({ params, body, ok }) => {
    const msg = mockChannelMessages.find((m) => m.id === params.id);
    if (!msg) return notFound('消息不存在', { status: 404 });
    if (msg.status === 'sent') return badRequest('已发送消息不可编辑', { status: 400 });
    applyPublishFields(msg, body);
    return ok(msg, '更新成功');
  }),

  mock(channelMessageContract.removeDraft, ({ params, ok }) => {
    const idx = mockChannelMessages.findIndex((m) => m.id === params.id);
    if (idx === -1) return notFound('消息不存在', { status: 404 });
    if (mockChannelMessages[idx].status === 'sent') return badRequest('已发送消息不可删除', { status: 400 });
    mockChannelMessages.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(channelMessageContract.publishDraftNow, ({ params, ok }) => {
    const msg = mockChannelMessages.find((m) => m.id === params.id);
    if (!msg) return notFound('消息不存在', { status: 404 });
    msg.status = 'sent';
    msg.scheduledAt = null;
    msg.createdAt = mockDateTime();
    return ok(msg, '已发送');
  }),

  mock(channelMessageContract.retract, ({ params, ok }) => {
    const msg = mockChannelMessages.find((m) => m.id === params.id);
    if (!msg) return notFound('消息不存在', { status: 404 });
    if (msg.status !== 'sent') return badRequest('仅已发送的消息可撤回', { status: 400 });
    msg.isRetracted = true;
    msg.retractedAt = mockDateTime();
    return ok(null, '已撤回');
  }),

  // 消息记录列表（某频道全部 out 消息，可按状态过滤）
  mock(channelMessageContract.adminMessages, ({ params, query, ok, paginate }) => {
    const all = mockChannelMessages
      .filter((m) => m.channelId === params.id && m.direction === 'out' && (!query.status || m.status === query.status))
      .sort((a, b) => b.id - a.id);
    return ok(paginate(all));
  }),

  // 我的频道列表（含未读数）
  mock(channelContract.mine, ({ ok }) => {
    const list = mockChannels.filter((ch) => ch.isSubscribed).map((ch) => {
      const msgs = mockChannelMessages.filter((m) => visibleToCurrentUser(m, ch.id));
      const last = msgs.length ? [...msgs].sort((a, b) => b.id - a.id)[0] : null;
      return { ...ch, unreadCount: msgs.filter((m) => !m.isRead).length, lastMessage: last };
    });
    return ok(list);
  }),

  // 频道消息流（分页，按时间倒序）——当前用户视角
  mock(channelContract.messages, ({ params, ok, paginate }) => {
    const all = mockChannelMessages.filter((m) => visibleToCurrentUser(m, params.id)).sort((a, b) => b.id - a.id);
    return ok(paginate(all));
  }),

  // 标记频道已读
  mock(channelContract.markRead, ({ params, ok }) => {
    mockChannelMessages.forEach((m) => {
      if (m.channelId === params.id) m.isRead = true;
    });
    return ok(null, '已标记已读');
  }),

  // 用户向运营号发送消息（写 in + 命中自动回复写 out）
  mock(channelContract.send, ({ params, body, ok }) => {
    const channelId = params.id;
    const ch = mockChannels.find((c) => c.id === channelId);
    if (!ch) return notFound('频道不存在', { status: 404 });
    if (ch.type !== 'business') return badRequest('仅运营号支持该操作', { status: 400 });

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
    return ok({ message: inMsg, autoReply }, '已发送');
  }),

  // ── 底部菜单 ──────────────────────────────────────────────
  mock(channelContract.menus, ({ params, ok }) => ok(topMenus(params.id))),

  mock(channelContract.saveMenus, ({ params, body, ok }) => {
    const channelId = params.id;
    removeWhere(mockChannelMenus, (menu) => menu.channelId === channelId);
    body.menus.forEach((m, i) => {
      const topId = nextMenuId++;
      const children = (m.children ?? []).map((c, j) => ({
        id: nextMenuId++, channelId, parentId: topId, name: c.name, type: c.type, value: c.value ?? null, sort: j,
      }));
      mockChannelMenus.push({ id: topId, channelId, parentId: null, name: m.name, type: m.type, value: m.value ?? null, sort: i, children });
    });
    return ok(topMenus(channelId), '保存成功');
  }),

  // ── 自动回复 ──────────────────────────────────────────────
  mock(channelContract.autoReplies, ({ params, ok }) => {
    const list = mockChannelAutoReplies.filter((r) => r.channelId === params.id).sort((a, b) => a.sort - b.sort);
    return ok(list);
  }),

  mock(channelContract.createAutoReply, ({ params, body, ok }) => {
    const rule: ChannelAutoReply = {
      id: getNextAutoReplyId(), channelId: params.id,
      matchType: body.matchType,
      keyword: body.matchType === 'keyword' ? (body.keyword ?? null) : null,
      keywordMode: body.keywordMode,
      replyType: body.replyType,
      replyContent: body.replyContent,
      replyExtra: body.replyExtra ?? null,
      hitCount: 0,
      status: body.status,
      sort: body.sort,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockChannelAutoReplies.push(rule);
    return ok(rule, '创建成功');
  }),

  mock(channelContract.updateAutoReply, ({ params, body, ok }) => {
    const rule = mockChannelAutoReplies.find((r) => r.id === params.replyId);
    if (!rule) return notFound('自动回复规则不存在', { status: 404 });
    if (body.keyword !== undefined) rule.keyword = rule.matchType === 'keyword' ? body.keyword : null;
    if (body.keywordMode !== undefined) rule.keywordMode = body.keywordMode;
    if (body.replyType !== undefined) rule.replyType = body.replyType;
    if (body.replyContent !== undefined) rule.replyContent = body.replyContent;
    if (body.replyExtra !== undefined) rule.replyExtra = body.replyExtra;
    if (body.status !== undefined) rule.status = body.status;
    if (body.sort !== undefined) rule.sort = body.sort;
    rule.updatedAt = mockDateTime();
    return ok(rule, '更新成功');
  }),

  mock(channelContract.removeAutoReply, ({ params, ok }) => {
    const idx = mockChannelAutoReplies.findIndex((r) => r.id === params.replyId);
    if (idx === -1) return notFound('自动回复规则不存在', { status: 404 });
    mockChannelAutoReplies.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ── 客服工作台 ────────────────────────────────────────────
  mock(channelCsContract.csChannels, ({ ok }) => {
    const list = mockChannels.filter((c) => c.type === 'business' && c.status === 'enabled')
      .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }));
    return ok(list);
  }),

  mock(channelCsContract.csAgents, ({ ok }) => ok(MOCK_CS_AGENTS)),

  mock(channelCsContract.conversations, ({ params, query, ok }) => {
    const channelId = params.id;
    const fKeyword = (query.keyword ?? '').trim().toLowerCase();
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
    if (query.status) list = list.filter((c) => c.status === query.status);
    if (query.assignee === 'mine') list = list.filter((c) => c.assigneeId === MOCK_CURRENT_USER_ID);
    else if (query.assignee === 'unassigned') list = list.filter((c) => c.assigneeId == null);
    if (query.tag) list = list.filter((c) => c.tags.includes(query.tag!));
    if (fKeyword) list = list.filter((c) => c.userName.toLowerCase().includes(fKeyword) || c.lastMessage.toLowerCase().includes(fKeyword));
    return ok(list);
  }),

  mock(channelCsContract.conversationMessages, ({ params, ok, paginate }) => {
    const all = mockChannelMessages.filter((m) => m.channelId === params.id && m.convUserId === params.userId).sort((a, b) => b.id - a.id);
    const outIds = all.filter((m) => m.direction === 'out' && m.audienceType === 'targeted').map((m) => m.id);
    const maxOutId = outIds.length ? Math.max(...outIds) : 0;
    // 已读回执：最新一条客服消息显示「已送达」，更早的显示「已读」
    const page = paginate(all);
    const list = page.list.map((m) =>
      (m.direction === 'out' && m.audienceType === 'targeted')
        ? { ...m, readByTarget: m.id !== maxOutId }
        : m,
    );
    return ok({ ...page, list });
  }),

  mock(channelCsContract.reply, ({ params, body, ok }) => {
    const out: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId: params.id, audienceType: 'targeted', type: 'text', title: null,
      content: body.content, extra: null, publishedById: MOCK_CURRENT_USER_ID, direction: 'out',
      senderUserId: MOCK_CURRENT_USER_ID, senderUserName: CURRENT_USER_NAME, isRead: true,
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: params.userId,
    };
    mockChannelMessages.push(out);
    // 会话治理：客服回复 → 处理中
    setConvAttr(params.id, params.userId, { status: 'processing', resolvedAt: null });
    return ok(out, '已回复');
  }),

  // ── 会话治理（指派/转接 · 解决 · 标签） ──────────
  mock(channelCsContract.assign, ({ params, body, ok }) => {
    setConvAttr(params.id, params.userId, { assigneeId: body.assigneeId });
    return ok(null, '已指派');
  }),

  mock(channelCsContract.resolve, ({ params, ok }) => {
    setConvAttr(params.id, params.userId, { status: 'resolved', resolvedAt: mockDateTime() });
    return ok(null, '已解决');
  }),

  mock(channelCsContract.setTags, ({ params, body, ok }) => {
    setConvAttr(params.id, params.userId, { tags: body.tags });
    return ok(null, '已保存');
  }),

  // ── 管理后台 ──────────────────────────────────────────────
  mock(channelContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    const filtered = mockChannels.filter((c) => !keyword || c.name.includes(keyword) || c.code.includes(keyword));
    const page = paginate(filtered);
    return ok({ ...page, list: page.list.map(toAdminView) });
  }),

  mock(channelContract.create, ({ body, ok }) => {
    const id = nextIdFrom(mockChannels);
    const now = mockDateTime();
    const ch: Channel = {
      id, code: body.code, name: body.name, avatar: body.avatar ?? null, description: body.description ?? null,
      type: 'business', builtin: false, status: 'enabled', unreadCount: 0, lastMessage: null, isMuted: false, isSubscribed: false,
      tenantId: null,
      createdAt: now, updatedAt: now,
    };
    mockChannels.push(ch);
    return ok(toAdminView(ch), '创建成功');
  }),

  mock(channelContract.update, ({ params, body, ok }) => {
    const ch = mockChannels.find((c) => c.id === params.id);
    if (!ch) return notFound('频道不存在', { status: 404 });
    if (body.name !== undefined) ch.name = body.name;
    if (body.avatar !== undefined) ch.avatar = body.avatar;
    if (body.description !== undefined) ch.description = body.description;
    if (body.status !== undefined) ch.status = body.status;
    ch.updatedAt = mockDateTime();
    return ok(toAdminView(ch), '更新成功');
  }),

  mock(channelContract.remove, ({ params, ok }) => {
    const idx = mockChannels.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('频道不存在', { status: 404 });
    if (mockChannels[idx].builtin) return badRequest('内置系统号不可删除', { status: 400 });
    mockChannels.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(channelMessageContract.publish, ({ params, body, ok }) => {
    const msg: MockChannelMessage = {
      id: getNextChannelMessageId(), channelId: params.id, audienceType: 'broadcast', type: 'text', title: null, content: '',
      extra: null, publishedById: MOCK_CURRENT_USER_ID, direction: 'out', senderUserId: null, senderUserName: null, isRead: false,
      createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: null,
    };
    applyPublishFields(msg, body);
    mockChannelMessages.unshift(msg);
    const okMsg = msg.status === 'draft' ? '已保存草稿' : msg.status === 'scheduled' ? '已设置定时发送' : '已发布';
    return ok(msg, okMsg);
  }),

  // 群发受众预估
  mock(channelMessageContract.audienceEstimate, ({ body, ok }) => {
    const a = body.audience;
    let count = 88;
    if (a.mode === 'users') count = a.userIds?.length ?? 0;
    else if (a.mode === 'departments') count = (a.departmentIds?.length ?? 0) * 12;
    else if (a.mode === 'roles') count = (a.roleIds?.length ?? 0) * 25;
    return ok({ count });
  }),

  // 频道数据看板
  mock(channelDashboardContract.dashboard, ({ ok }) => ok(buildDashboard())),

  // ── 订阅（运营号） ────────────────────────────────────────
  mock(channelContract.discoverable, ({ query, ok }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    let list = mockChannels.filter((ch) => ch.type === 'business' && !ch.isSubscribed);
    if (keyword) list = list.filter((ch) => ch.name.toLowerCase().includes(keyword));
    return ok(list);
  }),

  mock(channelContract.subscribe, ({ params, ok }) => {
    const ch = mockChannels.find((c) => c.id === params.id);
    if (!ch) return notFound('频道不存在', { status: 404 });
    if (ch.type === 'system') return badRequest('系统号默认全员订阅', { status: 400 });
    ch.isSubscribed = true;
    return ok(null, '已订阅');
  }),

  mock(channelContract.unsubscribe, ({ params, ok }) => {
    const ch = mockChannels.find((c) => c.id === params.id);
    if (!ch) return notFound('频道不存在', { status: 404 });
    if (ch.type === 'system') return badRequest('系统号不可退订', { status: 400 });
    ch.isSubscribed = false;
    return ok(null, '已退订');
  }),
];
