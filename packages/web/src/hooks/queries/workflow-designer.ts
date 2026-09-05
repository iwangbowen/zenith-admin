import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { dictContract } from '@zenith/shared/platform';
import { decisionFlowContract, decisionTableContract, ruleScorecardContract } from '@zenith/shared/rules';
import type { WorkflowFlowData, WorkflowSimulationDecision } from '@zenith/shared/workflow';
import {
  workflowConnectorContract,
  workflowDataSourceContract,
  workflowDefinitionContract,
  workflowFormContract,
  workflowInstanceContract,
  workflowSimulationCaseContract,
} from '@zenith/shared/workflow';
import { api, useApiMutation } from '@/lib/contract-query';
import { positionContract, userGroupContract } from '@zenith/shared/identity';
import { LOOKUP_STALE_TIME } from '@/lib/query';
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

/** 结构化流程图以自由 JSON 记录形态进入请求体（写侧契约按 record 校验，结构由引擎运行时保证） */
const toJsonRecord = (value: WorkflowFlowData): Record<string, unknown> => ({ ...value });

/** 设计器保存载荷：创建入参 + 结构化 flowData（编辑时同一载荷按部分更新提交） */
export type WorkflowDefinitionSaveValues = Omit<BodyOf<typeof workflowDefinitionContract.create>, 'flowData'> & {
  flowData?: WorkflowFlowData | null;
};

interface WorkflowDefinitionSavePayload {
  id?: number | null;
  values: WorkflowDefinitionSaveValues;
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
      api(workflowConnectorContract.list, { query: { status: 'enabled', pageSize: 100 } })
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
      api(workflowDataSourceContract.list, { query: { page: 1, pageSize: 100, status: 'enabled' } }, { silent: true })
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
    queryFn: () => api(workflowInstanceContract.relationOptions, { query: params }, { silent: true }),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useWorkflowDesignerRemoteDataSourceOptions(params: WorkflowRemoteDataSourceOptionParams, enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.remoteDataSourceOptions(params),
    queryFn: () =>
      api(workflowDataSourceContract.options, { params: { id: params.dataSourceId as number }, query: { keyword: params.keyword } }, { silent: true }),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && !!params.dataSourceId,
  });
}

/** 按选项值取数据源完整记录（联动赋值回填用；命令式调用，失败抛错由调用方静默） */
export function fetchWorkflowDataSourceRecord(dataSourceId: number, value: string): Promise<Record<string, unknown> | null> {
  return api(workflowDataSourceContract.record, { params: { id: dataSourceId }, query: { value } }, { silent: true });
}

export function useWorkflowDesignerFormOptions(formId: number | null | undefined) {
  return useQuery({
    queryKey: workflowDesignerKeys.formOptions(formId),
    queryFn: async () => {
      let list = await api(workflowFormContract.enabled);
      if (formId && !list.some((f) => f.id === formId)) {
        const detail = await api(workflowFormContract.detail, { params: { id: formId } }, { silent: true });
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
    mutationFn: ({ id, values }: WorkflowDefinitionSavePayload) => {
      const body = { ...values, flowData: values.flowData ? toJsonRecord(values.flowData) : values.flowData };
      return id
        ? api(workflowDefinitionContract.update, { params: { id }, body })
        : api(workflowDefinitionContract.create, { body });
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.versions(saved.id) });
      // published 只在发布后变化；设计器的表单/连接器/数据源下拉不受影响
    },
  });
}

export function usePublishWorkflowDesignerDefinition() {
  return useApiMutation(workflowDefinitionContract.publish, {
    invalidate: (qc, _saved, { params }) => {
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.versions(params.id) });
      // 发布会改变「已发布流程」下拉源（发起流程等场景使用）
      void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.published });
    },
  });
}

export function useWorkflowDesignerHealthCheck() {
  return useMutation({
    mutationFn: ({ flowData, definitionId, formFields, silent }: WorkflowHealthCheckPayload) =>
      runWorkflowHealthCheck({ flowData, definitionId, formFields, silent }),
  });
}

/** 画布实时体检：inline flowData + 当前表单字段，静默失败不打扰编辑 */
export function fetchWorkflowFlowHealth(flowData: WorkflowFlowData, formFields: ReadonlyArray<{ key: string; type?: string }>) {
  return runWorkflowHealthCheck({ flowData, formFields, silent: true });
}

function runWorkflowHealthCheck({ flowData, definitionId, formFields, silent }: WorkflowHealthCheckPayload) {
  const fieldPayload = formFields?.filter((f) => f.key).map((f) => ({ key: f.key, type: f.type }));
  const body = flowData?.nodes?.length
    ? { flowData: toJsonRecord(flowData), ...(fieldPayload?.length ? { formFields: fieldPayload } : {}) }
    : { definitionId: definitionId ?? undefined };
  return api(workflowDefinitionContract.healthCheck, { body }, silent ? { silent: true } : undefined);
}

export function useWorkflowDesignerSimulation() {
  return useMutation({
    mutationFn: (payload: WorkflowSimulationPayload) =>
      api(workflowDefinitionContract.simulate, {
        body: { ...payload, definitionId: payload.definitionId ?? undefined, flowData: toJsonRecord(payload.flowData) },
      }),
  });
}

export function useWorkflowSimulationCases(definitionId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowDesignerKeys.simulationCases(definitionId),
    queryFn: () => api(workflowSimulationCaseContract.list, { query: { definitionId: definitionId as number } }, { silent: true }),
    enabled: enabled && !!definitionId,
  });
}

export function useSaveWorkflowSimulationCase() {
  return useApiMutation(workflowSimulationCaseContract.save, {
    invalidate: (qc, _saved, { body }) => {
      void qc.invalidateQueries({ queryKey: workflowDesignerKeys.simulationCases(body.definitionId) });
    },
  });
}

export function useDeleteWorkflowSimulationCase(definitionId: number | null | undefined) {
  return useApiMutation(workflowSimulationCaseContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: workflowDesignerKeys.simulationCases(definitionId) });
    },
  });
}
