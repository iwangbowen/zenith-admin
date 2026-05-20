import type { InAppMessage } from '@zenith/shared';

export const mockInAppMessages: InAppMessage[] = [
  {
    id: 1,
    templateId: 1,
    userId: 1,
    userName: '管理员',
    title: '系统将于 2025-03-10 02:00 升级',
    content: '系统将于 2025-03-10 02:00 进行升级，预计耗时 30 分钟。',
    type: 'info',
    isRead: false,
    readAt: null,
    source: 'system',
    senderId: null,
    senderName: '系统',
    createdAt: '2025-03-08 09:00:00',
  },
  {
    id: 2,
    templateId: 2,
    userId: 1,
    userName: '管理员',
    title: '您的申请已通过',
    content: '您提交的【请假申请】已通过审批。',
    type: 'success',
    isRead: true,
    readAt: '2025-03-05 10:30:00',
    source: 'system',
    senderId: 1,
    senderName: '管理员',
    createdAt: '2025-03-05 10:00:00',
  },
  {
    id: 3,
    templateId: null,
    userId: 1,
    userName: '管理员',
    title: '欢迎使用 Zenith Admin',
    content: '感谢您选择 Zenith Admin。',
    type: 'info',
    isRead: false,
    readAt: null,
    source: 'manual',
    senderId: 1,
    senderName: '管理员',
    createdAt: '2025-03-01 08:00:00',
  },
];

let nextId = Math.max(...mockInAppMessages.map((m) => m.id)) + 1;
export function getNextInAppMessageId() {
  return nextId++;
}
