import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { reportDatasourceContract } from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { asyncTaskKeys } from './async-tasks';
import { useReportLookup, type ReportLookupParams } from './report-lookups';

export type ReportDatasourceListParams = NonNullable<QueryOf<typeof reportDatasourceContract.list>>;

const resource = createResourceQueries(reportDatasourceContract, {
  // 契约无 all 操作，工厂不会替我们失效下拉源：名称 / 状态变化后 lookup 操作前缀一并回源
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lookup }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lookup }),
});

export const reportDatasourceKeys = {
  ...resource.keys,
  /** 轻量下拉源（lookup 操作前缀，覆盖 useReportLookup('datasources') 的全部关键字 / 状态变体）；契约无 all 操作 */
  lookup: contractKey(reportDatasourceContract.lookup),
};

export const useReportDatasourceList = resource.useList;
export const useReportDatasourceDetail = resource.useDetail;
export const useSaveReportDatasource = resource.useSave;
export const useDeleteReportDatasources = resource.useDelete;

export function useReportDatasourceLookup(params: ReportLookupParams = {}, enabled = true) {
  return useReportLookup('datasources', params, enabled);
}

/** 连接测试不落库，无需失效任何缓存；错误由弹窗自行展示 */
export function useTestReportDatasourceConnection() {
  return useApiMutation(reportDatasourceContract.test, { requestOptions: { silent: true } });
}

/** 若干数据源的行内字段（status / 连接状态）变化：列表与各自详情回源；下拉源按 status 过滤，仅在启停时一并失效 */
function invalidateDatasourceRows(qc: QueryClient, ids: number[], withLookup: boolean) {
  void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lists });
  for (const id of ids) void qc.invalidateQueries({ queryKey: reportDatasourceKeys.detail(id) });
  if (withLookup) void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lookup });
}

/**
 * 健康检查是异步任务：立刻可见的副作用是任务中心多了一条记录（列表与统计）；
 * 连接状态由 worker 回写，把被检查数据源的列表 / 详情标脏，让它们在回源或下次挂载时拿到最新状态。
 * 下拉源不含健康字段，不动。
 */
export function useRunReportDatasourceHealthCheck() {
  return useApiMutation(reportDatasourceContract.healthCheck, {
    invalidate: (qc, _task, { body }) => {
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
      invalidateDatasourceRows(qc, body.ids, false);
    },
  });
}

export function useBatchReportDatasourceStatus() {
  return useApiMutation(reportDatasourceContract.batchStatus, {
    invalidate: (qc, _output, { body }) => invalidateDatasourceRows(qc, body.ids, true),
  });
}

/** 克隆只新增一条记录：列表与下拉源刷新，源数据源不受影响 */
export function useCloneReportDatasource() {
  return useApiMutation(reportDatasourceContract.clone, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lookup });
    },
  });
}
