import { userContract, mostPermissiveDataScope, type DataScope } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockUsers } from '@/mocks/data/users';
import { mockRoles } from '@/mocks/data/roles';
import { mockUserGroups } from '@/mocks/data/user-groups';

// In-memory store for user-level menu/data permissions
const userMenuMap: Record<number, number[]> = {};
const userDataScopeMap: Record<number, DataScope | null> = {};
const userDeptScopeMap: Record<number, number[]> = {};

const getMostPermissive = mostPermissiveDataScope;

/** 用户所在启用用户组继承的角色/菜单/数据权限 */
function getGroupInheritance(userId: number) {
  const memberGroups = mockUserGroups.filter((g) => g.status === 'enabled' && g.memberIds.includes(userId));
  const groupRoles = memberGroups
    .flatMap((g) => g.roleIds)
    .map((rid) => mockRoles.find((r) => r.id === rid))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const groupMenuIds = [...new Set(groupRoles.flatMap((r) => r.menuIds ?? []))];
  const groupDataScope = getMostPermissive(groupRoles.map((r) => r.dataScope ?? null));
  const groupDeptScopeIds = [...new Set(
    groupRoles.filter((r) => r.dataScope === 'custom').flatMap((r) => r.deptScopeIds ?? [])
  )];
  const groups = memberGroups.filter((g) => g.roleIds.length > 0).map((g) => ({ id: g.id, name: g.name }));
  return { groupMenuIds, groupDataScope, groupDeptScopeIds, groups };
}

/** 用户直接分配的角色（以 mock 角色表为准，保证菜单 / 数据权限字段最新） */
function getUserRoles(roleIds: number[]) {
  return mockRoles.filter((r) => roleIds.includes(r.id));
}

export const userPermissionsHandlers = [
  // 用户菜单权限
  mock(userContract.menus, ({ params, ok }) => {
    const userId = params.id;
    const user = mockUsers.find((u) => u.id === userId);
    if (!user) return notFound('用户不存在', { status: 404 });

    const directMenuIds = userMenuMap[userId] ?? [];
    const roleMenuIdSet = new Set<number>();
    for (const role of getUserRoles(user.roles.map((r) => r.id))) {
      for (const id of (role.menuIds ?? [])) roleMenuIdSet.add(id);
    }
    return ok({ directMenuIds, roleMenuIds: [...roleMenuIdSet] });
  }),

  // 分配用户菜单权限
  mock(userContract.assignMenus, ({ params, body, ok }) => {
    userMenuMap[params.id] = body.menuIds;
    return ok(null, '保存成功');
  }),

  // 用户数据权限
  mock(userContract.dataPermission, ({ params, ok }) => {
    const userId = params.id;
    const user = mockUsers.find((u) => u.id === userId);
    if (!user) return notFound('用户不存在', { status: 404 });

    const userRoles = getUserRoles(user.roles.map((r) => r.id));
    const roleDataScope = getMostPermissive(userRoles.map((r) => r.dataScope ?? null));
    const roleDeptScopeIds = [...new Set(
      userRoles.filter((r) => r.dataScope === 'custom').flatMap((r) => r.deptScopeIds ?? [])
    )];
    const { groupDataScope, groupDeptScopeIds, groups } = getGroupInheritance(userId);

    return ok({
      userDataScope: userDataScopeMap[userId] ?? null,
      deptScopeIds: userDeptScopeMap[userId] ?? [],
      roleDataScope,
      roleDeptScopeIds,
      groupDataScope,
      groupDeptScopeIds,
      groups,
    });
  }),

  // 设置用户数据权限
  mock(userContract.updateDataPermission, ({ params, body, ok }) => {
    userDataScopeMap[params.id] = body.dataScope;
    userDeptScopeMap[params.id] = body.dataScope === 'custom' ? body.deptScopeIds : [];
    return ok(null, '保存成功');
  }),

  // 最终有效权限
  mock(userContract.effectivePermissions, ({ params, ok }) => {
    const userId = params.id;
    const user = mockUsers.find((u) => u.id === userId);
    if (!user) return notFound('用户不存在', { status: 404 });

    const userRoles = getUserRoles(user.roles.map((r) => r.id));
    const { groupMenuIds, groupDataScope, groupDeptScopeIds, groups } = getGroupInheritance(userId);

    const directMenuIds = userMenuMap[userId] ?? [];
    const roleMenuIds = [...new Set(userRoles.flatMap((r) => r.menuIds ?? []))];
    const effectiveMenuIds = [...new Set([...directMenuIds, ...roleMenuIds, ...groupMenuIds])];

    const userDataScope = userDataScopeMap[userId] ?? null;
    const roleDataScope = getMostPermissive(userRoles.map((r) => r.dataScope ?? null));
    const effectiveDataScope = getMostPermissive([userDataScope, roleDataScope, groupDataScope]) ?? 'self';

    const userDeptScopeIds = userDeptScopeMap[userId] ?? [];
    const roleDeptScopeIds = [...new Set(
      userRoles.filter((r) => r.dataScope === 'custom').flatMap((r) => r.deptScopeIds ?? [])
    )];
    const effectiveDeptScopeIds =
      effectiveDataScope === 'custom'
        ? [...new Set([...(userDataScope === 'custom' ? userDeptScopeIds : []), ...roleDeptScopeIds, ...groupDeptScopeIds])]
        : [];

    return ok({
      directMenuIds,
      roleMenuIds,
      groupMenuIds,
      effectiveMenuIds,
      userDataScope,
      roleDataScope,
      groupDataScope,
      effectiveDataScope,
      userDeptScopeIds,
      roleDeptScopeIds,
      groupDeptScopeIds,
      effectiveDeptScopeIds,
      groups,
    });
  }),
];
