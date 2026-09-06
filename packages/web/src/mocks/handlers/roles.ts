import { roleContract, type Role } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, conflict } from '@/mocks/utils/handlers';
import { mockRoles, getNextRoleId } from '@/mocks/data/roles';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

export const rolesHandlers = [
  // 所有角色（不分页，供下拉框使用）
  mock(roleContract.all, ({ ok }) => {
    return ok(mockRoles);
  }),

  // 角色列表（支持服务端分页）
  mock(roleContract.list, ({ query, ok, paginate }) => {
    const { keyword, status } = query;
    const filtered = mockRoles.filter((r) => {
      if (keyword && !includesKeyword(keyword, r.name, r.code)) return false;
      if (status && r.status !== status) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  // 获取单个角色
  mock(roleContract.detail, ({ params, ok }) => {
    const role = mockRoles.find((r) => r.id === params.id);
    if (!role) return notFound('角色不存在', { status: 404 });
    return ok(role);
  }),

  // 新增角色
  mock(roleContract.create, ({ body, ok }) => {
    if (body.code === 'super_admin') {
      return badRequest('角色编码 super_admin 为系统保留编码，不允许使用', { status: 400 });
    }
    const newRole: Role = {
      id: getNextRoleId(),
      name: body.name,
      code: body.code,
      description: body.description,
      dataScope: body.dataScope,
      status: body.status,
      menuIds: [],
      deptScopeIds: body.deptScopeIds ?? [],
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockRoles.push(newRole);
    return ok(newRole, '新增成功');
  }),

  // 更新角色
  mock(roleContract.update, ({ params, body, ok }) => {
    const role = mockRoles.find((r) => r.id === params.id);
    if (!role) return notFound('角色不存在', { status: 404 });
    if (body.code !== undefined && body.code !== role.code) {
      if (body.code === 'super_admin') {
        return badRequest('角色编码 super_admin 为系统保留编码，不允许使用', { status: 400 });
      }
      if (role.code === 'super_admin') {
        return badRequest('超级管理员角色编码不允许修改', { status: 400 });
      }
    }
    const { deptScopeIds, ...rest } = body;
    Object.assign(role, rest, { updatedAt: mockDateTime() });
    if (deptScopeIds !== undefined) role.deptScopeIds = deptScopeIds ?? [];
    return ok(role, '更新成功');
  }),

  // 删除角色（在用保护：已分配用户的角色返回 409）
  mock(roleContract.remove, ({ params, ok }) => {
    const index = mockRoles.findIndex((r) => r.id === params.id);
    if (index === -1) return notFound('角色不存在', { status: 404 });
    const role = mockRoles[index];
    if (role.code === 'super_admin') {
      return badRequest('超级管理员角色不允许删除', { status: 400 });
    }
    const boundUsers = role.userCount ?? 0;
    if (boundUsers > 0) {
      return conflict(`该角色已分配给 ${boundUsers} 个用户，请先解除用户关联后再删除`, { status: 409 });
    }
    mockRoles.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // 更新角色菜单
  mock(roleContract.assignMenus, ({ params, body, ok }) => {
    const role = mockRoles.find((r) => r.id === params.id);
    if (!role) return notFound('角色不存在', { status: 404 });
    role.menuIds = body.menuIds;
    role.updatedAt = mockDateTime();
    return ok(null, '菜单权限更新成功');
  }),

  // 获取角色下的用户列表
  mock(roleContract.users, ({ params, ok }) => {
    const roleId = params.id;
    const role = mockRoles.find((r) => r.id === roleId);
    if (!role) return notFound('角色不存在', { status: 404 });
    const list = mockUsers
      .filter((u) => u.roles.some((r) => r.id === roleId))
      .map((u) => ({
        id: u.id, username: u.username, nickname: u.nickname, email: u.email,
        avatar: u.avatar ?? null, status: u.status,
        createdAt: u.createdAt, updatedAt: u.updatedAt,
      }));
    return ok(list);
  }),

  // 分配角色用户（先清后设）
  mock(roleContract.assignUsers, ({ params, body, ok }) => {
    const roleId = params.id;
    const role = mockRoles.find((r) => r.id === roleId);
    if (!role) return notFound('角色不存在', { status: 404 });
    const nextIds = new Set(body.userIds);
    mockUsers.forEach((u) => {
      const has = u.roles.some((r) => r.id === roleId);
      if (nextIds.has(u.id) && !has) u.roles = [...u.roles, role];
      if (!nextIds.has(u.id) && has) u.roles = u.roles.filter((r) => r.id !== roleId);
    });
    role.userCount = nextIds.size;
    role.updatedAt = mockDateTime();
    return ok(null, '用户分配成功');
  }),
];
