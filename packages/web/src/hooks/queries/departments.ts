import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Department } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface DepartmentTreeParams {
  keyword?: string;
  status?: string;
}

export const departmentKeys = {
  all: ['departments'] as const,
  tree: ['departments', 'tree'] as const,
  treeSearch: (params: DepartmentTreeParams) =>
    params.keyword || params.status ? ['departments', 'tree', params] as const : ['departments', 'tree'] as const,
  flat: ['departments', 'flat'] as const,
  detail: (id: number | undefined) => ['departments', 'detail', id] as const,
};

/** 部门树（角色管理范围、部门管理等场景全局共享缓存） */
export function useDepartmentTree(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: departmentKeys.tree,
    queryFn: () => request.get<Department[]>('/api/departments').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useDepartmentTreeSearch(params: DepartmentTreeParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: departmentKeys.treeSearch(params),
    queryFn: () => request.get<Department[]>(`/api/departments${toQueryString(params)}`).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/** 扁平部门列表（用户穿梭框等场景共享缓存） */
export function useFlatDepartments(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: departmentKeys.flat,
    queryFn: () => request.get<Department[]>('/api/departments/flat').then(unwrap),
    select: (data) => (Array.isArray(data) ? data : []),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useDepartmentDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: departmentKeys.detail(id),
    queryFn: () => request.get<Department>(`/api/departments/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<Department> }) =>
      (id === undefined
        ? request.post<Department>('/api/departments', values)
        : request.put<Department>(`/api/departments/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: departmentKeys.all }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/departments/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: departmentKeys.all }),
  });
}
