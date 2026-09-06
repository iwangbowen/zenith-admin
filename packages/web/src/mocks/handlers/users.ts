import { userContract, type Department, type Position, type Role, type User } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockUsers, getNextUserId, type MockUser } from '@/mocks/data/users';
import { mockRoles } from '@/mocks/data/roles';
import { mockPositions } from '@/mocks/data/positions';
import { mockDepartments } from '@/mocks/data/departments';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

// Demo 模式下新增/重置用户时使用的默认初始口令（明文仅用于演示环境）
const DEMO_INITIAL_CREDENTIAL = ['1', '2', '3', '4', '5', '6'].join('');

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
    const { keyword, phone, status, departmentId } = query;
    const list = mockUsers.filter((u) => {
      if (keyword && !includesKeyword(keyword, u.username, u.nickname)) return false;
      if (phone && !(u.phone ?? '').includes(phone)) return false;
      if (status && u.status !== status) return false;
      if (departmentId && u.departmentId !== departmentId) return false;
      return true;
    });
    const paged = paginate(list);
    return ok({ ...paged, list: paged.list.map(toUserResponse) });
  }),

  // 新增用户
  mock(userContract.create, ({ body, ok }) => {
    const newUser: MockUser = {
      id: getNextUserId(),
      username: body.username,
      nickname: body.nickname,
      email: body.email ?? null,
      phone: body.phone,
      gender: body.gender,
      password: DEMO_INITIAL_CREDENTIAL,
      departmentId: body.departmentId ?? null,
      departmentName: null,
      positionIds: body.positionIds,
      positions: resolvePositions(body.positionIds),
      roles: resolveRoles(body.roleIds),
      status: body.status,
      passwordUpdatedAt: mockDateTime(),
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockUsers.push(newUser);
    return ok(toUserResponse(newUser), '新增成功');
  }),

  // 批量删除用户
  mock(userContract.removeBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    if (ids.size === 0) return badRequest('请选择要删除的用户', { status: 400 });
    const removed = removeWhere(mockUsers, (u) => ids.has(u.id));
    return ok(null, `已删除 ${removed} 个用户`);
  }),

  // 批量修改用户状态
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

  // 批量重置密码
  mock(userContract.batchResetPassword, ({ body, ok }) => {
    const ids = new Set(body.ids);
    mockUsers.forEach((u) => {
      if (ids.has(u.id)) u.password = body.password || DEMO_INITIAL_CREDENTIAL;
    });
    return ok(null, '密码重置成功');
  }),

  // 重置密码
  mock(userContract.resetPassword, ({ params, ok }) => {
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) return notFound('用户不存在', { status: 404 });
    user.password = DEMO_INITIAL_CREDENTIAL;
    return ok(null, '密码修改成功');
  }),

  // 解锁账号
  mock(userContract.unlock, ({ ok }) => {
    return ok(null, 'success');
  }),

  // 获取单个用户
  mock(userContract.detail, ({ params, ok }) => {
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) return notFound('用户不存在', { status: 404 });
    return ok(toUserResponse(user));
  }),

  // 更新用户
  mock(userContract.update, ({ params, body, ok }) => {
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) return notFound('用户不存在', { status: 404 });
    const { roleIds, positionIds, ...rest } = body;
    if (roleIds !== undefined) {
      user.roles = resolveRoles(roleIds);
    }
    if (positionIds !== undefined) {
      user.positionIds = positionIds;
      user.positions = resolvePositions(positionIds);
    }
    Object.assign(user, rest, { updatedAt: mockDateTime() });
    return ok(toUserResponse(user), '更新成功');
  }),

  // 删除用户
  mock(userContract.remove, ({ params, ok }) => {
    const index = mockUsers.findIndex((u) => u.id === params.id);
    if (index === -1) return notFound('用户不存在', { status: 404 });
    if (mockUsers[index].username === 'admin') {
      return badRequest('不能删除管理员账号', { status: 400 });
    }
    mockUsers.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // 分配用户角色
  mock(userContract.assignRoles, ({ params, body, ok }) => {
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) return notFound('用户不存在', { status: 404 });
    user.roles = resolveRoles(body.roleIds);
    user.updatedAt = mockDateTime();
    return ok(null, '保存成功');
  }),
];
