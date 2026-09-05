import type { AnnouncementDetail } from '@zenith/shared/messaging';
import { nextIdFrom } from '@/mocks/utils/handlers';

/** 内存中的公告同时承载列表 / 详情两种视角，故直接存详情形态（收件人与附件必带） */
export const mockAnnouncements: AnnouncementDetail[] = [
  {
    id: 1,
    title: '系统上线公告',
    content: '<p>Zenith Admin 演示系统欢迎您！本系统为演示模式，所有数据仅为示例。</p>',
    type: 'announcement',
    publishStatus: 'published',
    priority: 'high',
    publishTime: '2024-01-01 08:00:00',
    createById: 1,
    createByName: '管理员',
    targetType: 'all',
    tenantId: null,
    recipients: [],
    attachments: [],
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
    readCount: 8,
  },
  {
    id: 2,
    title: '密码修改提醒',
    content: '<p>请及时修改初始密码，保障账户安全。</p>',
    type: 'notice',
    publishStatus: 'published',
    priority: 'medium',
    publishTime: '2024-01-02 09:00:00',
    createById: 1,
    createByName: '管理员',
    targetType: 'all',
    tenantId: null,
    recipients: [],
    attachments: [],
    createdAt: '2024-01-02 00:00:00',
    updatedAt: '2024-01-02 00:00:00',
    readCount: 3,
  },
  {
    id: 3,
    title: '系统维护公告（草稿）',
    content: '<p>本公告为草稿状态，尚未发布。</p>',
    type: 'notice',
    publishStatus: 'draft',
    priority: 'low',
    publishTime: null,
    createById: 1,
    createByName: '管理员',
    targetType: 'all',
    tenantId: null,
    recipients: [],
    attachments: [],
    createdAt: '2024-01-03 00:00:00',
    updatedAt: '2024-01-03 00:00:00',
    readCount: 0,
  },
];

let nextAnnouncementId = nextIdFrom(mockAnnouncements);
export function getNextAnnouncementId() {
  return nextAnnouncementId++;
}