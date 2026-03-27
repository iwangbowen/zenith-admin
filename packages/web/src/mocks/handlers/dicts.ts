import { http, HttpResponse } from 'msw';
import { mockDicts, mockDictItems, getNextDictId, getNextDictItemId } from '@/mocks/data/dicts';
import type { Dict, DictItem } from '@zenith/shared';

export const dictsHandlers = [
  // 字典列表（DictsPage 期望平铺数组）
  http.get('/api/dicts', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';

    const list = mockDicts.filter((d) => {
      if (keyword && !d.name.includes(keyword) && !d.code.includes(keyword)) return false;
      return true;
    });
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDicts.push(newDict);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newDict });
  }),

  // 更新字典
  http.put('/api/dicts/:id', async ({ params, request }) => {
    const dict = mockDicts.find((d) => d.id === Number(params.id));
    if (!dict) return HttpResponse.json({ code: 404, message: '字典不存在', data: null });
    const body = await request.json() as Partial<Dict>;
    Object.assign(dict, body, { updatedAt: new Date().toISOString() });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDictItems.push(newItem);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newItem });
  }),

  // 更新字典条目
  http.put('/api/dicts/:dictId/items/:itemId', async ({ params, request }) => {
    const item = mockDictItems.find((i) => i.id === Number(params.itemId));
    if (!item) return HttpResponse.json({ code: 404, message: '字典条目不存在', data: null });
    const body = await request.json() as Partial<DictItem>;
    Object.assign(item, body, { updatedAt: new Date().toISOString() });
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
