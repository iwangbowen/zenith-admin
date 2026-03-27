import { http, HttpResponse } from 'msw';
import { mockUsers, getNextUserId, type MockUser } from '@/mocks/data/users';
import { mockRoles } from '@/mocks/data/roles';
import { mockPositions } from '@/mocks/data/positions';
import { mockDepartments } from '@/mocks/data/departments';

// Demo 模式下新增/重置用户时使用的默认初始口令（明文仅用于演示环境）
const DEMO_INITIAL_CREDENTIAL = ['1', '2', '3', '4', '5', '6'].join('');

function flattenDepts(depts: typeof mockDepartments): typeof mockDepartments {
  const result: typeof mockDepartments = [];
  const traverse = (items: typeof mockDepartments) => {
    for (const d of items) {
      result.push(d);
      if (d.children) traverse(d.children);
    }
  };
  traverse(depts);
  return result;
}

function toUserResponse(user: MockUser) {
  const { password: _, ...rest } = user;
  return {
    ...rest,
    departmentName: flattenDepts(mockDepartments).find((d) => d.id === rest.departmentId)?.name ?? null,
    positions: rest.positionIds?.map((pid) => mockPositions.find((p) => p.id === pid)).filter(Boolean) ?? [],
    roles: rest.roles,
  };
}

export const usersHandlers = [
  // 用户列表（分页）
  http.get('/api/users', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const roleId = url.searchParams.get('roleId') ?? '';

    let list = mockUsers.filter((u) => {
      if (keyword && !u.username.includes(keyword) && !u.nickname.includes(keyword)) return false;
      if (status && u.status !== status) return false;
      if (roleId && !u.roles.some((r) => String(r.id) === roleId)) return false;
      return true;
    });

    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { list: list.map(toUserResponse), total, page, pageSize },
    });
  }),

  // 获取单个用户
  http.get('/api/users/:id', ({ params }) => {
    const user = mockUsers.find((u) => u.id === Number(params.id));
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: toUserResponse(user) });
  }),

  // 新增用户
  http.post('/api/users', async ({ request }) => {
    const body = await request.json() as Partial<MockUser> & { roleIds?: number[]; positionIds?: number[] };
    const roles = (body.roleIds ?? []).map((id) => mockRoles.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    const positions = (body.positionIds ?? []).map((id) => mockPositions.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const newUser: MockUser = {
      id: getNextUserId(),
      username: body.username ?? '',
      nickname: body.nickname ?? '',
      email: body.email ?? '',
      password: DEMO_INITIAL_CREDENTIAL,
      avatar: body.avatar,
      departmentId: body.departmentId ?? null,
      departmentName: null,
      positionIds: body.positionIds ?? [],
      positions,
      roles,
      status: body.status ?? 'active',
      passwordUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockUsers.push(newUser);
    return HttpResponse.json({ code: 0, message: '新增成功', data: toUserResponse(newUser) });
  }),

  // 更新用户
  http.put('/api/users/:id', async ({ params, request }) => {
    const user = mockUsers.find((u) => u.id === Number(params.id));
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });
    const body = await request.json() as Partial<MockUser> & { roleIds?: number[]; positionIds?: number[] };
    if (body.roleIds !== undefined) {
      user.roles = body.roleIds.map((id) => mockRoles.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    }
    if (body.positionIds !== undefined) {
      user.positionIds = body.positionIds;
      user.positions = body.positionIds.map((id) => mockPositions.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    }
    Object.assign(user, { ...body, updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: toUserResponse(user) });
  }),

  // 批量删除用户
  http.delete('/api/users/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = new Set(body?.ids ?? []);
    if (ids.size === 0) return HttpResponse.json({ code: 400, message: '请选择要删除的用户', data: null });
    const before = mockUsers.length;
    mockUsers.splice(0, mockUsers.length, ...mockUsers.filter((u) => !ids.has(u.id)));
    return HttpResponse.json({ code: 0, message: `已删除 ${before - mockUsers.length} 个用户`, data: null });
  }),

  // 删除用户
  http.delete('/api/users/:id', ({ params }) => {
    const index = mockUsers.findIndex((u) => u.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });
    if (mockUsers[index].username === 'admin') {
      return HttpResponse.json({ code: 400, message: '不能删除管理员账号', data: null });
    }
    mockUsers.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 重置密码
  http.put('/api/users/:id/reset-password', ({ params }) => {
    const user = mockUsers.find((u) => u.id === Number(params.id));
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });
    user.password = DEMO_INITIAL_CREDENTIAL;
    return HttpResponse.json({ code: 0, message: `密码已重置为 ${DEMO_INITIAL_CREDENTIAL}`, data: null });
  }),

  // 修改用户状态
  http.put('/api/users/:id/status', async ({ params, request }) => {
    const user = mockUsers.find((u) => u.id === Number(params.id));
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });
    const body = await request.json() as { status: 'active' | 'disabled' };
    user.status = body.status;
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json({ code: 0, message: '状态更新成功', data: null });
  }),

  // 下载导入模板
  http.get('/api/users/import-template', () => {
    return new Response(new ArrayBuffer(0), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=user_import_template.xlsx',
      },
    });
  }),

  // 批量导入用户
  http.post('/api/users/import', () => {
    return HttpResponse.json({
      code: 0,
      message: '导入完成',
      data: { total: 2, success: 2, failed: 0, errors: [] },
    });
  }),
];
