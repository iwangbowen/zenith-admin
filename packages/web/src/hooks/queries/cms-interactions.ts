import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsInteractionContract } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsInteractionListParams = NonNullable<QueryOf<typeof cmsInteractionContract.list>>;

export type CmsInteractionResponseListParams = NonNullable<QueryOf<typeof cmsInteractionContract.responses>>;

const resource = createResourceQueries(cmsInteractionContract);

export const cmsInteractionKeys = {
  ...resource.keys,
  stats: (id: number | undefined) => contractKey(cmsInteractionContract.stats, { params: { id: id ?? 0 } }),
  texts: (id: number | undefined, questionId: number | undefined, page: number, pageSize: number, keyword: string) =>
    contractKey(cmsInteractionContract.texts, { params: { id: id ?? 0 }, query: { questionId: questionId ?? 0, page, pageSize, keyword: keyword || undefined } }),
  cross: (id: number | undefined, x: number | undefined, y: number | undefined) =>
    contractKey(cmsInteractionContract.crossStats, { params: { id: id ?? 0 }, query: { xQuestionId: x ?? 0, yQuestionId: y ?? 0 } }),
  trend: (id: number | undefined, days: number) => contractKey(cmsInteractionContract.trend, { params: { id: id ?? 0 }, query: { days } }),
  responseLists: contractKey(cmsInteractionContract.responses),
  responseList: (params: CmsInteractionResponseListParams) => contractKey(cmsInteractionContract.responses, { query: params }),
  /** 站点级可选问卷下拉：复用列表操作，以固定的大页参数区分 */
  optionsPrefix: [...contractKey(cmsInteractionContract.list), 'options'] as const,
  options: (siteId: number | undefined) => [...contractKey(cmsInteractionContract.list), 'options', siteId] as const,
};

/** 站点下全部互动问卷（下拉筛选用，最多 200 条） */
export function useCmsInteractionOptions(siteId: number | undefined) {
  return useQuery({
    queryKey: cmsInteractionKeys.options(siteId),
    queryFn: () => api(cmsInteractionContract.list, { query: { siteId: siteId ?? 0, page: 1, pageSize: 200 } }).then((data) => data.list),
    enabled: siteId !== undefined,
  });
}

export const useCmsInteractionList = resource.useList;
export const useCmsInteractionDetail = resource.useDetail;

export function useCmsInteractionStats(id: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsInteractionContract.stats, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function useCmsInteractionResponseList(params: CmsInteractionResponseListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsInteractionContract.responses, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 文本 / 日期 /「其他」填空答案分页 */
export function useCmsInteractionTexts(
  id: number | undefined,
  questionId: number | undefined,
  page: number,
  pageSize: number,
  keyword: string,
  enabled = true,
) {
  return useQuery({
    ...apiQueryOptions(cmsInteractionContract.texts, {
      params: { id: id ?? 0 },
      query: { questionId: questionId ?? 0, page, pageSize, keyword: keyword || undefined },
    }),
    placeholderData: keepPreviousData,
    enabled: enabled && id !== undefined && questionId !== undefined,
  });
}

export function useCmsInteractionCrossStats(
  id: number | undefined,
  xQuestionId: number | undefined,
  yQuestionId: number | undefined,
  enabled = true,
) {
  return useQuery({
    ...apiQueryOptions(cmsInteractionContract.crossStats, {
      params: { id: id ?? 0 },
      query: { xQuestionId: xQuestionId ?? 0, yQuestionId: yQuestionId ?? 0 },
    }),
    enabled: enabled && id !== undefined && xQuestionId !== undefined && yQuestionId !== undefined,
  });
}

export function useCmsInteractionTrend(id: number | undefined, days: number, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsInteractionContract.trend, { params: { id: id ?? 0 }, query: { days } }),
    enabled: enabled && id !== undefined,
  });
}

/**
 * 保存问卷定义：工厂失效 detail + lists。stats / texts / cross / trend 是答卷聚合分析，
 * 改问卷定义不产生新答卷；options 是站点级可选问卷下拉，仅在发布状态变化时才需刷新
 */
export const useSaveCmsInteraction = resource.useSave;

/** 发布/关闭决定问卷是否出现在可选下拉中 */
export function useSetCmsInteractionStatus() {
  return useApiMutation(cmsInteractionContract.setStatus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.optionsPrefix });
    },
  });
}

export function useBatchCmsInteractionStatus() {
  return useApiMutation(cmsInteractionContract.batchStatus, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.optionsPrefix });
    },
  });
}

/** 问卷删除后其详情与全部答卷分析都不再有对应资源 */
export function useDeleteCmsInteraction() {
  return useApiMutation(cmsInteractionContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: cmsInteractionKeys.detail(params.id) });
      qc.removeQueries({ queryKey: cmsInteractionKeys.stats(params.id) });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.optionsPrefix });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.responseLists });
    },
  });
}

/** 复制只新增一份草稿，源问卷与其答卷分析都不受影响 */
export function useCopyCmsInteraction() {
  return useApiMutation(cmsInteractionContract.copy, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists }),
  });
}
