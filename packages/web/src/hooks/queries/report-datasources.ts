import type { QueryOf } from '@zenith/shared/core';
import { reportDatasourceContract } from '@zenith/shared/report';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { useReportLookup, type ReportLookupParams } from './report-lookups';

export type ReportDatasourceListParams = NonNullable<QueryOf<typeof reportDatasourceContract.list>>;

export const {
  keys: reportDatasourceKeys,
  useList: useReportDatasourceList,
  useDetail: useReportDatasourceDetail,
  useSave: useSaveReportDatasource,
  useDelete: useDeleteReportDatasources,
} = createResourceQueries(reportDatasourceContract);

export function useReportDatasourceLookup(params: ReportLookupParams = {}, enabled = true) {
  return useReportLookup('datasources', params, enabled);
}

/** 连接测试不落库，无需失效任何缓存；错误由弹窗自行展示 */
export function useTestReportDatasourceConnection() {
  return useApiMutation(reportDatasourceContract.test, { requestOptions: { silent: true } });
}

/** 健康检查会回写连接状态字段，列表、详情与下拉源随之刷新 */
export function useRunReportDatasourceHealthCheck() {
  return useApiMutation(reportDatasourceContract.healthCheck, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}

export function useBatchReportDatasourceStatus() {
  return useApiMutation(reportDatasourceContract.batchStatus, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}

/** 克隆只新增一条记录：列表与下拉源刷新，源数据源不受影响 */
export function useCloneReportDatasource() {
  return useApiMutation(reportDatasourceContract.clone, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}
