import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Dict,
  PaginatedResponse,
  WorkflowDataSource,
  WorkflowDataSourceOption,
  WorkflowDefinition,
  WorkflowDefinitionHealthReport,
  WorkflowFlowData,
  WorkflowForm,
  WorkflowRelationOption,
  WorkflowSimulationCase,
  WorkflowSimulationDecision,
  WorkflowSimulationResult,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { workflowDefinitionKeys } from './workflow-definitions';

export const workflowDesignerKeys = {
  all: ['workflow', 'designer'] as const,
  connectorOptions: ['workflow', 'designer', 'connectors', 'options'] as const,
  decisionTableOptions: ['workflow', 'designer', 'decision-tables', 'options'] as const,
  publishedDefinitionOptions: ['workflow', 'designer', 'definitions', 'published-options'] as const,
  userGroupOptions: ['workflow', 'designer', 'user-groups', 'options'] as const,
  positionOptions: ['workflow', 'designer', 'positions', 'options'] as const,
  dataSourceOptions: ['workflow', 'designer', 'data-sources', 'options'] as const,
  dictOptions: ['workflow', 'designer', 'dicts', 'options'] as const,
  relationOptions: (params: WorkflowRelationOptionParams) => ['workflow', 'designer', 'relation-options', params] as const,
  remoteDataSourceOptions: (params: WorkflowRemoteDataSourceOptionParams) =>
    ['workflow', 'designer', 'remote-data-source-options', params] as const,
  simulationCases: (definitionId: number | null | undefined) =>
    ['workflow', 'designer', 'simulation-cases', definitionId ?? null] as const,
  formOptions: (formId: number | null | undefined) => ['workflow', 'forms', 'options', formId ?? null] as const,
};

export interface WorkflowRelationOptionParams {
  definitionId?: number;
  keyword?: string;
  limit: number;
}

export interface WorkflowRemoteDataSourceOptionParams {
  dataSourceId: number | null | undefined;
  keyword?: string;
}

interface WorkflowDefinitionSavePayload {
  id?: number | null;
  values: Record<string, unknown>;
}

interface WorkflowHealthCheckPayload {
  flowData?: WorkflowFlowData;
  definitionId?: number | null;
  formFields?: ReadonlyArray<{ key: string; type?: string }>;
  silent?: boolean;
}

interface WorkflowSimulationPayload {
  definitionId?: number | null;
  flowData: WorkflowFlowData;
  formData: Record<string, unknown>;
  starterUserId?: number;
  decisions: WorkflowSimulationDecision[];
  options: Record<string, unknown>;
}

export function useWorkflowDesignerConnectorOptions(enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.connectorOptions,
    queryFn: () =>
      request
        .get<{ list: Array<{ id: number; name: string; type: string }> }>('/api/workflows/connectors?status=enabled&pageSize=100')
        .then(unwrap)
        .then((data) => data.list.map((c) => ({ value: c.id, label: `${c.name}（${c.type}）` }))),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useWorkflowDesignerDecisionTableOptions(enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.decisionTableOptions,
    queryFn: () =>
      request
        .get<{ list: Array<{ key: string; name: string }> }>('/api/rules/decision-tables?status=published&pageSize=100')
        .then(unwrap)
        .then((data) => data.list.map((t) => ({ value: t.key, label: `${t.name}（${t.key}）` }))),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useWorkflowDesignerPublishedDefinitionOptions() {
  return useQuery({
    queryKey: workflowDesignerKeys.publishedDefinitionOptions,
    queryFn: () => request.get<WorkflowDefinition[]>('/api/workflows/definitions/published', { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useWorkflowDesignerUserGroupOptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowDesignerKeys.userGroupOptions,
    queryFn: () => request.get<Array<{ id: number; name: string }>>('/api/user-groups/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useWorkflowDesignerPositionOptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowDesignerKeys.positionOptions,
    queryFn: () => request.get<Array<{ id: number; name: string }>>('/api/positions/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useWorkflowDesignerDataSourceOptions() {
  return useQuery({
    queryKey: workflowDesignerKeys.dataSourceOptions,
    queryFn: () =>
      request
        .get<PaginatedResponse<WorkflowDataSource>>('/api/workflows/data-sources?page=1&pageSize=100&status=enabled', { silent: true })
        .then(unwrap)
        .then((data) => data.list.map((d) => ({ id: d.id, name: d.name }))),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useWorkflowDesignerDictOptions() {
  return useQuery({
    queryKey: workflowDesignerKeys.dictOptions,
    queryFn: () =>
      request
        .get<PaginatedResponse<Dict>>('/api/dicts?page=1&pageSize=200', { silent: true })
        .then(unwrap)
        .then((data) => data.list.map((d) => ({ code: d.code, name: d.name }))),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useWorkflowDesignerRelationOptions(params: WorkflowRelationOptionParams, enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.relationOptions(params),
    queryFn: () =>
      request
        .get<WorkflowRelationOption[]>(`/api/workflows/instances/relation-options${toQueryString(params)}`, { silent: true })
        .then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useWorkflowDesignerRemoteDataSourceOptions(params: WorkflowRemoteDataSourceOptionParams, enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.remoteDataSourceOptions(params),
    queryFn: () =>
      request
        .get<WorkflowDataSourceOption[]>(
          `/api/workflows/data-sources/${params.dataSourceId}/options${toQueryString({ keyword: params.keyword })}`,
          { silent: true },
        )
        .then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && !!params.dataSourceId,
  });
}

export function useWorkflowDesignerFormOptions(formId: number | null | undefined) {
  return useQuery({
    queryKey: workflowDesignerKeys.formOptions(formId),
    queryFn: async () => {
      let list = await request.get<WorkflowForm[]>('/api/workflows/forms/enabled').then(unwrap);
      if (formId && !list.some((f) => f.id === formId)) {
        const detail = await request.get<WorkflowForm>(`/api/workflows/forms/${formId}`, { silent: true }).then(unwrap);
        list = [detail, ...list];
      }
      return list;
    },
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveWorkflowDesignerDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: WorkflowDefinitionSavePayload) =>
      (id
        ? request.put<WorkflowDefinition>(`/api/workflows/definitions/${id}`, values)
        : request.post<WorkflowDefinition>('/api/workflows/definitions', values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowDefinitionKeys.all }),
  });
}

export function usePublishWorkflowDesignerDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<WorkflowDefinition>(`/api/workflows/definitions/${id}/publish`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowDefinitionKeys.all }),
  });
}

export function useWorkflowDesignerHealthCheck() {
  return useMutation({
    mutationFn: ({ flowData, definitionId, formFields, silent }: WorkflowHealthCheckPayload) => {
      const fieldPayload = formFields?.filter((f) => f.key).map((f) => ({ key: f.key, type: f.type }));
      const body = flowData?.nodes?.length
        ? { flowData, ...(fieldPayload?.length ? { formFields: fieldPayload } : {}) }
        : { definitionId };
      return request.post<WorkflowDefinitionHealthReport>('/api/workflows/definitions/health-check', body, silent ? { silent: true } : undefined).then(unwrap);
    },
  });
}

export function useWorkflowDesignerSimulation() {
  return useMutation({
    mutationFn: (payload: WorkflowSimulationPayload) =>
      request.post<WorkflowSimulationResult>('/api/workflows/definitions/simulate', payload).then(unwrap),
  });
}

export function useWorkflowSimulationCases(definitionId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.simulationCases(definitionId),
    queryFn: () =>
      request
        .get<WorkflowSimulationCase[]>(`/api/workflows/simulation-cases${toQueryString({ definitionId })}`, { silent: true })
        .then(unwrap),
    enabled: enabled && !!definitionId,
  });
}

export function useSaveWorkflowSimulationCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      definitionId: number;
      name: string;
      starterUserId: number | null;
      formData: Record<string, unknown>;
      decisions: WorkflowSimulationDecision[];
    }) => request.post<WorkflowSimulationCase>('/api/workflows/simulation-cases', payload).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: workflowDesignerKeys.simulationCases(variables.definitionId) });
    },
  });
}

export function useDeleteWorkflowSimulationCase(definitionId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/simulation-cases/${id}`).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowDesignerKeys.simulationCases(definitionId) });
    },
  });
}
