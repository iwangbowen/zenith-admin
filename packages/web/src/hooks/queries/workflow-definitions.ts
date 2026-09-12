import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowDefinitionContract, workflowTemplateContract } from '@zenith/shared/workflow';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type WorkflowDefinitionListParams = QueryOf<typeof workflowDefinitionContract.list>;

export interface WorkflowVersionDiffParams {
  definitionId: number | null | undefined;
  left: number;
  right: number;
}

/** 只用工厂的列表与 keys：保存在设计器（带 flowData 转换），删除 / 发布等是非标准动作 */
const resource = createResourceQueries(workflowDefinitionContract);

export const workflowDefinitionKeys = {
  ...resource.keys,
  /** 详情统一为契约 key：监控页、设计器、批量恢复弹窗与本域共用同一份缓存 */
  details: contractKey(workflowDefinitionContract.detail),
  detail: (id: number | null | undefined) => contractKey(workflowDefinitionContract.detail, { params: { id: id ?? 0 } }),
  published: contractKey(workflowDefinitionContract.published),
  /** 某定义全部版本页的公共前缀：key 的对象段按部分匹配，只给 params 即命中任意分页 */
  versions: (definitionId: number | null | undefined) =>
    [...contractKey(workflowDefinitionContract.versions), { params: { id: definitionId ?? 0 } }] as const,
  versionList: (definitionId: number | null | undefined, params: { page: number; pageSize: number }) =>
    contractKey(workflowDefinitionContract.versions, { params: { id: definitionId ?? 0 }, query: params }),
  diff: (params: WorkflowVersionDiffParams) =>
    contractKey(workflowDefinitionContract.diff, { params: { id: params.definitionId ?? 0 }, query: { left: params.left, right: params.right } }),
};

export const useWorkflowDefinitionList = resource.useList;

/**
 * 已发布流程定义（启动列表、日程绑定、关联流程选择器、监控筛选等共用）。
 *
 * 这是该端点的唯一入口：发布 / 启停 / 删除只失效 `workflowDefinitionKeys.published`，各调用方必须共用这一份缓存，
 * 否则新发布的定义在其它 key 的下拉里最长 5 分钟不出现。
 *
 * `staleTime` 是 observer 级选项，不同调用方可各自指定；但 `silent` 之类会进入
 * queryFn 的参数刻意不开放——同一个 key 配不同 queryFn 会让实际行为取决于哪个
 * observer 最后注册。
 */
export function usePublishedWorkflowDefinitions(options?: { enabled?: boolean; staleTime?: number }) {
  return useApiQuery(workflowDefinitionContract.published, {
    enabled: options?.enabled ?? true,
    // 显式传 undefined 会覆盖 QueryClient 的默认 staleTime（视为 0），未指定时不写入该字段
    ...(options?.staleTime === undefined ? {} : { staleTime: options.staleTime }),
  });
}

export function useWorkflowDefinitionDetail(id: number | null | undefined, enabled = true) {
  return useApiQuery(workflowDefinitionContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export function useWorkflowDefinitionVersions(
  definitionId: number | null | undefined,
  params: { page: number; pageSize: number },
  enabled = true,
) {
  return useApiQuery(
    workflowDefinitionContract.versions,
    { params: { id: definitionId ?? 0 }, query: params },
    { enabled: enabled && !!definitionId, placeholderData: keepPreviousData },
  );
}

export function useWorkflowDefinitionDiff(params: WorkflowVersionDiffParams, enabled = true) {
  return useApiQuery(
    workflowDefinitionContract.diff,
    { params: { id: params.definitionId ?? 0 }, query: { left: params.left, right: params.right } },
    { enabled: enabled && !!params.definitionId },
  );
}

/**
 * 定义状态变化（发布 / 启停 / 恢复版本）后回源：列表（状态、版本号列）、该定义详情（未指定 id 时整组），
 * 以及已发布下拉（发布 / 禁用 / 删除都会改变可发起的流程集合）。
 * 设计器的表单 / 连接器 / 数据源 lookup 与审批链路预览不读定义状态，不受影响。
 */
export function invalidateWorkflowDefinitionState(qc: QueryClient, id?: number): void {
  void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
  void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.published });
  void qc.invalidateQueries({ queryKey: id === undefined ? workflowDefinitionKeys.details : workflowDefinitionKeys.detail(id) });
}

/** 发布 / 恢复版本会写入新的版本记录，在状态失效之外补上版本历史 */
export function invalidateAfterWorkflowDefinitionVersionChange(qc: QueryClient, id: number): void {
  invalidateWorkflowDefinitionState(qc, id);
  void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.versions(id) });
}

/** 删除：实体已不存在，移除详情与版本缓存而非失效，再回源列表与已发布下拉 */
function removeWorkflowDefinition(qc: QueryClient, id: number): void {
  qc.removeQueries({ queryKey: workflowDefinitionKeys.detail(id) });
  qc.removeQueries({ queryKey: workflowDefinitionKeys.versions(id) });
}

export function usePublishWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.publish, {
    invalidate: (qc, _saved, { params }) => invalidateAfterWorkflowDefinitionVersionChange(qc, params.id),
  });
}

export function useDisableWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.disable, {
    invalidate: (qc, _saved, { params }) => invalidateWorkflowDefinitionState(qc, params.id),
  });
}

export function useEnableWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.enable, {
    invalidate: (qc, _saved, { params }) => invalidateWorkflowDefinitionState(qc, params.id),
  });
}

export function useDeleteWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.remove, {
    invalidate: (qc, _output, { params }) => {
      removeWorkflowDefinition(qc, params.id);
      invalidateWorkflowDefinitionState(qc, params.id);
    },
  });
}

export function useBatchDisableWorkflowDefinitions() {
  return useApiMutation(workflowDefinitionContract.batchDisable, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.published });
    },
  });
}

export function useBatchEnableWorkflowDefinitions() {
  return useApiMutation(workflowDefinitionContract.batchEnable, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.published });
    },
  });
}

export function useBatchDeleteWorkflowDefinitions() {
  return useApiMutation(workflowDefinitionContract.batchDelete, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) removeWorkflowDefinition(qc, id);
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.published });
    },
  });
}

/** 复制 / 导入都只新增一条草稿定义：列表多一行，已发布下拉与既有定义不变 */
export function useDuplicateWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.duplicate, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists }),
  });
}

export function useImportWorkflowDefinition() {
  return useApiMutation(workflowDefinitionContract.import, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists }),
  });
}

/** 另存为模板不改动定义本身，只在模板库多出一条（模板 key 与 workflow-templates 同源于契约操作，避免循环引用） */
export function useSaveWorkflowDefinitionAsTemplate() {
  return useApiMutation(workflowTemplateContract.saveAs, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: contractKey(workflowTemplateContract.list) }),
  });
}

export function useRestoreWorkflowDefinitionVersion() {
  return useApiMutation(workflowDefinitionContract.restoreVersion, {
    invalidate: (qc, _saved, { params }) => invalidateAfterWorkflowDefinitionVersionChange(qc, params.id),
  });
}
