/**
 * 「成员预览」查询：部门 / 角色 / 岗位 / 用户组的成员列表（分页 + 关键字搜索）。
 *
 * 供 `UserPreviewCell` 的查看弹窗使用，四个来源共用同一契约形状，组件因此无需按来源分支。
 *
 * key 由各所有者契约的 `memberPreview` 操作派生（如 `['positions', 'memberPreview', { params, query }]`），
 * 与所有者域的 `members(id)`（`members` 操作）不再共享前缀：各页「分配成员」的 mutation 须显式失效
 * `scopeMemberKeys.of(scope, id)`，用户保存 / 删除则调用 `invalidateScopeMemberPreviews`。
 */
import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { departmentContract, positionContract, roleContract, userGroupContract, type ScopeMember } from '@zenith/shared/identity';
import type { QueryOf } from '@zenith/shared/core';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type { ScopeMember };

/** 成员归属范围，与服务端 `UserScopeType` 一一对应 */
export type UserScopeType = 'department' | 'role' | 'position' | 'userGroup';

export type ScopeMemberParams = NonNullable<QueryOf<typeof roleContract.memberPreview>>;

/** 各范围的契约操作（四者由同一 `memberPreviewOp()` 声明，入参 / 响应同形） */
const SCOPE_OPS = {
  department: departmentContract.memberPreview,
  role: roleContract.memberPreview,
  position: positionContract.memberPreview,
  userGroup: userGroupContract.memberPreview,
} as const satisfies Record<UserScopeType, unknown>;

const SCOPE_TYPES = Object.keys(SCOPE_OPS) as UserScopeType[];

export const scopeMemberKeys = {
  /** 某范围全部成员预览查询（任意范围 id / 分页 / 关键字） */
  all: (scopeType: UserScopeType) => contractKey(SCOPE_OPS[scopeType]),
  /** 某个部门 / 角色 / 岗位 / 用户组的全部成员预览分页（`query: {}` 深部分匹配任意分页与关键字） */
  of: (scopeType: UserScopeType, id: number | undefined) =>
    contractKey(SCOPE_OPS[scopeType], { params: { id: id ?? 0 }, query: {} }),
  page: (scopeType: UserScopeType, id: number | undefined, params: ScopeMemberParams) =>
    contractKey(SCOPE_OPS[scopeType], { params: { id: id ?? 0 }, query: params }),
};

/** 兼容旧签名：省略 `params` 得到该范围实体的前缀 */
export function scopeMemberKey(scopeType: UserScopeType, id: number | undefined, params?: ScopeMemberParams) {
  return params ? scopeMemberKeys.page(scopeType, id, params) : scopeMemberKeys.of(scopeType, id);
}

/**
 * 用户被保存 / 删除后，其部门、岗位、角色、用户组归属都可能变化，四类成员预览一并标脏；
 * 预览只在查看弹窗打开时挂载，其余时刻只是标脏，不发请求。
 */
export function invalidateScopeMemberPreviews(qc: QueryClient) {
  for (const scopeType of SCOPE_TYPES) void qc.invalidateQueries({ queryKey: scopeMemberKeys.all(scopeType) });
}

export function useScopeMembers(
  scopeType: UserScopeType,
  id: number | undefined,
  params: ScopeMemberParams,
  enabled = true,
) {
  return useApiQuery(SCOPE_OPS[scopeType], { params: { id: id ?? 0 }, query: params }, {
    enabled: enabled && id !== undefined,
    // 翻页/搜索时保留上一页数据，避免表格闪成空态
    placeholderData: keepPreviousData,
  });
}
