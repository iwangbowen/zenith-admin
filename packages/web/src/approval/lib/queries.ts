/**
 * 移动审批轻页域 hooks（独立 QueryClient，不与 admin/member 混用）
 */
import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  WorkflowApproverPreviewNode,
  WorkflowComment,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceSummaryItem,
  WorkflowQuickPhrase,
  WorkflowSelectableNextApproverGroup,
  WorkflowSlaLevel,
  WorkflowTaskStatus,
} from '@zenith/shared';
import { approvalRequest, unwrapApproval } from './approval-request';

export const approvalQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

export type ApprovalTab = 'pending' | 'handled' | 'mine' | 'cc';

export type ApprovalListItem = WorkflowInstance & {
  pendingTaskId?: number;
  pendingSignatureRequired?: boolean;
  requiresIndividual?: boolean;
  slaLevel?: WorkflowSlaLevel;
  slaOverdueSec?: number | null;
  slaDeadline?: string | null;
  summary?: WorkflowInstanceSummaryItem[];
  myTaskStatus?: WorkflowTaskStatus | null;
  myActionAt?: string | null;
};

const TAB_ENDPOINT: Record<ApprovalTab, string> = {
  pending: '/api/workflows/instances/pending-mine',
  handled: '/api/workflows/instances/handled-mine',
  mine: '/api/workflows/instances',
  cc: '/api/workflows/instances/cc-mine',
};

export const approvalKeys = {
  all: ['approval'] as const,
  list: (tab: ApprovalTab, size: number, keyword: string) => ['approval', 'list', tab, size, keyword] as const,
  lists: ['approval', 'list'] as const,
  detail: (id: number | null) => ['approval', 'detail', id] as const,
  definitions: ['approval', 'definitions'] as const,
  me: ['approval', 'me'] as const,
  counts: ['approval', 'counts'] as const,
  phrases: ['approval', 'quick-phrases'] as const,
  chainPreview: (definitionId: number | null, reloadKey: number) => ['approval', 'chain-preview', definitionId, reloadKey] as const,
  nextApprovers: (taskId: number | null) => ['approval', 'next-approvers', taskId] as const,
  users: ['approval', 'users'] as const,
};

/** 累积加载：固定 page=1、递增 pageSize（移动端"加载更多"语义，缓存 key 稳定） */
export function useApprovalList(tab: ApprovalTab, size: number, keyword = '') {
  return useQuery({
    queryKey: approvalKeys.list(tab, size, keyword),
    queryFn: () =>
      approvalRequest
        .get<PaginatedResponse<ApprovalListItem>>(
          `${TAB_ENDPOINT[tab]}?page=1&pageSize=${size}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`,
        )
        .then(unwrapApproval),
    placeholderData: keepPreviousData,
    refetchInterval: tab === 'pending' ? 30_000 : false,
  });
}

/** 待办总数 + 抄送未读数（Tab 角标），30s 轮询 */
export function useApprovalCounts() {
  return useQuery({
    queryKey: approvalKeys.counts,
    queryFn: async () => {
      const [pending, ccUnread] = await Promise.all([
        approvalRequest.get<{ count: number }>('/api/workflows/instances/pending-mine/count', { silent: true }).then(unwrapApproval),
        approvalRequest.get<{ count: number }>('/api/workflows/instances/cc-mine/unread-count', { silent: true }).then(unwrapApproval),
      ]);
      return { pending: pending.count, ccUnread: ccUnread.count };
    },
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useApprovalDetail(id: number | null) {
  return useQuery({
    queryKey: approvalKeys.detail(id),
    queryFn: () => approvalRequest.get<WorkflowInstance>(`/api/workflows/instances/${id}`).then(unwrapApproval),
    enabled: id != null,
  });
}

export function useApprovalMe() {
  return useQuery({
    queryKey: approvalKeys.me,
    queryFn: () => approvalRequest.get<{ id: number; username: string; nickname: string | null }>('/api/auth/me', { silent: true }).then(unwrapApproval),
    retry: false,
  });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, action, body }: { taskId: number; action: 'approve' | 'reject' | 'transfer'; body: Record<string, unknown> }) =>
      approvalRequest
        .post<WorkflowInstance>(`/api/workflows/tasks/${taskId}/${action}`, body, {
          headers: { 'X-Idempotency-Key': `approval-${action}-${taskId}` },
        })
        .then(unwrapApproval),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

/** 发起人撤回（running 实例） */
export function useWithdrawInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; comment?: string }) =>
      approvalRequest.post<unknown>(`/api/workflows/instances/${id}/withdraw`, comment ? { comment } : {}).then(unwrapApproval),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

/** 发起人催办当前审批人 */
export function useUrgeInstance() {
  return useMutation({
    mutationFn: ({ id, message }: { id: number; message?: string }) =>
      approvalRequest.post<unknown>(`/api/workflows/instances/${id}/urge`, message ? { message } : {}).then(unwrapApproval),
  });
}

/** 抄送已读标记 */
export function useMarkCcRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ccTaskId: number) =>
      approvalRequest.post<unknown>(`/api/workflows/instances/cc/${ccTaskId}/read`, {}, { silent: true }).then(unwrapApproval),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: approvalKeys.counts });
      void qc.invalidateQueries({ queryKey: approvalKeys.lists });
    },
  });
}

/** 发表评论（轻页仅文本，不含 @提及 / 附件） */
export function useAddApprovalComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId, content }: { instanceId: number; content: string }) =>
      approvalRequest
        .post<WorkflowComment>(`/api/workflows/instances/${instanceId}/comments`, { content, mentions: [], attachments: [], parentId: null })
        .then(unwrapApproval),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: approvalKeys.detail(vars.instanceId) }),
  });
}

/** 审批意见常用语（系统预置 + 我的） */
export function useApprovalQuickPhrases(enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.phrases,
    queryFn: () => approvalRequest.get<WorkflowQuickPhrase[]>('/api/workflows/quick-phrases', { silent: true }).then(unwrapApproval),
    staleTime: 5 * 60_000,
    enabled,
    retry: false,
  });
}

export function usePublishedDefinitions() {
  return useQuery({
    queryKey: approvalKeys.definitions,
    queryFn: () => approvalRequest.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then(unwrapApproval),
    staleTime: 60_000,
  });
}

export function useLaunchInstance() {
  const qc = useQueryClient();
  return useMutation({
    // 幂等由服务端自动指纹（userId+path+bodyHash）兜底，前端按钮 loading 防连点
    mutationFn: (values: Record<string, unknown>) =>
      approvalRequest.post<WorkflowInstance>('/api/workflows/instances', values).then(unwrapApproval),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

/** 提交前审批链路预测（含发起人自选节点候选人），表单变更经防抖 reloadKey 重新预测 */
export function useApprovalChainPreview(
  definitionId: number | null,
  reloadKey: number,
  getFormData?: () => Record<string, unknown>,
) {
  return useQuery({
    queryKey: approvalKeys.chainPreview(definitionId, reloadKey),
    queryFn: () =>
      approvalRequest
        .post<WorkflowApproverPreviewNode[]>(
          `/api/workflows/definitions/${definitionId}/preview`,
          { formData: getFormData ? getFormData() : null },
          { silent: true },
        )
        .then(unwrapApproval),
    enabled: definitionId != null,
    // 同一流程刷新预测时保留旧数据避免闪空；切换流程则重新加载
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === definitionId ? prev : undefined,
  });
}

/** 审批时下游「自选下一审批人」节点分组（无则为空数组） */
export function useSelectableNextApprovers(taskId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.nextApprovers(taskId),
    queryFn: () =>
      approvalRequest
        .get<WorkflowSelectableNextApproverGroup[]>(`/api/workflows/tasks/${taskId}/selectable-next-approvers`, { silent: true })
        .then(unwrapApproval),
    enabled: enabled && taskId != null,
  });
}

/** 全量用户（转办候选），按需加载 */
export function useApprovalUsers(enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.users,
    queryFn: () =>
      approvalRequest
        .get<Array<{ id: number; nickname: string | null; username: string }>>('/api/users/all', { silent: true })
        .then(unwrapApproval),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** 连续审批：处理完一条后取下一条待办（排除当前实例），供详情页自动跳转 */
export async function fetchNextPendingTask(
  excludeInstanceId: number,
): Promise<{ next: { instanceId: number; taskId: number } | null; remaining: number }> {
  const data = await approvalRequest
    .get<PaginatedResponse<ApprovalListItem>>('/api/workflows/instances/pending-mine?page=1&pageSize=5', { silent: true })
    .then(unwrapApproval);
  const item = data.list.find((i) => i.id !== excludeInstanceId && i.pendingTaskId != null);
  return {
    next: item?.pendingTaskId != null ? { instanceId: item.id, taskId: item.pendingTaskId } : null,
    remaining: data.total,
  };
}
