import type { QueryClient } from '@tanstack/react-query';
import { userGroupContract } from '@zenith/shared/identity';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateCurrentUserAccess } from './menus';
import { scopeMemberKeys } from './scope-members';
import { userKeys } from './users';

const resource = createResourceQueries(userGroupContract, {
  // 保存可能切换成员模式 / 改写动态规则，成员与角色子查询随之失效（未挂载时仅标脏）
  onSaved: (qc) => {
    void qc.invalidateQueries({ queryKey: userGroupKeys.membersAll });
    void qc.invalidateQueries({ queryKey: userGroupKeys.rolesAll });
  },
  // 删除组级联清理关联：移除而非失效，避免仍挂载的抽屉去请求 404
  onDeleted: (qc, ids) => {
    for (const id of ids) {
      qc.removeQueries({ queryKey: userGroupKeys.members(id) });
      qc.removeQueries({ queryKey: userGroupKeys.roles(id) });
      qc.removeQueries({ queryKey: scopeMemberKeys.of('userGroup', id) });
    }
  },
});

export const userGroupKeys = {
  ...resource.keys,
  /** 全部组的成员子查询 */
  membersAll: contractKey(userGroupContract.members),
  members: (id: number | undefined) => contractKey(userGroupContract.members, { params: { id: id ?? 0 } }),
  /** 全部组的角色子查询 */
  rolesAll: contractKey(userGroupContract.roles),
  roles: (id: number | undefined) => contractKey(userGroupContract.roles, { params: { id: id ?? 0 } }),
};

export const useUserGroupList = resource.useList;
export const useUserGroupDetail = resource.useDetail;
export const useSaveUserGroup = resource.useSave;
export const useDeleteUserGroups = resource.useDelete;

export function useAllUserGroups(options?: { enabled?: boolean }) {
  return resource.useLookup(options?.enabled ?? true);
}

export function useUserGroupMembers(id: number | undefined, enabled = true) {
  return useApiQuery(userGroupContract.members, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useUserGroupRoles(id: number | undefined, enabled = true) {
  return useApiQuery(userGroupContract.roles, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/**
 * 某个组的成员集合变化后需要刷新的面：成员抽屉、查看弹窗的成员预览、
 * 列表（memberPreview / memberCount 列）与详情（memberCount）。下拉源只渲染名称，不受影响。
 */
function invalidateGroupMembership(qc: QueryClient, id: number) {
  void qc.invalidateQueries({ queryKey: userGroupKeys.members(id) });
  void qc.invalidateQueries({ queryKey: scopeMemberKeys.of('userGroup', id) });
  void qc.invalidateQueries({ queryKey: userGroupKeys.lists });
  void qc.invalidateQueries({ queryKey: userGroupKeys.detail(id) });
}

/**
 * 组的成员 / 角色变化会改变成员用户的继承权限：
 * 用户管理页的「有效权限」视图按用户展示，此处定位不到具体用户，故按操作前缀整体标脏
 * （只在授权抽屉打开时挂载），用户列表 / 详情 / 下拉源不展示继承权限，不碰。
 */
function invalidateInheritedPermissions(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: userKeys.effectivePermissionsAll });
  invalidateCurrentUserAccess(qc);
}

export function useAssignUserGroupMembers() {
  return useApiMutation(userGroupContract.setMembers, {
    invalidate: (qc, _output, { params }) => {
      invalidateGroupMembership(qc, params.id);
      // 新成员继承组角色、被移除者失去继承，可能覆盖当前登录者
      invalidateInheritedPermissions(qc);
    },
  });
}

/** 组角色只出现在角色弹窗、列表的 roleCount 列与详情 */
export function useAssignUserGroupRoles() {
  return useApiMutation(userGroupContract.setRoles, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: userGroupKeys.roles(params.id) });
      void qc.invalidateQueries({ queryKey: userGroupKeys.lists });
      void qc.invalidateQueries({ queryKey: userGroupKeys.detail(params.id) });
      invalidateInheritedPermissions(qc);
    },
  });
}

/** 规则 dry-run：纯计算不落库，无需失效任何缓存 */
export function useUserGroupRulePreview() {
  return useApiMutation(userGroupContract.rulePreview);
}

/** 手动同步动态组成员：成员集合与 ruleSyncedAt 变化，且组可能绑定角色影响成员权限 */
export function useSyncUserGroup() {
  return useApiMutation(userGroupContract.sync, {
    invalidate: (qc, _output, { params }) => {
      invalidateGroupMembership(qc, params.id);
      invalidateInheritedPermissions(qc);
    },
  });
}
