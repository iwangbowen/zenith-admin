import { http, HttpResponse } from 'msw';
import { mockMenus, buildMenuTree, getNextMenuId } from '../data/menus';
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
      sort: body.sort ?? 0,
      status: body.status ?? 'active',
      visible: body.visible ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockMenus.push(newMenu);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newMenu });
  }),

  // 更新菜单
  http.put('/api/menus/:id', async ({ params, request }) => {
    const menu = mockMenus.find((m) => m.id === Number(params.id));
    if (!menu) return HttpResponse.json({ code: 404, message: '菜单不存在', data: null });
    const body = await request.json() as Partial<Menu>;
    Object.assign(menu, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: menu });
  }),

  // 删除菜单
  http.delete('/api/menus/:id', ({ params }) => {
    const index = mockMenus.findIndex((m) => m.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '菜单不存在', data: null });
    mockMenus.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
