import { http, HttpResponse } from 'msw';
import { mockDicts, mockDictItems, getNextDictId, getNextDictItemId } from '@/mocks/data/dicts';
import { mockDateTime } from '@/mocks/utils/date';
import type { Dict, DictItem } from '@zenith/shared';

export const dictsHandlers = [
  // 字典列表（支持服务端分页）
  http.get('/api/dicts', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const startDate = url.searchParams.get('startDate') ?? '';
    const endDate = url.searchParams.get('endDate') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    const filtered = mockDicts.filter((d) => {
      if (keyword && !d.name.includes(keyword) && !d.code.includes(keyword)) return false;
      if (status && d.status !== status) return false;
      if (startDate && d.createdAt < startDate) return false;
      if (endDate && d.createdAt > `${endDate} 23:59:59`) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取单个字典
  http.get('/api/dicts/:id', ({ params }) => {
    const dict = mockDicts.find((d) => d.id === Number(params.id));
    if (!dict) return HttpResponse.json({ code: 404, message: '字典不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: dict });
  }),

  // 新增字典
  http.post('/api/dicts', async ({ request }) => {
    const body = await request.json() as Partial<Dict>;
    const newDict: Dict = {
      id: getNextDictId(),
      name: body.name ?? '',
      code: body.code ?? '',
      description: body.description,
      status: body.status ?? 'active',
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockDicts.push(newDict);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newDict });
  }),

  // 更新字典
  http.put('/api/dicts/:id', async ({ params, request }) => {
    const dict = mockDicts.find((d) => d.id === Number(params.id));
    if (!dict) return HttpResponse.json({ code: 404, message: '字典不存在', data: null });
    const body = await request.json() as Partial<Dict>;
    Object.assign(dict, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: dict });
  }),

  // 删除字典
  http.delete('/api/dicts/:id', ({ params }) => {
    const index = mockDicts.findIndex((d) => d.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '字典不存在', data: null });
    mockDicts.splice(index, 1);
    // 同时删除该字典下的所有条目
    const toRemove = mockDictItems.filter((item) => item.dictId === Number(params.id));
    toRemove.forEach((item) => {
      const i = mockDictItems.indexOf(item);
      if (i !== -1) mockDictItems.splice(i, 1);
    });
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 获取字典条目列表
  http.get('/api/dicts/:id/items', ({ params }) => {
    const items = mockDictItems.filter((item) => item.dictId === Number(params.id));
    return HttpResponse.json({ code: 0, message: 'ok', data: items });
  }),

  // 新增字典条目
  http.post('/api/dicts/:id/items', async ({ params, request }) => {
    const body = await request.json() as Partial<DictItem>;
    const newItem: DictItem = {
      id: getNextDictItemId(),
      dictId: Number(params.id),
      label: body.label ?? '',
      value: body.value ?? '',
      color: body.color,
      sort: body.sort ?? 0,
      status: body.status ?? 'active',
      remark: body.remark,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockDictItems.push(newItem);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newItem });
  }),

  // 更新字典条目
  http.put('/api/dicts/:dictId/items/:itemId', async ({ params, request }) => {
    const item = mockDictItems.find((i) => i.id === Number(params.itemId));
    if (!item) return HttpResponse.json({ code: 404, message: '字典条目不存在', data: null });
    const body = await request.json() as Partial<DictItem>;
    Object.assign(item, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: item });
  }),

  // 删除字典条目
  http.delete('/api/dicts/:dictId/items/:itemId', ({ params }) => {
    const index = mockDictItems.findIndex((i) => i.id === Number(params.itemId));
    if (index === -1) return HttpResponse.json({ code: 404, message: '字典条目不存在', data: null });
    mockDictItems.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 通过 code 查询字典条目（供前端下拉框使用）
  http.get('/api/dicts/code/:code/items', ({ params }) => {
    const dict = mockDicts.find((d) => d.code === params.code);
    if (!dict) return HttpResponse.json({ code: 0, message: 'ok', data: [] });
    const items = mockDictItems.filter((item) => item.dictId === dict.id);
    return HttpResponse.json({ code: 0, message: 'ok', data: items });
  }),
];
