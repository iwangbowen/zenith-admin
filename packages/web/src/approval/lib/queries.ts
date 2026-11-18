/**
 * 移动审批轻页域 hooks（独立 QueryClient，不与 admin/member 混用）
 *
 * 与后台共用同一套工作流契约；所有调用经 `approvalRequest` 实例发出（独立会话 / 刷新 / 登录跳转语义）。
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, OutputOf } from '@zenith/shared/core';
import { workflowDefinitionContract, workflowDelegationContract, workflowInstanceContract, workflowQuickPhraseContract, workflowTaskContract, type WorkflowDelegation, type WorkflowInstanceListItem, type WorkflowHandledInstanceItem } from '@zenith/shared/workflow';
import { authContract } from '@zenith/shared/identity';
import { inAppMessageContract, type InAppMessage } from '@zenith/shared/messaging';
import { api, contractKey, urlOf } from '@/lib/contract-query';
import { runWorkflowBatchApprove, runWorkflowTaskAction, type WorkflowTaskActionVariables } from '@/hooks/queries/workflow-tasks';
import { approvalRequest } from './approval-request';

export type ApprovalTab = 'pending' | 'handled' | 'mine' | 'cc';

/** 四个 Tab 共用的列表项形态：待办返回 SLA / 摘要扩展字段，其余 Tab 返回实例摘要 */
export type ApprovalListItem = WorkflowInstanceListItem & Partial<Pick<WorkflowHandledInstanceItem, 'handledTask'>>;

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
  nextApprovers: (taskId: number | null, search?: { nodeKey: string; keyword: string }) =>
    ['approval', 'next-approvers', taskId, search ?? null] as const,
  users: ['approval', 'users'] as const,
  notifications: contractKey(inAppMessageContract.list),
  notificationUnread: contractKey(inAppMessageContract.unreadCount),
  delegations: contractKey(workflowDelegationContract.list),
};

/** Stable page-sized requests; all visible filters apply before pagination. */
export type ApprovalListFilters = { definitionId?: number | null; priority?: 'low' | 'normal' | 'high' | 'urgent' | null; overdue?: boolean; status?: 'draft' | 'returned' | 'running' | 'approved' | 'rejected' | 'withdrawn' };
function fetchApprovalList(tab: ApprovalTab, page: number, keyword: string, filters: ApprovalListFilters): Promise<{ list: ApprovalListItem[]; total: number }> {
  const query = { page, pageSize: 20, ...(keyword ? { keyword } : {}), definitionId: filters.definitionId ?? undefined, priority: filters.priority ?? undefined };
  switch (tab) {
    case 'pending':
      return api(workflowInstanceContract.pendingMine, { query: { ...query, overdue: filters.overdue || undefined } }, client);
    case 'handled':
      return api(workflowInstanceContract.handledMine, { query }, client);
    case 'cc':
      return api(workflowInstanceContract.ccMine, { query }, client);
    case 'mine':
      return filters.status === 'draft' ? api(workflowInstanceContract.ownDrafts, { query }, client) : api(workflowInstanceContract.list, { query: { ...query, status: filters.status } }, client);
  }
}

export function useApprovalList(tab: ApprovalTab, _size: number, keyword = '', enabled = true, filters: ApprovalListFilters = {}) {
  const result = useInfiniteQuery({
    queryKey: [...approvalKeys.lists, tab, keyword, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchApprovalList(tab, pageParam, keyword, filters),
    getNextPageParam: (last, pages) => pages.reduce((n, p) => n + p.list.length, 0) < last.total ? pages.length + 1 : undefined,
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: tab === 'pending' ? 30_000 : false,
  });
  const rows = result.data?.pages.flatMap(p => p.list) ?? [];
  const list = [...new Map(rows.map(i => [i.pendingTaskId ?? i.handledTask?.id ?? i.ccTaskId ?? i.id, i])).values()];
  return { data: result.data ? { list, total: result.data.pages[0]?.total ?? 0 } : undefined, error: result.error, isError: result.isError, isFetching: result.isFetching, isLoading: result.isLoading, refetch: result.refetch, hasNextPage: result.hasNextPage, fetchNextPage: result.fetchNextPage };
}

export function useApprovalDefinitionOptions(pending: boolean, canCreate = true) {
  return useQuery({ queryKey: ['approval', 'filter-definitions', pending], queryFn: () => pending ? api(workflowInstanceContract.pendingDefinitionOptions, client) : api(workflowDefinitionContract.published, client), enabled: pending || canCreate });
}

/** 待办总数 + 抄送未读数（Tab 角标），30s 轮询 */
export function useApprovalCounts() {
  return useQuery({
    queryKey: approvalKeys.counts,
    queryFn: async () => {
      const summary = await api(workflowInstanceContract.workbenchSummary, silentClient);
      return { ...summary, drafts: summary.myDrafts };
    },
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useApprovalNotifications(enabled: boolean) {
  return useQuery<{ list: InAppMessage[]; total: number }>({
    queryKey: approvalKeys.notifications,
    queryFn: () => api(inAppMessageContract.list, { query: { page: 1, pageSize: 20 } }, silentClient),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useApprovalNotificationUnreadCount() {
  return useQuery({
    queryKey: approvalKeys.notificationUnread,
    queryFn: () => api(inAppMessageContract.unreadCount, silentClient),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useMarkApprovalNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(inAppMessageContract.markRead, { params: { id } }, silentClient),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: approvalKeys.notifications });
      void qc.invalidateQueries({ queryKey: approvalKeys.notificationUnread });
    },
  });
}

export function useApprovalDetail(id: number | null) {
  return useQuery({
    queryKey: approvalKeys.detail(id),
    queryFn: () => api(workflowInstanceContract.detail, { params: { id: id as number } }, client),
    enabled: id != null,
  });
}

export function useApprovalDraftEditor(id: number | null) {
  return useQuery({ queryKey: ['approval', 'draft-editor', id], queryFn: () => api(workflowInstanceContract.draftEditor, { params: { id: id as number } }, client), enabled: id != null, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false });
}

export function useResubmitApprovalInstance() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => api(workflowInstanceContract.resubmit, { params: { id } }, client), onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }) });
}

export function useApprovalMe() {
  return useQuery({
    queryKey: approvalKeys.me,
    queryFn: () => api(authContract.me, silentClient),
    retry: false,
  });
}

/** 移动审批端暴露的任务动作：同意 / 驳回 / 转办，与后台面板共用同一映射 */
export type ApprovalTaskActionVariables = WorkflowTaskActionVariables;

/** 同意 / 驳回 / 转办：幂等键按动作 + 任务生成，防止弱网下的重复提交 */
export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ApprovalTaskActionVariables) =>
      runWorkflowTaskAction(vars, { ...client, headers: { 'X-Idempotency-Key': `approval-${vars.action}-${vars.taskId}-${crypto.randomUUID()}` } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

export function useApprovalCollaboration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (command: { action: 'reduce'; groupId: number; slotIds: number[] } | { action: 'consult'; taskId: number; userIds: number[]; question: string } | { action: 'reply'; id: number; opinion: string } | { action: 'recall'; taskId: number } | { action: 'forward'; instanceId: number; userIds: number[]; note: string }) => {
      switch (command.action) {
        case 'reduce': return api(workflowTaskContract.reduceSign, { params: { groupId: command.groupId }, body: { targetSlotIds: command.slotIds } }, client);
        case 'consult': return api(workflowTaskContract.consult, { params: { taskId: command.taskId }, body: { consulteeIds: command.userIds, question: command.question } }, client);
        case 'reply': return api(workflowTaskContract.replyConsult, { params: { id: command.id }, body: { opinion: command.opinion } }, client);
        case 'recall': return api(workflowTaskContract.recall, { params: { taskId: command.taskId }, body: {} }, client);
        case 'forward': return api(workflowInstanceContract.forward, { params: { id: command.instanceId }, body: { userIds: command.userIds, note: command.note } }, client);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

/** 批量同意沿用审批端客户端，逐任务结果由服务端返回；共享确认意图的幂等处理。 */
export function useBatchApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BodyOf<typeof workflowTaskContract.batchApprove>) => runWorkflowBatchApprove(body, client),
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
    mutationFn: ({ instanceId, content, mentions = [], attachments = [], parentId = null }: {
      instanceId: number;
      content: string;
      mentions?: number[];
      attachments?: Array<{ fileId: string }>;
      parentId?: number | null;
    }) => api(workflowInstanceContract.addComment, { params: { id: instanceId }, body: { content, mentions, attachments, parentId } }, client),
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

export function useUpdateApprovalDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: BodyOf<typeof workflowInstanceContract.updateDraft> }) =>
      api(workflowInstanceContract.updateDraft, { params: { id }, body }, client),
    onSuccess: (saved, vars) => {
      // 编辑器包含版本信息，不整块失效重挂表单；同步已保存实例，避免再次编辑携带旧 revision。
      qc.setQueryData(['approval', 'draft-editor', vars.id], (previous: OutputOf<typeof workflowInstanceContract.draftEditor> | undefined) => previous ? { ...previous, instance: saved } : previous);
      void qc.invalidateQueries({ queryKey: approvalKeys.lists });
      void qc.invalidateQueries({ queryKey: approvalKeys.counts });
      void qc.invalidateQueries({ queryKey: approvalKeys.detail(vars.id) });
    },
  });
}

export function useSubmitApprovalDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & BodyOf<typeof workflowInstanceContract.submitDraft>) =>
      api(workflowInstanceContract.submitDraft, { params: { id }, body }, client),
    onSuccess: (_saved, vars) => { void qc.invalidateQueries({ queryKey: approvalKeys.lists }); void qc.invalidateQueries({ queryKey: approvalKeys.counts }); void qc.invalidateQueries({ queryKey: approvalKeys.detail(vars.id) }); qc.removeQueries({ queryKey: ['approval', 'draft-editor', vars.id], exact: true }); },
  });
}

export function useDeleteApprovalInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(workflowInstanceContract.removeDraft, { params: { id } }, client),
    onSuccess: (_removed, _id) => {
      // 详情页仍挂载时不能移除 active query：TanStack Query 会让观察者
      // 重新创建该查询并回源，删除成功后随即得到「流程实例不存在」的 404。
      // 删除页在 mutation 完成后负责先离开详情，再移除缓存。
      void qc.invalidateQueries({ queryKey: approvalKeys.lists });
      void qc.invalidateQueries({ queryKey: approvalKeys.counts });
    },
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

/**
 * 审批时下游「自选下一审批人」节点分组（无则为空数组）。不传 `search` 取全部分组（每组限量）；
 * 传 `search` 只取该节点按关键词过滤后的候选，供 `truncated` 的组远程搜索。
 */
export function useSelectableNextApprovers(taskId: number | null, enabled: boolean, search?: { nodeKey: string; keyword: string }) {
  return useQuery({
    queryKey: approvalKeys.nextApprovers(taskId, search),
    queryFn: () => api(workflowTaskContract.selectableNextApprovers, {
      params: { taskId: taskId as number },
      query: search ? { nodeKey: search.nodeKey, keyword: search.keyword } : {},
    }, silentClient),
    enabled: enabled && taskId != null,
    placeholderData: search ? keepPreviousData : undefined,
  });
}

/** Bounded collaboration directory; picker searches on the server. */
export function useApprovalUsers(enabled: boolean, keyword = '') {
  const result = useQuery({
    queryKey: [...approvalKeys.users, keyword],
    queryFn: () => api(workflowInstanceContract.searchUsers, { query: { page: 1, pageSize: 50, keyword: keyword || undefined } }, silentClient),
    enabled,
    staleTime: 5 * 60_000,
  });
  return { data: result.data?.list, isLoading: result.isLoading, truncated: (result.data?.total ?? 0) > (result.data?.list.length ?? 0) };
}

export function useApprovalDelegations(enabled: boolean) {
  return useQuery<{ list: WorkflowDelegation[]; total: number }>({
    queryKey: approvalKeys.delegations,
    queryFn: () => api(workflowDelegationContract.list, { query: { page: 1, pageSize: 50, scope: 'mine' } }, silentClient),
    enabled,
    staleTime: 15_000,
  });
}

export function useCreateApprovalDelegation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BodyOf<typeof workflowDelegationContract.create>) => api(workflowDelegationContract.create, { body }, client),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: approvalKeys.delegations }); },
  });
}

export function useDeleteApprovalDelegation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(workflowDelegationContract.remove, { params: { id } }, client),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: approvalKeys.delegations }); },
  });
}

/** 连续审批：处理完一条后取下一条待办（排除当前实例），供详情页自动跳转 */
export async function fetchNextPendingTask(
  excludeTaskId: number,
  preferInstanceId?: number,
): Promise<{ next: { instanceId: number; taskId: number } | null; remaining: number }> {
  const data = await api(workflowInstanceContract.pendingMine, { query: { page: 1, pageSize: 20 } }, silentClient);
  const item = data.list.find((i) => i.id === preferInstanceId && i.pendingTaskId !== excludeTaskId)
    ?? data.list.find((i) => i.pendingTaskId !== excludeTaskId && i.pendingTaskId != null);
  return {
    next: item?.pendingTaskId != null ? { instanceId: item.id, taskId: item.pendingTaskId } : null,
    remaining: data.total,
  };
}

/** 审批单 PDF（与后台同一份文件：有归档件返回归档件，否则实时渲染），供移动端分享 / 保存 */
export async function fetchApprovalPrintPdf(instanceId: number): Promise<{ blob: Blob; filename: string }> {
  const res = await approvalRequest.fetchRaw(urlOf(workflowInstanceContract.print, { params: { id: instanceId }, query: {} }));
  if (!res) throw new Error('审批单生成失败');
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `审批单生成失败（HTTP ${res.status}）`);
  }
  const match = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), filename: match ? decodeURIComponent(match[1]) : `审批单-${instanceId}.pdf` };
}
