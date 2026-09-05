import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowDefinitionContract, workflowTemplateContract } from '@zenith/shared/workflow';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowDefinitionListParams = QueryOf<typeof workflowDefinitionContract.list>;

export interface WorkflowVersionDiffParams {
  definitionId: number | null | undefined;
  left: number;
  right: number;
}

const resource = createResourceQueries(workflowDefinitionContract, {
  // 多处运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播失效，保留嵌套前缀
  keyPrefix: ['workflow', 'definitions'],
});

export const workflowDefinitionKeys = {
  ...resource.keys,
  published: [...resource.keys.all, 'published'] as const,
  versions: (definitionId: number | null | undefined, params?: { page: number; pageSize: number }) =>
    [...resource.keys.all, 'versions', definitionId ?? null, params ?? null] as const,
  diff: (params: WorkflowVersionDiffParams) => [...resource.keys.all, 'diff', params] as const,
};

export const useWorkflowDefinitionList = resource.useList;

/**
 * 已发布流程定义（启动列表、日程绑定、关联流程选择器等共用）。
 *
 * 这是该端点的唯一入口：发布只失效 `workflowDefinitionKeys.all`，各调用方必须共用这一份缓存，
 * 否则新发布的定义在其它 key 的下拉里最长 5 分钟不出现。
 *
 * `staleTime` 是 observer 级选项，不同调用方可各自指定；但 `silent` 之类会进入
 * queryFn 的参数刻意不开放——同一个 key 配不同 queryFn 会让实际行为取决于哪个
 * observer 最后注册。
 */
export function usePublishedWorkflowDefinitions(options?: { enabled?: boolean; staleTime?: number }) {
  return useQuery({
    queryKey: workflowDefinitionKeys.published,
    queryFn: () => api(workflowDefinitionContract.published),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime,
  });
}

export function useWorkflowDefinitionDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowDefinitionKeys.detail(id ?? undefined),
    queryFn: () => api(workflowDefinitionContract.detail, { params: { id: id as number } }),
    enabled: enabled && !!id,
  });
}

export function useWorkflowDefinitionVersions(
  definitionId: number | null | undefined,
  params: { page: number; pageSize: number },
  enabled = true,
) {
  return useQuery({
    queryKey: workflowDefinitionKeys.versions(definitionId, params),
    queryFn: () => api(workflowDefinitionContract.versions, { params: { id: definitionId as number }, query: params }),
    enabled: enabled && !!definitionId,
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowDefinitionDiff(params: WorkflowVersionDiffParams, enabled = true) {
  return useQuery({
    queryKey: workflowDefinitionKeys.diff(params),
    queryFn: () =>
      api(workflowDefinitionContract.diff, { params: { id: params.definitionId as number }, query: { left: params.left, right: params.right } }),
    enabled: enabled && !!params.definitionId,
  });
}

/** 定义级写操作影响列表 / 详情 / 已发布下拉 / 版本历史，统一失效整个定义子树 */
const invalidateDefinitions = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.all });
};

export function usePublishWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.publish, { invalidate: invalidateDefinitions });
}

export function useDisableWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.disable, { invalidate: invalidateDefinitions });
}

export function useEnableWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.enable, { invalidate: invalidateDefinitions });
}

export function useDeleteWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.remove, { invalidate: invalidateDefinitions });
}

export function useBatchDisableWorkflowDefinitions() {
  return useApiMutation(workflowDefinitionContract.batchDisable, { invalidate: invalidateDefinitions });
}

export function useBatchEnableWorkflowDefinitions() {
  return useApiMutation(workflowDefinitionContract.batchEnable, { invalidate: invalidateDefinitions });
}

export function useBatchDeleteWorkflowDefinitions() {
  return useApiMutation(workflowDefinitionContract.batchDelete, { invalidate: invalidateDefinitions });
}

export function useDuplicateWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.duplicate, { invalidate: invalidateDefinitions });
}

export function useImportWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.import, { invalidate: invalidateDefinitions });
}

/** 另存为模板不改动定义本身，但模板列表页与定义页共用「模板库」入口，沿用定义子树失效口径 */
export function useSaveWorkflowDefinitionAsTemplate() {
  return useApiMutation(workflowTemplateContract.saveAs, { invalidate: invalidateDefinitions });
}

export function useRestoreWorkflowDefinitionVersion() {
  return useApiMutation(workflowDefinitionContract.restoreVersion, { invalidate: invalidateDefinitions });
}
