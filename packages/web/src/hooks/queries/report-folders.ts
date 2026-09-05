import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { reportFolderContract, type ReportFolder, type ReportFolderTreeNode } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type ReportFolderListParams = NonNullable<QueryOf<typeof reportFolderContract.tree>>;

export const reportFolderKeys = {
  lists: contractKey(reportFolderContract.tree),
  list: (params: ReportFolderListParams) => contractKey(reportFolderContract.tree, { query: params }),
  detail: (id: number | undefined) => contractKey(reportFolderContract.detail, { params: { id: id ?? 0 } }),
};

export function useReportFolderTree(params: ReportFolderListParams = {}, enabled = true) {
  return useApiQuery(reportFolderContract.tree, { query: params }, { staleTime: LOOKUP_STALE_TIME, enabled });
}

export function useReportFolderDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportFolderContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export function flattenReportFolders(nodes: ReportFolderTreeNode[]): ReportFolderTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenReportFolders(node.children ?? [])]);
}

/** 新增 / 编辑共用的保存载荷：resourceType 只在创建时提交，编辑表单由 rules 保证必填 */
export type SaveReportFolderValues = Partial<BodyOf<typeof reportFolderContract.create>>;

/** 无 id 走 create，有 id 走 update（供 useEditModal 使用） */
export function useSaveReportFolder() {
  const qc = useQueryClient();
  return useMutation<ReportFolder, Error, { id?: number; values: SaveReportFolderValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportFolderContract.create, { body: values as BodyOf<typeof reportFolderContract.create> }, { silent: true })
      : api(reportFolderContract.update, { params: { id }, body: values }, { silent: true })),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: reportFolderKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: reportFolderKeys.lists });
    },
  });
}

/** 移动会改变整棵树的层级关系，列表需整体回源 */
export function useMoveReportFolder() {
  return useApiMutation(reportFolderContract.move, {
    requestOptions: { silent: true },
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: reportFolderKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportFolderKeys.lists });
    },
  });
}

export function useDeleteReportFolder() {
  return useApiMutation(reportFolderContract.remove, {
    requestOptions: { silent: true },
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportFolderKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportFolderKeys.lists });
    },
  });
}
