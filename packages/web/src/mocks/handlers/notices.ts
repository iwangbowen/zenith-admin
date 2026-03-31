import { http, HttpResponse } from 'msw';
import { mockNotices, getNextNoticeId } from '@/mocks/data/notices';
import type { Notice } from '@zenith/shared';

export const noticesHandlers = [
  // 通知列表（分页）
  http.get('/api/notices', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const publishStatus = url.searchParams.get('publishStatus') ?? '';
    const type = url.searchParams.get('type') ?? '';

    let list = mockNotices.filter((n) => {
      if (keyword && !n.title.includes(keyword)) return false;
      if (publishStatus && n.publishStatus !== publishStatus) return false;
      if (type && n.type !== type) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 已发布通知列表（前台展示，无需鉴权）
  http.get('/api/notices/published', () => {
    const data = mockNotices
      .filter((n) => n.publishStatus === 'published')
      .sort((a, b) => new Date(b.publishTime ?? 0).getTime() - new Date(a.publishTime ?? 0).getTime())
      .slice(0, 20)
      .map((n) => ({ ...n, isRead: false }));
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // 通知收件箱（分页，含已读状态 — Demo 模式已读状态不持久化，始终 false）
  http.get('/api/notices/inbox', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const isReadFilter = url.searchParams.get('isRead');

    let list = mockNotices
      .filter((n) => n.publishStatus === 'published')
      .sort((a, b) => new Date(b.publishTime ?? 0).getTime() - new Date(a.publishTime ?? 0).getTime())
      .map((n) => ({ ...n, isRead: false }));

    if (isReadFilter === 'true') list = list.filter((n) => n.isRead);
    else if (isReadFilter === 'false') list = list.filter((n) => !n.isRead);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
  }),

  // 全部标记为已读（Demo 模式不持久化，直接返回成功）
  http.post('/api/notices/read-all', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),

  // 获取单个通知
  http.get('/api/notices/:id', ({ params }) => {
    const notice = mockNotices.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: notice });
  }),

  // 新增通知
  http.post('/api/notices', async ({ request }) => {
    const body = await request.json() as Partial<Notice>;
    const newNotice: Notice = {
      id: getNextNoticeId(),
      title: body.title ?? '',
      content: body.content ?? '',
      type: body.type ?? 'notice',
      publishStatus: 'draft',
      priority: body.priority ?? 'low',
      publishTime: null,
      createById: 1,
      createByName: '管理员',
      targetType: body.targetType ?? 'all',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockNotices.push(newNotice);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newNotice });
  }),

  // 更新通知
  http.put('/api/notices/:id', async ({ params, request }) => {
    const notice = mockNotices.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });
    const body = await request.json() as Partial<Notice>;
    Object.assign(notice, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: notice });
  }),

  // 发布通知
  http.put('/api/notices/:id/publish', ({ params }) => {
    const notice = mockNotices.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });
    notice.publishStatus = 'published';
    notice.publishTime = new Date().toISOString();
    notice.updatedAt = new Date().toISOString();
    return HttpResponse.json({ code: 0, message: '发布成功', data: notice });
  }),

  // 撤回通知
  http.put('/api/notices/:id/recall', ({ params }) => {
    const notice = mockNotices.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });
    notice.publishStatus = 'recalled';
    notice.updatedAt = new Date().toISOString();
    return HttpResponse.json({ code: 0, message: '撤回成功', data: notice });
  }),

  // 批量删除通知
  http.delete('/api/notices/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = body?.ids ?? [];
    ids.forEach((id) => {
      const index = mockNotices.findIndex((n) => n.id === id);
      if (index !== -1) mockNotices.splice(index, 1);
    });
    return HttpResponse.json({ code: 0, message: `已删除 ${ids.length} 条通知`, data: null });
  }),

  // 删除通知
  http.delete('/api/notices/:id', ({ params }) => {
    const index = mockNotices.findIndex((n) => n.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });
    mockNotices.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 已读统计详情（管理视角）
  http.get('/api/notices/:id/read-stats', ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const tab = url.searchParams.get('tab') === 'unread' ? 'unread' : 'read';
    const notice = mockNotices.find((n) => n.id === Number(params.id));
    if (!notice) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });

    // 模拟已读和未读用户列表
    const mockReadUsers = [
      { id: 1, username: 'admin', nickname: '管理员', avatar: null, readAt: '2024-01-01T09:00:00.000Z' },
      { id: 2, username: 'zhangsan', nickname: '张三', avatar: null, readAt: '2024-01-01T10:30:00.000Z' },
      { id: 3, username: 'lisi', nickname: '李四', avatar: null, readAt: '2024-01-02T08:15:00.000Z' },
      { id: 4, username: 'wangwu', nickname: '王五', avatar: null, readAt: '2024-01-02T14:20:00.000Z' },
      { id: 5, username: 'zhaoliu', nickname: '赵六', avatar: null, readAt: '2024-01-03T11:00:00.000Z' },
      { id: 6, username: 'sunqi', nickname: '孙七', avatar: null, readAt: '2024-01-03T16:45:00.000Z' },
      { id: 7, username: 'zhouba', nickname: '周八', avatar: null, readAt: '2024-01-04T09:30:00.000Z' },
      { id: 8, username: 'wujiu', nickname: '吴九', avatar: null, readAt: '2024-01-04T13:10:00.000Z' },
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

  // 标记通知已读
  http.post('/api/notices/:id/read', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),
];
