import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, TenantPackage } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface TenantPackageListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const tenantPackageKeys = {
  all: ['tenant-packages'] as const,
  allPackages: ['tenant-packages', 'all'] as const,
  lists: ['tenant-packages', 'list'] as const,
  list: (params: TenantPackageListParams) => ['tenant-packages', 'list', params] as const,
  detail: (id: number | undefined) => ['tenant-packages', 'detail', id] as const,
};

export function useAllTenantPackages(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: tenantPackageKeys.allPackages,
    queryFn: () => request.get<{ id: number; name: string; status: string }[]>('/api/tenant-packages/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useTenantPackageList(params: TenantPackageListParams) {
  return useQuery({
    queryKey: tenantPackageKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<TenantPackage>>(`/api/tenant-packages${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useTenantPackageDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: tenantPackageKeys.detail(id),
    queryFn: () => request.get<TenantPackage>(`/api/tenant-packages/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

/** 新增（无 id）或更新（有 id）套餐 */
export function useSaveTenantPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<TenantPackage> }) =>
      (id === undefined
        ? request.post<TenantPackage>('/api/tenant-packages', values)
        : request.put<TenantPackage>(`/api/tenant-packages/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tenantPackageKeys.all }),
  });
}

/** 删除套餐：单个（length===1 走单删接口）或批量 */
export function useDeleteTenantPackages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      (ids.length === 1
        ? request.delete<null>(`/api/tenant-packages/${ids[0]}`)
        : request.delete<null>('/api/tenant-packages/batch', { ids })
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tenantPackageKeys.all }),
  });
}

export function useAssignTenantPackageMenus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, menuIds }: { id: number; menuIds: number[] }) =>
      request.put<null>(`/api/tenant-packages/${id}/menus`, { menuIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: tenantPackageKeys.all }),
  });
}
