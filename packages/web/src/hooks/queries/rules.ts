import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  RuleDecisionExecution,
  RuleDecisionTable,
  RuleEvaluateResult,
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
    diff: (id: number | undefined, version: number | null) => ['rules', 'decision-tables', 'diff', id, version] as const,
    cases: (id: number | undefined) => ['rules', 'decision-tables', 'cases', id] as const,
    executions: (params: RuleExecutionsParams) => ['rules', 'decision-tables', 'executions', params] as const,
  },
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

export function useRuleVersionDiff(id: number | undefined, version: number | null, enabled = true) {
  return useQuery({
    queryKey: ruleKeys.decisionTables.diff(id, version),
    queryFn: () => request.get<RuleVersionDiff>(`/api/rules/decision-tables/${id}/diff?from=${version}&to=0`).then(unwrap),
    enabled: enabled && id !== undefined && version !== null,
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
