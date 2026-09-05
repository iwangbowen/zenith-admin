import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { reportDqContract, type ReportDqRule } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ReportDqRuleListParams = NonNullable<QueryOf<typeof reportDqContract.rules>>;
export type ReportDqRunListParams = NonNullable<QueryOf<typeof reportDqContract.runs>>;
export type ReportDqAnomalyListParams = NonNullable<QueryOf<typeof reportDqContract.anomalies>>;

/** 规则、运行历史、评分与异常互相派生，任何写操作整域失效 */
export const reportDqKeys = {
  all: [resourceKeyOf(reportDqContract.basePath)] as const,
  lists: contractKey(reportDqContract.rules),
  list: (params: ReportDqRuleListParams) => contractKey(reportDqContract.rules, { query: params }),
  detail: (id: number | undefined) => contractKey(reportDqContract.ruleDetail, { params: { id: id ?? 0 } }),
  runs: (params: ReportDqRunListParams) => contractKey(reportDqContract.runs, { query: params }),
  anomalies: (params: ReportDqAnomalyListParams) => contractKey(reportDqContract.anomalies, { query: params }),
  scores: (datasetId: number | undefined, params: { page: number; pageSize: number }) =>
    contractKey(reportDqContract.scores, { params: { id: datasetId ?? 0 }, query: params }),
  currentScore: (datasetId: number | undefined) => contractKey(reportDqContract.currentScore, { params: { id: datasetId ?? 0 } }),
};

const invalidateAll = {
  requestOptions: { silent: true },
  invalidate: (qc: QueryClient) => void qc.invalidateQueries({ queryKey: reportDqKeys.all }),
} as const;

export function useReportDqRuleList(params: ReportDqRuleListParams) {
  return useApiQuery(reportDqContract.rules, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportDqRuleDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportDqContract.ruleDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportDqRuleValues = Partial<BodyOf<typeof reportDqContract.createRule>>;

/** 无 id 走 createRule，有 id 走 updateRule（供 useEditModal 使用） */
export function useSaveReportDqRule() {
  const qc = useQueryClient();
  return useMutation<ReportDqRule, Error, { id?: number; values: SaveReportDqRuleValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportDqContract.createRule, { body: values as BodyOf<typeof reportDqContract.createRule> }, { silent: true })
      : api(reportDqContract.updateRule, { params: { id }, body: values }, { silent: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportDqKeys.all }),
  });
}

export function useDeleteReportDqRule() {
  return useApiMutation(reportDqContract.removeRule, invalidateAll);
}

export function useToggleReportDqRule() {
  return useApiMutation(reportDqContract.toggleRule, invalidateAll);
}

export function useRunReportDqRule() {
  return useApiMutation(reportDqContract.runRule, invalidateAll);
}

export function useReportDqRunList(params: ReportDqRunListParams) {
  return useApiQuery(reportDqContract.runs, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportDqScoreHistory(datasetId: number | undefined, params: { page: number; pageSize: number }, enabled = true) {
  return useApiQuery(reportDqContract.scores, { params: { id: datasetId ?? 0 }, query: params }, {
    placeholderData: keepPreviousData,
    enabled: enabled && !!datasetId,
  });
}

export function useCurrentReportDqScore(datasetId: number | undefined, enabled = true) {
  return useApiQuery(reportDqContract.currentScore, { params: { id: datasetId ?? 0 } }, { enabled: enabled && !!datasetId });
}

export function useReportDqAnomalyList(params: ReportDqAnomalyListParams, enabled = true) {
  return useApiQuery(reportDqContract.anomalies, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useUpdateReportDqAnomalyStatus() {
  return useApiMutation(reportDqContract.updateAnomalyStatus, invalidateAll);
}
