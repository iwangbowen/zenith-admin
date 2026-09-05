import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { workflowDefinitionContract, workflowInstanceContract, workflowTaskContract, type WorkflowDefinition, type WorkflowInstance, type WorkflowSelectableUser } from '@zenith/shared/workflow';
import { api } from '@/lib/contract-query';

export const workflowSharedKeys = {
  all: ['workflow'] as const,
  approvalPreviews: ['workflow', 'approval-preview'] as const,
  approvalPreview: (definitionId: number | null | undefined, reloadKey: number | undefined) =>
    ['workflow', 'approval-preview', definitionId ?? null, reloadKey ?? 0] as const,
  instanceDetails: ['workflow', 'instance-detail'] as const,
  instanceDetail: (instanceId: number | null | undefined) => ['workflow', 'instance-detail', instanceId ?? null] as const,
  selectableNextApprovers: (taskId: number | null | undefined) =>
    ['workflow', 'selectable-next-approvers', taskId ?? null] as const,
  selectableUsers: ['workflow', 'selectable-users'] as const,
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
      previousQuery?.queryKey[2] === definitionId ? previousData : undefined,
  });
}

export function useWorkflowInstanceWithDefinition(instanceId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowSharedKeys.instanceDetail(instanceId),
    queryFn: () => fetchWorkflowInstanceWithDefinition(instanceId as number),
    enabled: enabled && !!instanceId,
    staleTime: 0,
  });
}

export function useWorkflowSelectableNextApprovers(taskId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowSharedKeys.selectableNextApprovers(taskId),
    queryFn: () => api(workflowTaskContract.selectableNextApprovers, { params: { taskId: taskId as number } }),
    enabled: enabled && taskId != null,
    placeholderData: keepPreviousData,
  });
}

// ─── 工作流协作选人（转办/委派/加签/协办/转发/抄送共用） ─────────────────────

export type { WorkflowSelectableUser };

/** 与用户管理 lookup 相同的新鲜度语义：人员名录低频变化，5 分钟内复用缓存 */
const SELECTABLE_USERS_STALE_TIME = 5 * 60 * 1000;

export function workflowSelectableUsersQueryOptions() {
  return {
    queryKey: workflowSharedKeys.selectableUsers,
    queryFn: () => api(workflowInstanceContract.selectableUsers),
    staleTime: SELECTABLE_USERS_STALE_TIME,
  };
}

/**
 * 工作流选人数据源。区别于 `useAllUsers`（系统用户管理接口，要求 system:user:list）：
 * 本接口面向普通发起人/审批人开放，返回租户内启用用户的最小协作字段。
 * 工作流域内所有面向普通用户的选人（转办/委派/加签/协办/转发/抄送/审批代理）一律用它。
 */
export function useWorkflowSelectableUsers(options?: { enabled?: boolean }) {
  return useQuery({
    ...workflowSelectableUsersQueryOptions(),
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
