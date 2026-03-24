import { http, HttpResponse } from 'msw';
import { mockPositions, getNextPositionId } from '../data/positions';
import type { Position } from '@zenith/shared';

export const positionsHandlers = [
  // 岗位列表（分页）
  http.get('/api/positions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';

    let list = mockPositions.filter((p) => {
      if (keyword && !p.name.includes(keyword) && !p.code.includes(keyword)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 所有岗位（供下拉框使用）
  http.get('/api/positions/all', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockPositions });
  }),

  // 获取单个岗位
  http.get('/api/positions/:id', ({ params }) => {
    const pos = mockPositions.find((p) => p.id === Number(params.id));
    if (!pos) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: pos });
  }),

  // 新增岗位
  http.post('/api/positions', async ({ request }) => {
    const body = await request.json() as Partial<Position>;
    const newPos: Position = {
      id: getNextPositionId(),
      name: body.name ?? '',
      code: body.code ?? '',
      sort: body.sort ?? 0,
      status: body.status ?? 'active',
      remark: body.remark,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockPositions.push(newPos);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newPos });
  }),

  // 更新岗位
  http.put('/api/positions/:id', async ({ params, request }) => {
    const pos = mockPositions.find((p) => p.id === Number(params.id));
    if (!pos) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    const body = await request.json() as Partial<Position>;
    Object.assign(pos, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: pos });
  }),

  // 删除岗位
  http.delete('/api/positions/:id', ({ params }) => {
    const index = mockPositions.findIndex((p) => p.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    mockPositions.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
