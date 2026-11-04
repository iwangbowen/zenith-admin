import { userContract, type Department, type ManagedUserPreferences, type Position, type Role, type User } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { badRequest, conflict } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockUsers, getNextUserId, type MockUser } from '@/mocks/data/users';
import { mockRoles } from '@/mocks/data/roles';
import { mockPositions } from '@/mocks/data/positions';
import { mockDepartments } from '@/mocks/data/departments';
import { mockOnlineSessions } from '@/mocks/data/system';
import { mockDriveSpaces } from '@/mocks/data/drive';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

// Demo 模式下新增/重置用户时使用的默认初始口令（明文仅用于演示环境）
const DEMO_INITIAL_CREDENTIAL = ['1', '2', '3', '4', '5', '6'].join('');

/** Demo 模式下按用户保存偏好覆盖（与个人偏好同一文档结构） */
const userPreferencesMap = new Map<number, ManagedUserPreferences>();

function removesProtectedAdminRole(user: MockUser, roleIds: number[]) {
  return user.tenantId == null && user.username.trim().toLowerCase() === 'admin'
    && user.roles.some(role => role.code === 'super_admin' && !roleIds.includes(role.id));
}

function flattenDepts(depts: Department[]): Department[] {
  const result: Department[] = [];
  const traverse = (items: Department[]) => {
    for (const d of items) {
      result.push(d);
      if (d.children) traverse(d.children);
    }
  };
  traverse(depts);
  return result;
}

function resolveRoles(roleIds: number[]): Role[] {
  return roleIds.map((id) => mockRoles.find((r) => r.id === id)).filter((r): r is Role => Boolean(r));
}

function resolvePositions(positionIds: number[]): Position[] {
  return positionIds.map((id) => mockPositions.find((p) => p.id === id)).filter((p): p is Position => Boolean(p));
}

function toUserResponse(user: MockUser): User {
  const { password: _, ...rest } = user;
  return {
    ...rest,
    departmentName: flattenDepts(mockDepartments).find((d) => d.id === rest.departmentId)?.name ?? null,
    positions: resolvePositions(rest.positionIds ?? []),
    roles: rest.roles,
  };
}

export const usersHandlers = [
  mock(userContract.alertRecipients, ({ ok }) => {
    return ok(mockUsers
      .filter((user) => user.status === 'enabled')
      .map((user) => ({
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        departmentName: flattenDepts(mockDepartments).find((department) => department.id === user.departmentId)?.name ?? null,
        hasEmail: Boolean(user.email),
      })));
  }),

  // 全量用户（供下拉/穿梭框使用）
  mock(userContract.all, ({ ok }) => {
    return ok(mockUsers.map(toUserResponse));
  }),

  // 用户列表（分页）
  mock(userContract.list, ({ query, ok, paginate }) => {
    const { keyword, phone, email, status, departmentId, positionId, roleId, onlineStatus } = query;
    const onlineUserIds = new Set(mockOnlineSessions.map((session) => session.userId));
    const list = mockUsers.filter((u) => {
      if (keyword && !includesKeyword(keyword, u.username, u.nickname)) return false;
      if (phone && !(u.phone ?? '').includes(phone)) return false;
      if (email && !(u.email ?? '').includes(email)) return false;
      if (positionId && !(u.positionIds ?? []).includes(positionId)) return false;
      if (roleId && !u.roles.some((role) => role.id === roleId)) return false;
      if (onlineStatus === 'online' && !onlineUserIds.has(u.id)) return false;
      if (onlineStatus === 'offline' && onlineUserIds.has(u.id)) return false;
      if (status && u.status !== status) return false;
      if (departmentId && u.departmentId !== departmentId) return false;
      return true;
    });
    const paged = paginate(list);
    // 与服务端 listUsers 同口径：在线状态 + 多会话最新活跃时间，离线为 null
    const lastActiveMap = new Map<number, string>();
    for (const s of mockOnlineSessions) {
      const prev = lastActiveMap.get(s.userId);
      if (!prev || s.lastActiveAt > prev) lastActiveMap.set(s.userId, s.lastActiveAt);
    }
    return ok({ ...paged, list: paged.list.map((u) => ({ ...toUserResponse(u), isOnline: onlineUserIds.has(u.id), lastActiveAt: lastActiveMap.get(u.id) ?? null })) });
  }),

  mock(userContract.create, ({ body, ok }) => {
    const department = body.organization?.departmentId !== null && body.organization?.departmentId !== undefined
      ? flattenDepts(mockDepartments).find((d) => d.id === body.organization?.departmentId)
      : undefined;
    const positionIds = body.organization?.positionIds ?? [];
    const newUser: MockUser = {
      id: getNextUserId(),
      username: body.username,
      nickname: body.nickname,
      email: body.email ?? null,
      phone: body.phone,
      gender: body.gender,
      birthDate: body.birthDate ?? null,
      password: DEMO_INITIAL_CREDENTIAL,
      departmentId: department?.id ?? null,
      departmentName: department?.name ?? null,
      positionIds,
      positions: resolvePositions(positionIds),
      roles: body.roles ? resolveRoles(body.roles.roleIds) : mockRoles.filter(role => role.code === 'user'),
      status: 'enabled',
      passwordUpdatedAt: mockDateTime(),
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockUsers.push(newUser);
    return ok(toUserResponse(newUser), '新增成功');
  }),

  mock(userContract.removeBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    if (ids.size === 0) return badRequest('请选择要删除的用户', { status: 400 });
    const removed = removeWhere(mockUsers, (u) => ids.has(u.id));
    for (const space of mockDriveSpaces) {
      if (space.ownerId !== null && ids.has(space.ownerId)) { space.ownerId = null; space.ownerName = null; }
    }
    return ok(null, `已删除 ${removed} 个用户`);
  }),

  mock(userContract.batchStatus, ({ body, ok }) => {
    const ids = new Set(body.ids);
    mockUsers.forEach((u) => {
      if (ids.has(u.id) && u.username !== 'admin') {
        u.status = body.status;
        u.updatedAt = mockDateTime();
      }
    });
    return ok(null, '状态更新成功');
  }),

  mock(userContract.batchResetPassword, ({ body, ok }) => {
    const ids = new Set(body.ids);
    mockUsers.forEach((u) => {
      if (ids.has(u.id)) u.password = body.password || DEMO_INITIAL_CREDENTIAL;
    });
    return ok(null, '密码重置成功');
  }),

  mock(userContract.resetPassword, ({ params, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    user.password = DEMO_INITIAL_CREDENTIAL;
    return ok(null, '密码修改成功');
  }),

  mock(userContract.unlock, ({ ok }) => {
    return ok(null, 'success');
  }),

  mock(userContract.detail, ({ params, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    const sessions = mockOnlineSessions.filter((session) => session.userId === user.id);
    const lastActive = sessions.reduce<string | null>(
      (latest, session) => !latest || session.lastActiveAt > latest ? session.lastActiveAt : latest,
      null,
    );
    return ok({ ...toUserResponse(user), isOnline: sessions.length > 0, lastActiveAt: lastActive });
  }),

  mock(userContract.update, ({ params, body, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    Object.assign(user, body, { updatedAt: mockDateTime() });
    return ok(toUserResponse(user), '更新成功');
  }),

  mock(userContract.manage, ({ params, body, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    if (body.roles && removesProtectedAdminRole(user, body.roles.roleIds)) return conflict('不能移除 admin 管理员用户的超级管理员角色');
    Object.assign(user, body.profile ?? {}, { updatedAt: mockDateTime() });
    if (body.organization) {
      user.departmentId = body.organization.departmentId;
      user.positionIds = body.organization.positionIds;
      user.positions = resolvePositions(body.organization.positionIds);
    }
    if (body.roles) user.roles = resolveRoles(body.roles.roleIds);
    return ok(toUserResponse(user));
  }),

  mock(userContract.organization, ({ params, body, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    user.departmentId = body.departmentId;
    user.positionIds = body.positionIds;
    user.positions = resolvePositions(body.positionIds);
    return ok(toUserResponse(user));
  }),

  mock(userContract.remove, ({ params, ok }) => {
    const item = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    if (item.username === 'admin') {
      return badRequest('不能删除管理员账号', { status: 400 });
    }
    removeByIds(mockUsers, [params.id]);
    for (const space of mockDriveSpaces) {
      if (space.ownerId === params.id) { space.ownerId = null; space.ownerName = null; }
    }
    return ok(null, '删除成功');
  }),

  mock(userContract.preferences, ({ params, ok }) => {
    requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    return ok(userPreferencesMap.get(params.id) ?? { overrides: {} });
  }),

  mock(userContract.updatePreferences, ({ params, body, ok }) => {
    requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    userPreferencesMap.set(params.id, body);
    return ok(body, '保存成功');
  }),

  mock(userContract.assignRoles, ({ params, body, ok }) => {
    const user = requireItem(mockUsers, params.id, '用户不存在', { status: 404 });
    if (removesProtectedAdminRole(user, body.roleIds)) return conflict('不能移除 admin 管理员用户的超级管理员角色');
    user.roles = resolveRoles(body.roleIds);
    user.updatedAt = mockDateTime();
    return ok(null, '保存成功');
  }),
];
