// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InputOf, QueryOf } from '@zenith/shared/core';
import {
  workflowDefinitionContract,
  workflowEngineContract,
  workflowInstanceContract,
  workflowInstanceOpsContract,
  workflowTaskContract,
  type WorkflowJobClusterDimension,
  type WorkflowJobFailureCluster,
  type WorkflowJobFailureClusterMember,
  type WorkflowJobDetail,
  type WorkflowJobReplayResult,
  type WorkflowJobRuntimeStatus,
} from '@zenith/shared/workflow';
import { api, apiQueryOptions, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateAfterInstanceChange, workflowInstanceKeys } from './workflow-instances';
import { workflowDelegationKeys } from './workflow-delegations';

export type WorkflowMonitorListParams = QueryOf<typeof workflowInstanceContract.monitor>;

export type WorkflowJobListParams = QueryOf<typeof workflowEngineContract.jobs>;

export type WorkflowTaskMonitorParams = QueryOf<typeof workflowTaskContract.taskMonitor>;

export type WorkflowCompensationListParams = QueryOf<typeof workflowInstanceOpsContract.compensations>;

export type { WorkflowJobDetail, WorkflowJobReplayResult, WorkflowJobRuntimeStatus };

export type FailureCluster = WorkflowJobFailureCluster;

export type FailureClusterJob = WorkflowJobFailureClusterMember;

export interface WorkflowEngineDiagnosticsParams {
  thresholdMinutes: number;
  historyHours: number;
}

/** 超时预警固定取前 50 条（预警列表不分页） */
const OVERDUE_PAGE_SIZE = 50;

export const workflowMonitorKeys = {
  monitorLists: contractKey(workflowInstanceContract.monitor),
  monitorList: (params: WorkflowMonitorListParams) => contractKey(workflowInstanceContract.monitor, { query: params }),
  taskMonitorLists: contractKey(workflowTaskContract.taskMonitor),
  taskMonitorList: (params: WorkflowTaskMonitorParams) => contractKey(workflowTaskContract.taskMonitor, { query: params }),
  /** 监控视角的实例详情与「我的申请」等处的详情是同一份缓存（同一契约操作） */
  monitorDetail: (id: number) => workflowInstanceKeys.detail(id),
  /** 已发布定义下拉：与 workflowDefinitionKeys.published 同一份缓存，发布后由定义域失效 */
  definitionsOptions: contractKey(workflowDefinitionContract.published),
  definitionDetail: (id: number) => contractKey(workflowDefinitionContract.detail, { params: { id } }),
  diagnostics: (id: number) => contractKey(workflowInstanceOpsContract.diagnostics, { params: { id } }),
  trace: (id: number) => contractKey(workflowInstanceOpsContract.trace, { params: { id } }),
  analytics: (definitionId: number | undefined) => contractKey(workflowInstanceContract.analytics, { query: { definitionId } }),
  overdue: (definitionId: number | undefined) =>
    contractKey(workflowInstanceContract.overdue, { query: { pageSize: OVERDUE_PAGE_SIZE, definitionId } }),
  jobLists: contractKey(workflowEngineContract.jobs),
  jobList: (params: WorkflowJobListParams) => contractKey(workflowEngineContract.jobs, { query: params }),
  jobDetails: contractKey(workflowEngineContract.jobDetail),
  jobDetail: (id: number) => contractKey(workflowEngineContract.jobDetail, { params: { id } }),
  jobChains: contractKey(workflowEngineContract.jobChain),
  jobChain: (traceId: string) => contractKey(workflowEngineContract.jobChain, { params: { traceId } }),
  jobRuntimeStatus: contractKey(workflowEngineContract.jobRuntimeStatus),
  jobSummary: contractKey(workflowEngineContract.jobsSummary),
  jobFailureClusterLists: contractKey(workflowEngineContract.failureClusters),
  jobFailureClusters: (dimension: WorkflowJobClusterDimension | undefined) =>
    contractKey(workflowEngineContract.failureClusters, { query: { dimension } }),
  compensationLists: contractKey(workflowInstanceOpsContract.compensations),
  compensationList: (params: WorkflowCompensationListParams) => contractKey(workflowInstanceOpsContract.compensations, { query: params }),
  compensationDetails: contractKey(workflowInstanceOpsContract.compensationDetail),
  compensationDetail: (id: number) => contractKey(workflowInstanceOpsContract.compensationDetail, { params: { id } }),
  /** 引擎诊断是 introspection + healthHistory 的组合查询，挂在 introspection 前缀之下 */
  engineDiagnosticsAll: contractKey(workflowEngineContract.introspection),
  engineDiagnostics: (params: WorkflowEngineDiagnosticsParams) =>
    [...contractKey(workflowEngineContract.introspection), 'with-history', params] as const,
};

export function useWorkflowMonitorList(params: WorkflowMonitorListParams) {
  return useApiQuery(workflowInstanceContract.monitor, { query: params }, { placeholderData: keepPreviousData });
}

export function useWorkflowTaskMonitorList(params: WorkflowTaskMonitorParams) {
  return useApiQuery(workflowTaskContract.taskMonitor, { query: params }, { placeholderData: keepPreviousData });
}

/** 监控视角的实例详情 queryOptions（供 fetchQuery 命令式取数） */
export function workflowMonitorInstanceDetailQuery(id: number) {
  return apiQueryOptions(workflowInstanceContract.detail, { params: { id } });
}

export function useWorkflowInstanceDetail(id: number | undefined, enabled = true) {
  return useApiQuery(workflowInstanceContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function workflowMonitorDefinitionDetailQuery(id: number, options?: { silent?: boolean }) {
  return apiQueryOptions(workflowDefinitionContract.detail, { params: { id } }, { requestOptions: { silent: options?.silent } });
}

export function useWorkflowDefinitionDetail(id: number | undefined, enabled = true, options?: { silent?: boolean }) {
  return useQuery({
    ...workflowMonitorDefinitionDetailQuery(id ?? 0, options),
    enabled: enabled && id !== undefined,
  });
}

/** 已发布定义下拉（数据分析筛选 / 强制跳转节点选择 / 批量恢复） */
export function useWorkflowMonitorDefinitionOptions(enabled = true) {
  return useApiQuery(workflowDefinitionContract.published, { enabled });
}

export function useWorkflowRuntimeDiagnostics(id: number | undefined, enabled = true) {
  return useApiQuery(workflowInstanceOpsContract.diagnostics, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useWorkflowInstanceTrace(instanceId: number, enabled = true) {
  return useApiQuery(workflowInstanceOpsContract.trace, { params: { id: instanceId } }, { enabled });
}

/** 导出实例诊断包（诊断 + 轨迹 + 执行 Token），供页面另存为 JSON */
export function fetchWorkflowDiagnosticBundle(instanceId: number) {
  return api(workflowInstanceOpsContract.diagnosticBundle, { params: { id: instanceId } });
}

/** traceId 诊断包（作业链路 + 涉及实例诊断聚合） */
export function fetchWorkflowTraceDiagnosticBundle(traceId: string) {
  return api(workflowEngineContract.jobChainBundle, { params: { traceId } });
}

export function useWorkflowAnalytics(definitionId: number | undefined) {
  return useApiQuery(workflowInstanceContract.analytics, { query: { definitionId } });
}

export function useWorkflowOverdueTasks(definitionId: number | undefined) {
  return useApiQuery(workflowInstanceContract.overdue, { query: { pageSize: OVERDUE_PAGE_SIZE, definitionId } });
}

export function useWorkflowJobList(params: WorkflowJobListParams) {
  return useApiQuery(workflowEngineContract.jobs, { query: params }, { placeholderData: keepPreviousData });
}

export function useWorkflowJobDetail(id: number | undefined, enabled = true) {
  return useApiQuery(workflowEngineContract.jobDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useWorkflowJobChain(traceId: string | undefined, enabled = true) {
  return useApiQuery(workflowEngineContract.jobChain, { params: { traceId: traceId ?? '' } }, { enabled: enabled && !!traceId });
}

export function useWorkflowJobRuntimeStatus() {
  return useApiQuery(workflowEngineContract.jobRuntimeStatus);
}

export function useWorkflowJobSummary() {
  return useApiQuery(workflowEngineContract.jobsSummary);
}

export function useWorkflowJobFailureClusters(dimension: WorkflowJobClusterDimension | undefined, enabled = true) {
  return useApiQuery(workflowEngineContract.failureClusters, { query: { dimension } }, { enabled: enabled && !!dimension });
}

export function useWorkflowCompensationList(params: WorkflowCompensationListParams) {
  return useApiQuery(workflowInstanceOpsContract.compensations, { query: params }, { placeholderData: keepPreviousData });
}

export function useWorkflowCompensationDetail(id: number | undefined, enabled = true) {
  return useApiQuery(workflowInstanceOpsContract.compensationDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** H5：queryFn 组合两次请求（引擎内省 + 健康趋势）并附带取数时间戳 */
export function useWorkflowEngineDiagnostics(params: WorkflowEngineDiagnosticsParams, refetchInterval: number | false) {
  return useQuery({
    queryKey: workflowMonitorKeys.engineDiagnostics(params),
    queryFn: async () => {
      const [introspection, history] = await Promise.all([
        api(workflowEngineContract.introspection, { query: { thresholdMinutes: params.thresholdMinutes } }),
        api(workflowEngineContract.healthHistory, { query: { hours: params.historyHours } }),
      ]);
      return { introspection, history, fetchedAt: Date.now() };
    },
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

// ─── 实例状态变更（管理员） ───

/**
 * 管理员干预（取消 / 挂起 / 恢复 / 跳转 / 改派 / 迁移 / Token 恢复）改变实例与任务状态，
 * 影响面与用户侧实例状态变化一致（监控列表与统计卡、任务监控、详情 / 诊断 / 轨迹、作业账本、
 * 当事人的待办 / 我的申请 / 已办 / 抄送），统一走实例域 helper；已发布定义下拉与定义详情不受影响。
 */
const invalidateInstanceRuntime = (qc: QueryClient, instanceId?: number) => invalidateAfterInstanceChange(qc, instanceId);

export function useCancelWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.cancel, {
    invalidate: (qc, _saved, { params }) => invalidateInstanceRuntime(qc, params.id),
  });
}

export function useSuspendWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.suspend, {
    invalidate: (qc, _saved, { params }) => invalidateInstanceRuntime(qc, params.id),
  });
}

export function useResumeWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.resume, {
    invalidate: (qc, _saved, { params }) => invalidateInstanceRuntime(qc, params.id),
  });
}

export function useMigrateWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.migrate, {
    invalidate: (qc, _output, { params }) => {
      invalidateInstanceRuntime(qc, params.id);
      // 迁移记录与预检结果随版本变化
      void qc.invalidateQueries({ queryKey: contractKey(workflowInstanceOpsContract.migrations, { params: { id: params.id } }) });
    },
  });
}

export function useDeleteWorkflowInstanceAsAdmin() {
  return useApiMutation(workflowInstanceContract.remove, {
    invalidate: (qc, _output, { params }) => {
      // 实体已不存在：移除详情（含组合查询）而非失效
      qc.removeQueries({ queryKey: workflowInstanceKeys.detail(params.id) });
      invalidateInstanceRuntime(qc, params.id);
    },
  });
}

export function useJumpWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.jump, {
    invalidate: (qc, _saved, { params }) => invalidateInstanceRuntime(qc, params.id),
  });
}

/** 改派只知道任务 ID，所属实例的详情 / 诊断按前缀整组失效 */
export function useReassignWorkflowTask() {
  return useApiMutation(workflowTaskContract.reassign, {
    invalidate: (qc) => invalidateInstanceRuntime(qc),
  });
}

/** Token 运营恢复：跳过卡死的执行 Token（响应为所属实例最新状态） */
export function useSkipWorkflowToken() {
  return useApiMutation(workflowInstanceOpsContract.skipToken, {
    invalidate: (qc, instance) => invalidateInstanceRuntime(qc, instance.id),
  });
}

/** Token 运营恢复：从执行 Token 节点重放流程 */
export function useReplayWorkflowToken() {
  return useApiMutation(workflowInstanceOpsContract.replayToken, {
    invalidate: (qc, instance) => invalidateInstanceRuntime(qc, instance.id),
  });
}

/** 迁移预检：只读诊断，结果只在确认弹窗内展示，不进入缓存 */
export function useWorkflowMigratePreflight() {
  return useApiMutation(workflowInstanceOpsContract.migratePreflight);
}

// ─── 作业账本 ───

/**
 * 作业重试 / 跳过 / 死信重放只改变作业子树：列表、详情、链路、按类型汇总、失败聚类都读作业状态，
 * 运行状态的派生指标（积压 / 死信数）随之变化；流程定义下拉、实例监控列表不受影响。
 */
export function invalidateWorkflowJobs(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobLists });
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobDetails });
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobChains });
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobSummary });
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobFailureClusterLists });
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobRuntimeStatus });
}

export function useBatchRetryWorkflowJobs() {
  return useApiMutation(workflowEngineContract.batchRetryJobs, { invalidate: invalidateWorkflowJobs });
}

export function useBatchSkipWorkflowJobs() {
  return useApiMutation(workflowEngineContract.batchSkipJobs, { invalidate: invalidateWorkflowJobs });
}

export function useRetryWorkflowJob() {
  return useApiMutation(workflowEngineContract.retryJob, { invalidate: invalidateWorkflowJobs });
}

export function useSkipWorkflowJob() {
  return useApiMutation(workflowEngineContract.skipJob, { invalidate: invalidateWorkflowJobs });
}

export function useWorkflowJobReplayPreview() {
  return useApiMutation(workflowEngineContract.replayPreview);
}

export function useWorkflowJobReplayDead() {
  return useApiMutation(workflowEngineContract.replayDeadJobs, { invalidate: invalidateWorkflowJobs });
}

// ─── 补偿工单 ───

/** 处理 / 备注只改工单本身：列表（状态列）与该工单详情（处理历史） */
const invalidateCompensation = (qc: QueryClient, id: number) => {
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.compensationLists });
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.compensationDetail(id) });
};

export function useResolveWorkflowCompensation() {
  return useApiMutation(workflowInstanceOpsContract.resolveCompensation, {
    // 处理动作可能推进 / 终止所属实例
    invalidate: (qc, saved, { params }) => {
      invalidateCompensation(qc, params.id);
      invalidateInstanceRuntime(qc, saved.instanceId);
    },
  });
}

export function useAddWorkflowCompensationNote() {
  return useApiMutation(workflowInstanceOpsContract.addCompensationNote, {
    invalidate: (qc, _saved, { params }) => invalidateCompensation(qc, params.id),
  });
}

export function useRetryWorkflowCompensation() {
  return useApiMutation(workflowInstanceOpsContract.retryCompensation, {
    // 重试自动反向动作会重新入队作业
    invalidate: (qc, saved, { params }) => {
      invalidateCompensation(qc, params.id);
      invalidateWorkflowJobs(qc);
      invalidateInstanceRuntime(qc, saved.instanceId);
    },
  });
}

export function useResumeWorkflowCompensation() {
  return useApiMutation(workflowInstanceOpsContract.resumeCompensation, {
    // 恢复后所属实例继续推进
    invalidate: (qc, saved, { params }) => {
      invalidateCompensation(qc, params.id);
      invalidateInstanceRuntime(qc, saved.instanceId);
    },
  });
}

// ─── 引擎运维 ───

export function useWorkflowEngineActionPreview() {
  return useApiMutation(workflowEngineContract.previewAction);
}

/**
 * 引擎维护动作（清理僵死实例、重投事件等）：影响面横跨实例与作业（实例域 helper 已含作业列表 / 汇总），
 * 作业详情 / 链路 / 聚类 / 运行状态另行补齐；不涉及流程定义下拉。
 */
export function useWorkflowEngineAction() {
  return useApiMutation(workflowEngineContract.runAction, {
    invalidate: (qc) => {
      invalidateInstanceRuntime(qc);
      invalidateWorkflowJobs(qc);
    },
  });
}

export function useWorkflowBatchRecovery() {
  return useApiMutation(workflowInstanceOpsContract.batchSkipStuck, {
    invalidate: (qc) => {
      invalidateInstanceRuntime(qc);
      invalidateWorkflowJobs(qc);
    },
  });
}

/** 交接影响范围预览：只读，结果只在向导内展示，不进入缓存 */
export function useWorkflowHandoverPreview() {
  return useApiMutation(workflowTaskContract.handoverPreview);
}

/**
 * 离职交接：批量移交待办，幂等键按交接双方派生进请求头（H5：契约未声明 headers 段，无法经 useApiMutation 传入）。
 * 交接改写任务归属：当事双方的待办、实例详情、任务监控回源；勾选「同时停用代理」时代理规则列表也变。
 */
export function useWorkflowHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof workflowTaskContract.handover>) =>
      api(workflowTaskContract.handover, { body }, { headers: { 'X-Idempotency-Key': `workflow-handover-${body.fromUserId}-${body.toUserId}` } }),
    onSuccess: (_result, { body }) => {
      invalidateInstanceRuntime(qc);
      if (body.disableDelegations) void qc.invalidateQueries({ queryKey: workflowDelegationKeys.lists });
    },
  });
}
