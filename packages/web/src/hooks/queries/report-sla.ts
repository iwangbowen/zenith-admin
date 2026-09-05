import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { reportSlaContract, type ReportSlaRule } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ReportSlaRuleListParams = NonNullable<QueryOf<typeof reportSlaContract.rules>>;
export type ReportSlaViolationListParams = NonNullable<QueryOf<typeof reportSlaContract.violations>>;

/** 规则与违规记录互相派生，任何写操作整域失效 */
export const reportSlaKeys = {
  all: [resourceKeyOf(reportSlaContract.basePath)] as const,
  lists: contractKey(reportSlaContract.rules),
  list: (params: ReportSlaRuleListParams) => contractKey(reportSlaContract.rules, { query: params }),
  detail: (id: number | undefined) => contractKey(reportSlaContract.ruleDetail, { params: { id: id ?? 0 } }),
  violations: (params: ReportSlaViolationListParams) => contractKey(reportSlaContract.violations, { query: params }),
};

const invalidateAll = {
  requestOptions: { silent: true },
  invalidate: (qc: QueryClient) => void qc.invalidateQueries({ queryKey: reportSlaKeys.all }),
} as const;

export function useReportSlaRuleList(params: ReportSlaRuleListParams) {
  return useApiQuery(reportSlaContract.rules, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportSlaRuleDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportSlaContract.ruleDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportSlaRuleValues = Partial<BodyOf<typeof reportSlaContract.createRule>>;

/** 无 id 走 createRule，有 id 走 updateRule（供 useEditModal 使用） */
export function useSaveReportSlaRule() {
  const qc = useQueryClient();
  return useMutation<ReportSlaRule, Error, { id?: number; values: SaveReportSlaRuleValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportSlaContract.createRule, { body: values as BodyOf<typeof reportSlaContract.createRule> }, { silent: true })
      : api(reportSlaContract.updateRule, { params: { id }, body: values }, { silent: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportSlaKeys.all }),
  });
}

export function useDeleteReportSlaRule() {
  return useApiMutation(reportSlaContract.removeRule, invalidateAll);
}

export function useEvaluateReportSlaRule() {
  return useApiMutation(reportSlaContract.evaluate, invalidateAll);
}

export function useReportSlaViolationList(params: ReportSlaViolationListParams) {
  return useApiQuery(reportSlaContract.violations, { query: params }, { placeholderData: keepPreviousData });
}

export function useUpdateReportSlaViolation() {
  return useApiMutation(reportSlaContract.updateViolationStatus, invalidateAll);
}
