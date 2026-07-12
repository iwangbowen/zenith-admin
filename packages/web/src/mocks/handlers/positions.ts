import { http, HttpResponse } from 'msw';
import { mockPositions, getNextPositionId } from '@/mocks/data/positions';
import { mockUsers } from '@/mocks/data/users';
import { mockDepartments } from '@/mocks/data/departments';
import { mockDateTime } from '@/mocks/utils/date';
import type { Position } from '@zenith/shared';

function findDepartmentName(departmentId: number | null | undefined): string | null {
  if (!departmentId) return null;
  const stack = [...mockDepartments];
  while (stack.length > 0) {
    const dept = stack.pop();
    if (!dept) continue;
    if (dept.id === departmentId) return dept.name;
    if (dept.children) stack.push(...dept.children);
  }
  return null;
}

export const positionsHandlers = [
  // 岗位列表（分页，与真实后端一致）
  http.get('/api/positions', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;

    const filtered = mockPositions.filter((p) => {
      if (keyword && !p.name.includes(keyword) && !p.code.includes(keyword)) return false;
      if (status && p.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
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
      status: body.status ?? 'enabled',
      remark: body.remark,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockPositions.push(newPos);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newPos });
  }),

  // 更新岗位
  http.put('/api/positions/:id', async ({ params, request }) => {
    const pos = mockPositions.find((p) => p.id === Number(params.id));
    if (!pos) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    const body = await request.json() as Partial<Position>;
    Object.assign(pos, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: pos });
  }),

  // 批量删除岗位
  http.delete('/api/positions/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = body?.ids ?? [];
    ids.forEach((id) => {
      const index = mockPositions.findIndex((p) => p.id === id);
      if (index !== -1) mockPositions.splice(index, 1);
    });
    return HttpResponse.json({ code: 0, message: `已删除 ${ids.length} 个岗位`, data: null });
  }),

  // 删除岗位
  http.delete('/api/positions/:id', ({ params }) => {
    const index = mockPositions.findIndex((p) => p.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    mockPositions.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 获取岗位成员（与真实接口 GET /api/positions/:id/members 对齐）
  http.get('/api/positions/:id/members', ({ params }) => {
    const positionId = Number(params.id);
    const pos = mockPositions.find((p) => p.id === positionId);
    if (!pos) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    const list = mockUsers
      .filter((u) => (u.positionIds ?? []).includes(positionId))
      .map((u) => ({
        id: u.id, username: u.username, nickname: u.nickname, email: u.email,
        avatar: u.avatar ?? null,
        departmentName: findDepartmentName(u.departmentId),
        createdAt: u.createdAt,
      }));
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  // 分配岗位成员（先清后设，与真实接口 PUT /api/positions/:id/members 对齐）
  http.put('/api/positions/:id/members', async ({ params, request }) => {
    const positionId = Number(params.id);
    const pos = mockPositions.find((p) => p.id === positionId);
    if (!pos) return HttpResponse.json({ code: 404, message: '岗位不存在', data: null });
    const body = await request.json() as { userIds: number[] };
    const nextIds = new Set(body.userIds ?? []);
    mockUsers.forEach((u) => {
      const ids = new Set(u.positionIds ?? []);
      if (nextIds.has(u.id)) ids.add(positionId);
      else ids.delete(positionId);
      u.positionIds = [...ids];
      u.positions = u.positionIds
        .map((pid) => mockPositions.find((p) => p.id === pid))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
    });
    pos.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '成员分配成功', data: null });
  }),
];
