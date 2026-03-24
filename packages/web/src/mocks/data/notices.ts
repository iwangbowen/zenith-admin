import type { Notice } from '@zenith/shared';

export const mockNotices: Notice[] = [
  {
    id: 1,
    title: '系统上线公告',
    content: '<p>Zenith Admin 演示系统欢迎您！本系统为演示模式，所有数据仅为示例。</p>',
    type: 'announcement',
    publishStatus: 'published',
    priority: 'high',
    publishTime: '2024-01-01T08:00:00.000Z',
    createById: 1,
    createByName: '管理员',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    title: '密码修改提醒',
    content: '<p>请及时修改初始密码，保障账户安全。</p>',
    type: 'notice',
    publishStatus: 'published',
    priority: 'medium',
    publishTime: '2024-01-02T09:00:00.000Z',
    createById: 1,
    createByName: '管理员',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    id: 3,
    title: '系统维护通知（草稿）',
    content: '<p>本通知为草稿状态，尚未发布。</p>',
    type: 'notice',
    publishStatus: 'draft',
    priority: 'low',
    publishTime: null,
    createById: 1,
    createByName: '管理员',
    createdAt: '2024-01-03T00:00:00.000Z',
    updatedAt: '2024-01-03T00:00:00.000Z',
  },
];

let nextNoticeId = 4;
export function getNextNoticeId() {
  return nextNoticeId++;
}
