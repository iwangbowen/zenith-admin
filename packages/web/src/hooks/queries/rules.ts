import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { systemConfigContract } from '@zenith/shared/platform';
import {
  decisionFlowContract,
  decisionTableContract,
  ruleExecutionContract,
  ruleListContract,
  type CreateDecisionFlowInput,
  type CreateDecisionTableInput,
  type CreateRuleListInput,
  type CreateRuleTestCaseInput,
  type RuleDecisionFlow,
  type RuleDecisionTable,
  type RuleList,
  type RuleTestCase,
  type RuleUsageItem,
  type UpdateDecisionFlowInput,
  type UpdateDecisionTableInput,
  type UpdateRuleListInput,
  type UpdateRuleTestCaseInput,
} from '@zenith/shared/rules';
import { api, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export type RuleDecisionTableListParams = NonNullable<QueryOf<typeof decisionTableContract.list>>;

export type RuleExecutionsParams = NonNullable<QueryOf<typeof ruleExecutionContract.list>>;

export type RuleFlowListParams = NonNullable<QueryOf<typeof decisionFlowContract.list>>;

export type RuleListListParams = NonNullable<QueryOf<typeof ruleListContract.list>>;

export type RuleListItemsParams = NonNullable<QueryOf<typeof ruleListContract.items>>;

export const ruleKeys = {
  decisionTables: {
    all: [resourceKeyOf(decisionTableContract.basePath)] as const,
    lists: contractKey(decisionTableContract.list),
    list: (params: RuleDecisionTableListParams) => contractKey(decisionTableContract.list, { query: params }),
    versions: (id: number | undefined) => contractKey(decisionTableContract.versions, { params: { id: id ?? 0 } }),
    diff: (id: number | undefined, from: number | null, to: number) =>
      contractKey(decisionTableContract.diff, { params: { id: id ?? 0 }, query: { from: from ?? 0, to } }),
    cases: (id: number | undefined) => contractKey(decisionTableContract.cases, { params: { id: id ?? 0 } }),
    stats: (id: number | undefined, days: number) => contractKey(decisionTableContract.stats, { params: { id: id ?? 0 }, query: { days } }),
  },
  executions: {
    all: [resourceKeyOf(ruleExecutionContract.basePath)] as const,
    list: (params: RuleExecutionsParams) => contractKey(ruleExecutionContract.list, { query: params }),
  },
  flows: {
    all: [resourceKeyOf(decisionFlowContract.basePath)] as const,
    lists: contractKey(decisionFlowContract.list),
    list: (params: RuleFlowListParams) => contractKey(decisionFlowContract.list, { query: params }),
    versions: (id: number | undefined) => contractKey(decisionFlowContract.versions, { params: { id: id ?? 0 } }),
  },
  ruleLists: {
    all: [resourceKeyOf(ruleListContract.basePath)] as const,
    lists: contractKey(ruleListContract.list),
    list: (params: RuleListListParams) => contractKey(ruleListContract.list, { query: params }),
    items: (listId: number | undefined, params: RuleListItemsParams) =>
      contractKey(ruleListContract.items, { params: { id: listId ?? 0 }, query: params }),
  },
  /** 发布审批开关：系统配置派生的布尔视图，与 usePublicConfig 的原始配置缓存分键 */
  approvalConfig: ['rules', 'approval-config'] as const,
};

// ─── 决策表 ─────────────────────────────────────────────────────────────────────

/** 决策表的版本 / 用例 / 统计 / 执行流水都挂在同一资源键下，任一写操作后整体回源 */
const invalidateDecisionTables = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all });

export function useRuleDecisionTableList(params: RuleDecisionTableListParams) {
  return useApiQuery(decisionTableContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export type RuleDecisionTableSaveValues = Partial<CreateDecisionTableInput & UpdateDecisionTableInput>;

/** 无 id 走 create，有 id 走 update（key 仅创建时提交） */
export function useSaveRuleDecisionTable() {
  const qc = useQueryClient();
  return useMutation<RuleDecisionTable, Error, { id?: number; values: RuleDecisionTableSaveValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(decisionTableContract.create, { body: values as CreateDecisionTableInput })
      : api(decisionTableContract.update, { params: { id }, body: values as UpdateDecisionTableInput })),
    onSuccess: () => invalidateDecisionTables(qc),
  });
}

export function usePublishRuleDecisionTable() {
  return useApiMutation(decisionTableContract.publish, { invalidate: invalidateDecisionTables });
}

/** 灰度操作：complete=转正全量；cancel=放弃（旧版本前滚为新版本） */
export function useGrayActionRuleTable() {
  return useApiMutation(decisionTableContract.grayAction, { invalidate: invalidateDecisionTables });
}

/** 批量仿真：纯读操作，不触发失效 */
export function useSimulateRuleTable() {
  return useApiMutation(decisionTableContract.simulate);
}

export function useDeleteRuleDecisionTable() {
  return useApiMutation(decisionTableContract.remove, { invalidate: invalidateDecisionTables });
}

export function useRuleVersions(id: number | undefined, enabled = true) {
  return useApiQuery(decisionTableContract.versions, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useRuleVersionDiff(id: number | undefined, from: number | null, to = 0, enabled = true) {
  return useApiQuery(
    decisionTableContract.diff,
    { params: { id: id ?? 0 }, query: { from: from ?? 0, to } },
    { enabled: enabled && id !== undefined && from !== null },
  );
}

export function useRollbackRuleDecisionTable() {
  return useApiMutation(decisionTableContract.rollback, { invalidate: invalidateDecisionTables });
}

export function useToggleRuleDecisionTable() {
  return useApiMutation(decisionTableContract.toggle, { invalidate: invalidateDecisionTables });
}

export function useRuleTestCases(id: number | undefined, enabled = true) {
  return useApiQuery(decisionTableContract.cases, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export type RuleTestCaseSaveValues = Partial<CreateRuleTestCaseInput & UpdateRuleTestCaseInput>;

/** 用例只影响所属决策表的用例列表 */
export function useSaveRuleTestCase() {
  const qc = useQueryClient();
  return useMutation<RuleTestCase, Error, { tableId: number; caseId?: number; values: RuleTestCaseSaveValues }>({
    mutationFn: ({ tableId, caseId, values }) => (caseId === undefined
      ? api(decisionTableContract.createCase, { params: { id: tableId }, body: values as CreateRuleTestCaseInput })
      : api(decisionTableContract.updateCase, { params: { id: tableId, caseId }, body: values })),
    onSuccess: (_data, variables) => void qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.cases(variables.tableId) }),
  });
}

export function useDeleteRuleTestCase() {
  return useApiMutation(decisionTableContract.removeCase, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.cases(params.id) }),
  });
}

/** 运行用例 / 测试求值：纯读操作，不触发失效 */
export function useRunRuleTestCases() {
  return useApiMutation(decisionTableContract.runCases);
}

export function useTestRuleDecisionTable() {
  return useApiMutation(decisionTableContract.test);
}

export function useRuleExecutions(params: RuleExecutionsParams, enabled = true) {
  return useApiQuery(ruleExecutionContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 引用分析（删除/停用确认时按需拉取） */
export function fetchRuleUsages(id: number): Promise<RuleUsageItem[]> {
  return api(decisionTableContract.usages, { params: { id } });
}

/** 名单引用分析（删除确认时按需拉取） */
export function fetchRuleListUsages(id: number): Promise<RuleUsageItem[]> {
  return api(ruleListContract.usages, { params: { id } });
}

// ─── 命中分析 / 影子对比 / 发布审批 ──────────────────────────────────────────────

export function useRuleTableStats(id: number | undefined, days: number, enabled = true) {
  return useApiQuery(decisionTableContract.stats, { params: { id: id ?? 0 }, query: { days } }, { enabled: enabled && id !== undefined });
}

export function useShadowRunRuleTable() {
  return useApiMutation(decisionTableContract.shadowRun);
}

/** 发布审批开关（system_configs 公开配置） */
export function useRulePublishApprovalEnabled() {
  return useQuery({
    queryKey: ruleKeys.approvalConfig,
    queryFn: () => api(systemConfigContract.publicByKey, { params: { key: 'rule_publish_approval' } }, { silent: true })
      .then((c) => c.configValue === 'true').catch(() => false),
    staleTime: 60_000,
  });
}

export function useSubmitRuleTableReview() {
  return useApiMutation(decisionTableContract.submitReview, { invalidate: invalidateDecisionTables });
}

export function useReviewRuleTable() {
  return useApiMutation(decisionTableContract.review, { invalidate: invalidateDecisionTables });
}

// ─── 决策流 ─────────────────────────────────────────────────────────────────────

const invalidateFlows = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ruleKeys.flows.all });

export function useRuleFlowList(params: RuleFlowListParams) {
  return useApiQuery(decisionFlowContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export type RuleFlowSaveValues = Partial<CreateDecisionFlowInput & UpdateDecisionFlowInput>;

export function useSaveRuleFlow() {
  const qc = useQueryClient();
  return useMutation<RuleDecisionFlow, Error, { id?: number; values: RuleFlowSaveValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(decisionFlowContract.create, { body: values as CreateDecisionFlowInput })
      : api(decisionFlowContract.update, { params: { id }, body: values as UpdateDecisionFlowInput })),
    onSuccess: () => invalidateFlows(qc),
  });
}

export function usePublishRuleFlow() {
  return useApiMutation(decisionFlowContract.publish, { invalidate: invalidateFlows });
}

export function useToggleRuleFlow() {
  return useApiMutation(decisionFlowContract.toggle, { invalidate: invalidateFlows });
}

export function useDeleteRuleFlow() {
  return useApiMutation(decisionFlowContract.remove, { invalidate: invalidateFlows });
}

export function useTestRuleFlow() {
  return useApiMutation(decisionFlowContract.test);
}

export function useRuleFlowVersions(id: number | undefined, enabled = true) {
  return useApiQuery(decisionFlowContract.versions, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useRollbackRuleFlow() {
  return useApiMutation(decisionFlowContract.rollback, { invalidate: invalidateFlows });
}

// ─── 名单库 ─────────────────────────────────────────────────────────────────────

/** 名单与条目共用资源键：条目数随条目增删变化，列表也需回源 */
const invalidateRuleLists = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all });

export function useRuleListList(params: RuleListListParams, enabled = true) {
  return useApiQuery(ruleListContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export type RuleListSaveValues = Partial<CreateRuleListInput & UpdateRuleListInput>;

export function useSaveRuleList() {
  const qc = useQueryClient();
  return useMutation<RuleList, Error, { id?: number; values: RuleListSaveValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(ruleListContract.create, { body: values as CreateRuleListInput })
      : api(ruleListContract.update, { params: { id }, body: values as UpdateRuleListInput })),
    onSuccess: () => invalidateRuleLists(qc),
  });
}

export function useDeleteRuleList() {
  return useApiMutation(ruleListContract.remove, { invalidate: invalidateRuleLists });
}

export function useRuleListItems(listId: number | undefined, params: RuleListItemsParams, enabled = true) {
  return useApiQuery(
    ruleListContract.items,
    { params: { id: listId ?? 0 }, query: params },
    { placeholderData: keepPreviousData, enabled: enabled && listId !== undefined },
  );
}

export function useSaveRuleListItem() {
  return useApiMutation(ruleListContract.createItem, { invalidate: invalidateRuleLists });
}

/** 批量导入返回服务端结果消息（新增 / 跳过数量），由调用方展示 */
export function useBatchImportRuleListItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, values, expiresAt }: { listId: number; values: string[]; expiresAt?: string | null }) => {
      const res = await request.post<null>(urlOf(ruleListContract.createItemsBatch, { params: { id: listId } }), { values, expiresAt });
      unwrap(res);
      return res.message;
    },
    onSuccess: () => invalidateRuleLists(qc),
  });
}

export function useDeleteRuleListItem() {
  return useApiMutation(ruleListContract.removeItem, { invalidate: invalidateRuleLists });
}

/** 清理过期条目返回服务端结果消息（删除数量），由调用方展示 */
export function usePurgeExpiredRuleListItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: number) => {
      const res = await request.post<null>(urlOf(ruleListContract.purgeExpiredItems, { params: { id: listId } }));
      unwrap(res);
      return res.message;
    },
    onSuccess: () => invalidateRuleLists(qc),
  });
}

/** 命中判定：纯读操作，不触发失效 */
export function useCheckRuleList() {
  return useApiMutation(ruleListContract.check);
}
