import { keepPreviousData } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { reportQueryCapacityContract } from '@zenith/shared/report';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ReportQueryQuotaListParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.quotas>>;
export type ReportQueryCostLogParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.costLogs>>;
export type ReportQueryCostParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.costStats>>;
export type ReportQueryCostTrendParams = NonNullable<QueryOf<typeof reportQueryCapacityContract.costTrend>>;

/**
 * 配额 / 用量与成本日志、成本统计、成本趋势同页挂载，但后三者由查询执行流水派生，
 * 与配额配置无关——配额的增删改 / 重置只触达配额自身的列表、详情与用量。
 */
export const reportQueryCapacityKeys = {
  all: [resourceKeyOf(reportQueryCapacityContract.basePath)] as const,
  lists: contractKey(reportQueryCapacityContract.quotas),
  list: (params: ReportQueryQuotaListParams) => contractKey(reportQueryCapacityContract.quotas, { query: params }),
  detail: (id: number | undefined) => contractKey(reportQueryCapacityContract.quotaDetail, { params: { id: id ?? 0 } }),
  /** 某个配额的全部用量查询（任意 scopeDate） */
  usageOf: (id: number) => contractKey(reportQueryCapacityContract.quotaUsage, { params: { id }, query: {} }),
  usage: (id: number | undefined, scopeDate?: string) =>
    contractKey(reportQueryCapacityContract.quotaUsage, { params: { id: id ?? 0 }, query: { scopeDate } }),
  costLogs: (params: ReportQueryCostLogParams) => contractKey(reportQueryCapacityContract.costLogs, { query: params }),
  costStats: (params: ReportQueryCostParams) => contractKey(reportQueryCapacityContract.costStats, { query: params }),
  costTrend: (params: ReportQueryCostTrendParams) => contractKey(reportQueryCapacityContract.costTrend, { query: params }),
  /** 成本日志 / 统计 / 趋势的公共前缀：成本筛选条「查询」时一并回源 */
  costLogsLists: contractKey(reportQueryCapacityContract.costLogs),
  costStatsAll: contractKey(reportQueryCapacityContract.costStats),
  costTrendAll: contractKey(reportQueryCapacityContract.costTrend),
};

const silent = { requestOptions: { silent: true } } as const;

export function useReportQueryQuotaList(params: ReportQueryQuotaListParams) {
  return useApiQuery(reportQueryCapacityContract.quotas, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportQueryQuotaDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportQueryCapacityContract.quotaDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportQueryQuotaValues = Partial<BodyOf<typeof reportQueryCapacityContract.createQuota>>;

/**
 * 无 id 走 createQuota，有 id 走 updateQuota（供 useEditModal 使用）。
 * 用量响应带着配额上限（maxConcurrent / dailyXxxLimit），编辑上限后该配额的用量一并回源；新建尚无用量查询。
 */
export function useSaveReportQueryQuota() {
  return useSaveMutation(reportQueryCapacityContract.createQuota, reportQueryCapacityContract.updateQuota, {
    requestOptions: { silent: true },
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.lists });
      void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.usageOf(saved.id) });
    },
  });
}

/** 配额已删除：详情与用量缓存移除而非失效，列表回源 */
export function useDeleteReportQueryQuota() {
  return useApiMutation(reportQueryCapacityContract.removeQuota, {
    ...silent,
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportQueryCapacityKeys.detail(params.id) });
      qc.removeQueries({ queryKey: reportQueryCapacityKeys.usageOf(params.id) });
      void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.lists });
    },
  });
}

export function useReportQueryQuotaUsage(id: number | undefined, scopeDate?: string, enabled = true) {
  return useApiQuery(reportQueryCapacityContract.quotaUsage, { params: { id: id ?? 0 }, query: { scopeDate } }, { enabled: enabled && !!id });
}

/** 重置只清零当日计量：配额本身（列表 / 详情）与成本流水都不变，只有该配额的用量回源 */
export function useResetReportQueryQuota() {
  return useApiMutation(reportQueryCapacityContract.resetQuota, {
    ...silent,
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportQueryCapacityKeys.usageOf(params.id) }),
  });
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
