import { userGroupContract, type UserGroup, type UserGroupMemberRule } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest, conflict } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockUserGroups, getNextUserGroupId } from '@/mocks/data/user-groups';
import { mockUsers } from '@/mocks/data/users';
import { mockRoles } from '@/mocks/data/roles';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

const DYNAMIC_GROUP_MEMBERS_MESSAGE = '动态用户组的成员由规则自动维护，请通过编辑规则调整（支持强制包含/排除名单）';

/** Demo 简化版规则求值：仅按部门（不展开子树层级差异）与强制名单计算 */
function evaluateRule(rule: UserGroupMemberRule): number[] {
  const target = new Set<number>();
  if (rule.departmentIds?.length) {
    for (const u of mockUsers) {
      if (u.status === 'enabled' && u.departmentId != null && rule.departmentIds.includes(u.departmentId)) {
        target.add(u.id);
      }
    }
  }
  for (const id of rule.includeUserIds ?? []) target.add(id);
  for (const id of rule.excludeUserIds ?? []) target.delete(id);
  return [...target];
}

function publicView(g: typeof mockUserGroups[number]): UserGroup {
  const { memberIds: _memberIds, roleIds: _roleIds, ...rest } = g;
  const memberPreview = g.memberIds.slice(0, 5).map((uid) => {
    const u = mockUsers.find((mu) => mu.id === uid);
    return u ? { id: u.id, nickname: u.nickname, avatar: u.avatar ?? null } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  return { ...rest, memberCount: g.memberIds.length, memberPreview, roleCount: g.roleIds.length };
}

export const userGroupsHandlers = [
  mock(userGroupContract.all, ({ ok }) =>
    ok(mockUserGroups.map(publicView))),

  // 规则 dry-run（必须先于 /{id} 注册）
  mock(userGroupContract.rulePreview, ({ body, ok }) => {
    const target = evaluateRule(body.memberRule);
    const current = body.groupId != null
      ? (mockUserGroups.find((g) => g.id === body.groupId)?.memberIds ?? [])
      : [];
    const currentSet = new Set(current);
    const targetSet = new Set(target);
    const joining = target.filter((id) => !currentSet.has(id));
    const leaving = current.filter((id) => !targetSet.has(id));
    const brief = (id: number) => {
      const u = mockUsers.find((mu) => mu.id === id);
      return { id, username: u?.username ?? `#${id}`, nickname: u?.nickname ?? `#${id}` };
    };
    return ok({
      total: target.length,
      joiningCount: joining.length,
      leavingCount: leaving.length,
      joining: joining.slice(0, 50).map(brief),
      leaving: leaving.slice(0, 50).map(brief),
    });
  }),

  mock(userGroupContract.list, ({ query, ok, paginate }) => {
    const { keyword, status } = query;
    const filtered = mockUserGroups.filter((g) => {
      if (keyword && !includesKeyword(keyword, g.name, g.code)) return false;
      if (status && g.status !== status) return false;
      return true;
    });
    const paged = paginate(filtered);
    return ok({ ...paged, list: paged.list.map(publicView) });
  }),

  mock(userGroupContract.members, ({ params, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    const members = grp.memberIds.flatMap((uid) => {
      const u = mockUsers.find((mu) => mu.id === uid);
      return u
        ? [{ id: u.id, username: u.username, nickname: u.nickname, email: u.email, departmentName: null, joinedAt: grp.createdAt }]
        : [];
    });
    return ok(members);
  }),

  mock(userGroupContract.setMembers, ({ params, body, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    if (grp.memberMode === 'dynamic') return badRequest(DYNAMIC_GROUP_MEMBERS_MESSAGE, { status: 400 });
    grp.memberIds = body.userIds;
    grp.memberCount = grp.memberIds.length;
    grp.updatedAt = mockDateTime();
    return ok(null, '保存成功');
  }),

  mock(userGroupContract.addMembers, ({ params, body, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    if (grp.memberMode === 'dynamic') return badRequest(DYNAMIC_GROUP_MEMBERS_MESSAGE, { status: 400 });
    const set = new Set(grp.memberIds);
    body.userIds.forEach((id) => set.add(id));
    grp.memberIds = [...set];
    grp.memberCount = grp.memberIds.length;
    return ok(null, '添加成功');
  }),

  mock(userGroupContract.removeMembers, ({ params, body, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    if (grp.memberMode === 'dynamic') return badRequest(DYNAMIC_GROUP_MEMBERS_MESSAGE, { status: 400 });
    const remove = new Set(body.userIds);
    grp.memberIds = grp.memberIds.filter((id) => !remove.has(id));
    grp.memberCount = grp.memberIds.length;
    return ok(null, '移除成功');
  }),

  // 手动同步动态组成员
  mock(userGroupContract.sync, ({ params, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    if (grp.memberMode !== 'dynamic') return badRequest('仅动态用户组支持手动同步', { status: 400 });
    const target = evaluateRule(grp.memberRule ?? {});
    const before = new Set(grp.memberIds);
    const added = target.filter((id) => !before.has(id)).length;
    const removed = grp.memberIds.filter((id) => !target.includes(id)).length;
    grp.memberIds = target;
    grp.memberCount = target.length;
    grp.ruleSyncedAt = mockDateTime();
    return ok(null, `同步完成：加入 ${added} 人，移除 ${removed} 人`);
  }),

  mock(userGroupContract.roles, ({ params, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    const list = grp.roleIds
      .map((rid) => mockRoles.find((r) => r.id === rid))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ id: r.id, name: r.name, code: r.code, status: r.status }));
    return ok(list);
  }),

  mock(userGroupContract.setRoles, ({ params, body, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    grp.roleIds = body.roleIds;
    grp.roleCount = grp.roleIds.length;
    grp.updatedAt = mockDateTime();
    return ok(null, '保存成功');
  }),

  mock(userGroupContract.detail, ({ params, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    return ok(publicView(grp));
  }),

  mock(userGroupContract.create, ({ body, ok }) => {
    if (mockUserGroups.some((g) => g.code === body.code)) {
      return badRequest('用户组编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const memberMode = body.memberMode;
    const memberRule = memberMode === 'dynamic' ? (body.memberRule ?? null) : null;
    const memberIds = memberMode === 'dynamic' && memberRule ? evaluateRule(memberRule) : [];
    const created = {
      id: getNextUserGroupId(),
      name: body.name,
      code: body.code,
      description: body.description ?? null,
      ownerId: body.ownerId ?? null,
      ownerName: null,
      memberMode,
      memberRule,
      ruleSyncedAt: memberMode === 'dynamic' ? now : null,
      memberCount: memberIds.length,
      memberIds,
      roleIds: [],
      roleCount: 0,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockUserGroups.push(created);
    return ok(publicView(created), '创建成功');
  }),

  mock(userGroupContract.update, ({ params, body, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    Object.assign(grp, body, { updatedAt: mockDateTime() });
    if (grp.memberMode === 'static') {
      grp.memberRule = null;
    } else if (body.memberRule !== undefined || body.memberMode !== undefined) {
      grp.memberIds = evaluateRule(grp.memberRule ?? {});
      grp.memberCount = grp.memberIds.length;
      grp.ruleSyncedAt = mockDateTime();
    }
    return ok(publicView(grp), '更新成功');
  }),

  mock(userGroupContract.removeBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    // 在用保护仅针对静态组：动态组成员是规则物化产物，允许直接删除
    const blocked = mockUserGroups.filter((g) => ids.has(g.id) && g.memberMode === 'static' && g.memberCount > 0);
    if (blocked.length > 0) {
      const names = blocked.slice(0, 3).map((g) => `「${g.name}」`).join('、');
      const suffix = blocked.length > 3 ? ` 等 ${blocked.length} 个用户组` : '';
      return conflict(`${names}${suffix}仍有成员，请先移除成员后再删除`, { status: 409 });
    }
    removeWhere(mockUserGroups, (g) => ids.has(g.id));
    return ok(null, `已删除 ${body.ids.length} 个用户组`);
  }),

  mock(userGroupContract.remove, ({ params, ok }) => {
    const grp = requireItem(mockUserGroups, params.id, '用户组不存在', { status: 404 });
    if (grp.memberMode === 'static' && grp.memberCount > 0) {
      return conflict(`该用户组下仍有 ${grp.memberCount} 名成员，请先移除成员后再删除`, { status: 409 });
    }
    removeByIds(mockUserGroups, [params.id]);
    return ok(null, '删除成功');
  }),
];
