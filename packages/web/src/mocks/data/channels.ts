import type { Channel, ChannelMessage, ChannelMenu, ChannelAutoReply, ChannelQuickReply, ChannelMessageTemplate } from '@zenith/shared';
import { SEED_CHANNELS, SEED_CHANNEL_QUICK_REPLIES } from '@zenith/shared';
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
    status: 'sent',
    scheduledAt: null,
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
    status: 'sent',
    scheduledAt: null,
    convUserId: null,
  },
  // ── 运营号「智能客服」(channel 3) 双向会话 ─────────────────────────────────
  // 当前登录用户（id=1）自己的会话
  {
    id: 3, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '你好，请问你们怎么收费？', extra: null, publishedById: null,
    direction: 'in', senderUserId: 1, senderUserName: '超级管理员', isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 1,
  },
  {
    id: 4, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '我们提供免费版与企业版，详情见官网定价页。', extra: null, publishedById: null,
    direction: 'out', senderUserId: null, senderUserName: null, isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 1,
  },
  // 用户「李四」(id=2) 的会话
  {
    id: 5, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '价格', extra: null, publishedById: null,
    direction: 'in', senderUserId: 2, senderUserName: '李四', isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 2,
  },
  {
    id: 6, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '我们提供免费版与企业版，详情见官网定价页。', extra: null, publishedById: null,
    direction: 'out', senderUserId: null, senderUserName: null, isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 2,
  },
  {
    id: 7, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '您好，我是客服小王，企业版可享受专属对接，需要我详细介绍吗？', extra: null, publishedById: 1,
    direction: 'out', senderUserId: 1, senderUserName: '超级管理员', isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 2,
  },
  // 用户「王五」(id=3) 的会话（待回复）
  {
    id: 8, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '人工', extra: null, publishedById: null,
    direction: 'in', senderUserId: 3, senderUserName: '王五', isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 3,
  },
  {
    id: 9, channelId: 3, audienceType: 'targeted', type: 'text', title: null,
    content: '正在为您转接人工客服，请稍候…', extra: null, publishedById: null,
    direction: 'out', senderUserId: null, senderUserName: null, isRead: true,
    createdAt: mockDateTime(), status: 'sent', scheduledAt: null, convUserId: 3,
  },
  // ── 运营号图文（news）群发示例（channel 3 广播，所有订阅用户可见） ──────────
  {
    id: 10,
    channelId: 3,
    audienceType: 'broadcast',
    type: 'news',
    title: '企业版全新升级，限时体验',
    content: '企业版全新升级，限时体验',
    extra: {
      card: {
        title: '企业版全新升级，限时体验',
        text: '专属客服对接、数据看板、API 开放能力一站到位，点击查看详情。',
        cover: 'https://picsum.photos/400/200',
        actions: [{ key: 'open', label: '查看详情', action: 'link', url: 'https://example.com/enterprise' }],
        source: '图文',
        status: null,
      },
    },
    publishedById: 1,
    direction: 'out',
    senderUserId: null,
    senderUserName: null,
    isRead: false,
    createdAt: mockDateTime(),
    status: 'sent',
    scheduledAt: null,
    convUserId: null,
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
  { id: 1, channelId: 3, matchType: 'subscribe', keyword: null, keywordMode: 'contains', replyType: 'text', replyContent: '欢迎关注智能客服！发送「价格」「人工」试试。', replyExtra: null, hitCount: 12, status: 'enabled', sort: 0, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, channelId: 3, matchType: 'keyword', keyword: '价格', keywordMode: 'contains', replyType: 'text', replyContent: '我们提供免费版与企业版，详情见官网定价页。', replyExtra: null, hitCount: 34, status: 'enabled', sort: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 3, channelId: 3, matchType: 'keyword', keyword: '人工', keywordMode: 'exact', replyType: 'text', replyContent: '正在为您转接人工客服，请稍候…', replyExtra: null, hitCount: 21, status: 'enabled', sort: 2, createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 4, channelId: 3, matchType: 'default', keyword: null, keywordMode: 'contains', replyType: 'text', replyContent: '已收到您的消息，客服会尽快回复。', replyExtra: null, hitCount: 8, status: 'enabled', sort: 3, createdAt: mockDateTime(), updatedAt: mockDateTime() },
];

let nextAutoReplyId = 100;
export function getNextAutoReplyId() { return nextAutoReplyId++; }

/** 客服快捷回复（channelId 为 null = 全局，所有运营号通用） */
export const mockChannelQuickReplies: ChannelQuickReply[] = SEED_CHANNEL_QUICK_REPLIES.map((q, i) => ({
  id: i + 1,
  channelId: q.channelId,
  channelName: null,
  title: q.title,
  content: q.content,
  sort: q.sort,
  createdAt: mockDateTime(),
  updatedAt: mockDateTime(),
}));

let nextQuickReplyId = 100;
export function getNextQuickReplyId() { return nextQuickReplyId++; }

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

/** 订阅者用户池（mock，用于系统号全员订阅与运营号添加候选） */
export const MOCK_SUBSCRIBER_USERS: { userId: number; name: string; avatar: string | null }[] = [
  { userId: 1, name: '超级管理员', avatar: null },
  { userId: 2, name: '张三', avatar: null },
  { userId: 3, name: '李四', avatar: null },
  { userId: 4, name: '王五', avatar: null },
  { userId: 5, name: '赵六', avatar: null },
  { userId: 6, name: '钱七', avatar: null },
];

/** 群发消息模板（mock，内存可增删改） */
export const mockChannelTemplates: ChannelMessageTemplate[] = [
  {
    id: 1, name: '节日问候（文本）', type: 'text', title: null,
    content: '亲爱的用户，节日快乐！感谢您一直以来的支持与陪伴。', extra: null,
    createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
  {
    id: 2, name: '版本更新公告（图文）', type: 'news', title: '产品版本更新',
    content: '',
    extra: { card: { title: '产品 v2.0 重磅上线', text: '全新界面与多项体验优化，点击查看详情。', cover: null, actions: [{ key: 'open', label: '查看详情', action: 'link', url: 'https://example.com/changelog' }], source: '图文', status: null } },
    createdAt: mockDateTime(), updatedAt: mockDateTime(),
  },
];
let nextTemplateId = 3;
export function getNextTemplateId() { return nextTemplateId++; }
