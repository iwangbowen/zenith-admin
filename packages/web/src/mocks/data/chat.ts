import type { ChatConversation, ChatMessage } from '@zenith/shared';

// Demo 会话与消息数据，基于 mock 用户 id=1（admin）和 id=2（张三）

let msgIdCounter = 100;
export function getNextMsgId() { return ++msgIdCounter; }

export const mockChatMessages: ChatMessage[] = [
  {
    id: 1,
    conversationId: 1,
    senderId: 2,
    senderName: '张三',
    senderAvatar: null,
    type: 'text',
    content: '你好，有什么问题可以找我',
    replyToId: null,
    isRecalled: false,
    isEdited: false,
    extra: null,
    reactions: [],
    createdAt: '2024-01-01 09:00:00',
    updatedAt: '2024-01-01 09:00:00',
  },
  {
    id: 2,
    conversationId: 1,
    senderId: 1,
    senderName: '管理员',
    senderAvatar: null,
    type: 'text',
    content: '好的，最近系统有个问题需要沟通',
    replyToId: null,
    isRecalled: false,
    isEdited: false,
    extra: null,
    reactions: [],
    createdAt: '2024-01-01 09:01:00',
    updatedAt: '2024-01-01 09:01:00',
  },
  {
    id: 3,
    conversationId: 1,
    senderId: 2,
    senderName: '张三',
    senderAvatar: null,
    type: 'text',
    content: '请说，我在',
    replyToId: null,
    isRecalled: false,
    isEdited: false,
    extra: null,
    reactions: [],
    createdAt: '2024-01-01 09:02:00',
    updatedAt: '2024-01-01 09:02:00',
  },
  {
    id: 4,
    conversationId: 2,
    senderId: 1,
    senderName: '管理员',
    senderAvatar: null,
    type: 'vote',
    content: '本周例会时间投票',
    replyToId: null,
    isRecalled: false,
    isEdited: false,
    extra: {
      voteData: {
        question: '本周例会安排在什么时候？',
        options: [
          { id: 'opt-1', label: '周三 15:00' },
          { id: 'opt-2', label: '周四 10:00' },
          { id: 'opt-3', label: '周五 16:00' },
        ],
        isMultiple: false,
        isAnonymous: false,
        expireAt: null,
        votes: [
          { userId: 2, optionIds: ['opt-2'], nickname: '张三' },
        ],
        isClosed: false,
      },
    },
    reactions: [],
    createdAt: '2024-01-02 10:05:00',
    updatedAt: '2024-01-02 10:05:00',
  },
];

export const mockChatConversations: ChatConversation[] = [
  {
    id: 1,
    type: 'direct',
    name: null,
    targetUser: { id: 2, nickname: '张三', avatar: null },
    lastMessage: mockChatMessages[2],
    unreadCount: 1,
    hasMentionUnread: false,
    isPinned: false,
    isStarred: false,
    isMuted: false,
    createdAt: '2024-01-01 09:00:00',
    updatedAt: '2024-01-01 09:02:00',
  },
  {
    id: 2,
    type: 'group',
    name: '项目组',
    announcement: '欢迎加入项目组！有问题请 @ 管理员。',
    targetUser: null,
    lastMessage: mockChatMessages[3],
    unreadCount: 0,
    hasMentionUnread: false,
    isPinned: false,
    isStarred: false,
    isMuted: false,
    createdAt: '2024-01-02 10:00:00',
    updatedAt: '2024-01-02 10:05:00',
  },
];

// 群聊成员 Map: conversationId -> 成员列表
export const mockGroupMembers: Record<number, { id: number; nickname: string; username: string; avatar: null; role: 'owner' | 'member' }[]> = {
  2: [
    { id: 1, nickname: '管理员', username: 'admin', avatar: null, role: 'owner' },
    { id: 2, nickname: '张三', username: 'zhangsan', avatar: null, role: 'member' },
    { id: 3, nickname: '李四', username: 'lisi', avatar: null, role: 'member' },
  ],
};

export function getMockConvMessages(conversationId: number): ChatMessage[] {
  return mockChatMessages.filter((m) => m.conversationId === conversationId);
}

export function addMockMessage(msg: ChatMessage) {
  mockChatMessages.push(msg);
  const conv = mockChatConversations.find((c) => c.id === msg.conversationId);
  if (conv) {
    conv.lastMessage = msg;
    conv.updatedAt = msg.createdAt;
  }
}

export function mockChatUser(userId = 1) {
  return {
    id: userId === 1 ? 2 : 1,
    nickname: userId === 1 ? '张三' : '管理员',
    username: userId === 1 ? 'zhangsan' : 'admin',
    avatar: null,
  };
}

export const mockChatUsers = [
  { id: 2, nickname: '张三', username: 'zhangsan', avatar: null, phone: '13800000002', email: 'zhangsan@example.com', departmentName: '技术部', positionNames: ['高级工程师'] },
  { id: 3, nickname: '李四', username: 'lisi', avatar: null, phone: '13800000003', email: 'lisi@example.com', departmentName: '产品部', positionNames: ['产品经理'] },
  { id: 4, nickname: '王五', username: 'wangwu', avatar: null, phone: null, email: 'wangwu@example.com', departmentName: null, positionNames: [] },
];
