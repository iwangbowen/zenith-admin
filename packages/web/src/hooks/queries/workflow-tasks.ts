import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, InputOf, PaginatedResponse, QueryOf } from '@zenith/shared/core';
import { workflowInstanceContract, workflowTaskContract, type WorkflowBatchActionResponse, type WorkflowInstance, type WorkflowPendingInstanceItem, type WorkflowTask } from '@zenith/shared/workflow';
import { api, contractKey, useApiMutation, useApiQuery, type ApiCallOptions } from '@/lib/contract-query';
import { invalidateAfterInstanceChange, workflowInstanceKeys } from './workflow-instances';

/** 待办列表项：实例摘要 + 待我处理任务的 SLA / 摘要字段 */
export type PendingWorkflowItem = WorkflowPendingInstanceItem;

export type PendingWorkflowListParams = QueryOf<typeof workflowInstanceContract.pendingMine>;

export const workflowTaskKeys = {
  /** 待办列表全部分页 / 筛选条件的公共前缀 */
  pendingLists: contractKey(workflowInstanceContract.pendingMine),
  pendingList: (params: PendingWorkflowListParams) => contractKey(workflowInstanceContract.pendingMine, { query: params }),
  pendingCount: contractKey(workflowInstanceContract.pendingMineCount),
  consultsMine: contractKey(workflowTaskContract.myConsults),
};

export function fetchPendingWorkflowTasks(params: PendingWorkflowListParams) {
  return api(workflowInstanceContract.pendingMine, { query: params }, { silent: true });
}

export function usePendingWorkflowTasks(params: PendingWorkflowListParams) {
  return useApiQuery(workflowInstanceContract.pendingMine, { query: params }, { placeholderData: keepPreviousData });
}

export function useMyWorkflowConsults(enabled = true) {
  return useApiQuery(workflowTaskContract.myConsults, { query: { pageSize: 50 } }, { enabled });
}

/**
 * 待办侧查询：待办列表、待办计数、我的协办。任务被创建 / 完成 / 改派（含 WebSocket 推送）时回源；
 * 不碰实例列表与监控，那些由 invalidateAfterTaskAction 在动作成功后处理。
 */
export function invalidateWorkflowPendingViews(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: workflowTaskKeys.pendingLists });
  void qc.invalidateQueries({ queryKey: workflowTaskKeys.pendingCount });
  void qc.invalidateQueries({ queryKey: workflowTaskKeys.consultsMine });
}

/**
 * 任务动作（同意 / 驳回 / 转办 / 委派 / 加减签 / 退回 / 批量审批）成功后回源的查询。
 * 动作推进实例，影响面与实例状态变化一致：待办列表 + 计数、我的申请 / 已办 / 抄送、
 * 实例详情（含审批面板组合查询）、实例 / 任务监控、诊断 / 轨迹、作业账本等，见 invalidateAfterInstanceChange。
 * 审批面板关闭时（WorkflowApprovalDetailSheet.closeAfterAction）与详情面板的撤回已办都走这一入口，页面不要再自行拼前缀；
 * WebSocket 推送按事件粒度走 invalidateWorkflowPendingViews（任务创建 / 完成）与 invalidateAfterInstanceChange（实例结束）。
 */
export function invalidateAfterTaskAction(qc: QueryClient, instanceId?: number): void {
  invalidateAfterInstanceChange(qc, instanceId);
}

/** H5：幂等键按选中任务集合派生进请求头（重复点击同一批任务不会重复审批），契约未声明 headers 段 */
export function useBatchApproveWorkflowTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof workflowTaskContract.batchApprove>) =>
      api(workflowTaskContract.batchApprove, { body }, { headers: { 'X-Idempotency-Key': `workflow-batch-approve-${body.taskIds.join('-')}` } }),
    onSuccess: (res) => {
      removeSucceededFromPendingCaches(qc, res);
      invalidateAfterTaskAction(qc);
    },
  });
}

/** H5：同 useBatchApproveWorkflowTasks，幂等键按任务集合派生 */
export function useBatchRejectWorkflowTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof workflowTaskContract.batchReject>) =>
      api(workflowTaskContract.batchReject, { body }, { headers: { 'X-Idempotency-Key': `workflow-batch-reject-${body.taskIds.join('-')}` } }),
    onSuccess: (res) => {
      removeSucceededFromPendingCaches(qc, res);
      invalidateAfterTaskAction(qc);
    },
  });
}

/** 批量操作成功后：先把成功任务从各待办列表缓存即时移除（行立即消失），再由 invalidate 后台校准 */
function removeSucceededFromPendingCaches(qc: QueryClient, res: WorkflowBatchActionResponse): void {
  const okIds = new Set(res.results.filter((r) => r.success).map((r) => r.taskId));
  if (okIds.size === 0) return;
  qc.setQueriesData<PaginatedResponse<PendingWorkflowItem>>({ queryKey: workflowTaskKeys.pendingLists }, (old) => {
    if (!old) return old;
    const list = old.list.filter((it) => !okIds.has(it.pendingTaskId));
    if (list.length === old.list.length) return old;
    return { ...old, list, total: Math.max(0, old.total - (old.list.length - list.length)) };
  });
}

/** 协办不改变实例 / 任务状态：只有实例详情里的协办意见与被邀请人的「我的协办」变化（任务所属实例未知，按详情前缀失效） */
const invalidateConsults = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowInstanceKeys.details });
  void qc.invalidateQueries({ queryKey: workflowTaskKeys.consultsMine });
};

export function useConsultWorkflowTask() {
  return useApiMutation(workflowTaskContract.consult, { invalidate: invalidateConsults });
}

export function useReplyWorkflowConsult() {
  return useApiMutation(workflowTaskContract.replyConsult, { invalidate: invalidateConsults });
}

/** 同意 / 驳回 / 转办三个基础决策动作（移动审批端只暴露这三个） */
export type WorkflowTaskDecisionVariables =
  | { taskId: number; action: 'approve'; body: BodyOf<typeof workflowTaskContract.approve> }
  | { taskId: number; action: 'reject'; body: BodyOf<typeof workflowTaskContract.reject> }
  | { taskId: number; action: 'transfer'; body: BodyOf<typeof workflowTaskContract.transfer> };

/** 审批详情面板的单任务动作：动作名即幂等键前缀，body 形状由对应契约推导 */
export type WorkflowTaskActionVariables =
  | WorkflowTaskDecisionVariables
  | { taskId: number; action: 'delegate'; body: BodyOf<typeof workflowTaskContract.delegate> }
  | { taskId: number; action: 'add-sign'; body: BodyOf<typeof workflowTaskContract.addSign> }
  | { taskId: number; action: 'reduce-sign'; body: BodyOf<typeof workflowTaskContract.reduceSign> }
  | { taskId: number; action: 'return'; body: BodyOf<typeof workflowTaskContract.returnTask> };

/**
 * 单任务动作 → 契约调用的唯一映射；后台审批面板与移动审批端共用，
 * 幂等键前缀与请求实例（会话语义）由调用方经 `options` 传入。
 */
export function runWorkflowTaskAction(vars: WorkflowTaskDecisionVariables, options?: ApiCallOptions): Promise<WorkflowInstance | WorkflowTask>;
export function runWorkflowTaskAction(vars: WorkflowTaskActionVariables, options?: ApiCallOptions): Promise<unknown>;
export function runWorkflowTaskAction(vars: WorkflowTaskActionVariables, options?: ApiCallOptions): Promise<unknown> {
  const params = { taskId: vars.taskId };
  switch (vars.action) {
    case 'approve':
      return api(workflowTaskContract.approve, { params, body: vars.body }, options);
    case 'reject':
      return api(workflowTaskContract.reject, { params, body: vars.body }, options);
    case 'transfer':
      return api(workflowTaskContract.transfer, { params, body: vars.body }, options);
    case 'delegate':
      return api(workflowTaskContract.delegate, { params, body: vars.body }, options);
    case 'add-sign':
      return api(workflowTaskContract.addSign, { params, body: vars.body }, options);
    case 'reduce-sign':
      return api(workflowTaskContract.reduceSign, { params, body: vars.body }, options);
    case 'return':
      return api(workflowTaskContract.returnTask, { params, body: vars.body }, options);
  }
}

/**
 * H5：按动作分发到七个契约操作，且幂等键按「动作 + 任务」派生进请求头（契约未声明 headers 段）。
 * 缓存失效由审批面板在动作完成关闭时统一走 invalidateAfterTaskAction（面板内连续动作只回源一次）。
 */
export function useWorkflowTaskAction() {
  return useMutation({
    mutationFn: (vars: WorkflowTaskActionVariables) =>
      runWorkflowTaskAction(vars, { headers: { 'X-Idempotency-Key': `workflow-${vars.action}-${vars.taskId}` } }),
  });
}
