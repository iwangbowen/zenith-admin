import { menuContract, type Menu } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem, updateItem } from '@/mocks/utils/crud';
import { conflict } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockMenus, buildMenuTree, getNextMenuId } from '@/mocks/data/menus';
import { mockRoles } from '@/mocks/data/roles';
import { mockDateTime } from '@/mocks/utils/date';

export const menusHandlers = [
  // 当前用户的菜单树（用于渲染侧边栏）
  mock(menuContract.userTree, ({ ok }) => {
    // 与真实后端对齐：禁用菜单对所有人不可见；按钮为纯权限点，不参与页面展示
    return ok(buildMenuTree(mockMenus.filter((m) => m.status === 'enabled' && m.type !== 'button')));
  }),

  // 平铺菜单列表
  mock(menuContract.flat, ({ ok }) => {
    return ok(mockMenus);
  }),

  // 菜单树（含所有层级）
  mock(menuContract.tree, ({ ok }) => {
    return ok(buildMenuTree(mockMenus));
  }),

  // 获取单个菜单
  mock(menuContract.detail, ({ params, ok }) => {
    const menu = requireItem(mockMenus, params.id, '菜单不存在', { status: 404 });
    return ok(menu);
  }),

  // 新增菜单
  mock(menuContract.create, ({ body, ok }) => {
    const newMenu: Menu = {
      id: getNextMenuId(),
      ...body,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockMenus.push(newMenu);
    return ok(newMenu, '新增成功');
  }),

  // 更新菜单
  mock(menuContract.update, ({ params, body, ok }) => {
    const menu = updateItem(mockMenus, params.id, body, { notFoundMessage: '菜单不存在', now: mockDateTime, init: { status: 404 } });
    return ok(menu, '更新成功');
  }),

  // 删除菜单（在用保护：被非超管角色引用的菜单返回 409；级联删除子菜单）
  mock(menuContract.remove, ({ params, ok }) => {
    const id = params.id;
    requireItem(mockMenus, id, '菜单不存在', { status: 404 });
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
      return conflict(`该菜单（含子菜单）仍被 ${refRoles.length} 个角色授权引用，请先解除授权后再删除`, { status: 409 });
    }
    removeWhere(mockMenus, (menu) => toDelete.has(menu.id));
    return ok(null, '删除成功');
  }),
];
