import { useQuery } from '@tanstack/react-query';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { buildTree, mapTree, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { departmentContract, type Department } from '@zenith/shared/identity';
import { api, useSaveMutation, useApiMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type DepartmentTreeParams = NonNullable<QueryOf<typeof departmentContract.tree>>;

/** 保存载荷：创建入参的部分形态，同一表单同时服务新增与编辑 */
export type DepartmentFormValues = Partial<BodyOf<typeof departmentContract.create>>;

/** 平铺部门节点的最小形态（`Department` 及各处按需裁剪的部门列表都满足） */
type FlatDepartmentLike = { id: number; name: string; parentId: number | null };

type DepartmentNode = FlatDepartmentLike & { children?: DepartmentNode[] };

const toDepartmentTreeNode = (d: { id: number; name: string }): Omit<TreeNodeData, 'children'> => ({
  key: String(d.id),
  value: d.id,
  label: d.name,
});

/** 嵌套部门树（`useDepartmentTree`）→ Semi Tree / TreeSelect 节点；无子节点时 `children` 为 undefined */
export function departmentTreeToTreeData(nodes: readonly Department[]): TreeNodeData[] {
  return mapTree<Department, TreeNodeData>(nodes, toDepartmentTreeNode);
}

/**
 * 平铺部门列表（`useFlatDepartments`）→ Semi Tree / TreeSelect 节点：按 parentId 挂接，
 * 父节点缺失（被过滤 / 越权）的节点提升为根。
 * - `excludeIds`：排除的部门（编辑部门时排除自身及子孙，避免选自己做上级）
 * - `keepEmptyChildren`：叶子保留 `children: []`（缺省不带 children）
 */
export function departmentsToTreeData(
  departments: readonly FlatDepartmentLike[],
  options: { excludeIds?: ReadonlySet<number>; keepEmptyChildren?: boolean } = {},
): TreeNodeData[] {
  const { excludeIds, keepEmptyChildren } = options;
  const source: DepartmentNode[] = departments
    .filter((d) => !excludeIds?.has(d.id))
    .map((d) => ({ id: d.id, parentId: d.parentId, name: d.name }));
  return mapTree<DepartmentNode, TreeNodeData>(buildTree(source, { keepEmptyChildren }), toDepartmentTreeNode);
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
