import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  WorkflowAnalytics,
  WorkflowCompensation,
  WorkflowCompensationDetail,
  WorkflowDefinition,
  WorkflowEngineActionKey,
  WorkflowEngineActionPreview,
  WorkflowEngineActionResult,
  WorkflowEngineHealthHistory,
  WorkflowEngineIntrospection,
  WorkflowHandoverPreview,
  WorkflowHandoverResult,
  WorkflowInstance,
  WorkflowInstanceTrace,
  WorkflowJob,
  WorkflowJobBatchResult,
  WorkflowJobChain,
  WorkflowJobExecution,
  WorkflowJobStatus,
  WorkflowJobSummaryItem,
  WorkflowJobType,
  WorkflowOverdueTask,
  WorkflowRecoveryBatchResult,
  WorkflowRuntimeDiagnostics,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowMonitorListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  categoryId?: number;
  initiatorKeyword?: string;
  priority?: string;
}

export interface WorkflowMonitorStats {
  total: number;
  running: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  cancelled: number;
}

export interface WorkflowMonitorResponse {
  stats: WorkflowMonitorStats;
  list: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkflowJobListParams {
  page: number;
  pageSize: number;
  jobType: WorkflowJobType;
  status?: WorkflowJobStatus;
  keyword?: string;
}

export type WorkflowJobDetail = WorkflowJob & { executions: WorkflowJobExecution[] };

export interface FailureCluster {
  dimension: 'reason' | 'jobType' | 'instance' | 'trace';
  key: string;
  label: string;
  count: number;
  jobTypes: string[];
  instanceId: number | null;
  traceId: string | null;
  reasonKeyword: string | null;
}

export interface WorkflowJobReplayResult {
  total: number;
  success: number;
  skipped: number;
  matched: number;
  ratePerSecond: number;
  limit: number;
}

export interface WorkflowJobRuntimeStatus {
  activeWorkers: number;
  totalWorkers: number;
  workers: Array<{ nodeId: string; hostname: string | null; runningJobCount: number; lastHeartbeatAt: string | null; fresh: boolean }>;
  runningJobs: number;
  stuckRunningJobs: number;
  backlog: number;
  deadLetter: number;
  lastClaimedAt: string | null;
  failureRate: number;
  avgDurationMs: number | null;
  recentExecutions: number;
}

export interface WorkflowCompensationListParams {
  page: number;
  pageSize: number;
  status?: string;
}

export interface WorkflowEngineDiagnosticsParams {
  thresholdMinutes: number;
  historyHours: number;
}

export interface WorkflowRecoveryBatchInput {
  definitionId: number;
  nodeKey: string;
  olderThanMinutes?: number;
  reason?: string;
}

export const workflowMonitorKeys = {
  all: ['workflow'] as const,
  monitor: ['workflow', 'monitor'] as const,
  monitorLists: ['workflow', 'monitor', 'list'] as const,
  monitorList: (params: WorkflowMonitorListParams) => ['workflow', 'monitor', 'list', params] as const,
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
    queryFn: () => request.get<WorkflowMonitorResponse>(`/api/workflows/instances/all${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowInstanceDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.monitorDetail(id),
    queryFn: () => request.get<WorkflowInstance>(`/api/workflows/instances/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowDefinitionDetail(id: number | undefined, enabled = true, options?: { silent?: boolean }) {
  return useQuery({
    queryKey: workflowMonitorKeys.definitionDetail(id),
    queryFn: () => request.get<WorkflowDefinition>(`/api/workflows/definitions/${id}`, { silent: options?.silent }).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowRuntimeDiagnostics(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.diagnostics(id),
    queryFn: () => request.get<WorkflowRuntimeDiagnostics>(`/api/workflows/instances/${id}/diagnostics`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowInstanceTrace(instanceId: number, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.trace(instanceId),
    queryFn: () => request.get<WorkflowInstanceTrace>(`/api/workflows/instances/${instanceId}/trace`).then(unwrap),
    enabled,
  });
}

export function useWorkflowAnalytics(definitionId: number | undefined) {
  return useQuery({
    queryKey: workflowMonitorKeys.analytics(definitionId),
    queryFn: () => request.get<WorkflowAnalytics>(`/api/workflows/instances/analytics${toQueryString({ definitionId })}`).then(unwrap),
  });
}

export function useWorkflowOverdueTasks(definitionId: number | undefined) {
  return useQuery({
    queryKey: workflowMonitorKeys.overdue(definitionId),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowOverdueTask>>(`/api/workflows/instances/overdue${toQueryString({ pageSize: 50, definitionId })}`).then(unwrap),
  });
}

export function useWorkflowJobList(params: WorkflowJobListParams) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobList(params),
    queryFn: () => request.get<PaginatedResponse<WorkflowJob>>(`/api/workflows/engine/jobs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowJobDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobDetail(id),
    queryFn: () => request.get<WorkflowJobDetail>(`/api/workflows/engine/jobs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowJobChain(traceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobChain(traceId),
    queryFn: () => request.get<WorkflowJobChain>(`/api/workflows/engine/jobs/chain/${encodeURIComponent(traceId ?? '')}`).then(unwrap),
    enabled: enabled && !!traceId,
  });
}

export function useWorkflowJobRuntimeStatus() {
  return useQuery({
    queryKey: workflowMonitorKeys.jobRuntimeStatus,
    queryFn: () => request.get<WorkflowJobRuntimeStatus>('/api/workflows/engine/jobs/runtime-status').then(unwrap),
  });
}

export function useWorkflowJobSummary() {
  return useQuery({
    queryKey: workflowMonitorKeys.jobSummary,
    queryFn: () => request.get<WorkflowJobSummaryItem[]>('/api/workflows/engine/jobs/summary').then(unwrap),
  });
}

export function useWorkflowJobFailureClusters(dimension: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.jobFailureClusters(dimension),
    queryFn: () => request.get<FailureCluster[]>(`/api/workflows/engine/jobs/failure-clusters${toQueryString({ dimension })}`).then(unwrap),
    enabled: enabled && !!dimension,
  });
}

export function useWorkflowCompensationList(params: WorkflowCompensationListParams) {
  return useQuery({
    queryKey: workflowMonitorKeys.compensationList(params),
    queryFn: () => request.get<PaginatedResponse<WorkflowCompensation>>(`/api/workflows/compensation/list${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowCompensationDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowMonitorKeys.compensationDetail(id),
    queryFn: () => request.get<WorkflowCompensationDetail>(`/api/workflows/compensation/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useWorkflowEngineDiagnostics(params: WorkflowEngineDiagnosticsParams, refetchInterval: number | false) {
  return useQuery({
    queryKey: workflowMonitorKeys.engineDiagnostics(params),
    queryFn: async () => {
      const [introspection, history] = await Promise.all([
        request.get<WorkflowEngineIntrospection>(`/api/workflows/engine/introspection${toQueryString({ thresholdMinutes: params.thresholdMinutes })}`).then(unwrap),
        request.get<WorkflowEngineHealthHistory>(`/api/workflows/engine/health-history${toQueryString({ hours: params.historyHours })}`).then(unwrap),
      ]);
      return { introspection, history, fetchedAt: Date.now() };
    },
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

export function useWorkflowStateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, body, method = 'post' }: { url: string; body?: unknown; method?: 'post' | 'delete' }) =>
      (method === 'delete' ? request.delete<null>(url, body) : request.post<null>(url, body)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowMigratePreflight() {
  return useMutation({
    mutationFn: (id: number) =>
      request.get<{ migratable: boolean; fromVersion: number; toVersion: number; blocked: string[] }>(`/api/workflows/instances/${id}/migrate/preflight`).then(unwrap),
  });
}

export function useWorkflowJobBatchMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: 'retry' | 'skip'; ids: number[] }) =>
      request.post<WorkflowJobBatchResult>(`/api/workflows/engine/jobs/batch-${action}`, { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowJobActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'retry' | 'skip' }) =>
      request.post<WorkflowJob>(`/api/workflows/engine/jobs/${id}/${action}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowJobReplayPreview() {
  return useMutation({
    mutationFn: (body: object) => request.post<{ matched: number }>('/api/workflows/engine/jobs/replay-preview', body).then(unwrap),
  });
}

export function useWorkflowJobReplayDead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => request.post<WorkflowJobReplayResult>('/api/workflows/engine/jobs/replay-dead', body).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowCompensationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: 'resolve' | 'resume' | 'retry' | 'note'; body?: unknown }) =>
      request.post<unknown>(`/api/workflows/compensation/${id}/${action}`, body ?? {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowEngineActionPreview() {
  return useMutation({
    mutationFn: ({ key, filter }: { key: WorkflowEngineActionKey; filter: { instanceId?: number; olderThanMinutes?: number; limit: number } }) =>
      request.post<WorkflowEngineActionPreview>(`/api/workflows/engine/actions/${key}/preview`, filter).then(unwrap),
  });
}

export function useWorkflowEngineAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, filter }: { key: WorkflowEngineActionKey; filter: { instanceId?: number; olderThanMinutes?: number; limit: number } }) =>
      request.post<WorkflowEngineActionResult>(`/api/workflows/engine/actions/${key}`, filter).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowBatchRecovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowRecoveryBatchInput) => request.post<WorkflowRecoveryBatchResult>('/api/workflows/instances/batch-skip-stuck', body).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}

export function useWorkflowHandoverPreview() {
  return useMutation({
    mutationFn: (fromUserId: number) =>
      request.get<WorkflowHandoverPreview>(`/api/workflows/tasks/handover-preview${toQueryString({ fromUserId })}`).then(unwrap),
  });
}

export function useWorkflowHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fromUserId: number; toUserId: number; disableDelegations?: boolean; comment?: string }) =>
      request.post<WorkflowHandoverResult>('/api/workflows/tasks/handover', body, {
        headers: { 'X-Idempotency-Key': `workflow-handover-${body.fromUserId}-${body.toUserId}` },
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowMonitorKeys.all }),
  });
}
