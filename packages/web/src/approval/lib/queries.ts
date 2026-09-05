/**
 * 移动审批轻页域 hooks（独立 QueryClient，不与 admin/member 混用）
 *
 * 与后台共用同一套工作流契约；所有调用经 `approvalRequest` 实例发出（独立会话 / 刷新 / 登录跳转语义）。
 */
import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { workflowDefinitionContract, workflowInstanceContract, workflowQuickPhraseContract, workflowTaskContract, type WorkflowInstance, type WorkflowInstanceListItem, type WorkflowTask } from '@zenith/shared/workflow';
import { authContract, userContract } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { approvalRequest } from './approval-request';

export const approvalQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

export type ApprovalTab = 'pending' | 'handled' | 'mine' | 'cc';

/** 四个 Tab 共用的列表项形态：待办返回 SLA / 摘要扩展字段，其余 Tab 返回实例摘要 */
export type ApprovalListItem = WorkflowInstanceListItem;

/** 审批端请求实例：与后台 `request` 隔离的会话与 401 处理 */
const client = { client: approvalRequest } as const;
const silentClient = { client: approvalRequest, silent: true } as const;

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
function fetchApprovalList(tab: ApprovalTab, size: number, keyword: string): Promise<{ list: ApprovalListItem[]; total: number }> {
  const query = { page: 1, pageSize: size, ...(keyword ? { keyword } : {}) };
  switch (tab) {
    case 'pending':
      return api(workflowInstanceContract.pendingMine, { query }, client);
    case 'handled':
      return api(workflowInstanceContract.handledMine, { query }, client);
    case 'cc':
      return api(workflowInstanceContract.ccMine, { query }, client);
    case 'mine':
      // 「我的申请」端点不支持关键字筛选
      return api(workflowInstanceContract.list, { query: { page: 1, pageSize: size } }, client);
  }
}

export function useApprovalList(tab: ApprovalTab, size: number, keyword = '') {
  return useQuery({
    queryKey: approvalKeys.list(tab, size, keyword),
    queryFn: () => fetchApprovalList(tab, size, keyword),
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
        api(workflowInstanceContract.pendingMineCount, silentClient),
        api(workflowInstanceContract.ccUnreadCount, silentClient),
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
    queryFn: () => api(workflowInstanceContract.detail, { params: { id: id as number } }, client),
    enabled: id != null,
  });
}

export function useApprovalMe() {
  return useQuery({
    queryKey: approvalKeys.me,
    queryFn: () => api(authContract.me, silentClient),
    retry: false,
  });
}

export type ApprovalTaskActionVariables =
  | { taskId: number; action: 'approve'; body: BodyOf<typeof workflowTaskContract.approve> }
  | { taskId: number; action: 'reject'; body: BodyOf<typeof workflowTaskContract.reject> }
  | { taskId: number; action: 'transfer'; body: BodyOf<typeof workflowTaskContract.transfer> };

/** 同意 / 驳回 / 转办：幂等键按动作 + 任务生成，防止弱网下的重复提交 */
export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ApprovalTaskActionVariables): Promise<WorkflowInstance | WorkflowTask> => {
      const params = { taskId: vars.taskId };
      const options = { ...client, headers: { 'X-Idempotency-Key': `approval-${vars.action}-${vars.taskId}` } };
      switch (vars.action) {
        case 'approve':
          return api(workflowTaskContract.approve, { params, body: vars.body }, options);
        case 'reject':
          return api(workflowTaskContract.reject, { params, body: vars.body }, options);
        case 'transfer':
          return api(workflowTaskContract.transfer, { params, body: vars.body }, options);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

/** 发起人撤回（running 实例） */
export function useWithdrawInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => api(workflowInstanceContract.withdraw, { params: { id } }, client),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

/** 发起人催办当前审批人 */
export function useUrgeInstance() {
  return useMutation({
    mutationFn: ({ id, message }: { id: number; message?: string }) =>
      api(workflowInstanceContract.urge, { params: { id }, body: message ? { message } : {} }, client),
  });
}

/** 抄送已读标记 */
export function useMarkCcRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ccTaskId: number) => api(workflowInstanceContract.ccRead, { params: { ccTaskId } }, silentClient),
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
      api(workflowInstanceContract.addComment, { params: { id: instanceId }, body: { content, mentions: [], attachments: [], parentId: null } }, client),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: approvalKeys.detail(vars.instanceId) }),
  });
}

/** 审批意见常用语（系统预置 + 我的） */
export function useApprovalQuickPhrases(enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.phrases,
    queryFn: () => api(workflowQuickPhraseContract.list, silentClient),
    staleTime: 5 * 60_000,
    enabled,
    retry: false,
  });
}

export function usePublishedDefinitions() {
  return useQuery({
    queryKey: approvalKeys.definitions,
    queryFn: () => api(workflowDefinitionContract.published, client),
    staleTime: 60_000,
  });
}

export function useLaunchInstance() {
  const qc = useQueryClient();
  return useMutation({
    // 幂等由服务端自动指纹（userId+path+bodyHash）兜底，前端按钮 loading 防连点
    mutationFn: (body: BodyOf<typeof workflowInstanceContract.create>) => api(workflowInstanceContract.create, { body }, client),
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
      api(
        workflowDefinitionContract.preview,
        { params: { id: definitionId as number }, body: { formData: getFormData ? getFormData() : null } },
        silentClient,
      ),
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
    queryFn: () => api(workflowTaskContract.selectableNextApprovers, { params: { taskId: taskId as number } }, silentClient),
    enabled: enabled && taskId != null,
  });
}

/** 全量用户（转办候选），按需加载 */
export function useApprovalUsers(enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.users,
    queryFn: () => api(userContract.all, silentClient),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** 连续审批：处理完一条后取下一条待办（排除当前实例），供详情页自动跳转 */
export async function fetchNextPendingTask(
  excludeInstanceId: number,
): Promise<{ next: { instanceId: number; taskId: number } | null; remaining: number }> {
  const data = await api(workflowInstanceContract.pendingMine, { query: { page: 1, pageSize: 5 } }, silentClient);
  const item = data.list.find((i) => i.id !== excludeInstanceId && i.pendingTaskId != null);
  return {
    next: item?.pendingTaskId != null ? { instanceId: item.id, taskId: item.pendingTaskId } : null,
    remaining: data.total,
  };
}
