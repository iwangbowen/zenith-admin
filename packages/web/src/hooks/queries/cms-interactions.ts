import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsInteractionContract } from '@zenith/shared/cms';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type CmsInteractionListParams = NonNullable<QueryOf<typeof cmsInteractionContract.list>>;

export type CmsInteractionResponseListParams = NonNullable<QueryOf<typeof cmsInteractionContract.responses>>;

const resource = createResourceQueries(cmsInteractionContract);

/** 站点级可选问卷下拉复用列表操作，以固定的大页参数区分（最多 200 条） */
const OPTIONS_PAGE = { page: 1, pageSize: 200 } as const;

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
  /** 可选问卷下拉就是一次列表查询，处在 `lists` 前缀之下：凡失效列表即同时失效下拉 */
  options: (siteId: number | undefined) => contractKey(cmsInteractionContract.list, { query: { siteId: siteId ?? 0, ...OPTIONS_PAGE } }),
};

/** 站点下全部互动问卷（下拉筛选用，最多 200 条）；返回分页载荷，取 `data.list` */
export function useCmsInteractionOptions(siteId: number | undefined) {
  return useApiQuery(cmsInteractionContract.list, { query: { siteId: siteId ?? 0, ...OPTIONS_PAGE } }, {
    enabled: siteId !== undefined,
  });
}

export const useCmsInteractionList = resource.useList;
export const useCmsInteractionDetail = resource.useDetail;

export function useCmsInteractionStats(id: number | undefined, enabled = true) {
  return useApiQuery(cmsInteractionContract.stats, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
  });
}

export function useCmsInteractionResponseList(params: CmsInteractionResponseListParams, enabled = true) {
  return useApiQuery(cmsInteractionContract.responses, { query: params }, {
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
  return useApiQuery(cmsInteractionContract.texts, {
    params: { id: id ?? 0 },
    query: { questionId: questionId ?? 0, page, pageSize, keyword: keyword || undefined },
  }, {
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
  return useApiQuery(cmsInteractionContract.crossStats, {
    params: { id: id ?? 0 },
    query: { xQuestionId: xQuestionId ?? 0, yQuestionId: yQuestionId ?? 0 },
  }, {
    enabled: enabled && id !== undefined && xQuestionId !== undefined && yQuestionId !== undefined,
  });
}

export function useCmsInteractionTrend(id: number | undefined, days: number, enabled = true) {
  return useApiQuery(cmsInteractionContract.trend, { params: { id: id ?? 0 }, query: { days } }, {
    enabled: enabled && id !== undefined,
  });
}

/**
 * 保存问卷定义：工厂失效 detail + lists（下拉在 lists 前缀下随之失效）。stats / texts / cross / trend
 * 是答卷聚合分析，改问卷定义不产生新答卷，不动
 */
export const useSaveCmsInteraction = resource.useSave;

/** 发布/关闭决定问卷是否出现在可选下拉中（下拉即列表查询，lists 前缀已覆盖） */
export function useSetCmsInteractionStatus() {
  return useApiMutation(cmsInteractionContract.setStatus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
    },
  });
}

export function useBatchCmsInteractionStatus() {
  return useApiMutation(cmsInteractionContract.batchStatus, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists }),
  });
}

/** 问卷删除后其详情与全部答卷分析都不再有对应资源；答卷列表带问卷名，需回源 */
export function useDeleteCmsInteraction() {
  return useApiMutation(cmsInteractionContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: cmsInteractionKeys.detail(params.id) });
      qc.removeQueries({ queryKey: cmsInteractionKeys.stats(params.id) });
      void qc.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
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