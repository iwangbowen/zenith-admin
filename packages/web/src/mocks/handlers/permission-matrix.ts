import { apiCatalogContract, permissionCatalogContract, permissionMatrixContract, type ApiCatalog, type PermissionCatalog, type RolePermissionSet, type UserPermissionSet } from '@zenith/shared/identity';
import { buildApiCatalog } from '@zenith/shared/permission-catalog';
import { SEED_MENUS } from '@zenith/shared/seed';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { mockRoles } from '@/mocks/data/roles';
import { mockUsers } from '@/mocks/data/users';

/** Demo 模式与服务端同源：直接从契约派生目录（mocks 只进 Demo 构建，不影响生产分包） */
let cachedCatalog: ApiCatalog | null = null;

/** 角色绑定的启用按钮菜单 → 权限码（与服务端 permissionsOfMenus 同口径，Demo 不区分套餐） */
function permissionsOfMenuIds(menuIds: readonly number[]): string[] {
  const ids = new Set(menuIds);
  const codes = SEED_MENUS
    .filter((menu) => ids.has(menu.id) && menu.status === 'enabled' && menu.permission)
    .map((menu) => menu.permission as string);
  return [...new Set(codes)].sort();
}

function toRoleSet(role: typeof mockRoles[number]): RolePermissionSet {
  const superAdmin = role.code === 'super_admin';
  return {
    id: role.id,
    name: role.name,
    code: role.code,
    status: role.status,
    tenantId: null,
    superAdmin,
    permissions: superAdmin ? [] : permissionsOfMenuIds(role.menuIds ?? []),
  };
}

function buildPermissionCatalog(): PermissionCatalog {
  const pages = SEED_MENUS.filter(menu => menu.type === 'menu');
  const pageById = new Map(pages.map(page => [page.id, page]));
  const buttons = SEED_MENUS.filter(menu => menu.type === 'button');
  return {
    items: Object.entries(ALL_PERMISSIONS).map(([code, meta]) => {
      const page = pages.find(item => item.permission === code);
      if (page) return { code, label: meta.label, surface: 'page' as const, pageId: page.id, pageTitle: page.title, path: page.path ?? null, uiOnly: meta.uiOnly ?? false };
      const button = buttons.find(item => item.permission === code);
      if (button) {
        const parent = pageById.get(button.parentId);
        return { code, label: meta.label, surface: 'button' as const, pageId: parent?.id ?? null, pageTitle: parent?.title ?? null, path: parent?.path ?? null, uiOnly: meta.uiOnly ?? false };
      }
      return { code, label: meta.label, surface: 'api' as const, pageId: null, pageTitle: null, path: null, uiOnly: meta.uiOnly ?? false };
    }),
  };
}

let cachedPermissionCatalog: PermissionCatalog | null = null;

export const permissionMatrixHandlers = [
  mock(apiCatalogContract.get, ({ ok }) => ok(cachedCatalog ??= buildApiCatalog())),
  mock(permissionCatalogContract.list, ({ ok }) => ok(cachedPermissionCatalog ??= buildPermissionCatalog())),
  mock(permissionMatrixContract.roles, ({ ok }) => ok(mockRoles.map(toRoleSet))),
  mock(permissionMatrixContract.user, ({ params, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    const roles = user.roles.map((r) => mockRoles.find((m) => m.id === r.id) ?? r);
    const superAdmin = roles.some((r) => r.code === 'super_admin');
    const set: UserPermissionSet = {
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      status: user.status,
      tenantId: user.tenantId ?? null,
      superAdmin,
      roles: roles.map(({ id, name, code }) => ({ id, name, code })),
      permissions: superAdmin ? [] : [...new Set(roles.flatMap((r) => permissionsOfMenuIds(r.menuIds ?? [])))].sort(),
    };
    return ok(set);
  }),
];
