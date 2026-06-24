import type { Channel, ChannelMessage, ChannelMenu, ChannelAutoReply } from '@zenith/shared';
import { SEED_CHANNELS } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

/**
 * Mock 频道消息：在标准 ChannelMessage 基础上附带 mock 专用的 `convUserId`，
 * 用于标记该消息归属的会话用户（in=发送者；out=被定向用户；广播=null）。
 * 客服工作台与用户视图均基于该字段做会话过滤。当前 mock 登录用户视为 id=1。
 */
export interface MockChannelMessage extends ChannelMessage {
  convUserId: number | null;
}

export const MOCK_CURRENT_USER_ID = 1;

/** 频道消息（系统号广播/卡片 + 运营号双向会话示例） */
export const mockChannelMessages: MockChannelMessage[] = [
  {
    id: 1,
    channelId: 1,
    audienceType: 'broadcast',
    type: 'text',
    title: '系统升级通知',
    content: '系统将于本周六凌晨 02:00 进行例行升级，预计耗时 30 分钟，请提前保存工作。',
    extra: null,
    publishedById: null,
    direction: 'out',
    senderUserId: null,
    senderUserName: null,
    isRead: false,
    createdAt: mockDateTime(),
    convUserId: null,
  },
  {
    id: 2,
    channelId: 1,
    audienceType: 'targeted',
    type: 'card',
    title: '待办审批提醒',
    content: '待办审批提醒',
    extra: {
      bot: { name: 'Zenith 助手', avatar: null },
      card: {
        title: '待办审批提醒',
        text: '流程「请假申请（LV-20260624）」需要你审批',
        fields: [{ label: '审批节点', value: '部门负责人审批' }],
        actions: [
          { key: 'approve', label: '同意', theme: 'primary', action: 'workflow:approve', taskId: 9001 },
          { key: 'reject', label: '驳回', theme: 'danger', action: 'workflow:reject', taskId: 9001, requireComment: true },
        ],
        source: '工作流',
        status: 'pending',
        instanceId: 8001,
      },
    },
    publishedById: null,
    direction: 'out',
    senderUserId: null,
    senderUserName: null,
    isRead: false,
    createdAt: mockDateTime(),
    convUserId: null,
  },
  // ── 运营号「智能客服」(channel 3) 双向会话 ─────────────────────────────────
  // 当前登录用户（id=1）自己的会话
  {
    id: 3, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '你好，请问你们怎么收费？', extra: null, publishedById: null,
    direction: 'in', senderUserId: 1, senderUserName: '超级管理员', isRead: true,
    createdAt: mockDateTime(), convUserId: 1,
  },
  {
    id: 4, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '我们提供免费版与企业版，详情见官网定价页。', extra: null, publishedById: null,
    direction: 'out', senderUserId: null, senderUserName: null, isRead: true,
    createdAt: mockDateTime(), convUserId: 1,
  },
  // 用户「李四」(id=2) 的会话
  {
    id: 5, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '价格', extra: null, publishedById: null,
    direction: 'in', senderUserId: 2, senderUserName: '李四', isRead: true,
    createdAt: mockDateTime(), convUserId: 2,
  },
  {
    id: 6, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '我们提供免费版与企业版，详情见官网定价页。', extra: null, publishedById: null,
    direction: 'out', senderUserId: null, senderUserName: null, isRead: true,
    createdAt: mockDateTime(), convUserId: 2,
  },
  {
    id: 7, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '您好，我是客服小王，企业版可享受专属对接，需要我详细介绍吗？', extra: null, publishedById: 1,
    direction: 'out', senderUserId: 1, senderUserName: '超级管理员', isRead: true,
    createdAt: mockDateTime(), convUserId: 2,
  },
  // 用户「王五」(id=3) 的会话（待回复）
  {
    id: 8, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '人工', extra: null, publishedById: null,
    direction: 'in', senderUserId: 3, senderUserName: '王五', isRead: true,
    createdAt: mockDateTime(), convUserId: 3,
  },
  {
    id: 9, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '正在为您转接人工客服，请稍候…', extra: null, publishedById: null,
    direction: 'out', senderUserId: null, senderUserName: null, isRead: true,
    createdAt: mockDateTime(), convUserId: 3,
  },
];

let nextMessageId = 100;
export function getNextChannelMessageId() { return nextMessageId++; }

/** 运营号底部菜单（channel 3） */
export const mockChannelMenus: ChannelMenu[] = [
  { id: 1, channelId: 3, parentId: null, name: '产品介绍', type: 'click', value: '产品介绍', sort: 0 },
  { id: 2, channelId: 3, parentId: null, name: '帮助中心', type: 'view', value: 'https://example.com/help', sort: 1 },
  {
    id: 3, channelId: 3, parentId: null, name: '更多', type: 'click', value: null, sort: 2,
    children: [
      { id: 4, channelId: 3, parentId: 3, name: '联系人工', type: 'click', value: '人工', sort: 0 },
      { id: 5, channelId: 3, parentId: 3, name: '访问官网', type: 'view', value: 'https://example.com', sort: 1 },
    ],
  },
];

/** 运营号自动回复规则（channel 3） */
export const mockChannelAutoReplies: ChannelAutoReply[] = [
  { id: 1, channelId: 3, matchType: 'subscribe', keyword: null, keywordMode: 'contains', replyContent: '欢迎关注智能客服！发送「价格」「人工」试试。', status: 'enabled', sort: 0, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, channelId: 3, matchType: 'keyword', keyword: '价格', keywordMode: 'contains', replyContent: '我们提供免费版与企业版，详情见官网定价页。', status: 'enabled', sort: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 3, channelId: 3, matchType: 'keyword', keyword: '人工', keywordMode: 'exact', replyContent: '正在为您转接人工客服，请稍候…', status: 'enabled', sort: 2, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 4, channelId: 3, matchType: 'default', keyword: null, keywordMode: 'contains', replyContent: '已收到您的消息，客服会尽快回复。', status: 'enabled', sort: 3, createdAt: mockDateTime(), updatedAt: mockDateTime() },
];

let nextAutoReplyId = 100;
export function getNextAutoReplyId() { return nextAutoReplyId++; }

function buildChannel(seed: (typeof SEED_CHANNELS)[number]): Channel {
  const msgs = mockChannelMessages.filter((m) => m.channelId === seed.id);
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  return {
    id: seed.id,
    code: seed.code,
    name: seed.name,
    avatar: seed.avatar,
    description: seed.description,
    type: seed.type,
    builtin: seed.builtin,
    status: 'enabled',
    unreadCount: msgs.filter((m) => !m.isRead).length,
    lastMessage: last,
    isMuted: false,
    isSubscribed: true,
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  };
}

export const mockChannels: Channel[] = [
  ...SEED_CHANNELS.map(buildChannel),
  {
    id: 2,
    code: 'product-updates',
    name: '产品动态',
    avatar: null,
    description: '产品更新与运营活动公告',
    type: 'business',
    builtin: false,
    status: 'enabled',
    unreadCount: 0,
    lastMessage: null,
    isMuted: false,
    isSubscribed: false,
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
  {
    id: 3,
    code: 'smart-cs',
    name: '智能客服',
    avatar: null,
    description: '运营号双向客服示例（菜单 + 自动回复 + 人工）',
    type: 'business',
    builtin: false,
    status: 'enabled',
    unreadCount: 0,
    lastMessage: mockChannelMessages.filter((m) => m.channelId === 3 && m.convUserId === MOCK_CURRENT_USER_ID).slice(-1)[0] ?? null,
    isMuted: false,
    isSubscribed: true,
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
];
