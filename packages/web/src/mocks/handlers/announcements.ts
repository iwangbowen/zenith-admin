import { http, HttpResponse } from 'msw';
import { mockAnnouncements, getNextAnnouncementId } from '@/mocks/data/announcements';
import { mockManagedFiles } from '@/mocks/handlers/files';
import { mockDateTime } from '@/mocks/utils/date';
import type { Announcement, AnnouncementAttachment } from '@zenith/shared';

type AnnouncementPayload = Partial<Announcement> & { fileIds?: number[] };

function buildAnnouncementAttachments(fileIds: number[] = []): AnnouncementAttachment[] {
  return fileIds
    .map((fileId, index) => {
      const file = mockManagedFiles.find((f) => f.id === fileId);
      if (!file) return null;
      return {
        id: fileId,
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

export const announcementsHandlers = [
  // 公告列表（分页）
  http.get('/api/announcements', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const publishStatus = url.searchParams.get('publishStatus') ?? '';
    const type = url.searchParams.get('type') ?? '';

    let list = mockAnnouncements.filter((n) => {
      if (keyword && !n.title.includes(keyword)) return false;
      if (publishStatus && n.publishStatus !== publishStatus) return false;
      if (type && n.type !== type) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 已发布公告列表（前台展示，无需鉴权）
  http.get('/api/announcements/published', () => {
    const data = mockAnnouncements
      .filter((n) => n.publishStatus === 'published')
      .sort((a, b) => (b.publishTime ?? '').localeCompare(a.publishTime ?? ''))
      .slice(0, 20)
      .map((n) => ({ ...n, isRead: false }));
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // 公告收件箱（分页，含已读状态 — Demo 模式已读状态不持久化，始终 false）
  http.get('/api/announcements/inbox', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const isReadFilter = url.searchParams.get('isRead');

    let list = mockAnnouncements
      .filter((n) => n.publishStatus === 'published')
      .sort((a, b) => (b.publishTime ?? '').localeCompare(a.publishTime ?? ''))
      .map((n) => ({ ...n, isRead: false }));

    if (isReadFilter === 'true') list = list.filter((n) => n.isRead);
    else if (isReadFilter === 'false') list = list.filter((n) => !n.isRead);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
  }),

  // 未读公告数（Demo 模式：返回已发布公告总数，不持久化已读状态）
  http.get('/api/announcements/unread-count', () => {
    const count = mockAnnouncements.filter((n) => n.publishStatus === 'published').length;
    return HttpResponse.json({ code: 0, message: 'ok', data: { count } });
  }),

  // 全部标记为已读（Demo 模式不持久化，直接返回成功）
  http.post('/api/announcements/read-all', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 获取单个公告
  http.get('/api/announcements/:id', ({ params }) => {
    const notice = mockAnnouncements.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '公告不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: notice });
  }),

  // 新增公告
  http.post('/api/announcements', async ({ request }) => {
    const body = await request.json() as AnnouncementPayload;
    const isScheduled = body.publishStatus === 'scheduled' && body.publishTime;
    let publishTime: string | null = null;
    if (isScheduled) publishTime = body.publishTime ?? null;
    else if (body.publishStatus === 'published') publishTime = mockDateTime();
    const newNotice: Announcement = {
      id: getNextAnnouncementId(),
      title: body.title ?? '',
      content: body.content ?? '',
      type: body.type ?? 'notice',
      publishStatus: body.publishStatus ?? 'draft',
      priority: body.priority ?? 'low',
      publishTime,
      createById: 1,
      createByName: '管理员',
      targetType: body.targetType ?? 'all',
      recipients: body.recipients ?? [],
      attachments: buildAnnouncementAttachments(body.fileIds),
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockAnnouncements.push(newNotice);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newNotice });
  }),

  // 更新公告
  http.put('/api/announcements/:id', async ({ params, request }) => {
    const notice = mockAnnouncements.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '公告不存在', data: null });
    const body = await request.json() as AnnouncementPayload;
    const { fileIds, ...announcementPatch } = body;
    Object.assign(notice, announcementPatch, { updatedAt: mockDateTime() });
    if (body.publishStatus === 'published' && !body.publishTime && !notice.publishTime) {
      notice.publishTime = mockDateTime();
    }
    if (Object.prototype.hasOwnProperty.call(body, 'fileIds')) {
      notice.attachments = buildAnnouncementAttachments(fileIds);
    }
    return HttpResponse.json({ code: 0, message: '更新成功', data: notice });
  }),

  // 发布公告
  http.put('/api/announcements/:id/publish', ({ params }) => {
    const notice = mockAnnouncements.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '公告不存在', data: null });
    notice.publishStatus = 'published';
    notice.publishTime = mockDateTime();
    notice.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '发布成功', data: notice });
  }),

  // 撤回公告
  http.put('/api/announcements/:id/recall', ({ params }) => {
    const notice = mockAnnouncements.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '公告不存在', data: null });
    notice.publishStatus = 'recalled';
    notice.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '撤回成功', data: notice });
  }),

  // 批量删除公告
  http.delete('/api/announcements/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = body?.ids ?? [];
    ids.forEach((id) => {
      const index = mockAnnouncements.findIndex((n) => n.id === id);
      if (index !== -1) mockAnnouncements.splice(index, 1);
    });
    return HttpResponse.json({ code: 0, message: `已删除 ${ids.length} 条公告`, data: null });
  }),

  // 删除公告
  http.delete('/api/announcements/:id', ({ params }) => {
    const index = mockAnnouncements.findIndex((n) => n.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '公告不存在', data: null });
    mockAnnouncements.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 已读统计详情（管理视角）
  http.get('/api/announcements/:id/read-stats', ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const tab = url.searchParams.get('tab') === 'unread' ? 'unread' : 'read';
    const notice = mockAnnouncements.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '公告不存在', data: null });

    // 模拟已读和未读用户列表
    const mockReadUsers = [
      { id: 1, username: 'admin', nickname: '管理员', avatar: null, readAt: '2024-01-01 09:00:00' },
      { id: 2, username: 'zhangsan', nickname: '张三', avatar: null, readAt: '2024-01-01 10:30:00' },
      { id: 3, username: 'lisi', nickname: '李四', avatar: null, readAt: '2024-01-02 08:15:00' },
      { id: 4, username: 'wangwu', nickname: '王五', avatar: null, readAt: '2024-01-02 14:20:00' },
      { id: 5, username: 'zhaoliu', nickname: '赵六', avatar: null, readAt: '2024-01-03 11:00:00' },
      { id: 6, username: 'sunqi', nickname: '孙七', avatar: null, readAt: '2024-01-03 16:45:00' },
      { id: 7, username: 'zhouba', nickname: '周八', avatar: null, readAt: '2024-01-04 09:30:00' },
      { id: 8, username: 'wujiu', nickname: '吴九', avatar: null, readAt: '2024-01-04 13:10:00' },
    ];
    const mockUnreadUsers = [
      { id: 9, username: 'zhengshi', nickname: '郑十', avatar: null },
      { id: 10, username: 'qianyi', nickname: '镰一', avatar: null },
    ];

    const readCount = notice.readCount ?? 0;
    const totalCount = readCount + mockUnreadUsers.length;

    const list = tab === 'read'
      ? mockReadUsers.slice(0, readCount)
      : mockUnreadUsers;
    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json({
      code: 0, message: 'ok',
      data: { readCount, totalCount, list: paged, total, page, pageSize },
    });
  }),

  // 标记公告已读
  http.post('/api/announcements/:id/read', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),
];
