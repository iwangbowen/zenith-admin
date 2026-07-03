import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, User } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface UserListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  phone?: string;
  departmentId?: number;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export interface ImportUsersResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export interface UserDataPermission {
  userDataScope: string | null;
  deptScopeIds: number[];
  roleDataScope: string | null;
  roleDeptScopeIds: number[];
}

export interface UserEffectivePermissions {
  directMenuIds: number[];
  roleMenuIds: number[];
  effectiveMenuIds: number[];
}

export const userKeys = {
  all: ['users'] as const,
  allUsers: ['users', 'all'] as const,
  lists: ['users', 'list'] as const,
  list: (params: UserListParams) => ['users', 'list', params] as const,
  detail: (id: number | undefined) => ['users', 'detail', id] as const,
  dataPermission: (userId: number | undefined) => ['users', 'data-permission', userId] as const,
  effectivePermissions: (userId: number | undefined) => ['users', 'effective-permissions', userId] as const,
};

/** 全量用户下拉源（角色分配、岗位成员、用户组等场景全局共享缓存） */
export function useAllUsers(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: userKeys.allUsers,
    queryFn: () => request.get<User[]>('/api/users/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useUserList(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<User>>(`/api/users${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useUserDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => request.get<User>(`/api/users/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined ? request.post<User>('/api/users', values) : request.put<User>(`/api/users/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/users/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useBatchDeleteUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.delete<null>('/api/users/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useBatchUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: 'enabled' | 'disabled'; id?: number }) =>
      request.put<null>('/api/users/batch-status', { ids, status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      request.put<null>(`/api/users/${id}/password`, { password }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useBatchUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, password }: { ids: number[]; password: string }) =>
      request.put<null>('/api/users/batch-password', { ids, password }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUnlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/users/${id}/unlock`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useAssignUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleIds }: { id: number; roleIds: number[] }) =>
      request.put<null>(`/api/users/${id}/roles`, { roleIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useImportUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress }: { formData: FormData; onProgress?: (percent: number) => void }) =>
      request.postForm<ImportUsersResult>('/api/users/import', formData, { onProgress }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useKickUserSessions() {
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/sessions/user/${id}`).then(unwrap),
  });
}

export function useUserDataPermission(userId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: userKeys.dataPermission(userId),
    queryFn: () => request.get<UserDataPermission>(`/api/users/${userId}/data-permission`).then(unwrap),
    enabled: enabled && userId !== undefined,
  });
}

export function useSaveUserDataPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, dataScope, deptScopeIds }: { userId: number; dataScope: string | null; deptScopeIds: number[] }) =>
      request.put<null>(`/api/users/${userId}/data-permission`, { dataScope, deptScopeIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useSaveUserMenus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, menuIds }: { userId: number; menuIds: number[] }) =>
      request.put<null>(`/api/users/${userId}/menus`, { menuIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUserEffectivePermissions(userId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: userKeys.effectivePermissions(userId),
    queryFn: () => request.get<UserEffectivePermissions>(`/api/users/${userId}/effective-permissions`).then(unwrap),
    enabled: enabled && userId !== undefined,
  });
}
