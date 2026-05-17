import { http, HttpResponse } from 'msw';
import { mockTags, getNextTagId, getTagGroups } from '@/mocks/data/tags';
import { mockDateTime } from '@/mocks/utils/date';
import type { Tag } from '@zenith/shared';

export const tagsHandlers = [
  // 标签列表（支持分页 + 关键字/状态/分组筛选）
  http.get('/api/tags', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const groupName = url.searchParams.get('groupName') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

    const filtered = mockTags.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !(t.description ?? '').includes(keyword)) return false;
      if (status && t.status !== status) return false;
      if (groupName && t.groupName !== groupName) return false;
      return true;
    });

    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取分组列表
  http.get('/api/tags/groups', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: getTagGroups() });
  }),

  // 新增标签
  http.post('/api/tags', async ({ request }) => {
    const body = await request.json() as Partial<Tag>;
    if (mockTags.some((t) => t.name === body.name)) {
      return HttpResponse.json({ code: 400, message: '标签名称已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const newTag: Tag = {
      id: getNextTagId(),
      name: body.name ?? '',
      color: body.color ?? null,
      groupName: body.groupName ?? null,
      description: body.description ?? null,
      status: body.status ?? 'enabled',
      sortOrder: body.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    mockTags.push(newTag);
    return HttpResponse.json({ code: 0, message: '创建成功', data: newTag });
  }),

  // 更新标签
  http.put('/api/tags/:id', async ({ params, request }) => {
    const tag = mockTags.find((t) => t.id === Number(params.id));
    if (!tag) return HttpResponse.json({ code: 404, message: '标签不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<Tag>;
    if (body.name && body.name !== tag.name && mockTags.some((t) => t.name === body.name)) {
      return HttpResponse.json({ code: 400, message: '标签名称已存在', data: null }, { status: 400 });
    }
    Object.assign(tag, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: tag });
  }),

  // 删除标签
  http.delete('/api/tags/:id', ({ params }) => {
    const index = mockTags.findIndex((t) => t.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '标签不存在', data: null }, { status: 404 });
    mockTags.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 批量删除
  http.delete('/api/tags/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = new Set(body.ids ?? []);
    let count = 0;
    for (let i = mockTags.length - 1; i >= 0; i--) {
      if (ids.has(mockTags[i].id)) {
        mockTags.splice(i, 1);
        count++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${count} 条标签`, data: null });
  }),
];
