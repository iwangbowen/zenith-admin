import type { QueryOf } from '@zenith/shared/core';
import { reportPrintContract } from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { useReportLookup, type ReportLookupParams } from './report-lookups';

export type ReportPrintTemplateListParams = NonNullable<QueryOf<typeof reportPrintContract.list>>;

const resource = createResourceQueries(reportPrintContract, {
  // 契约无 all 操作，工厂不会替我们失效下拉源：名称 / 状态变化后 lookup 操作前缀一并回源
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: reportPrintKeys.lookup }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: reportPrintKeys.lookup }),
});

export const reportPrintKeys = {
  ...resource.keys,
  /** 轻量下拉源（lookup 操作前缀，覆盖 useReportLookup('print') 的全部关键字 / 状态变体）；契约无 all 操作 */
  lookup: contractKey(reportPrintContract.lookup),
};

export const useReportPrintTemplateList = resource.useList;
export const useReportPrintTemplateDetail = resource.useDetail;
export const useSaveReportPrintTemplate = resource.useSave;
export const useDeleteReportPrintTemplates = resource.useDelete;

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

/** 批量启停改写若干模板的 status：列表、各自详情与按 status 过滤的下拉源回源 */
export function useBatchReportPrintTemplateStatus() {
  return useApiMutation(reportPrintContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: reportPrintKeys.lists });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: reportPrintKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: reportPrintKeys.lookup });
    },
  });
}

/** 克隆只新增一条记录：列表与下拉源刷新，源模板不受影响 */
export function useCloneReportPrintTemplate() {
  return useApiMutation(reportPrintContract.clone, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: reportPrintKeys.lists });
      void qc.invalidateQueries({ queryKey: reportPrintKeys.lookup });
    },
  });
}
