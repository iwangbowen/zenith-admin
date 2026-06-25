import { http, HttpResponse } from 'msw';
import { mockUsers } from '@/mocks/data/users';
import { mockRoles } from '@/mocks/data/roles';

// In-memory store for user-level menu/data permissions
const userMenuMap: Record<number, number[]> = {};
const userDataScopeMap: Record<number, string | null> = {};
const userDeptScopeMap: Record<number, number[]> = {};

const SCOPE_PRIORITY: Record<string, number> = { all: 5, dept: 4, dept_only: 3, custom: 2, self: 1 };

function getMostPermissive(scopes: Array<string | null>): string | null {
  const valid = scopes.filter((s): s is string => s !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, curr) => (SCOPE_PRIORITY[curr] ?? 0) > (SCOPE_PRIORITY[best] ?? 0) ? curr : best, valid[0]);
}

export const userPermissionsHandlers = [
  // GET /api/users/:id/menus — 用户菜单权限
  http.get('/api/users/:id/menus', ({ params }) => {
    const userId = Number(params.id);
    const user = mockUsers.find((u) => u.id === userId);
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });

    const directMenuIds = userMenuMap[userId] ?? [];
    const userRoleIds = (user as { roleIds?: number[] }).roleIds ?? [];
    const roleMenuIdSet = new Set<number>();
    for (const role of mockRoles.filter((r) => userRoleIds.includes(r.id))) {
      for (const id of (role.menuIds ?? [])) roleMenuIdSet.add(id);
    }
    return HttpResponse.json({
      code: 0, message: 'ok',
      data: { directMenuIds, roleMenuIds: [...roleMenuIdSet] },
    });
  }),

  // PUT /api/users/:id/menus — 分配用户菜单权限
  http.put('/api/users/:id/menus', async ({ params, request }) => {
    const userId = Number(params.id);
    const body = await request.json() as { menuIds: number[] };
    userMenuMap[userId] = body.menuIds ?? [];
    return HttpResponse.json({ code: 0, message: '保存成功', data: null });
  }),

  // GET /api/users/:id/data-permission — 用户数据权限
  http.get('/api/users/:id/data-permission', ({ params }) => {
    const userId = Number(params.id);
    const user = mockUsers.find((u) => u.id === userId);
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });

    const userRoleIds = (user as { roleIds?: number[] }).roleIds ?? [];
    const userRoles = mockRoles.filter((r) => userRoleIds.includes(r.id));
    const roleDataScope = getMostPermissive(userRoles.map((r) => r.dataScope ?? null));
    const roleDeptScopeIds = [...new Set(
      userRoles.filter((r) => r.dataScope === 'custom').flatMap((r) => r.deptScopeIds ?? [])
    )];

    return HttpResponse.json({
      code: 0, message: 'ok',
      data: {
        userDataScope: userDataScopeMap[userId] ?? null,
        deptScopeIds: userDeptScopeMap[userId] ?? [],
        roleDataScope,
        roleDeptScopeIds,
      },
    });
  }),

  // PUT /api/users/:id/data-permission — 设置用户数据权限
  http.put('/api/users/:id/data-permission', async ({ params, request }) => {
    const userId = Number(params.id);
    const body = await request.json() as { dataScope: string | null; deptScopeIds: number[] };
    userDataScopeMap[userId] = body.dataScope ?? null;
    userDeptScopeMap[userId] = body.dataScope === 'custom' ? (body.deptScopeIds ?? []) : [];
    return HttpResponse.json({ code: 0, message: '保存成功', data: null });
  }),

  // GET /api/users/:id/effective-permissions — 最终有效权限
  http.get('/api/users/:id/effective-permissions', ({ params }) => {
    const userId = Number(params.id);
    const user = mockUsers.find((u) => u.id === userId);
    if (!user) return HttpResponse.json({ code: 404, message: '用户不存在', data: null });

    const userRoleIds = (user as { roleIds?: number[] }).roleIds ?? [];
    const userRoles = mockRoles.filter((r) => userRoleIds.includes(r.id));

    const directMenuIds = userMenuMap[userId] ?? [];
    const roleMenuIds = [...new Set(userRoles.flatMap((r) => r.menuIds ?? []))];
    const effectiveMenuIds = [...new Set([...directMenuIds, ...roleMenuIds])];

    const userDataScope = userDataScopeMap[userId] ?? null;
    const roleDataScope = getMostPermissive(userRoles.map((r) => r.dataScope ?? null));
    const effectiveDataScope = getMostPermissive([userDataScope, roleDataScope]) ?? 'self';

    const userDeptScopeIds = userDeptScopeMap[userId] ?? [];
    const roleDeptScopeIds = [...new Set(
      userRoles.filter((r) => r.dataScope === 'custom').flatMap((r) => r.deptScopeIds ?? [])
    )];
    const effectiveDeptScopeIds =
      effectiveDataScope === 'custom'
        ? [...new Set([...(userDataScope === 'custom' ? userDeptScopeIds : []), ...roleDeptScopeIds])]
        : [];

    return HttpResponse.json({
      code: 0, message: 'ok',
      data: {
        directMenuIds,
        roleMenuIds,
        effectiveMenuIds,
        userDataScope,
        roleDataScope,
        effectiveDataScope,
        userDeptScopeIds,
        roleDeptScopeIds,
        effectiveDeptScopeIds,
      },
    });
  }),
];
