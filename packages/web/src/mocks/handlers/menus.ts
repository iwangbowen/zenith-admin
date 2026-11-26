import { ADMIN_CONTEXT_ROUTES, PAGE_ROUTE_RULES, menuContract, menuRoutePattern, type Menu } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { conflict } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockMenus, buildMenuTree, getNextMenuId } from '@/mocks/data/menus';
import { mockRoles } from '@/mocks/data/roles';
import { mockDateTime } from '@/mocks/utils/date';
import { mockResource } from '@/mocks/utils/resource';
import { currentMockSession, isMockPlatformAdmin, mockAvailableMenus, mockPackageFeatures, mockUserAccess } from '@/mocks/utils/auth';

export const menusHandlers = [
  // 当前用户的菜单树（用于渲染侧边栏）
  mock(menuContract.userTree, ({ request, ok }) => {
    const user = currentMockSession(request)?.user;
    const available = mockAvailableMenus(user?.tenantId);
    if (!user || isMockPlatformAdmin(user)) return ok(buildMenuTree(available));
    const access = mockUserAccess(user);
    const byId = new Map(available.map(menu => [menu.id, menu]));
    const byName = new Map(available.map(menu => [menu.name, menu.id]));
    const selected = new Set(available.flatMap(page => {
      if (page.type !== 'menu') return [];
      const rule = PAGE_ROUTE_RULES[page.name ?? ''];
      const owner = rule ? byName.get(rule.owner) : undefined;
      if (rule && (owner === undefined || (rule.anyPermission && !rule.anyPermission.some(code => access.permissions.includes(code))))) return [];
      return access.menuIds.includes(page.id) || (owner !== undefined && access.menuIds.includes(owner)) ? [page.id] : [];
    }));
    for (const id of [...selected]) {
      for (let parent = byId.get(byId.get(id)?.parentId ?? 0); parent; parent = byId.get(parent.parentId)) {
        if (parent.type === 'directory') selected.add(parent.id);
      }
    }
    return ok(buildMenuTree(available.filter(menu => selected.has(menu.id)).map(menu => {
      let parentId = menu.parentId;
      while (parentId && !selected.has(parentId)) parentId = byId.get(parentId)?.parentId ?? 0;
      return { ...menu, parentId };
    })));
  }),

  mock(menuContract.paths, ({ request, ok }) => {
    const tenantId = currentMockSession(request)?.user.tenantId;
    const available = mockAvailableMenus(tenantId);
    const names = new Set(available.filter(menu => menu.type === 'menu').map(page => page.name));
    const features = mockPackageFeatures(tenantId);
    return ok([
      ...available.flatMap(menu => {
        const owner = PAGE_ROUTE_RULES[menu.name ?? '']?.owner;
        return !owner || names.has(owner) ? menuRoutePattern(menu) ?? [] : [];
      }),
      ...ADMIN_CONTEXT_ROUTES.filter(route => (!route.owner || names.has(route.owner))
        && (!route.feature || !features || features.has(route.feature))).map(route => route.path),
    ]);
  }),

  mock(menuContract.flat, ({ ok }) => {
    return ok(mockMenus);
  }),

  // 菜单树（含所有层级）
  mock(menuContract.tree, ({ ok }) => {
    return ok(buildMenuTree(mockMenus));
  }),
  ...mockResource(menuContract, {
    store: mockMenus,
    notFound: '菜单不存在',
    exclude: ['create', 'remove'],
  }),

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
