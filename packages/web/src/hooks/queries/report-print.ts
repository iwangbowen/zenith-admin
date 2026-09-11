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

/**
 * 某流程可绑定的审批单模板：workflow_instance 实体模板中参照为该流程或通用（entityRefId 为空）的已启用模板。
 * 由报表域所有，流程设计器「更多设置」与打印设计器共用。
 */
export function useWorkflowPrintTemplateOptions(definitionId: number | null | undefined, enabled = true) {
  return useReportPrintTemplateList(
    { page: 1, pageSize: 200, status: 'enabled', sourceType: 'entity', entityKind: 'workflow_instance', ...(definitionId ? { entityRefId: definitionId } : {}) },
    enabled,
  );
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
