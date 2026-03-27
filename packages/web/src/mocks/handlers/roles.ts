import { http, HttpResponse } from 'msw';
import { mockRoles, getNextRoleId } from '@/mocks/data/roles';
import { mockMenus } from '@/mocks/data/menus';
import type { Role } from '@zenith/shared';

export const rolesHandlers = [
  // 角色列表（平铺，与真实后端一致）
  http.get('/api/roles', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';

    const data = mockRoles.filter((r) => {
      if (keyword && !r.name.includes(keyword) && !r.code.includes(keyword)) return false;
      if (status && r.status !== status) return false;
      return true;
    });
    return HttpResponse.json({ code: 0, message: 'ok', data });
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
    const newRole: Role = {
      id: getNextRoleId(),
      name: body.name ?? '',
      code: body.code ?? '',
      description: body.description,
      dataScope: body.dataScope ?? 'all',
      status: body.status ?? 'active',
      menuIds: body.menuIds ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockRoles.push(newRole);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newRole });
  }),

  // 更新角色
  http.put('/api/roles/:id', async ({ params, request }) => {
    const role = mockRoles.find((r) => r.id === Number(params.id));
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const body = await request.json() as Partial<Role>;
    Object.assign(role, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: role });
  }),

  // 删除角色
  http.delete('/api/roles/:id', ({ params }) => {
    const index = mockRoles.findIndex((r) => r.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    mockRoles.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 更新角色菜单
  http.put('/api/roles/:id/menus', async ({ params, request }) => {
    const role = mockRoles.find((r) => r.id === Number(params.id));
    if (!role) return HttpResponse.json({ code: 404, message: '角色不存在', data: null });
    const body = await request.json() as { menuIds: number[] };
    role.menuIds = body.menuIds;
    role.updatedAt = new Date().toISOString();
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
];
