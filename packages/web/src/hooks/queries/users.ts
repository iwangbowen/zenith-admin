import { queryOptions, useQuery } from '@tanstack/react-query';
import { sessionContract, userContract } from '@zenith/shared/identity';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { invalidateCurrentUserAccess } from './menus';

const resource = createResourceQueries(userContract, {
  // 下拉源展示昵称与用户名，且被角色分配、岗位成员、用户组等多页共享；告警接收人下拉同样渲染昵称
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: userKeys.alertRecipients }),
  onDeleted: (qc, ids) => {
    for (const id of ids) {
      qc.removeQueries({ queryKey: userKeys.dataPermission(id) });
      qc.removeQueries({ queryKey: userKeys.effectivePermissions(id) });
    }
    void qc.invalidateQueries({ queryKey: userKeys.alertRecipients });
  },
});

export const userKeys = {
  ...resource.keys,
  /** 全量用户下拉源（角色分配、岗位成员、用户组等场景全局共享缓存） */
  allUsers: resource.keys.lookup,
  alertRecipients: [...resource.keys.all, 'alert-recipients'] as const,
  dataPermission: (userId: number | undefined) => [...resource.keys.all, 'data-permission', userId] as const,
  effectivePermissions: (userId: number | undefined) => [...resource.keys.all, 'effective-permissions', userId] as const,
};

/**
 * 保存用户：刻意不回填详情——写接口返回 mapUser（未脱敏），详情走 mapUserWithMask（按查看者角色脱敏），
 * 用响应覆盖详情缓存会把未脱敏的手机号 / 邮箱写进本不该看到它们的界面；工厂只失效不回填，正合此意。
 */
export const useSaveUser = resource.useSave;
export const useUserList = resource.useList;
export const useUserDetail = resource.useDetail;
/** 单个与批量删除；同时移除该用户的权限类缓存 */
export const useDeleteUsers = resource.useDelete;

/** 全量用户下拉源的 queryOptions（供 ensureQueryData 等命令式取数） */
export function allUsersQueryOptions() {
  return queryOptions({
    queryKey: userKeys.allUsers,
    queryFn: () => api(userContract.all),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useAllUsers(options?: { enabled?: boolean }) {
  return resource.useLookup(options?.enabled ?? true);
}

export function useAlertRecipientUsers(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: userKeys.alertRecipients,
    queryFn: () => api(userContract.alertRecipients),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useBatchUserStatus() {
  return useApiMutation(userContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: userKeys.lists });
      void qc.invalidateQueries({ queryKey: userKeys.allUsers });
      void qc.invalidateQueries({ queryKey: userKeys.alertRecipients });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
}

/** 密码不出现在任何已挂载的查询里；列表的「最后修改时间」等字段仍可能变，故只刷列表与该用户详情 */
export function useResetUserPassword() {
  return useApiMutation(userContract.resetPassword, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: userKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: userKeys.lists });
    },
  });
}

export function useBatchUserPassword() {
  return useApiMutation(userContract.batchResetPassword, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: userKeys.lists });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
}

export function useUnlockUser() {
  return useApiMutation(userContract.unlock, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: userKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: userKeys.lists });
    },
  });
}

export function useAssignUserRoles() {
  return useApiMutation(userContract.assignRoles, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: userKeys.detail(params.id) });
      // 列表展示角色名
      void qc.invalidateQueries({ queryKey: userKeys.lists });
      // 角色决定可见菜单
      void qc.invalidateQueries({ queryKey: userKeys.effectivePermissions(params.id) });
    },
  });
}

/** 强制下线指定用户的全部会话（用户管理页入口） */
export function useKickUserSessions() {
  return useApiMutation(sessionContract.forceLogoutUser);
}

export function useUserDataPermission(userId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: userKeys.dataPermission(userId),
    queryFn: () => api(userContract.dataPermission, { params: { id: userId ?? 0 } }),
    enabled: enabled && userId !== undefined,
  });
}

/** 数据权限自成一份查询，不出现在列表与详情 */
export function useSaveUserDataPermission() {
  return useApiMutation(userContract.updateDataPermission, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: userKeys.dataPermission(params.id) }),
  });
}

/** 直接授权菜单改变该用户的有效权限视图；若改到自己，导航树与权限码需同步刷新 */
export function useSaveUserMenus() {
  return useApiMutation(userContract.assignMenus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: userKeys.effectivePermissions(params.id) });
      invalidateCurrentUserAccess(qc);
    },
  });
}

export function useUserEffectivePermissions(userId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: userKeys.effectivePermissions(userId),
    queryFn: () => api(userContract.effectivePermissions, { params: { id: userId ?? 0 } }),
    enabled: enabled && userId !== undefined,
  });
}
