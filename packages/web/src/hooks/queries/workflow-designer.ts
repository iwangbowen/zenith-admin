import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse } from '@zenith/shared/core';
import { dictContract } from '@zenith/shared/platform';
import { decisionFlowContract, decisionTableContract, ruleScorecardContract } from '@zenith/shared/rules';
import type { WorkflowDataSource, WorkflowDataSourceOption, WorkflowDefinition, WorkflowDefinitionHealthReport, WorkflowFlowData, WorkflowForm, WorkflowRelationOption, WorkflowSimulationCase, WorkflowSimulationDecision, WorkflowSimulationResult } from '@zenith/shared/workflow';
import { request } from '@/utils/request';
import { api } from '@/lib/contract-query';
import { positionContract, userGroupContract } from '@zenith/shared/identity';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { workflowDefinitionKeys } from './workflow-definitions';

export const workflowDesignerKeys = {
  all: ['workflow', 'designer'] as const,
  connectorOptions: ['workflow', 'designer', 'connectors', 'options'] as const,
  decisionRefOptions: (kind: WorkflowDecisionRefKind) => ['workflow', 'designer', 'decision-refs', kind, 'options'] as const,
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

export type WorkflowDecisionRefKind = 'table' | 'scorecard' | 'flow';

/** 按类型取规则中心已发布资产（决策表/评分卡/决策流），仅保留下拉所需的 key / name */
function fetchPublishedDecisionRefs(kind: WorkflowDecisionRefKind): Promise<Array<{ key: string; name: string }>> {
  const query = { status: 'published' as const, pageSize: 100 };
  switch (kind) {
    case 'table':
      return api(decisionTableContract.list, { query }).then((data) => data.list);
    case 'scorecard':
      return api(ruleScorecardContract.list, { query }).then((data) => data.list);
    case 'flow':
      return api(decisionFlowContract.list, { query }).then((data) => data.list);
  }
}

/** 网关决策资产下拉源：按类型取规则中心已发布资产（决策表/评分卡/决策流） */
export function useWorkflowDesignerDecisionRefOptions(kind: WorkflowDecisionRefKind, enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.decisionRefOptions(kind),
    queryFn: () =>
      fetchPublishedDecisionRefs(kind)
        .then((list) => list.map((t) => ({ value: t.key, label: `${t.name}（${t.key}）` }))),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useWorkflowDesignerUserGroupOptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowDesignerKeys.userGroupOptions,
    queryFn: () => api(userGroupContract.all),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useWorkflowDesignerPositionOptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowDesignerKeys.positionOptions,
    queryFn: () => api(positionContract.all),
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
      api(dictContract.list, { query: { page: 1, pageSize: 200 } }, { silent: true })
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

/** 按选项值取数据源完整记录（联动赋值回填用；命令式调用，失败抛错由调用方静默） */
export function fetchWorkflowDataSourceRecord(dataSourceId: number, value: string): Promise<Record<string, unknown> | null> {
  return request
    .get<Record<string, unknown> | null>(
      `/api/workflows/data-sources/${dataSourceId}/record${toQueryString({ value })}`,
      { silent: true },
    )
    .then(unwrap);
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
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.versions(saved.id) });
      // published 只在发布后变化；设计器的表单/连接器/数据源下拉不受影响
    },
  });
}

export function usePublishWorkflowDesignerDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<WorkflowDefinition>(`/api/workflows/definitions/${id}/publish`, {}).then(unwrap),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.versions(id) });
      // 发布会改变「已发布流程」下拉源（发起流程等场景使用）
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.published });
    },
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
