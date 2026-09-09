import { useQuery } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { departmentContract } from '@zenith/shared/identity';
import { api, useSaveMutation, useApiMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type DepartmentTreeParams = NonNullable<QueryOf<typeof departmentContract.tree>>;

/** 保存载荷：创建入参的部分形态，同一表单同时服务新增与编辑 */
export type DepartmentFormValues = Partial<BodyOf<typeof departmentContract.create>>;

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
    queryFn: () => api(departmentContract.tree, { query: {} }),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useDepartmentTreeSearch(params: DepartmentTreeParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: departmentKeys.treeSearch(params),
    queryFn: () => api(departmentContract.tree, { query: params }),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/** 扁平部门列表（用户穿梭框等场景共享缓存） */
export function useFlatDepartments(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: departmentKeys.flat,
    queryFn: () => api(departmentContract.flat),
    select: (data) => (Array.isArray(data) ? data : []),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useDepartmentDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: departmentKeys.detail(id),
    queryFn: () => api(departmentContract.detail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveDepartment() {
  return useSaveMutation(departmentContract.create, departmentContract.update, {
    invalidate: (qc, saved) => {
      // 树与扁平列表都会注入 children / userCount 等聚合字段，写接口响应不含，故不回填
      void qc.invalidateQueries({ queryKey: departmentKeys.detail(saved.id) });
      // tree 是 treeSearch 的前缀，一并覆盖带筛选条件的树
      void qc.invalidateQueries({ queryKey: departmentKeys.tree });
      void qc.invalidateQueries({ queryKey: departmentKeys.flat });
    },
  });
}

export function useDeleteDepartment() {
  return useApiMutation(departmentContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: departmentKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: departmentKeys.tree });
      void qc.invalidateQueries({ queryKey: departmentKeys.flat });
    },
  });
}
