import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { reportMetricContract } from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type ReportMetricListParams = NonNullable<QueryOf<typeof reportMetricContract.list>>;
export type ReportMetricLookupParams = NonNullable<QueryOf<typeof reportMetricContract.lookup>>;

const resource = createResourceQueries(reportMetricContract, {
  requestOptions: { silent: true },
  // 可选指标下拉按状态过滤，增删改后随之刷新
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: reportMetricKeys.lookup }),
  onDeleted: (qc, ids) => {
    for (const id of ids) qc.removeQueries({ queryKey: reportMetricKeys.refs(id) });
    void qc.invalidateQueries({ queryKey: reportMetricKeys.lookup });
  },
});

export const reportMetricKeys = {
  ...resource.keys,
  lookup: contractKey(reportMetricContract.lookup),
  refs: (id: number | undefined) => contractKey(reportMetricContract.refs, { params: { id: id ?? 0 } }),
};

export function useReportMetricList(params: ReportMetricListParams) {
  return useApiQuery(reportMetricContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export const useReportMetricDetail = resource.useDetail;
export const useSaveReportMetric = resource.useSave;
export const useDeleteReportMetrics = resource.useDelete;

export function useReportMetricLookup(params: ReportMetricLookupParams = {}, enabled = true) {
  return useApiQuery(reportMetricContract.lookup, { query: params }, { staleTime: LOOKUP_STALE_TIME, enabled });
}

export function useReportMetricRefs(id: number | undefined, enabled = true) {
  return useApiQuery(reportMetricContract.refs, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

/** 计算结果只在弹窗内消费，不进入缓存 */
export function useEvaluateReportMetric() {
  return useApiMutation(reportMetricContract.evaluate, { requestOptions: { silent: true } });
}

const LIFECYCLE_OPS = {
  publish: reportMetricContract.publish,
  deprecate: reportMetricContract.deprecate,
} as const;

/** 发布 / 废弃改变生命周期状态：详情、列表与按状态过滤的下拉源都要回源 */
function useReportMetricLifecycle(action: keyof typeof LIFECYCLE_OPS) {
  return useApiMutation(LIFECYCLE_OPS[action], {
    requestOptions: { silent: true },
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: reportMetricKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportMetricKeys.lists });
      void qc.invalidateQueries({ queryKey: reportMetricKeys.lookup });
    },
  });
}

export function usePublishReportMetric() {
  return useReportMetricLifecycle('publish');
}

export function useDeprecateReportMetric() {
  return useReportMetricLifecycle('deprecate');
}
