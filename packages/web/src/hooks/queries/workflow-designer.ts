// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { useQuery } from '@tanstack/react-query';
import type { BodyOf, InputOf } from '@zenith/shared/core';
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
import { api, contractKey, useApiMutation, useApiQuery, useSaveMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { positionKeys, useAllPositions } from './positions';
import { useAllUserGroups, userGroupKeys } from './user-groups';
import { invalidateAfterWorkflowDefinitionVersionChange, workflowDefinitionKeys } from './workflow-definitions';
import { workflowFormKeys } from './workflow-forms';

export type WorkflowDecisionRefKind = 'table' | 'scorecard' | 'flow';

export interface WorkflowRelationOptionParams {
  definitionId?: number;
  keyword?: string;
  limit: number;
}

export interface WorkflowRemoteDataSourceOptionParams {
  dataSourceId: number | null | undefined;
  keyword?: string;
}

/** 下拉源固定查询条件：进入 key，因而与所有者域的 lists 前缀同源，由所有者域的增删改失效 */
const CONNECTOR_OPTIONS_QUERY = { status: 'enabled' as const, pageSize: 100 };
const DECISION_REF_QUERY = { status: 'published' as const, pageSize: 100 };
const DATA_SOURCE_OPTIONS_QUERY = { page: 1, pageSize: 100, status: 'enabled' as const };
const DICT_OPTIONS_QUERY = { page: 1, pageSize: 200 };

/**
 * 设计器只消费别人的资源，key 一律由所有者域的契约操作派生：
 * 连接器 / 数据源 / 字典 / 规则资产的下拉挂在各自 list 操作之下，所有者域保存 / 删除时随 lists 一起回源；
 * 用户组 / 岗位直接复用 identity 域的 lookup hook 与缓存。
 */
export const workflowDesignerKeys = {
  connectorOptions: contractKey(workflowConnectorContract.list, { query: CONNECTOR_OPTIONS_QUERY }),
  decisionRefOptions: (kind: WorkflowDecisionRefKind) => {
    switch (kind) {
      case 'table':
        return contractKey(decisionTableContract.list, { query: DECISION_REF_QUERY });
      case 'scorecard':
        return contractKey(ruleScorecardContract.list, { query: DECISION_REF_QUERY });
      case 'flow':
        return contractKey(decisionFlowContract.list, { query: DECISION_REF_QUERY });
    }
  },
  userGroupOptions: userGroupKeys.lookup,
  positionOptions: positionKeys.lookup,
  dataSourceOptions: contractKey(workflowDataSourceContract.list, { query: DATA_SOURCE_OPTIONS_QUERY }),
  dictOptions: contractKey(dictContract.list, { query: DICT_OPTIONS_QUERY }),
  relationOptions: (params: WorkflowRelationOptionParams) => contractKey(workflowInstanceContract.relationOptions, { query: params }),
  remoteDataSourceOptions: (params: WorkflowRemoteDataSourceOptionParams) =>
    contractKey(workflowDataSourceContract.options, { params: { id: params.dataSourceId ?? 0 }, query: { keyword: params.keyword } }),
  simulationCases: (definitionId: number | null | undefined) =>
    contractKey(workflowSimulationCaseContract.list, { query: { definitionId: definitionId ?? 0 } }),
  /** 「启用表单 + 当前已停用表单」组合查询，挂在 enabled 操作前缀下，表单域增删改时随之回源 */
  formOptions: (formId: number | null | undefined) => [...workflowFormKeys.enabled, { formId: formId ?? null }] as const,
};

/** 结构化流程图以自由 JSON 记录形态进入请求体（写侧契约按 record 校验，结构由引擎运行时保证） */
const toJsonRecord = (value: WorkflowFlowData): Record<string, unknown> => ({ ...value });

/** 设计器保存载荷：创建入参 + 结构化 flowData（编辑时同一载荷按部分更新提交） */
export type WorkflowDefinitionSaveValues = Omit<BodyOf<typeof workflowDefinitionContract.create>, 'flowData'> & {
  flowData?: WorkflowFlowData | null;
};

interface WorkflowHealthCheckPayload {
  flowData?: WorkflowFlowData;
  definitionId?: number | null;
  formFields?: ReadonlyArray<{ key: string; type?: string }>;
}

interface WorkflowSimulationPayload {
  definitionId?: number | null;
  flowData: WorkflowFlowData;
  formData: Record<string, unknown>;
  starterUserId?: number;
  decisions: WorkflowSimulationDecision[];
  options: Record<string, unknown>;
}

/** 触发器节点的连接器下拉（只取启用项） */
export function useWorkflowDesignerConnectorOptions(enabled = true) {
  return useApiQuery(workflowConnectorContract.list, { query: CONNECTOR_OPTIONS_QUERY }, {
    select: (data) => data.list.map((c) => ({ value: c.id, label: `${c.name}（${c.type}）` })),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

const toDecisionRefOptions = (list: ReadonlyArray<{ key: string; name: string }>) =>
  list.map((t) => ({ value: t.key, label: `${t.name}（${t.key}）` }));

/**
 * 网关决策资产下拉源：按类型取规则中心已发布资产（决策表 / 评分卡 / 决策流）。
 * 三类资产是三个契约操作，各自一个观察者、只启用当前类型，返回值形状一致。
 */
export function useWorkflowDesignerDecisionRefOptions(kind: WorkflowDecisionRefKind, enabled = true) {
  const tables = useApiQuery(decisionTableContract.list, { query: DECISION_REF_QUERY }, {
    select: (data) => toDecisionRefOptions(data.list),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && kind === 'table',
  });
  const scorecards = useApiQuery(ruleScorecardContract.list, { query: DECISION_REF_QUERY }, {
    select: (data) => toDecisionRefOptions(data.list),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && kind === 'scorecard',
  });
  const flows = useApiQuery(decisionFlowContract.list, { query: DECISION_REF_QUERY }, {
    select: (data) => toDecisionRefOptions(data.list),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && kind === 'flow',
  });
  switch (kind) {
    case 'table':
      return tables;
    case 'scorecard':
      return scorecards;
    case 'flow':
      return flows;
  }
}

/** 用户组 / 岗位下拉复用 identity 域的 lookup：同一份缓存，由所属域的增删改失效 */
export function useWorkflowDesignerUserGroupOptions(options?: { enabled?: boolean }) {
  return useAllUserGroups(options);
}

export function useWorkflowDesignerPositionOptions(options?: { enabled?: boolean }) {
  return useAllPositions(options);
}

export function useWorkflowDesignerDataSourceOptions() {
  return useApiQuery(workflowDataSourceContract.list, { query: DATA_SOURCE_OPTIONS_QUERY }, {
    requestOptions: { silent: true },
    select: (data) => data.list.map((d) => ({ id: d.id, name: d.name })),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useWorkflowDesignerDictOptions() {
  return useApiQuery(dictContract.list, { query: DICT_OPTIONS_QUERY }, {
    requestOptions: { silent: true },
    select: (data) => data.list.map((d) => ({ code: d.code, name: d.name })),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useWorkflowDesignerRelationOptions(params: WorkflowRelationOptionParams, enabled = true) {
  return useApiQuery(workflowInstanceContract.relationOptions, { query: params }, {
    staleTime: LOOKUP_STALE_TIME,
    enabled,
    requestOptions: { silent: true },
  });
}

export function useWorkflowDesignerRemoteDataSourceOptions(params: WorkflowRemoteDataSourceOptionParams, enabled = true) {
  return useApiQuery(
    workflowDataSourceContract.options,
    { params: { id: params.dataSourceId ?? 0 }, query: { keyword: params.keyword } },
    { staleTime: LOOKUP_STALE_TIME, enabled: enabled && !!params.dataSourceId, requestOptions: { silent: true } },
  );
}

/** 按选项值取数据源完整记录（联动赋值回填用；命令式调用，失败抛错由调用方静默） */
export function fetchWorkflowDataSourceRecord(dataSourceId: number, value: string): Promise<Record<string, unknown> | null> {
  return api(workflowDataSourceContract.record, { params: { id: dataSourceId }, query: { value } }, { silent: true });
}

/** H5：queryFn 组合两次请求 —— 启用表单列表 + 当前绑定表单已停用时补拉其详情，保证选择器仍能显示当前值 */
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

/**
 * 设计器保存：无 id 走创建、有 id 走更新。结构化 flowData 直接作为 JSON 记录提交（序列化结果与记录形态一致）。
 * 保存只改定义本身：详情、列表（名称 / 更新时间列）与版本历史回源；published 只在发布后变化，
 * 设计器的表单 / 连接器 / 数据源下拉不受影响。
 */
export function useSaveWorkflowDesignerDefinition() {
  return useSaveMutation<typeof workflowDefinitionContract.create, typeof workflowDefinitionContract.update, WorkflowDefinitionSaveValues>(
    workflowDefinitionContract.create,
    workflowDefinitionContract.update,
    {
      invalidate: (qc, saved) => {
        void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.detail(saved.id) });
        void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
        void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.versions(saved.id) });
      },
    },
  );
}

/** 发布：与定义列表页的发布共用失效口径（含「已发布流程」下拉，发起流程等场景使用） */
export function usePublishWorkflowDesignerDefinition() {
  return useApiMutation(workflowDefinitionContract.publish, {
    invalidate: (qc, _saved, { params }) => invalidateAfterWorkflowDefinitionVersionChange(qc, params.id),
  });
}

/**
 * 体检入参：有画布节点时按 inline flowData + 当前表单字段体检，否则按已保存定义体检。
 * 供 useWorkflowDesignerHealthCheck 的调用方与 fetchWorkflowFlowHealth 共用。
 */
export function workflowHealthCheckInput({ flowData, definitionId, formFields }: WorkflowHealthCheckPayload): InputOf<typeof workflowDefinitionContract.healthCheck> {
  const fieldPayload = formFields?.filter((f) => f.key).map((f) => ({ key: f.key, type: f.type }));
  const body = flowData?.nodes?.length
    ? { flowData: toJsonRecord(flowData), ...(fieldPayload?.length ? { formFields: fieldPayload } : {}) }
    : { definitionId: definitionId ?? undefined };
  return { body };
}

/** 发布前体检（只读，不进入缓存）；`silent` 用于发布 gate 等由调用方自行提示的场景 */
export function useWorkflowDesignerHealthCheck(options?: { silent?: boolean }) {
  return useApiMutation(workflowDefinitionContract.healthCheck, {
    requestOptions: options?.silent ? { silent: true } : undefined,
  });
}

/** 画布实时体检：inline flowData + 当前表单字段，静默失败不打扰编辑 */
export function fetchWorkflowFlowHealth(flowData: WorkflowFlowData, formFields: ReadonlyArray<{ key: string; type?: string }>) {
  return api(workflowDefinitionContract.healthCheck, workflowHealthCheckInput({ flowData, formFields }), { silent: true });
}

/** 仿真入参：结构化 flowData 转 JSON 记录，definitionId 为 null 时省略 */
export function workflowSimulationInput(payload: WorkflowSimulationPayload): InputOf<typeof workflowDefinitionContract.simulate> {
  return { body: { ...payload, definitionId: payload.definitionId ?? undefined, flowData: toJsonRecord(payload.flowData) } };
}

/** 流程仿真（只读，不进入缓存） */
export function useWorkflowDesignerSimulation() {
  return useApiMutation(workflowDefinitionContract.simulate);
}

export function useWorkflowSimulationCases(definitionId: number | null | undefined, enabled = true) {
  return useApiQuery(
    workflowSimulationCaseContract.list,
    { query: { definitionId: definitionId ?? 0 } },
    { enabled: enabled && !!definitionId, requestOptions: { silent: true } },
  );
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
