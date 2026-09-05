import { announcementContract } from '@zenith/shared/messaging';
import type { AnnouncementAttachment, AnnouncementDetail, AnnouncementReadStatsUser } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockAnnouncements, getNextAnnouncementId } from '@/mocks/data/announcements';
import { mockManagedFiles } from '@/mocks/handlers/files';
import { mockDateTime } from '@/mocks/utils/date';

function buildAnnouncementAttachments(fileIds: string[] = []): AnnouncementAttachment[] {
  return fileIds
    .map((fileId, index) => {
      const file = mockManagedFiles.find((f) => f.id === fileId);
      if (!file) return null;
      return {
        id: Date.now() + index,
        fileId,
        file: {
          id: file.id,
          originalName: file.originalName,
          size: file.size,
          mimeType: file.mimeType ?? null,
          extension: file.extension ?? null,
          url: file.url,
        },
        sortOrder: index,
        createdAt: mockDateTime(),
      };
    })
    .filter((item): item is AnnouncementAttachment => item !== null);
}

/** Demo 模式不持久化已读状态：收件视角的已发布公告始终视为未读 */
function publishedForInbox() {
  return mockAnnouncements
    .filter((n) => n.publishStatus === 'published')
    .sort((a, b) => (b.publishTime ?? '').localeCompare(a.publishTime ?? ''))
    .map((n) => ({ ...n, isRead: false }));
}

/** 模拟已读 / 未读用户列表 */
const MOCK_READ_USERS: AnnouncementReadStatsUser[] = [
  { id: 1, username: 'admin', nickname: '管理员', avatar: null, readAt: '2024-01-01 09:00:00' },
  { id: 2, username: 'zhangsan', nickname: '张三', avatar: null, readAt: '2024-01-01 10:30:00' },
  { id: 3, username: 'lisi', nickname: '李四', avatar: null, readAt: '2024-01-02 08:15:00' },
  { id: 4, username: 'wangwu', nickname: '王五', avatar: null, readAt: '2024-01-02 14:20:00' },
  { id: 5, username: 'zhaoliu', nickname: '赵六', avatar: null, readAt: '2024-01-03 11:00:00' },
  { id: 6, username: 'sunqi', nickname: '孙七', avatar: null, readAt: '2024-01-03 16:45:00' },
  { id: 7, username: 'zhouba', nickname: '周八', avatar: null, readAt: '2024-01-04 09:30:00' },
  { id: 8, username: 'wujiu', nickname: '吴九', avatar: null, readAt: '2024-01-04 13:10:00' },
];
const MOCK_UNREAD_USERS: AnnouncementReadStatsUser[] = [
  { id: 9, username: 'zhengshi', nickname: '郑十', avatar: null },
  { id: 10, username: 'qianyi', nickname: '镰一', avatar: null },
];

export const announcementsHandlers = [
  // 公告列表（管理，分页）
  mock(announcementContract.list, ({ query, ok, paginate }) => {
    const list = mockAnnouncements.filter((n) => {
      if (query.title && !n.title.includes(query.title)) return false;
      if (query.publishStatus && n.publishStatus !== query.publishStatus) return false;
      if (query.type && n.type !== query.type) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  // 已发布公告（顶栏铃铛 / 工作台）
  mock(announcementContract.published, ({ ok }) => ok(publishedForInbox().slice(0, 20))),

  // 公告收件箱（分页）
  mock(announcementContract.inbox, ({ query, ok, paginate }) => {
    let list = publishedForInbox();
    if (query.isRead === 'true') list = list.filter((n) => n.isRead);
    else if (query.isRead === 'false') list = list.filter((n) => !n.isRead);
    return ok(paginate(list));
  }),

  // 未读公告数（Demo 模式：返回已发布公告总数）
  mock(announcementContract.unreadCount, ({ ok }) => {
    const count = mockAnnouncements.filter((n) => n.publishStatus === 'published').length;
    return ok({ count });
  }),

  mock(announcementContract.markAllRead, ({ ok }) => ok(null)),

  mock(announcementContract.detail, ({ params, ok }) => {
    const notice = mockAnnouncements.find((n) => n.id === params.id);
    if (!notice) return notFound('公告不存在');
    return ok(notice);
  }),

  mock(announcementContract.create, ({ body, ok }) => {
    const isScheduled = body.publishStatus === 'scheduled' && body.publishTime;
    let publishTime: string | null = null;
    if (isScheduled) publishTime = body.publishTime ?? null;
    else if (body.publishStatus === 'published') publishTime = mockDateTime();
    const newNotice: AnnouncementDetail = {
      id: getNextAnnouncementId(),
      title: body.title,
      content: body.content,
      type: body.type,
      publishStatus: body.publishStatus,
      priority: body.priority,
      publishTime,
      createById: 1,
      createByName: '管理员',
      targetType: body.targetType,
      tenantId: null,
      recipients: body.recipients.map((r) => ({ ...r, recipientLabel: '' })),
      attachments: buildAnnouncementAttachments(body.fileIds),
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockAnnouncements.push(newNotice);
    return ok(newNotice, '新增成功');
  }),

  mock(announcementContract.update, ({ params, body, ok }) => {
    const notice = mockAnnouncements.find((n) => n.id === params.id);
    if (!notice) return notFound('公告不存在');
    const { fileIds, recipients, ...announcementPatch } = body;
    Object.assign(notice, announcementPatch, { updatedAt: mockDateTime() });
    if (recipients !== undefined) {
      notice.recipients = recipients.map((r) => ({ ...r, recipientLabel: '' }));
    }
    if (body.publishStatus === 'published' && !body.publishTime && !notice.publishTime) {
      notice.publishTime = mockDateTime();
    }
    if (fileIds !== undefined) {
      notice.attachments = buildAnnouncementAttachments(fileIds);
    }
    return ok(notice, '更新成功');
  }),

  mock(announcementContract.removeBatch, ({ body, ok }) => {
    const selected = new Set(body.ids);
    const deleted = removeWhere(mockAnnouncements, (n) => selected.has(n.id));
    return ok(null, `已删除 ${deleted} 条公告`);
  }),

  mock(announcementContract.remove, ({ params, ok }) => {
    const index = mockAnnouncements.findIndex((n) => n.id === params.id);
    if (index === -1) return notFound('公告不存在');
    mockAnnouncements.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // 已读统计详情（管理视角）
  mock(announcementContract.readStats, ({ params, query, ok, paginate }) => {
    const tab = query.tab === 'unread' ? 'unread' : 'read';
    const notice = mockAnnouncements.find((n) => n.id === params.id);
    if (!notice) return notFound('公告不存在');

    const readCount = notice.readCount ?? 0;
    const totalCount = readCount + MOCK_UNREAD_USERS.length;
    const users = tab === 'read' ? MOCK_READ_USERS.slice(0, readCount) : MOCK_UNREAD_USERS;
    return ok({ readCount, totalCount, ...paginate(users) });
  }),

  mock(announcementContract.markRead, ({ ok }) => ok(null)),
];