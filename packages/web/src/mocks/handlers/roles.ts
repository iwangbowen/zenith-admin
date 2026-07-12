import { http, HttpResponse } from 'msw';
import { mockRoles, getNextRoleId } from '@/mocks/data/roles';
import { mockMenus } from '@/mocks/data/menus';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import type { Role } from '@zenith/shared';

export const rolesHandlers = [
  // 角色列表（支持服务端分页）
  http.get('/api/roles', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    const filtered = mockRoles.filter((r) => {
      if (keyword && !r.name.includes(keyword) && !r.code.includes(keyword)) return false;
      if (status && r.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 所有角色（不分页，供下拉框使用）
  http.get('/api/roles/all', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockRoles });
  }),

  // 获取单个角色
  http.get('/api/roles/:id', ({ params }) => {
    const role = mockRoles.find((r) => r.id === Number(params.id));
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: role });
  }),

  // 新增角色
  http.post('/api/roles', async ({ request }) => {
    const body = await request.json() as Partial<Role> & { menuIds?: number[] };
    if (body.code === 'super_admin') {
      return HttpResponse.json({ code: 400, message: '角色编码 super_admin 为系统保留编码，不允许使用', data: null }, { status: 400 });
    }
    const newRole: Role = {
      id: getNextRoleId(),
      name: body.name ?? '',
      code: body.code ?? '',
      description: body.description,
      dataScope: body.dataScope ?? 'all',
      status: body.status ?? 'enabled',
      menuIds: body.menuIds ?? [],
      deptScopeIds: body.deptScopeIds ?? [],
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockRoles.push(newRole);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newRole });
  }),

  // 更新角色
  http.put('/api/roles/:id', async ({ params, request }) => {
    const role = mockRoles.find((r) => r.id === Number(params.id));
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const body = await request.json() as Partial<Role>;
    if (body.code !== undefined && body.code !== role.code) {
      if (body.code === 'super_admin') {
        return HttpResponse.json({ code: 400, message: '角色编码 super_admin 为系统保留编码，不允许使用', data: null }, { status: 400 });
      }
      if (role.code === 'super_admin') {
        return HttpResponse.json({ code: 400, message: '超级管理员角色编码不允许修改', data: null }, { status: 400 });
      }
    }
    Object.assign(role, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: role });
  }),

  // 删除角色（在用保护：已分配用户的角色返回 409）
  http.delete('/api/roles/:id', ({ params }) => {
    const index = mockRoles.findIndex((r) => r.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const role = mockRoles[index];
    if (role.code === 'super_admin') {
      return HttpResponse.json({ code: 400, message: '超级管理员角色不允许删除', data: null }, { status: 400 });
    }
    const boundUsers = role.userCount ?? 0;
    if (boundUsers > 0) {
      return HttpResponse.json(
        { code: 409, message: `该角色已分配给 ${boundUsers} 个用户，请先解除用户关联后再删除`, data: null },
        { status: 409 },
      );
    }
    mockRoles.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 更新角色菜单
  http.put('/api/roles/:id/menus', async ({ params, request }) => {
    const role = mockRoles.find((r) => r.id === Number(params.id));
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const body = await request.json() as { menuIds: number[] };
    role.menuIds = body.menuIds;
    role.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '菜单权限更新成功', data: null });
  }),

  // 获取角色下的菜单 ID 列表
  http.get('/api/roles/:id/menus', ({ params }) => {
    const role = mockRoles.find((r) => r.id === Number(params.id));
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const menuIds = role.menuIds ?? [];
    const menus = mockMenus.filter((m) => menuIds.includes(m.id));
    return HttpResponse.json({ code: 0, message: 'ok', data: menus });
  }),

  // 获取角色下的用户列表（与真实接口 GET /api/roles/:id/users 对齐）
  http.get('/api/roles/:id/users', ({ params }) => {
    const roleId = Number(params.id);
    const role = mockRoles.find((r) => r.id === roleId);
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const list = mockUsers
      .filter((u) => u.roles.some((r) => r.id === roleId))
      .map((u) => ({
        id: u.id, username: u.username, nickname: u.nickname, email: u.email,
        avatar: u.avatar ?? null, status: u.status,
        createdAt: u.createdAt, updatedAt: u.updatedAt,
      }));
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  // 分配角色用户（先清后设，与真实接口 PUT /api/roles/:id/users 对齐）
  http.put('/api/roles/:id/users', async ({ params, request }) => {
    const roleId = Number(params.id);
    const role = mockRoles.find((r) => r.id === roleId);
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const body = await request.json() as { userIds: number[] };
    const nextIds = new Set(body.userIds ?? []);
    mockUsers.forEach((u) => {
      const has = u.roles.some((r) => r.id === roleId);
      if (nextIds.has(u.id) && !has) u.roles = [...u.roles, role];
      if (!nextIds.has(u.id) && has) u.roles = u.roles.filter((r) => r.id !== roleId);
    });
    role.userCount = nextIds.size;
    role.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '用户分配成功', data: null });
  }),
];
