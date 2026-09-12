import { roleContract } from '@zenith/shared/identity';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateCurrentUserAccess } from './menus';
import { scopeMemberKeys } from './scope-members';

const resource = createResourceQueries(roleContract, {
  onDeleted: (qc, ids) => {
    for (const id of ids) {
      qc.removeQueries({ queryKey: roleKeys.users(id) });
      qc.removeQueries({ queryKey: scopeMemberKeys.of('role', id) });
    }
  },
});

export const roleKeys = {
  ...resource.keys,
  users: (roleId: number | undefined) => contractKey(roleContract.users, { params: { id: roleId ?? 0 } }),
  /** 全量角色下拉源（角色分配、公告收件人等跨域页面共享缓存） */
  allRoles: resource.keys.lookup,
};

export const useRoleList = resource.useList;
export const useRoleDetail = resource.useDetail;
/**
 * 保存角色：写接口返回的 mapRole 不带 menuIds（详情才查关联菜单），形状不一致，
 * 工厂只失效详情不回填，正合此意；下拉源渲染名称且被公告收件人等跨域页面复用，一并失效。
 */
export const useSaveRole = resource.useSave;
export const useDeleteRoles = resource.useDelete;

export function useAllRoles(options?: { enabled?: boolean }) {
  return resource.useLookup(options?.enabled ?? true);
}

export function useRoleUsers(roleId: number | undefined, enabled = true) {
  return useApiQuery(roleContract.users, { params: { id: roleId ?? 0 } }, { enabled: enabled && roleId !== undefined });
}

/** menuIds 只存在于角色详情，列表与下拉源都不含；角色授权可能覆盖当前登录者 */
export function useAssignRoleMenus() {
  return useApiMutation(roleContract.assignMenus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: roleKeys.detail(params.id) });
      invalidateCurrentUserAccess(qc);
    },
  });
}

export function useAssignRoleUsers() {
  return useApiMutation(roleContract.assignUsers, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: roleKeys.users(params.id) });
      // 查看弹窗的成员预览与 users 不共享前缀
      void qc.invalidateQueries({ queryKey: scopeMemberKeys.of('role', params.id) });
      // 列表展示 userCount / userPreview
      void qc.invalidateQueries({ queryKey: roleKeys.lists });
    },
  });
}

/** 数据权限只影响详情与列表展示，不影响下拉源渲染 */
export function useUpdateRoleDataScope() {
  return useApiMutation(roleContract.update, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: roleKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: roleKeys.lists });
    },
  });
}
