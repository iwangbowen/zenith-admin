import { useCallback, useMemo, useState } from 'react';
// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { workflowDefinitionContract, workflowInstanceContract, workflowTaskContract, type WorkflowDefinition, type WorkflowInstance, type WorkflowSelectableUser } from '@zenith/shared/workflow';
import { api, apiQueryOptions, contractKey, useApiQuery } from '@/lib/contract-query';
import { workflowInstanceKeys } from './workflow-instances';

/** 按组远程搜索「下一节点自选审批人」：只针对一个下游节点，避免关键词过滤掉其它组 */
export interface WorkflowNextApproverSearch {
  nodeKey: string;
  keyword: string;
}

export const workflowSharedKeys = {
  approvalPreviews: contractKey(workflowDefinitionContract.preview),
  /** 预览是 POST 查询：请求体在取数时刻惰性求值，不进 key；主操作前缀 + 定义 id + reloadKey 区分段驱动重算 */
  approvalPreview: (definitionId: number | null | undefined, reloadKey: number | undefined) =>
    [...contractKey(workflowDefinitionContract.preview), { params: { id: definitionId ?? 0 } }, reloadKey ?? 0] as const,
  instanceDetails: workflowInstanceKeys.details,
  /** 「实例 + 定义」组合查询：挂在实例详情 key 之下，失效 detail(id) 时一并回源 */
  instanceDetail: (instanceId: number | null | undefined) =>
    [...workflowInstanceKeys.detail(instanceId ?? 0), 'with-definition'] as const,
  selectableNextApprovers: (taskId: number | null | undefined, search?: WorkflowNextApproverSearch) =>
    contractKey(workflowTaskContract.selectableNextApprovers, {
      params: { taskId: taskId ?? 0 },
      query: search ? { nodeKey: search.nodeKey, keyword: search.keyword } : {},
    }),
  selectableUsers: contractKey(workflowInstanceContract.selectableUsers),
};

export async function fetchWorkflowInstanceWithDefinition(instanceId: number): Promise<{
  instance: WorkflowInstance;
  definition: WorkflowDefinition | null;
}> {
  const instance = await api(workflowInstanceContract.detail, { params: { id: instanceId } }, { silent: true });
  if (instance.definitionSnapshot) return { instance, definition: null };
  const definition = await api(workflowDefinitionContract.detail, { params: { id: instance.definitionId } }, { silent: true });
  return { instance, definition };
}

/** 读 key 里的 params.id：占位数据只在定义未切换时沿用，切换定义后立即清空避免展示错误链路 */
function previewDefinitionIdOf(queryKey: readonly unknown[]): number | undefined {
  const identity = queryKey[2] as { params?: { id?: number } } | undefined;
  return identity?.params?.id;
}

/** H5：queryFn 不是单次直调 —— 请求体由 getFormData 在取数时刻惰性求值，key 用 reloadKey 区分而不含表单数据 */
export function useWorkflowApprovalPreview(
  definitionId: number | null | undefined,
  reloadKey: number | undefined,
  getFormData?: () => Record<string, unknown>,
) {
  return useQuery({
    queryKey: workflowSharedKeys.approvalPreview(definitionId, reloadKey),
    queryFn: () =>
      api(
        workflowDefinitionContract.preview,
        { params: { id: definitionId as number }, body: { formData: getFormData ? getFormData() : null } },
        { silent: true },
      ),
    enabled: !!definitionId,
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previewDefinitionIdOf(previousQuery.queryKey) === definitionId ? previousData : undefined,
  });
}

/** 组合查询的 queryOptions（审批面板需要在驳回前用 fetchQuery 命令式取最新实例） */
export function workflowInstanceWithDefinitionQueryOptions(instanceId: number) {
  return {
    queryKey: workflowSharedKeys.instanceDetail(instanceId),
    queryFn: () => fetchWorkflowInstanceWithDefinition(instanceId),
    staleTime: 0,
  };
}

/** H5：queryFn 组合两次请求（实例详情 + 快照缺失时补拉定义） */
export function useWorkflowInstanceWithDefinition(instanceId: number | null | undefined, enabled = true) {
  return useQuery({
    ...workflowInstanceWithDefinitionQueryOptions(instanceId ?? 0),
    enabled: enabled && !!instanceId,
  });
}

/**
 * 下游「自选下一审批人」候选分组。不传 `search` 取全部分组（每组限量，`truncated` 标记截断）；
 * 传 `search` 只取该节点按关键词过滤后的候选，供 truncated 的组做远程搜索。
 */
export function useWorkflowSelectableNextApprovers(
  taskId: number | null | undefined,
  enabled = true,
  search?: WorkflowNextApproverSearch,
) {
  return useApiQuery(
    workflowTaskContract.selectableNextApprovers,
    { params: { taskId: taskId ?? 0 }, query: search ? { nodeKey: search.nodeKey, keyword: search.keyword } : {} },
    { enabled: enabled && taskId != null, placeholderData: keepPreviousData },
  );
}

// ─── 工作流协作选人（转办/委派/加签/协办/转发/抄送共用） ─────────────────────

export type { WorkflowSelectableUser };

/** 与用户管理 lookup 相同的新鲜度语义：人员名录低频变化，5 分钟内复用缓存 */
const SELECTABLE_USERS_STALE_TIME = 5 * 60 * 1000;

export function workflowSelectableUsersQueryOptions() {
  return apiQueryOptions(workflowInstanceContract.selectableUsers, { staleTime: SELECTABLE_USERS_STALE_TIME });
}

/**
 * 工作流选人数据源。区别于 `useAllUsers`（系统用户管理接口，要求 system:user:list）：
 * 本接口面向普通发起人/审批人开放，返回租户内启用用户的最小协作字段。
 * 工作流域内所有面向普通用户的选人（转办/委派/加签/协办/转发/抄送/审批代理）一律用它。
 */
export function useWorkflowSelectableUsers(options?: { enabled?: boolean }) {
  return useApiQuery(workflowInstanceContract.selectableUsers, {
    staleTime: SELECTABLE_USERS_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export interface WorkflowUserOption {
  label: string;
  value: number;
}

const EMPTY_USER_OPTIONS: WorkflowUserOption[] = [];

function toUserOptions(list: WorkflowSelectableUser[]): WorkflowUserOption[] {
  return list.map((u) => ({ label: u.nickname ?? u.username, value: u.id }));
}

/**
 * 工作流选人下拉选项（{ label, value } 形态），接口/语义与 `useUserOptions` 对齐：
 * - immediate: true → 挂载即加载（发起页抄送人等需要立即可选的场景）
 * - 默认 lazy      → 调用方在弹窗打开时 await ensureLoaded()
 */
export function useWorkflowUserOptions(options?: { immediate?: boolean }) {
  const [enabled, setEnabled] = useState(options?.immediate ?? false);
  const queryClient = useQueryClient();
  const { data, isPending } = useWorkflowSelectableUsers({ enabled });

  const userOptions = useMemo(() => (data ? toUserOptions(data) : EMPTY_USER_OPTIONS), [data]);

  const ensureLoaded = useCallback(async (): Promise<WorkflowUserOption[]> => {
    setEnabled(true);
    const list = await queryClient.ensureQueryData(workflowSelectableUsersQueryOptions());
    return toUserOptions(list);
  }, [queryClient]);

  return { userOptions, loading: enabled && isPending, ensureLoaded };
}
