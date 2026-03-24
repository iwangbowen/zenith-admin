import { http, HttpResponse } from 'msw';
import { mockNotices, getNextNoticeId } from '../data/notices';
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

  // 删除通知
  http.delete('/api/notices/:id', ({ params }) => {
    const index = mockNotices.findIndex((n) => n.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '通知不存在', data: null });
    mockNotices.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 标记通知已读
  http.post('/api/notices/:id/read', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: null });
  }),
];
