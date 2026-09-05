import type { QueryOf } from '@zenith/shared/core';
import { reportPrintContract } from '@zenith/shared/report';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { useReportLookup, type ReportLookupParams } from './report-lookups';

export type ReportPrintTemplateListParams = NonNullable<QueryOf<typeof reportPrintContract.list>>;

export const {
  keys: reportPrintKeys,
  useList: useReportPrintTemplateList,
  useDetail: useReportPrintTemplateDetail,
  useSave: useSaveReportPrintTemplate,
  useDelete: useDeleteReportPrintTemplates,
} = createResourceQueries(reportPrintContract);

export function useReportPrintTemplateLookup(params: ReportLookupParams = {}, enabled = true) {
  return useReportLookup('print', params, enabled);
}

/** 渲染结果只在预览弹窗内消费，不进入缓存 */
export function useRenderReportPrintTemplate() {
  return useApiMutation(reportPrintContract.render, { requestOptions: { silent: true } });
}

export function useBatchReportPrintTemplateStatus() {
  return useApiMutation(reportPrintContract.batchStatus, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportPrintKeys.all }),
  });
}

export function useCloneReportPrintTemplate() {
  return useApiMutation(reportPrintContract.clone, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportPrintKeys.all }),
  });
}
