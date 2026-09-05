import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import {
  reportAiContract,
  reportDatasetContract,
  reportExecutionContract,
  reportMetaContract,
} from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { useReportLookup, type ReportLookupParams } from './report-lookups';

export type ReportDatasetListParams = NonNullable<QueryOf<typeof reportDatasetContract.list>>;
export type ReportExecutionLogParams = NonNullable<QueryOf<typeof reportExecutionContract.list>>;
export type ReportExecutionStatsParams = NonNullable<QueryOf<typeof reportExecutionContract.stats>>;

const resource = createResourceQueries(reportDatasetContract, {
  // 数据集增删改会影响运行治理概览；metaTables / metaColumns 是数据库元数据，与数据集无关
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: reportDatasetKeys.governance }),
  onDeleted: (qc, ids) => {
    for (const id of ids) qc.removeQueries({ queryKey: reportDatasetKeys.refs(id) });
    void qc.invalidateQueries({ queryKey: reportDatasetKeys.governance });
  },
});

/** 数据集变更需要联动刷新的派生视图：下拉源、血缘、治理配置与执行统计 */
export const reportDatasetKeys = {
  ...resource.keys,
  lookup: contractKey(reportDatasetContract.lookup),
  refs: (id: number | undefined) => contractKey(reportDatasetContract.refs, { params: { id: id ?? 0 } }),
  executionLogs: contractKey(reportExecutionContract.list),
  executionStats: contractKey(reportExecutionContract.stats),
  governance: contractKey(reportExecutionContract.governance),
  metaTables: contractKey(reportMetaContract.tables),
  metaColumns: (table: string) => contractKey(reportMetaContract.columns, { params: { table } }),
};

export const useReportDatasetList = resource.useList;
export const useReportDatasetDetail = resource.useDetail;
export const useSaveReportDataset = resource.useSave;
export const useDeleteReportDatasets = resource.useDelete;

/** 数据集下游引用（血缘弹窗） */
export function useReportDatasetRefs(id: number | undefined, enabled = true) {
  return useApiQuery(reportDatasetContract.refs, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

/** 可视化建模：内置库可用表清单 */
export function useReportMetaTables(enabled = true) {
  return useApiQuery(reportMetaContract.tables, { staleTime: LOOKUP_STALE_TIME, enabled });
}

/** 可视化建模：某表列清单 */
export function useReportMetaColumns(table: string | undefined, enabled = true) {
  return useApiQuery(reportMetaContract.columns, { params: { table: table ?? '' } }, {
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && !!table,
  });
}

export function useReportDatasetLookup(params: ReportLookupParams = {}, enabled = true) {
  return useReportLookup('datasets', params, enabled);
}

export function useEnabledReportDatasets(keyword?: string, enabled = true) {
  return useReportDatasetLookup({ keyword, status: 'enabled', limit: 50 }, enabled);
}

export function useEnabledReportDatasources(keyword?: string, enabled = true) {
  return useReportLookup('datasources', { keyword, status: 'enabled', limit: 50 }, enabled);
}

export function useReportDatasetExecutionLogs(params: ReportExecutionLogParams, enabled = true) {
  return useApiQuery(reportExecutionContract.list, { query: params }, { enabled, placeholderData: keepPreviousData });
}

export function useReportDatasetExecutionStats(params: ReportExecutionStatsParams, enabled = true) {
  return useApiQuery(reportExecutionContract.stats, { query: params }, { enabled });
}

export function useReportRuntimeGovernance(enabled = true) {
  return useApiQuery(reportExecutionContract.governance, { enabled });
}

/** 试跑预览不落库，无需失效缓存 */
export function usePreviewReportDataset() {
  return useApiMutation(reportDatasetContract.preview, { requestOptions: { silent: true } });
}

/** 上传 Excel / CSV 解析为列与数据行（multipart，变量为 { body: FormData }） */
export function useParseReportDatasetFile() {
  return useApiMutation(reportDatasetContract.parseFile, { requestOptions: { silent: true } });
}

export function useGenerateReportDatasetSql() {
  return useApiMutation(reportAiContract.nl2sql, { requestOptions: { silent: true } });
}

/** 物化刷新改变数据集行数 / 更新时间，并产生一条执行记录 */
export function useRefreshReportDatasetMaterialize() {
  return useApiMutation(reportDatasetContract.materialize, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.executionLogs });
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.executionStats });
    },
  });
}

/** 停用会从可选数据集下拉中移除 */
export function useBatchReportDatasetStatus() {
  return useApiMutation(reportDatasetContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.lookup });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: reportDatasetKeys.detail(id) });
    },
  });
}

/** 克隆只新增一条记录，源数据集不受影响 */
export function useCloneReportDataset() {
  return useApiMutation(reportDatasetContract.clone, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.lookup });
    },
  });
}
