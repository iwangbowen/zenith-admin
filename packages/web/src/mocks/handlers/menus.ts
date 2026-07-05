import { http, HttpResponse } from 'msw';
import { mockMenus, buildMenuTree, getNextMenuId } from '@/mocks/data/menus';
import { mockRoles } from '@/mocks/data/roles';
import { mockDateTime } from '@/mocks/utils/date';
import type { Menu } from '@zenith/shared';

export const menusHandlers = [
  // 当前用户的菜单树（用于渲染侧边栏）
  http.get('/api/menus/user', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: buildMenuTree(mockMenus) });
  }),

  // 菜单树（含所有层级）
  http.get('/api/menus', ({ request }) => {
    const url = new URL(request.url);
    const flat = url.searchParams.get('flat');
    if (flat === 'true') {
      return HttpResponse.json({ code: 0, message: 'ok', data: mockMenus });
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: buildMenuTree(mockMenus) });
  }),

  // 获取单个菜单
  http.get('/api/menus/:id', ({ params }) => {
    const menu = mockMenus.find((m) => m.id === Number(params.id));
    if (!menu) return HttpResponse.json({ code: 404, message: '菜单不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: menu });
  }),

  // 新增菜单
  http.post('/api/menus', async ({ request }) => {
    const body = await request.json() as Partial<Menu>;
    const newMenu: Menu = {
      id: getNextMenuId(),
      parentId: body.parentId ?? 0,
      title: body.title ?? '',
      name: body.name,
      path: body.path,
      component: body.component,
      icon: body.icon,
      type: body.type ?? 'menu',
      permission: body.permission,
      query: body.query ?? null,
      isExternal: body.isExternal ?? false,
      embed: body.embed ?? false,
      sort: body.sort ?? 0,
      status: body.status ?? 'enabled',
      visible: body.visible ?? true,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockMenus.push(newMenu);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newMenu });
  }),

  // 更新菜单
  http.put('/api/menus/:id', async ({ params, request }) => {
    const menu = mockMenus.find((m) => m.id === Number(params.id));
    if (!menu) return HttpResponse.json({ code: 404, message: '菜单不存在', data: null });
    const body = await request.json() as Partial<Menu>;
    Object.assign(menu, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: menu });
  }),

  // 删除菜单（在用保护：被非超管角色引用的菜单返回 409；级联删除子菜单）
  http.delete('/api/menus/:id', ({ params }) => {
    const id = Number(params.id);
    const index = mockMenus.findIndex((m) => m.id === id);
    if (index === -1) return HttpResponse.json({ code: 404, message: '菜单不存在', data: null });
    // 收集自身及全部子孙菜单
    const toDelete = new Set<number>();
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      toDelete.add(cur);
      mockMenus.filter((m) => m.parentId === cur).forEach((m) => queue.push(m.id));
    }
    const refRoles = mockRoles.filter(
      (r) => r.code !== 'super_admin' && (r.menuIds ?? []).some((mid) => toDelete.has(mid)),
    );
    if (refRoles.length > 0) {
      return HttpResponse.json(
        { code: 409, message: `该菜单（含子菜单）仍被 ${refRoles.length} 个角色授权引用，请先解除授权后再删除`, data: null },
        { status: 409 },
      );
    }
    for (let i = mockMenus.length - 1; i >= 0; i--) {
      if (toDelete.has(mockMenus[i].id)) mockMenus.splice(i, 1);
    }
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
