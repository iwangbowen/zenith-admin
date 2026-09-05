import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { reportAssetContract, type ReportAssetTemplate, type ReportDeprecationNotice, type ReportResourceType } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ReportAssetCatalogParams = NonNullable<QueryOf<typeof reportAssetContract.catalog>>;
export type ReportAssetTopParams = NonNullable<QueryOf<typeof reportAssetContract.topAssets>>;
export type ReportAssetInactiveParams = NonNullable<QueryOf<typeof reportAssetContract.inactiveAssets>>;
export type ReportAssetTrendParams = NonNullable<QueryOf<typeof reportAssetContract.usageTrend>>;
export type ReportDeprecationListParams = NonNullable<QueryOf<typeof reportAssetContract.deprecations>>;
export type ReportAssetTemplateListParams = NonNullable<QueryOf<typeof reportAssetContract.templates>>;

/** 下线公告、资产模板与使用统计（usage / top / inactive / trend）互不相干，分别失效 */
export const reportAssetKeys = {
  lists: contractKey(reportAssetContract.catalog),
  list: (params: ReportAssetCatalogParams) => contractKey(reportAssetContract.catalog, { query: params }),
  usage: (resourceType: ReportResourceType | undefined, id: number | undefined, days: number) =>
    contractKey(reportAssetContract.usage, { params: { resourceType: resourceType ?? 'dashboard', id: id ?? 0 }, query: { days } }),
  top: (params: ReportAssetTopParams) => contractKey(reportAssetContract.topAssets, { query: params }),
  inactive: (params: ReportAssetInactiveParams) => contractKey(reportAssetContract.inactiveAssets, { query: params }),
  trend: (params: ReportAssetTrendParams) => contractKey(reportAssetContract.usageTrend, { query: params }),
  deprecationLists: contractKey(reportAssetContract.deprecations),
  deprecations: (params: ReportDeprecationListParams) => contractKey(reportAssetContract.deprecations, { query: params }),
  templateLists: contractKey(reportAssetContract.templates),
  templates: (params: ReportAssetTemplateListParams) => contractKey(reportAssetContract.templates, { query: params }),
  templateDetail: (id: number | undefined) => contractKey(reportAssetContract.templateDetail, { params: { id: id ?? 0 } }),
};

const silent = { requestOptions: { silent: true } } as const;

export function useReportAssetCatalog(params: ReportAssetCatalogParams) {
  return useApiQuery(reportAssetContract.catalog, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportAssetUsage(resourceType: ReportResourceType | undefined, id: number | undefined, days = 30, enabled = true) {
  return useApiQuery(reportAssetContract.usage, { params: { resourceType: resourceType ?? 'dashboard', id: id ?? 0 }, query: { days } }, {
    enabled: enabled && !!resourceType && !!id,
  });
}

export function useTopReportAssets(params: ReportAssetTopParams) {
  return useApiQuery(reportAssetContract.topAssets, { query: params });
}

export function useInactiveReportAssets(params: ReportAssetInactiveParams) {
  return useApiQuery(reportAssetContract.inactiveAssets, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportAssetUsageTrend(params: ReportAssetTrendParams) {
  return useApiQuery(reportAssetContract.usageTrend, { query: params });
}

// ─── 弃用公告 ───────────────────────────────────────────────────────────────

export function useReportDeprecationList(params: ReportDeprecationListParams, enabled = true) {
  return useApiQuery(reportAssetContract.deprecations, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export type SaveReportDeprecationValues = Partial<BodyOf<typeof reportAssetContract.createDeprecation>>;

/** 无 id 走 createDeprecation，有 id 走 updateDeprecation（供 useEditModal 使用） */
export function useSaveReportDeprecation() {
  const qc = useQueryClient();
  return useMutation<ReportDeprecationNotice, Error, { id?: number; values: SaveReportDeprecationValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportAssetContract.createDeprecation, { body: values as BodyOf<typeof reportAssetContract.createDeprecation> }, { silent: true })
      : api(reportAssetContract.updateDeprecation, { params: { id }, body: values }, { silent: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportAssetKeys.deprecationLists }),
  });
}

export function usePublishReportDeprecation() {
  return useApiMutation(reportAssetContract.publishDeprecation, {
    ...silent,
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportAssetKeys.deprecationLists }),
  });
}

export function useDeleteReportDeprecation() {
  return useApiMutation(reportAssetContract.removeDeprecation, {
    ...silent,
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportAssetKeys.deprecationLists }),
  });
}

// ─── 资产模板 ───────────────────────────────────────────────────────────────

export function useReportAssetTemplateList(params: ReportAssetTemplateListParams) {
  return useApiQuery(reportAssetContract.templates, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportAssetTemplateDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportAssetContract.templateDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportAssetTemplateValues = Partial<BodyOf<typeof reportAssetContract.createTemplate>>;

/** 无 id 走 createTemplate，有 id 走 updateTemplate（供 useEditModal 使用） */
export function useSaveReportAssetTemplate() {
  const qc = useQueryClient();
  return useMutation<ReportAssetTemplate, Error, { id?: number; values: SaveReportAssetTemplateValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportAssetContract.createTemplate, { body: values as BodyOf<typeof reportAssetContract.createTemplate> }, { silent: true })
      : api(reportAssetContract.updateTemplate, { params: { id }, body: values }, { silent: true })),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateDetail(saved.id) });
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists });
    },
  });
}

/** 克隆只新增一条模板，源模板不受影响 */
export function useCloneReportAssetTemplate() {
  return useApiMutation(reportAssetContract.cloneTemplate, {
    ...silent,
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists }),
  });
}

/** 套用会记录使用次数；生成的看板 / 数据集属于各自域，由所在页面自行刷新 */
export function useApplyReportAssetTemplate() {
  return useApiMutation(reportAssetContract.applyTemplate, {
    ...silent,
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateDetail(params.id) });
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists });
    },
  });
}

export function useDeleteReportAssetTemplate() {
  return useApiMutation(reportAssetContract.removeTemplate, {
    ...silent,
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportAssetKeys.templateDetail(params.id) });
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists });
    },
  });
}
