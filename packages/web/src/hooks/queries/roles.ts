import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, Role, User } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface RoleListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export const roleKeys = {
  all: ['roles'] as const,
  lists: ['roles', 'list'] as const,
  list: (params: RoleListParams) => ['roles', 'list', params] as const,
  detail: (id: number | undefined) => ['roles', 'detail', id] as const,
  users: (roleId: number | undefined) => ['roles', 'users', roleId] as const,
  allRoles: ['roles', 'all'] as const,
};

export function useRoleList(params: RoleListParams) {
  return useQuery({
    queryKey: roleKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<Role>>(`/api/roles${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useRoleDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: roleKeys.detail(id),
    queryFn: () => request.get<Role>(`/api/roles/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useRoleUsers(roleId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: roleKeys.users(roleId),
    queryFn: () => request.get<User[]>(`/api/roles/${roleId}/users`).then(unwrap),
    enabled: enabled && roleId !== undefined,
  });
}

export function useAllRoles(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: roleKeys.allRoles,
    queryFn: () => request.get<Role[]>('/api/roles/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useSaveRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Role> }) =>
      (id === undefined
        ? request.post<Role>('/api/roles', values)
        : request.put<Role>(`/api/roles/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/roles/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useAssignRoleMenus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, menuIds }: { id: number; menuIds: number[] }) =>
      request.put<null>(`/api/roles/${id}/menus`, { menuIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useAssignRoleUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) =>
      request.put<null>(`/api/roles/${id}/users`, { userIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useUpdateRoleDataScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Role> }) =>
      request.put<Role>(`/api/roles/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
  });
}
