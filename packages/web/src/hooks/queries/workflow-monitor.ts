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
import { api, useApiMutation } from '@/lib/contract-query';

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

export const workflowMonitorKeys = {
  all: ['workflow'] as const,
  monitor: ['workflow', 'monitor'] as const,
  monitorLists: ['workflow', 'monitor', 'list'] as const,
  monitorList: (params: WorkflowMonitorListParams) => ['workflow', 'monitor', 'list', params] as const,
  taskMonitorLists: ['workflow', 'monitor', 'tasks'] as const,
  taskMonitorList: (params: WorkflowTaskMonitorParams) => ['workflow', 'monitor', 'tasks', params] as const,
  monitorDetail: (id: number | undefined) => ['workflow', 'monitor', 'detail', id] as const,
  definitionsOptions: ['workflow', 'definitions', 'options'] as const,
  definitionDetail: (id: number | undefined) => ['workflow', 'definitions', 'detail', id] as const,
  diagnostics: (id: number | undefined) => ['workflow', 'monitor', 'diagnostics', id] as const,
  trace: (id: number | undefined) => ['workflow', 'monitor', 'trace', id] as const,
  analytics: (definitionId: number | undefined) => ['workflow', 'monitor', 'analytics', definitionId] as const,
  overdue: (definitionId: number | undefined) => ['workflow', 'monitor', 'overdue', definitionId] as const,
  jobs: ['workflow', 'jobs'] as const,
  jobLists: ['workflow', 'jobs', 'list'] as const,
  jobList: (params: WorkflowJobListParams) => ['workflow', 'jobs', 'list', params] as const,
  jobDetail: (id: number | undefined) => ['workflow', 'jobs', 'detail', id] as const,
  jobChain: (traceId: string | undefined) => ['workflow', 'jobs', 'chain', traceId] as const,
  jobRuntimeStatus: ['workflow', 'jobs', 'runtime-status'] as const,
  jobSummary: ['workflow', 'jobs', 'summary'] as const,
  jobFailureClusters: (dimension: string | undefined) => ['workflow', 'jobs', 'failure-clusters', dimension] as const,
  compensations: ['workflow', 'monitor', 'compensations'] as const,
  compensationLists: ['workflow', 'monitor', 'compensations', 'list'] as const,
  compensationList: (params: WorkflowCompensationListParams) => ['workflow', 'monitor', 'compensations', 'list', params] as const,
  compensationDetail: (id: number | undefined) => ['workflow', 'monitor', 'compensations', 'detail', id] as const,
  engine: ['workflow', 'monitor', 'engine'] as const,
  engineDiagnostics: (params: WorkflowEngineDiagnosticsParams) => ['workflow', 'monitor', 'engine', 'diagnostics', params] as const,
};

export function useWorkflowMonitorList(params: WorkflowMonitorListParams) {
  return useQuery({
    queryKey: workflowMonitorKeys.monitorList(params),
    queryFn: () => api(workflowInstanceContract.monitor, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowTaskMonitorList(params: WorkflowTaskMonitorParams) {
  return useQuery({
    queryKey: workflowMonitorKeys.taskMonitorList(params),
    queryFn: () => api(workflowTaskContract.taskMonitor, { query: params }),
    placeholderData: keepPreviousData,
  });
}

/** 监控视角的实例详情 queryOptions（供 fetchQuery 命令式取数） */
export function workflowMonitorInstanceDetailQuery(id: number) {
  return {
    queryKey: workflowMonitorKeys.monitorDetail(id),
    queryFn: () => api(workflowInstanceContract.detail, { params: { id } }),
  };
}

export function useWorkflowInstanceDetail(id: number | undefined, enabled = true) {
  return useQuery({
    ...workflowMonitorInstanceDetailQuery(id ?? 0),
    queryKey: workflowMonitorKeys.monitorDetail(id),
    enabled: enabled && id !== undefined,
  });
}

export function workflowMonitorDefinitionDetailQuery(id: number, options?: { silent?: boolean }) {
  return {
    queryKey: workflowMonitorKeys.definitionDetail(id),
    queryFn: () => api(workflowDefinitionContract.detail, { params: { id } }, { silent: options?.silent }),
  };
}

export function useWorkflowDefinitionDetail(id: number | undefined, enabled = true, options?: { silent?: boolean }) {
  return useQuery({
    ...workflowMonitorDefinitionDetailQuery(id ?? 0, options),
    queryKey: workflowMonitorKeys.definitionDetail(id),
    enabled: enabled && id !== undefined,
  });
}

/** 已发布定义下拉（数据分析筛选 / 强制跳转节点选择 / 批量恢复），与定义子树共享失效前缀 */
export function useWorkflowMonitorDefinitionOptions(enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.definitionsOptions,
    queryFn: () => api(workflowDefinitionContract.published),
    enabled,
  });
}

export function useWorkflowRuntimeDiagnostics(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.diagnostics(id),
    queryFn: () => api(workflowInstanceOpsContract.diagnostics, { params: { id: id as number } }),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowInstanceTrace(instanceId: number, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.trace(instanceId),
    queryFn: () => api(workflowInstanceOpsContract.trace, { params: { id: instanceId } }),
    enabled,
  });
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
  return useQuery({
    queryKey: workflowMonitorKeys.analytics(definitionId),
    queryFn: () => api(workflowInstanceContract.analytics, { query: { definitionId } }),
  });
}

export function useWorkflowOverdueTasks(definitionId: number | undefined) {
  return useQuery({
    queryKey: workflowMonitorKeys.overdue(definitionId),
    queryFn: () => api(workflowInstanceContract.overdue, { query: { pageSize: 50, definitionId } }),
  });
}

export function useWorkflowJobList(params: WorkflowJobListParams) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobList(params),
    queryFn: () => api(workflowEngineContract.jobs, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowJobDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobDetail(id),
    queryFn: () => api(workflowEngineContract.jobDetail, { params: { id: id as number } }),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowJobChain(traceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobChain(traceId),
    queryFn: () => api(workflowEngineContract.jobChain, { params: { traceId: traceId ?? '' } }),
    enabled: enabled && !!traceId,
  });
}

export function useWorkflowJobRuntimeStatus() {
  return useQuery({
    queryKey: workflowMonitorKeys.jobRuntimeStatus,
    queryFn: () => api(workflowEngineContract.jobRuntimeStatus),
  });
}

export function useWorkflowJobSummary() {
  return useQuery({
    queryKey: workflowMonitorKeys.jobSummary,
    queryFn: () => api(workflowEngineContract.jobsSummary),
  });
}

export function useWorkflowJobFailureClusters(dimension: WorkflowJobClusterDimension | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobFailureClusters(dimension),
    queryFn: () => api(workflowEngineContract.failureClusters, { query: { dimension } }),
    enabled: enabled && !!dimension,
  });
}

export function useWorkflowCompensationList(params: WorkflowCompensationListParams) {
  return useQuery({
    queryKey: workflowMonitorKeys.compensationList(params),
    queryFn: () => api(workflowInstanceOpsContract.compensations, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowCompensationDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.compensationDetail(id),
    queryFn: () => api(workflowInstanceOpsContract.compensationDetail, { params: { id: id as number } }),
    enabled: enabled && id !== undefined,
  });
}

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

// ─── 实例状态变更（管理员）：无法从入参反推受影响的列表，故失效整个监控子树；作业、补偿、引擎诊断不受影响 ───

const invalidateMonitor = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.monitor });
};

export function useCancelWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.cancel, { invalidate: invalidateMonitor });
}

export function useSuspendWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.suspend, { invalidate: invalidateMonitor });
}

export function useResumeWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.resume, { invalidate: invalidateMonitor });
}

export function useMigrateWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.migrate, { invalidate: invalidateMonitor });
}

export function useDeleteWorkflowInstanceAsAdmin() {
  return useApiMutation(workflowInstanceContract.remove, { invalidate: invalidateMonitor });
}

export function useJumpWorkflowInstance() {
  return useApiMutation(workflowInstanceOpsContract.jump, { invalidate: invalidateMonitor });
}

export function useReassignWorkflowTask() {
  return useApiMutation(workflowTaskContract.reassign, { invalidate: invalidateMonitor });
}

/** Token 运营恢复操作（跳过卡死 / 从节点重放） */
export function useWorkflowTokenOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ op, ...input }: InputOf<typeof workflowInstanceOpsContract.skipToken> & { op: 'skip' | 'replay' }) =>
      api(op === 'skip' ? workflowInstanceOpsContract.skipToken : workflowInstanceOpsContract.replayToken, input),
    onSuccess: () => invalidateMonitor(qc),
  });
}

export function useWorkflowMigratePreflight() {
  return useMutation({
    mutationFn: (id: number) => api(workflowInstanceOpsContract.migratePreflight, { params: { id } }),
  });
}

// ─── 作业账本：作业重试 / 跳过只改变作业子树；流程定义下拉、实例监控列表不受影响 ───

const invalidateJobs = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.jobs });
};

export function useWorkflowJobBatchMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: 'retry' | 'skip'; ids: number[] }) =>
      action === 'retry'
        ? api(workflowEngineContract.batchRetryJobs, { body: { ids } })
        : api(workflowEngineContract.batchSkipJobs, { body: { ids } }),
    onSuccess: () => invalidateJobs(qc),
  });
}

export function useWorkflowJobActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'retry' | 'skip' }) =>
      action === 'retry'
        ? api(workflowEngineContract.retryJob, { params: { id }, body: {} })
        : api(workflowEngineContract.skipJob, { params: { id } }),
    onSuccess: () => invalidateJobs(qc),
  });
}

export function useWorkflowJobReplayPreview() {
  return useApiMutation(workflowEngineContract.replayPreview);
}

export function useWorkflowJobReplayDead() {
  return useApiMutation(workflowEngineContract.replayDeadJobs, { invalidate: invalidateJobs });
}

// ─── 补偿工单：处理只影响补偿子树 ───

const invalidateCompensations = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowMonitorKeys.compensations });
};

export type WorkflowCompensationActionVariables =
  | { id: number; action: 'resolve'; body: InputOf<typeof workflowInstanceOpsContract.resolveCompensation>['body'] }
  | { id: number; action: 'note'; body: InputOf<typeof workflowInstanceOpsContract.addCompensationNote>['body'] }
  | { id: number; action: 'retry' | 'resume' };

export function useWorkflowCompensationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: WorkflowCompensationActionVariables) => {
      const params = { id: vars.id };
      switch (vars.action) {
        case 'resolve':
          return api(workflowInstanceOpsContract.resolveCompensation, { params, body: vars.body });
        case 'note':
          return api(workflowInstanceOpsContract.addCompensationNote, { params, body: vars.body });
        case 'retry':
          return api(workflowInstanceOpsContract.retryCompensation, { params });
        case 'resume':
          return api(workflowInstanceOpsContract.resumeCompensation, { params });
      }
    },
    onSuccess: () => invalidateCompensations(qc),
  });
}

// ─── 引擎运维 ───

export function useWorkflowEngineActionPreview() {
  return useApiMutation(workflowEngineContract.previewAction);
}

/**
 * 引擎维护动作（清理僵死实例、重投事件等）：影响面横跨实例与作业，
 * 但不涉及流程定义下拉，故失效监控与作业两棵子树。
 */
export function useWorkflowEngineAction() {
  return useApiMutation(workflowEngineContract.runAction, {
    invalidate: (qc) => {
      invalidateMonitor(qc);
      invalidateJobs(qc);
    },
  });
}

export function useWorkflowBatchRecovery() {
  return useApiMutation(workflowInstanceOpsContract.batchSkipStuck, {
    invalidate: (qc) => {
      invalidateMonitor(qc);
      invalidateJobs(qc);
    },
  });
}

export function useWorkflowHandoverPreview() {
  return useMutation({
    mutationFn: (fromUserId: number) => api(workflowTaskContract.handoverPreview, { query: { fromUserId } }),
  });
}

/** 幂等键按交接双方生成，重复提交同一对交接不会重复移交 */
export function useWorkflowHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof workflowTaskContract.handover>) =>
      api(workflowTaskContract.handover, { body }, { headers: { 'X-Idempotency-Key': `workflow-handover-${body.fromUserId}-${body.toUserId}` } }),
    onSuccess: () => {
      // 交接改写任务归属：任务列表、实例、监控视图都要回源；可选地停用委托
      void qc.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      void qc.invalidateQueries({ queryKey: ['workflow', 'instances'] });
      void qc.invalidateQueries({ queryKey: ['workflow', 'delegations'] });
      invalidateMonitor(qc);
    },
  });
}
