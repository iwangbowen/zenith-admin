import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { reportQueryCapacityContract, type ReportQueryQuota } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ReportQueryQuotaListParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.quotas>>;
export type ReportQueryCostLogParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.costLogs>>;
export type ReportQueryCostParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.costStats>>;
export type ReportQueryCostTrendParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.costTrend>>;

/** 配额、用量与成本统计互相派生，任何写操作整域失效 */
export const reportQueryCapacityKeys = {
  all: [resourceKeyOf(reportQueryCapacityContract.basePath)] as const,
  lists: contractKey(reportQueryCapacityContract.quotas),
  list: (params: ReportQueryQuotaListParams) => contractKey(reportQueryCapacityContract.quotas, { query: params }),
  detail: (id: number | undefined) => contractKey(reportQueryCapacityContract.quotaDetail, { params: { id: id ?? 0 } }),
  usage: (id: number | undefined, scopeDate?: string) =>
    contractKey(reportQueryCapacityContract.quotaUsage, { params: { id: id ?? 0 }, query: { scopeDate } }),
  costLogs: (params: ReportQueryCostLogParams) => contractKey(reportQueryCapacityContract.costLogs, { query: params }),
  costStats: (params: ReportQueryCostParams) => contractKey(reportQueryCapacityContract.costStats, { query: params }),
  costTrend: (params: ReportQueryCostTrendParams) => contractKey(reportQueryCapacityContract.costTrend, { query: params }),
};

const invalidateAll = {
  requestOptions: { silent: true },
  invalidate: (qc: QueryClient) => void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.all }),
} as const;

export function useReportQueryQuotaList(params: ReportQueryQuotaListParams) {
  return useApiQuery(reportQueryCapacityContract.quotas, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportQueryQuotaDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportQueryCapacityContract.quotaDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportQueryQuotaValues = Partial<BodyOf<typeof reportQueryCapacityContract.createQuota>>;

/** 无 id 走 createQuota，有 id 走 updateQuota（供 useEditModal 使用） */
export function useSaveReportQueryQuota() {
  const qc = useQueryClient();
  return useMutation<ReportQueryQuota, Error, { id?: number; values: SaveReportQueryQuotaValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportQueryCapacityContract.createQuota, { body: values as BodyOf<typeof reportQueryCapacityContract.createQuota> }, { silent: true })
      : api(reportQueryCapacityContract.updateQuota, { params: { id }, body: values }, { silent: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.all }),
  });
}

export function useDeleteReportQueryQuota() {
  return useApiMutation(reportQueryCapacityContract.removeQuota, invalidateAll);
}

export function useReportQueryQuotaUsage(id: number | undefined, scopeDate?: string, enabled = true) {
  return useApiQuery(reportQueryCapacityContract.quotaUsage, { params: { id: id ?? 0 }, query: { scopeDate } }, { enabled: enabled && !!id });
}

export function useResetReportQueryQuota() {
  return useApiMutation(reportQueryCapacityContract.resetQuota, invalidateAll);
}

export function useReportQueryCostLogs(params: ReportQueryCostLogParams) {
  return useApiQuery(reportQueryCapacityContract.costLogs, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportQueryCostStats(params: ReportQueryCostParams) {
  return useApiQuery(reportQueryCapacityContract.costStats, { query: params });
}

export function useReportQueryCostTrend(params: ReportQueryCostTrendParams) {
  return useApiQuery(reportQueryCapacityContract.costTrend, { query: params });
}
