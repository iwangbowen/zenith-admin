/**
 * Demo 模式：成员预览（部门 / 角色 / 岗位 / 用户组的分页成员名单）。
 *
 * 四条真实接口形状一致，故 mock 也共用一份实现，避免四处各写一遍后口径漂移。
 */
import {
  departmentContract,
  positionContract,
  roleContract,
  userGroupContract,
} from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { mockUsers, type MockUser } from '@/mocks/data/users';
import { mockUserGroups } from '@/mocks/data/user-groups';
import { includesKeyword } from '@/mocks/utils/filter';

type MemberPreviewOp = typeof departmentContract.memberPreview;

/** 各范围的成员判定，与服务端 user-scope.service 的归属条件一一对应 */
function memberPreviewHandler(op: MemberPreviewOp, isMember: (user: MockUser, scopeId: number) => boolean) {
  return mock(op, ({ params, query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();

    const list = mockUsers
      .filter((u) => isMember(u, params.id))
      .filter((u) => includesKeyword(keyword, u.nickname, u.username, { caseInsensitive: true }))
      .map((u) => ({ id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar ?? null }));

    return ok(paginate(list));
  });
}

export const scopeMembersHandlers = [
  memberPreviewHandler(departmentContract.memberPreview, (u, id) => u.departmentId === id),
  memberPreviewHandler(roleContract.memberPreview, (u, id) => u.roles.some((r) => r.id === id)),
  memberPreviewHandler(positionContract.memberPreview, (u, id) => (u.positionIds ?? []).includes(id)),
  memberPreviewHandler(
    userGroupContract.memberPreview,
    (u, id) => (mockUserGroups.find((g) => g.id === id)?.memberIds ?? []).includes(u.id),
  ),
];
