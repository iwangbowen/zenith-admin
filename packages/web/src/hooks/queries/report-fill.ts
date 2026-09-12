import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { reportFillContract, type ReportFillRecord, type ReportFillTemplate } from '@zenith/shared/report';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { asyncTaskKeys } from './async-tasks';
import { reportDatasetKeys } from './report-datasets';

export type ReportFillTemplateListParams = NonNullable<QueryOf<typeof reportFillContract.templates>>;
export type ReportFillMineParams = NonNullable<QueryOf<typeof reportFillContract.myRecords>>;
export type ReportFillAdminParams = NonNullable<QueryOf<typeof reportFillContract.adminRecords>>;

export const reportFillKeys = {
  templateLists: contractKey(reportFillContract.templates),
  templateList: (params: ReportFillTemplateListParams) => contractKey(reportFillContract.templates, { query: params }),
  templateDetail: (id: number | undefined) => contractKey(reportFillContract.templateDetail, { params: { id: id ?? 0 } }),
  templateLookup: contractKey(reportFillContract.templateLookup),
  recordMineLists: contractKey(reportFillContract.myRecords),
  recordMine: (params: ReportFillMineParams) => contractKey(reportFillContract.myRecords, { query: params }),
  recordAdminLists: contractKey(reportFillContract.adminRecords),
  recordAdmin: (params: ReportFillAdminParams) => contractKey(reportFillContract.adminRecords, { query: params }),
  recordDetail: (id: number | undefined) => contractKey(reportFillContract.recordDetail, { params: { id: id ?? 0 } }),
};

const silent = { silent: true } as const;

export function useReportFillTemplateList(params: ReportFillTemplateListParams) {
  return useApiQuery(reportFillContract.templates, { query: params }, { placeholderData: keepPreviousData, requestOptions: silent });
}

export function useReportFillTemplateDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportFillContract.templateDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id, requestOptions: silent });
}

export function useReportFillTemplateLookup(enabled = true) {
  return useApiQuery(reportFillContract.templateLookup, { enabled, staleTime: LOOKUP_STALE_TIME, requestOptions: silent });
}

export function useReportFillRecordMine(params: ReportFillMineParams) {
  return useApiQuery(reportFillContract.myRecords, { query: params }, { placeholderData: keepPreviousData, requestOptions: silent });
}

export function useReportFillRecordAdmin(params: ReportFillAdminParams, enabled = true) {
  return useApiQuery(reportFillContract.adminRecords, { query: params }, { placeholderData: keepPreviousData, enabled, requestOptions: silent });
}

/** 同步进行中的记录轮询直到落库完成 */
export function useReportFillRecordDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportFillContract.recordDetail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    requestOptions: silent,
    refetchInterval: (query) => {
      const record = query.state.data;
      return record && (record.syncStatus === 'pending' || record.syncStatus === 'running') ? 3000 : false;
    },
  });
}

// ─── 模板 ───────────────────────────────────────────────────────────────────

function invalidateTemplates(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: reportFillKeys.templateLists });
  void qc.invalidateQueries({ queryKey: reportFillKeys.templateLookup });
}

function applyTemplate(qc: QueryClient, template: ReportFillTemplate) {
  qc.setQueryData(reportFillKeys.templateDetail(template.id), template);
  invalidateTemplates(qc);
}

export function useCreateReportFillTemplate() {
  return useApiMutation(reportFillContract.createTemplate, { requestOptions: silent, invalidate: invalidateTemplates });
}

export function useUpdateReportFillTemplate() {
  return useApiMutation(reportFillContract.updateTemplate, { requestOptions: silent, invalidate: applyTemplate });
}

export function useChangeReportFillTemplateLifecycle() {
  return useApiMutation(reportFillContract.templateLifecycle, { requestOptions: silent, invalidate: applyTemplate });
}

export function useCloneReportFillTemplate() {
  return useApiMutation(reportFillContract.cloneTemplate, { requestOptions: silent, invalidate: invalidateTemplates });
}

export function useDeleteReportFillTemplate() {
  return useApiMutation(reportFillContract.removeTemplate, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportFillKeys.templateDetail(params.id) });
      invalidateTemplates(qc);
    },
  });
}

// ─── 记录 ───────────────────────────────────────────────────────────────────

/**
 * 记录状态流转（新建 / 编辑 / 提交 / 撤回 / 取消 / 审核）后的失效面：
 * - 详情用响应回填（写接口与详情同源），我的 / 管理两份记录列表回源
 * - 流转会触发一次同步任务：任务中心列表与统计多出一条记录（items 属于既有任务，types 是元数据，都不动）
 * - 已生成数据集的记录：worker 会把数据行回写进该数据集——数据集的列表 / 详情 / 下拉源 / 治理概览
 *   与该数据集的取数缓存一并标脏；其它数据集与数据库元数据（metaTables / metaColumns）不受影响
 */
function applyRecord(qc: QueryClient, record: ReportFillRecord) {
  qc.setQueryData(reportFillKeys.recordDetail(record.id), record);
  void qc.invalidateQueries({ queryKey: reportFillKeys.recordMineLists });
  void qc.invalidateQueries({ queryKey: reportFillKeys.recordAdminLists });
  void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
  void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
  if (record.generatedDatasetId) {
    void qc.invalidateQueries({ queryKey: reportDatasetKeys.lists });
    void qc.invalidateQueries({ queryKey: reportDatasetKeys.detail(record.generatedDatasetId) });
    void qc.invalidateQueries({ queryKey: reportDatasetKeys.lookup });
    void qc.invalidateQueries({ queryKey: reportDatasetKeys.governance });
    void qc.invalidateQueries({ queryKey: reportDatasetKeys.dataOf(record.generatedDatasetId) });
  }
}

export function useCreateReportFillRecord() {
  return useApiMutation(reportFillContract.createRecord, { requestOptions: silent, invalidate: applyRecord });
}

export function useUpdateReportFillRecord() {
  return useApiMutation(reportFillContract.updateRecord, { requestOptions: silent, invalidate: applyRecord });
}

export function useSubmitReportFillRecord() {
  return useApiMutation(reportFillContract.submitRecord, { requestOptions: silent, invalidate: applyRecord });
}

export function useWithdrawReportFillRecord() {
  return useApiMutation(reportFillContract.withdrawRecord, { requestOptions: silent, invalidate: applyRecord });
}

export function useCancelReportFillRecord() {
  return useApiMutation(reportFillContract.cancelRecord, { requestOptions: silent, invalidate: applyRecord });
}

export function useReviewReportFillRecord() {
  return useApiMutation(reportFillContract.reviewRecord, { requestOptions: silent, invalidate: applyRecord });
}
