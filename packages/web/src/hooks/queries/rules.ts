import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  RuleDecisionExecution,
  RuleDecisionFlow,
  RuleDecisionTable,
  RuleEvaluateResult,
  RuleFlowEvaluateResult,
  RuleList,
  RuleListItem,
  RuleShadowRunResult,
  RuleTableStats,
  RuleTestCase,
  RuleTestRunResult,
  RuleUsageItem,
  RuleVersionDiff,
} from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface RuleDecisionTableListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'disabled';
}

export interface RuleExecutionsParams {
  page: number;
  pageSize: number;
  tableId?: number;
  instanceId?: number;
  ruleKey?: string;
  source?: 'runtime' | 'manual' | 'test';
  matched?: boolean;
  dateStart?: string;
  dateEnd?: string;
}

export const ruleKeys = {
  all: ['rules'] as const,
  decisionTables: {
    all: ['rules', 'decision-tables'] as const,
    lists: ['rules', 'decision-tables', 'list'] as const,
    list: (params: RuleDecisionTableListParams) => ['rules', 'decision-tables', 'list', params] as const,
    versions: (id: number | undefined) => ['rules', 'decision-tables', 'versions', id] as const,
    diff: (id: number | undefined, from: number | null, to: number) => ['rules', 'decision-tables', 'diff', id, from, to] as const,
    cases: (id: number | undefined) => ['rules', 'decision-tables', 'cases', id] as const,
    executions: (params: RuleExecutionsParams) => ['rules', 'decision-tables', 'executions', params] as const,
    stats: (id: number | undefined, days: number) => ['rules', 'decision-tables', 'stats', id, days] as const,
  },
  flows: {
    all: ['rules', 'flows'] as const,
    lists: ['rules', 'flows', 'list'] as const,
    list: (params: RuleFlowListParams) => ['rules', 'flows', 'list', params] as const,
  },
  ruleLists: {
    all: ['rules', 'lists'] as const,
    lists: ['rules', 'lists', 'list'] as const,
    list: (params: RuleListListParams) => ['rules', 'lists', 'list', params] as const,
    items: (listId: number | undefined, params: RuleListItemsParams) => ['rules', 'lists', 'items', listId, params] as const,
  },
  approvalConfig: ['rules', 'approval-config'] as const,
};

export function useRuleDecisionTableList(params: RuleDecisionTableListParams) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.list(params),
    queryFn: () => request.get<PaginatedResponse<RuleDecisionTable>>(`/api/rules/decision-tables${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveRuleDecisionTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<RuleDecisionTable>('/api/rules/decision-tables', values)
        : request.put<RuleDecisionTable>(`/api/rules/decision-tables/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

export function usePublishRuleDecisionTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/rules/decision-tables/${id}/publish`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

export function useDeleteRuleDecisionTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/rules/decision-tables/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

export function useRuleVersions(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.versions(id),
    queryFn: () => request.get<Array<{ version: number; name: string; publishedAt: string }>>(`/api/rules/decision-tables/${id}/versions`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useRuleVersionDiff(id: number | undefined, from: number | null, to = 0, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.diff(id, from, to),
    queryFn: () => request.get<RuleVersionDiff>(`/api/rules/decision-tables/${id}/diff?from=${from}&to=${to}`).then(unwrap),
    enabled: enabled && id !== undefined && from !== null,
  });
}

export function useRollbackRuleDecisionTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: number; version: number }) => request.post<null>(`/api/rules/decision-tables/${id}/rollback/${version}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

export function useToggleRuleDecisionTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request.post<RuleDecisionTable>(`/api/rules/decision-tables/${id}/toggle`, { enabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

export function useRuleTestCases(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.cases(id),
    queryFn: () => request.get<RuleTestCase[]>(`/api/rules/decision-tables/${id}/cases`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveRuleTestCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableId, caseId, values }: { tableId: number; caseId?: number; values: Record<string, unknown> }) =>
      (caseId === undefined
        ? request.post<RuleTestCase>(`/api/rules/decision-tables/${tableId}/cases`, values)
        : request.put<RuleTestCase>(`/api/rules/decision-tables/${tableId}/cases/${caseId}`, values)
      ).then(unwrap),
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.cases(variables.tableId) }),
  });
}

export function useDeleteRuleTestCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableId, caseId }: { tableId: number; caseId: number }) =>
      request.delete<null>(`/api/rules/decision-tables/${tableId}/cases/${caseId}`).then(unwrap),
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.cases(variables.tableId) }),
  });
}

export function useRunRuleTestCases() {
  return useMutation({
    mutationFn: (tableId: number) => request.post<RuleTestRunResult>(`/api/rules/decision-tables/${tableId}/cases/run`, {}).then(unwrap),
  });
}

export function useTestRuleDecisionTable() {
  return useMutation({
    mutationFn: ({ tableId, input }: { tableId: number; input: unknown }) =>
      request.post<RuleEvaluateResult>(`/api/rules/decision-tables/${tableId}/test`, { input }).then(unwrap),
  });
}

export function useRuleExecutions(params: RuleExecutionsParams, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.executions(params),
    queryFn: () => request.get<PaginatedResponse<RuleDecisionExecution>>(`/api/rules/decision-tables/executions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 引用分析（删除/停用确认时按需拉取） */
export function fetchRuleUsages(id: number): Promise<RuleUsageItem[]> {
  return request.get<RuleUsageItem[]>(`/api/rules/decision-tables/${id}/usages`).then(unwrap);
}

// ─── 命中分析 / 影子对比 / 发布审批 ──────────────────────────────────────────────

export function useRuleTableStats(id: number | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.stats(id, days),
    queryFn: () => request.get<RuleTableStats>(`/api/rules/decision-tables/${id}/stats?days=${days}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useShadowRunRuleTable() {
  return useMutation({
    mutationFn: ({ id, limit }: { id: number; limit?: number }) =>
      request.post<RuleShadowRunResult>(`/api/rules/decision-tables/${id}/shadow-run`, { limit: limit ?? 100 }).then(unwrap),
  });
}

/** 发布审批开关（system_configs 公开配置） */
export function useRulePublishApprovalEnabled() {
  return useQuery({
    queryKey: ruleKeys.approvalConfig,
    queryFn: () => request.get<{ configValue: string }>('/api/system-configs/public/rule_publish_approval', { silent: true })
      .then(unwrap).then((c) => c.configValue === 'true').catch(() => false),
    staleTime: 60_000,
  });
}

export function useSubmitRuleTableReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<RuleDecisionTable>(`/api/rules/decision-tables/${id}/submit-review`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

export function useReviewRuleTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve, comment }: { id: number; approve: boolean; comment?: string }) =>
      request.post<RuleDecisionTable>(`/api/rules/decision-tables/${id}/review`, { approve, comment }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.decisionTables.all }),
  });
}

// ─── 决策流 ─────────────────────────────────────────────────────────────────────

export interface RuleFlowListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'disabled';
}

export function useRuleFlowList(params: RuleFlowListParams) {
  return useQuery({
    queryKey: ruleKeys.flows.list(params),
    queryFn: () => request.get<PaginatedResponse<RuleDecisionFlow>>(`/api/rules/decision-flows${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveRuleFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<RuleDecisionFlow>('/api/rules/decision-flows', values)
        : request.put<RuleDecisionFlow>(`/api/rules/decision-flows/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.flows.all }),
  });
}

export function usePublishRuleFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<RuleDecisionFlow>(`/api/rules/decision-flows/${id}/publish`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.flows.all }),
  });
}

export function useToggleRuleFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request.post<RuleDecisionFlow>(`/api/rules/decision-flows/${id}/toggle`, { enabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.flows.all }),
  });
}

export function useDeleteRuleFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/rules/decision-flows/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.flows.all }),
  });
}

export function useTestRuleFlow() {
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: unknown }) =>
      request.post<RuleFlowEvaluateResult>(`/api/rules/decision-flows/${id}/test`, { input }).then(unwrap),
  });
}

// ─── 名单库 ─────────────────────────────────────────────────────────────────────

export interface RuleListListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: 'black' | 'white' | 'grey';
}

export interface RuleListItemsParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export function useRuleListList(params: RuleListListParams) {
  return useQuery({
    queryKey: ruleKeys.ruleLists.list(params),
    queryFn: () => request.get<PaginatedResponse<RuleList>>(`/api/rules/lists${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveRuleList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<RuleList>('/api/rules/lists', values)
        : request.put<RuleList>(`/api/rules/lists/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all }),
  });
}

export function useDeleteRuleList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/rules/lists/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all }),
  });
}

export function useRuleListItems(listId: number | undefined, params: RuleListItemsParams, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.ruleLists.items(listId, params),
    queryFn: () => request.get<PaginatedResponse<RuleListItem>>(`/api/rules/lists/${listId}/items${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: enabled && listId !== undefined,
  });
}

export function useSaveRuleListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, values }: { listId: number; values: Record<string, unknown> }) =>
      request.post<RuleListItem>(`/api/rules/lists/${listId}/items`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all }),
  });
}

export function useBatchImportRuleListItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, values, expiresAt }: { listId: number; values: string[]; expiresAt?: string | null }) =>
      request.post<null>(`/api/rules/lists/${listId}/items/batch`, { values, expiresAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all }),
  });
}

export function useDeleteRuleListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, itemId }: { listId: number; itemId: number }) =>
      request.delete<null>(`/api/rules/lists/${listId}/items/${itemId}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all }),
  });
}

export function usePurgeExpiredRuleListItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listId: number) => request.post<null>(`/api/rules/lists/${listId}/items/purge-expired`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.ruleLists.all }),
  });
}

export function useCheckRuleList() {
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      request.post<{ hit: boolean; listType?: string; item?: { value: string; label?: string | null } }>('/api/rules/lists/check', { key, value }).then(unwrap),
  });
}
