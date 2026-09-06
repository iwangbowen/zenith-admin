import { chatContract } from '@zenith/shared/chat';
import type {
  ChatConversation, ChatCustomEmoji, ChatGroupInvite, ChatGroupJoinRequest, ChatGroupMember,
  ChatMessage, ChatQuickReply, ChatReadState, ChatReplySnapshot, ChatScheduledMessage,
} from '@zenith/shared/chat';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest, forbidden, notFound } from '@/mocks/utils/handlers';
import {
  mockChatConversations, mockChatUsers, getMockConvMessages,
  addMockMessage, getNextMsgId, mockChatMessages, mockGroupMembers,
} from '@/mocks/data/chat';
import { mockDepartments } from '@/mocks/data/departments';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

// 当前 demo 用户 ID（对应 admin = 1）
const CURRENT_USER_ID = 1;
const CURRENT_USER_NICKNAME = '管理员';

// ── 常用语（内存态） ──
const mockQuickReplies: ChatQuickReply[] = [
  { id: 1, content: '收到，我马上处理。', sort: 0, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, content: '好的，稍后同步进展。', sort: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 3, content: '这个问题我确认一下再回复你。', sort: 2, createdAt: mockDateTime(), updatedAt: mockDateTime() },
];
let nextQuickReplyId = 4;

// ── 定时消息（内存态） ──
const mockScheduledMessages: ChatScheduledMessage[] = [];
let nextScheduledId = 1;

// ── 自定义表情（内存态） ──
const mockCustomEmojis: ChatCustomEmoji[] = [];
let nextEmojiId = 1;

// ── 群邀请 / 入群申请（内存态） ──
const mockInvites: Record<number, ChatGroupInvite> = {};
let nextInviteId = 1;
const mockJoinRequests: ChatGroupJoinRequest[] = [];
let nextJoinRequestId = 1;

function convDisplayName(convId: number): string | null {
  const conv = mockChatConversations.find((c) => c.id === convId);
  if (!conv) return null;
  return conv.type === 'group' ? (conv.name ?? null) : (conv.targetUser?.nickname ?? null);
}

function newInvite(conversationId: number): ChatGroupInvite {
  return {
    id: nextInviteId++,
    conversationId,
    token: `mock-invite-${conversationId}-${Math.random().toString(16).slice(2, 10)}`,
    expiresAt: mockDateTimeOffset(7 * 24 * 3600 * 1000),
    maxUses: null,
    usedCount: 0,
    enabled: true,
    createdAt: mockDateTime(),
  };
}

function addSystemMessage(conversationId: number, content: string, extra: ChatMessage['extra'] = null) {
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
    extra,
    reactions: [],
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  };
  addMockMessage(newMsg);
}

function buildSearchSnippet(msg: ChatMessage): string {
  if (msg.type === 'image') return `[图片] ${msg.extra?.asset?.name ?? ''}`.trim();
  if (msg.type === 'file') return `[文件] ${msg.extra?.asset?.name ?? ''}`.trim();
  return msg.content;
}

export const chatHandlers = [
  // 链接预览
  mock(chatContract.linkPreview, ({ query, ok }) => {
    const parsed = new URL(query.url);
    const isImageUrl = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(parsed.pathname);

    return ok({
      url: parsed.toString(),
      title: isImageUrl ? (parsed.pathname.split('/').pop() || parsed.hostname) : parsed.hostname,
      description: `这是 ${parsed.hostname} 的链接预览（Demo）`,
      siteName: parsed.hostname,
      image: isImageUrl ? parsed.toString() : null,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  }),

  // 可聊天用户搜索
  mock(chatContract.users, ({ query, ok }) => {
    const keyword = query.keyword ?? '';
    const filtered = keyword
      ? mockChatUsers.filter((u) =>
          u.nickname.includes(keyword) || u.username.includes(keyword),
        )
      : mockChatUsers;
    return ok(filtered);
  }),

  // 组织架构选人数据（部门 + 用户）
  mock(chatContract.orgUsers, ({ ok }) => {
    return ok({
      departments: mockDepartments
        .filter((d) => d.status === 'enabled')
        .map((d) => ({ id: d.id, name: d.name, parentId: d.parentId })),
      users: mockUsers
        .filter((u) => u.id !== CURRENT_USER_ID && u.status === 'enabled')
        .map((u) => ({
          id: u.id, nickname: u.nickname, username: u.username,
          avatar: u.avatar ?? null, departmentId: u.departmentId ?? null,
        })),
    });
  }),

  // 会话列表
  mock(chatContract.conversations, ({ ok }) => {
    const data = [...mockChatConversations].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(a.lastMessage?.createdAt ?? a.updatedAt);
    });
    return ok(data);
  }),

  mock(chatContract.globalFavoriteMessages, ({ ok, paginate }) => {
    const all = mockChatMessages.filter((m) => m.extra?.isFavorited).slice().reverse();
    return ok(paginate(all));
  }),

  // 全局消息搜索
  mock(chatContract.globalSearch, ({ query, ok, paginate }) => {
    const keyword = query.keyword.toLowerCase();
    const all = mockChatMessages.filter((m) => {
      if (m.isRecalled) return false;
      return includesKeyword(keyword, m.content, m.extra?.asset?.name, { caseInsensitive: true });
    });
    const page = paginate(all);
    const conversationNames: Record<string, string> = {};
    for (const msg of page.list) {
      const conv = mockChatConversations.find((c) => c.id === msg.conversationId);
      if (conv) {
        conversationNames[String(msg.conversationId)] = conv.type === 'direct'
          ? (conv.targetUser?.nickname ?? '私聊')
          : (conv.name ?? '群聊');
      }
    }
    return ok({
      ...page,
      list: page.list.map((msg) => ({ message: msg, snippet: buildSearchSnippet(msg) })),
      conversationNames,
    });
  }),

  // 创建/获取单聊
  mock(chatContract.createDirect, ({ body, ok }) => {
    const targetUser = requireItem(mockChatUsers, body.targetUserId, '用户不存在', { status: 404 });

    const existing = mockChatConversations.find(
      (c) => c.type === 'direct' && c.targetUser?.id === body.targetUserId,
    );
    if (existing) return ok(existing);

    const newConv: ChatConversation = {
      id: mockChatConversations.length + 100,
      type: 'direct',
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
    return ok(newConv);
  }),

  // 消息列表（游标分页，最新在前）
  mock(chatContract.messages, ({ params, query, ok }) => {
    const { beforeId, limit = 30 } = query;
    const all = getMockConvMessages(params.id).slice().sort((a, b) => b.id - a.id); // 最新在前（按 id 降序）
    const filtered = beforeId === undefined ? all : all.filter((m) => m.id < beforeId);
    const batch = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;

    return ok({ list: batch, hasMore });
  }),

  // 发送消息
  mock(chatContract.sendMessage, ({ params, body, ok }) => {
    const newMsg: ChatMessage = {
      id: getNextMsgId(),
      conversationId: params.id,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER_NICKNAME,
      senderAvatar: null,
      type: body.type,
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
    return ok(newMsg);
  }),

  // 撤回消息
  mock(chatContract.recallMessage, ({ params, ok }) => {
    const msg = requireItem(mockChatMessages, params.id, '消息不存在', { status: 404 });
    if (msg.senderId !== CURRENT_USER_ID) {
      return forbidden('只能撤回自己的消息', { status: 403 });
    }
    msg.isRecalled = true;
    msg.content = '消息已撤回';
    return ok(null);
  }),

  mock(chatContract.favoriteMessage, ({ params, body, ok }) => {
    const msg = requireItem(mockChatMessages, params.id, '消息不存在', { status: 404 });
    msg.extra = { ...(msg.extra || {}), isFavorited: body.favorite };
    msg.updatedAt = mockDateTime();
    return ok(msg);
  }),

  mock(chatContract.pinMessage, ({ params, body, ok }) => {
    const msg = requireItem(mockChatMessages, params.id, '消息不存在', { status: 404 });
    msg.extra = { ...(msg.extra || {}), isPinned: body.pin };
    msg.updatedAt = mockDateTime();
    return ok(msg);
  }),

  // 投票
  mock(chatContract.vote, ({ params, body, ok }) => {
    const msg = requireItem(mockChatMessages, params.id, '消息不存在', { status: 404 });
    if (msg.type !== 'vote') return badRequest('该消息不是投票类型', { status: 400 });

    const voteData = msg.extra?.voteData;
    if (!voteData) return badRequest('投票数据异常', { status: 400 });
    if (voteData.isClosed) return badRequest('投票已关闭', { status: 400 });

    const validIds = new Set(voteData.options.map((o) => o.id));
    const selected = body.optionIds.filter((id) => validIds.has(id));
    if (selected.length === 0) {
      return badRequest('请选择有效选项', { status: 400 });
    }
    if (!voteData.isMultiple && selected.length > 1) {
      return badRequest('单选投票只能选择一个选项', { status: 400 });
    }

    voteData.votes = [
      ...voteData.votes.filter((v) => v.userId !== CURRENT_USER_ID),
      { userId: CURRENT_USER_ID, optionIds: selected, nickname: CURRENT_USER_NICKNAME },
    ];
    msg.updatedAt = mockDateTime();
    return ok(msg);
  }),

  mock(chatContract.pinnedMessages, ({ params, ok }) => {
    const data = getMockConvMessages(params.id)
      .filter((m) => m.extra?.isPinned)
      .slice()
      .reverse()
      .slice(0, 5);
    return ok(data);
  }),

  mock(chatContract.favoriteMessages, ({ params, ok, paginate }) => {
    const all = getMockConvMessages(params.id).filter((m) => m.extra?.isFavorited).slice().reverse();
    return ok(paginate(all));
  }),

  // 标记已读
  mock(chatContract.markRead, ({ params, ok }) => {
    const conv = mockChatConversations.find((c) => c.id === params.id);
    if (conv) {
      conv.unreadCount = 0;
      conv.hasMentionUnread = false;
    }
    return ok(null);
  }),

  // 会话成员已读状态（已读回执）
  mock(chatContract.readStates, ({ params, ok }) => {
    const conv = mockChatConversations.find((c) => c.id === params.id);
    let states: ChatReadState[] = [];
    if (conv?.type === 'group') {
      states = (mockGroupMembers[params.id] ?? [])
        .filter((m) => m.id !== CURRENT_USER_ID)
        .map((m) => ({ userId: m.id, nickname: m.nickname, avatar: m.avatar ?? null, lastReadAt: mockDateTime() }));
    } else if (conv?.targetUser) {
      states = [{ userId: conv.targetUser.id, nickname: conv.targetUser.nickname, avatar: conv.targetUser.avatar ?? null, lastReadAt: mockDateTime() }];
    }
    return ok(states);
  }),

  // 批量在线状态（演示：偶数 ID 在线，奇数离线）
  mock(chatContract.presence, ({ query, ok }) => {
    const ids = (query.userIds ?? '')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const data = ids.map((userId) => {
      const online = userId % 2 === 0;
      return { userId, online, lastSeen: online ? null : mockDateTime() };
    });
    return ok(data);
  }),

  // 创建群聊
  mock(chatContract.createGroup, ({ body, ok }) => {
    if (!body.name.trim()) {
      return badRequest('群聊名称不能为空', { status: 400 });
    }
    const newConv: ChatConversation = {
      id: mockChatConversations.length + 200,
      type: 'group',
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
      myRole: 'owner',
      myMutedUntil: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockChatConversations.unshift(newConv);
    const initialMembers: ChatGroupMember[] = (body.memberIds ?? [])
      .map((id) => mockUsers.find((u) => u.id === id))
      .filter((u): u is NonNullable<typeof u> => !!u && u.id !== CURRENT_USER_ID)
      .map((u) => ({ id: u.id, nickname: u.nickname, username: u.username, avatar: null, role: 'member', mutedUntil: null }));
    mockGroupMembers[newConv.id] = [
      { id: 1, nickname: '管理员', username: 'admin', avatar: null, role: 'owner', mutedUntil: null },
      ...initialMembers,
    ];
    addSystemMessage(newConv.id, `${CURRENT_USER_NICKNAME} 创建了群聊`);
    if (initialMembers.length > 0) {
      addSystemMessage(newConv.id, `${CURRENT_USER_NICKNAME} 邀请 ${initialMembers.map((m) => m.nickname).join('、')} 加入了群聊`);
    }
    return ok(newConv);
  }),

  // 群成员列表
  mock(chatContract.groupMembers, ({ params, ok }) => {
    const members = [...(mockGroupMembers[params.id] ?? [])].sort((a, b) => {
      const rank = (m: ChatGroupMember) => {
        if (m.role === 'owner') return 0;
        if (m.role === 'admin') return 1;
        return 2;
      };
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.id - b.id;
    });
    return ok(members);
  }),

  // 设置/取消群管理员
  mock(chatContract.setMemberRole, ({ params, body, ok }) => {
    const target = mockGroupMembers[params.id]?.find((m) => m.id === params.userId);
    if (!target) return notFound('该用户不在群聊中', { status: 404 });
    if (target.role === 'owner') return badRequest('不能修改群主角色', { status: 400 });
    target.role = body.role;
    addSystemMessage(params.id, body.role === 'admin'
      ? `${CURRENT_USER_NICKNAME} 将 ${target.nickname} 设为管理员`
      : `${CURRENT_USER_NICKNAME} 取消了 ${target.nickname} 的管理员身份`);
    return ok(null);
  }),

  // 禁言/解除禁言群成员
  mock(chatContract.muteMember, ({ params, body, ok }) => {
    const target = mockGroupMembers[params.id]?.find((m) => m.id === params.userId);
    if (!target) return notFound('该用户不在群聊中', { status: 404 });
    if (target.role === 'owner') return badRequest('不能禁言群主', { status: 400 });
    if (body.mute) {
      target.mutedUntil = body.durationMinutes
        ? mockDateTimeOffset(body.durationMinutes * 60 * 1000)
        : '9999-12-31 00:00:00';
      addSystemMessage(params.id, `${target.nickname} 已被 ${CURRENT_USER_NICKNAME} 禁言${body.durationMinutes ? '' : '（永久）'}`);
    } else {
      target.mutedUntil = null;
      addSystemMessage(params.id, `${target.nickname} 已被 ${CURRENT_USER_NICKNAME} 解除禁言`);
    }
    return ok(null);
  }),

  // 全员禁言开关
  mock(chatContract.setMuteAll, ({ params, body, ok }) => {
    const conv = requireItem(mockChatConversations, params.id, '会话不存在', { status: 404 });
    conv.muteAll = body.muteAll;
    addSystemMessage(params.id, body.muteAll
      ? `${CURRENT_USER_NICKNAME} 开启了全员禁言`
      : `${CURRENT_USER_NICKNAME} 解除了全员禁言`);
    return ok(null);
  }),

  // 置顶 / 取消置顶
  mock(chatContract.pinConversation, ({ params, body, ok }) => {
    const conv = mockChatConversations.find((c) => c.id === params.id);
    if (conv) conv.isPinned = body.pin;
    return ok(null);
  }),

  // 星标 / 取消星标
  mock(chatContract.starConversation, ({ params, body, ok }) => {
    const conv = mockChatConversations.find((c) => c.id === params.id);
    if (conv) conv.isStarred = body.star;
    return ok(null);
  }),

  // 免打扰 / 取消免打扰
  mock(chatContract.muteConversation, ({ params, body, ok }) => {
    const conv = mockChatConversations.find((c) => c.id === params.id);
    if (conv) conv.isMuted = body.mute;
    return ok(null);
  }),

  // 归档 / 取消归档
  mock(chatContract.archiveConversation, ({ params, body, ok }) => {
    const conv = mockChatConversations.find((c) => c.id === params.id);
    if (conv) conv.isArchived = body.archive;
    return ok(null);
  }),

  // ── 常用语 ──
  mock(chatContract.quickReplies, ({ ok }) =>
    ok([...mockQuickReplies].sort((a, b) => a.sort - b.sort || a.id - b.id)),
  ),

  mock(chatContract.createQuickReply, ({ body, ok }) => {
    if (!body.content.trim()) return badRequest('内容不能为空', { status: 400 });
    const item: ChatQuickReply = { id: nextQuickReplyId++, content: body.content.trim(), sort: body.sort ?? 0, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockQuickReplies.push(item);
    return ok(item);
  }),

  mock(chatContract.updateQuickReply, ({ params, body, ok }) => {
    const item = requireItem(mockQuickReplies, params.id, '常用语不存在', { status: 404 });
    if (body.content !== undefined) item.content = body.content;
    if (body.sort !== undefined) item.sort = body.sort;
    item.updatedAt = mockDateTime();
    return ok(item);
  }),

  mock(chatContract.removeQuickReply, ({ params, ok }) => {
    requireItem(mockQuickReplies, params.id, '常用语不存在', { status: 404 });
    removeByIds(mockQuickReplies, [params.id]);
    return ok(null);
  }),

  // ── 定时消息 ──
  mock(chatContract.createScheduledMessage, ({ params, body, ok }) => {
    if (!body.content.trim()) return badRequest('内容不能为空', { status: 400 });
    const item: ChatScheduledMessage = {
      id: nextScheduledId++,
      conversationId: params.id,
      conversationName: convDisplayName(params.id),
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
    return ok(item);
  }),

  mock(chatContract.scheduledMessages, ({ query, ok }) => {
    const list = mockScheduledMessages
      .filter((m) => !query.status || m.status === query.status)
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    return ok(list);
  }),

  mock(chatContract.cancelScheduledMessage, ({ params, ok }) => {
    const item = requireItem(mockScheduledMessages, params.id, '定时消息不存在', { status: 404 });
    if (item.status !== 'pending') return badRequest('仅待发送的定时消息可取消', { status: 400 });
    item.status = 'canceled';
    item.updatedAt = mockDateTime();
    return ok(null);
  }),

  // ── 自定义表情 ──
  mock(chatContract.customEmojis, ({ ok }) =>
    ok([...mockCustomEmojis].sort((a, b) => b.id - a.id)),
  ),

  mock(chatContract.addCustomEmoji, ({ body, ok }) => {
    const dup = mockCustomEmojis.find((e) => e.url === body.url);
    if (dup) return ok(dup);
    const item: ChatCustomEmoji = {
      id: nextEmojiId++, url: body.url, fileId: body.fileId ?? null, name: body.name ?? null,
      width: body.width ?? null, height: body.height ?? null, createdAt: mockDateTime(),
    };
    mockCustomEmojis.push(item);
    return ok(item);
  }),

  mock(chatContract.removeCustomEmoji, ({ params, ok }) => {
    requireItem(mockCustomEmojis, params.id, '表情不存在', { status: 404 });
    removeByIds(mockCustomEmojis, [params.id]);
    return ok(null);
  }),

  // ── 群邀请链接 ──
  mock(chatContract.createInvite, ({ params, ok }) => {
    let invite = mockInvites[params.id];
    if (!invite?.enabled) {
      invite = newInvite(params.id);
      mockInvites[params.id] = invite;
    }
    return ok(invite);
  }),

  mock(chatContract.resetInvite, ({ params, ok }) => {
    const invite = newInvite(params.id);
    mockInvites[params.id] = invite;
    return ok(invite);
  }),

  mock(chatContract.inviteInfo, ({ params, ok }) => {
    const invite = Object.values(mockInvites).find((i) => i.token === params.token && i.enabled);
    if (!invite) return notFound('邀请链接不存在或已失效', { status: 404 });
    const conv = mockChatConversations.find((c) => c.id === invite.conversationId);
    return ok({
      conversationId: invite.conversationId,
      groupName: conv?.name ?? '群聊',
      memberCount: (mockGroupMembers[invite.conversationId] ?? []).length,
      joinApproval: conv?.joinApproval ?? false,
      alreadyMember: (mockGroupMembers[invite.conversationId] ?? []).some((m) => m.id === CURRENT_USER_ID),
    });
  }),

  mock(chatContract.joinByInvite, ({ params, body, ok }) => {
    const invite = Object.values(mockInvites).find((i) => i.token === params.token && i.enabled);
    if (!invite) return notFound('邀请链接不存在或已失效', { status: 404 });
    const conv = mockChatConversations.find((c) => c.id === invite.conversationId);
    const members = mockGroupMembers[invite.conversationId] ?? [];
    if (members.some((m) => m.id === CURRENT_USER_ID)) {
      return badRequest('你已在该群聊中', { status: 400 });
    }
    if (conv?.joinApproval) {
      mockJoinRequests.push({
        id: nextJoinRequestId++, conversationId: invite.conversationId, userId: CURRENT_USER_ID,
        nickname: CURRENT_USER_NICKNAME, avatar: null, message: body.message ?? null,
        status: 'pending', createdAt: mockDateTime(),
      });
      return ok({ joined: false });
    }
    members.push({ id: CURRENT_USER_ID, nickname: CURRENT_USER_NICKNAME, username: 'admin', avatar: null, role: 'member', mutedUntil: null });
    invite.usedCount += 1;
    addSystemMessage(invite.conversationId, `${CURRENT_USER_NICKNAME} 通过邀请链接加入了群聊`);
    return ok({ joined: true });
  }),

  mock(chatContract.joinRequests, ({ params, ok }) => {
    const list = mockJoinRequests.filter((r) => r.conversationId === params.id && r.status === 'pending');
    return ok(list);
  }),

  mock(chatContract.handleJoinRequest, ({ params, body, ok }) => {
    const req = requireItem(mockJoinRequests, params.id, '申请不存在', { status: 404 });
    if (req.status !== 'pending') return badRequest('该申请已处理', { status: 400 });
    req.status = body.approve ? 'approved' : 'rejected';
    if (body.approve) {
      const members = mockGroupMembers[req.conversationId] ?? [];
      if (!members.some((m) => m.id === req.userId)) {
        members.push({ id: req.userId, nickname: req.nickname, username: `user${req.userId}`, avatar: null, role: 'member', mutedUntil: null });
      }
      addSystemMessage(req.conversationId, `${req.nickname} 通过邀请链接加入了群聊`);
    }
    return ok(null);
  }),

  mock(chatContract.setJoinApproval, ({ params, body, ok }) => {
    const conv = requireItem(mockChatConversations, params.id, '会话不存在', { status: 404 });
    conv.joinApproval = body.enabled;
    return ok(null);
  }),

  // 删除/退出会话
  mock(chatContract.removeConversation, ({ params, ok }) => {
    requireItem(mockChatConversations, params.id, '会话不存在', { status: 404 });
    removeByIds(mockChatConversations, [params.id]);
    return ok(null);
  }),

  // 添加群成员
  mock(chatContract.addGroupMember, ({ params, body, ok }) => {
    const user = requireItem(mockChatUsers, body.userId, '用户不存在', { status: 404 });
    if (!mockGroupMembers[params.id]) mockGroupMembers[params.id] = [];
    const already = mockGroupMembers[params.id].some((m) => m.id === body.userId);
    if (already) return badRequest('已是群成员', { status: 400 });
    mockGroupMembers[params.id].push({ id: user.id, nickname: user.nickname, username: user.username, avatar: null, role: 'member', mutedUntil: null });
    addSystemMessage(params.id, `${user.nickname} 加入了群聊`);
    return ok(null);
  }),

  // 移除群成员
  mock(chatContract.removeGroupMember, ({ params, ok }) => {
    if (!mockGroupMembers[params.id]) return notFound('群聊不存在', { status: 404 });
    const idx = mockGroupMembers[params.id].findIndex((m) => m.id === params.userId);
    if (idx === -1) return notFound('该用户不在群聊中', { status: 404 });
    const target = mockGroupMembers[params.id][idx];
    mockGroupMembers[params.id].splice(idx, 1);
    addSystemMessage(params.id, `${target.nickname} 被 ${CURRENT_USER_NICKNAME} 移出群聊`);
    return ok(null);
  }),

  // 更新群聊信息（群名/公告）
  mock(chatContract.updateGroupInfo, ({ params, body, ok }) => {
    const conv = requireItem(mockChatConversations, params.id, '会话不存在', { status: 404 });
    const oldName = conv.name ?? null;
    const oldAnnouncement = conv.announcement ?? null;
    if (body.name !== undefined) conv.name = body.name || null;
    if ('announcement' in body) conv.announcement = body.announcement ?? null;

    if (body.name !== undefined && (conv.name ?? null) !== oldName) {
      addSystemMessage(params.id, `${CURRENT_USER_NICKNAME} 将群聊名称修改为「${conv.name ?? '未命名群聊'}」`);
    }
    if ('announcement' in body) {
      const nextAnnouncement = conv.announcement ?? null;
      if (nextAnnouncement !== oldAnnouncement) {
        addSystemMessage(params.id, `${CURRENT_USER_NICKNAME} 更新了群公告`, {
          announcementHistory: { announcement: nextAnnouncement, operatorName: CURRENT_USER_NICKNAME },
        });
      }
    }
    return ok(null);
  }),

  mock(chatContract.announcementHistory, ({ params, ok }) => {
    const data = getMockConvMessages(params.id)
      .filter((m) => m.type === 'system' && m.extra?.announcementHistory)
      .slice()
      .reverse();
    return ok(data);
  }),

  mock(chatContract.removeAnnouncementHistory, ({ params, ok }) => {
    const idx = mockChatMessages.findIndex((m) => m.id === params.messageId && m.conversationId === params.id && m.type === 'system' && m.extra?.announcementHistory);
    if (idx < 0) return notFound('公告历史不存在', { status: 404 });
    mockChatMessages.splice(idx, 1);
    return ok(null);
  }),

  // 转让群主
  mock(chatContract.transferGroup, ({ params, body, ok }) => {
    const members = mockGroupMembers[params.id];
    if (!members) return notFound('群聊不存在', { status: 404 });
    const target = requireItem(members, body.newOwnerId, '目标用户不在群聊中', { status: 404 });
    members.forEach((m) => { m.role = m.id === body.newOwnerId ? 'owner' : 'member'; });
    addSystemMessage(params.id, `${CURRENT_USER_NICKNAME} 将群主转让给 ${target.nickname}`);
    return ok(null);
  }),
];
