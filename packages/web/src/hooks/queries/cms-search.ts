import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsSearchContract, cmsStaticContract } from '@zenith/shared/cms';
import { api, useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

// ─── 静态化 / 索引重建（任务中心执行）────────────────────────────────────────
export function useCmsStaticBuild() {
  return useApiMutation(cmsStaticContract.build);
}

export function useCmsSearchReindex() {
  return useApiMutation(cmsSearchContract.reindex);
}

// ─── 检索测试 / 分词预览 ─────────────────────────────────────────────────────
export type CmsSearchTestParams = { siteId: number | undefined; keyword: string; page: number };

export const cmsSearchKeys = {
  tests: contractKey(cmsSearchContract.test),
  test: (params: CmsSearchTestParams) => contractKey(cmsSearchContract.test, { query: { ...params, siteId: params.siteId ?? 0, pageSize: 10 } }),
  segments: contractKey(cmsSearchContract.segment),
  segment: (siteId: number | undefined, text: string) => contractKey(cmsSearchContract.segment, { query: { siteId: siteId ?? 0, text } }),
};

export function useCmsSearchTest(params: CmsSearchTestParams, enabled: boolean) {
  return useApiQuery(cmsSearchContract.test, { query: { ...params, siteId: params.siteId ?? 0, pageSize: 10 } }, {
    enabled: enabled && params.siteId !== undefined && !!params.keyword,
    placeholderData: keepPreviousData,
  });
}

export function useCmsSegmentPreview(siteId: number | undefined, text: string, enabled: boolean) {
  return useApiQuery(cmsSearchContract.segment, { query: { siteId: siteId ?? 0, text } }, {
    enabled: enabled && siteId !== undefined && !!text,
  });
}

// ─── 检索词典 / 热词 ──────────────────────────────────────────────────────────
export type CmsSearchWordListParams = NonNullable<QueryOf<typeof cmsSearchContract.wordList>>;

export type CmsHotKeywordParams = Omit<NonNullable<QueryOf<typeof cmsSearchContract.hotKeywords>>, 'siteId' | 'limit'> & { siteId: number | undefined };

export const cmsSearchWordKeys = {
  lists: contractKey(cmsSearchContract.wordList),
  hotLists: contractKey(cmsSearchContract.hotKeywords),
  groupLists: contractKey(cmsSearchContract.hotwordGroups),
  list: (params: CmsSearchWordListParams) => contractKey(cmsSearchContract.wordList, { query: params }),
  hot: (params: CmsHotKeywordParams) => contractKey(cmsSearchContract.hotKeywords, { query: { ...params, siteId: params.siteId ?? 0, limit: 200 } }),
  groups: (siteId: number | undefined) => contractKey(cmsSearchContract.hotwordGroups, { query: { siteId: siteId ?? 0 } }),
};

/**
 * 自定义词典变化（新增 / 编辑 / 删除 / 批量）后的失效面：词典列表，以及依赖站点词典即时生效的
 * 分词预览与检索测试（关键词分词随词典变化）。热词榜与热词分组来自搜索日志与热词表，与词典无关，不动。
 */
export function invalidateAfterCmsSearchWordChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsSearchKeys.segments });
  void qc.invalidateQueries({ queryKey: cmsSearchKeys.tests });
}

/**
 * 热词 / 热词分组变化后的失效面：热词榜条目带 groupId / groupName，分组改名、删除或热词改组都会改变榜单；
 * 分组列表本身在分组增删改时变化。词典列表与检索测试不引用热词，不动。
 */
export function invalidateAfterCmsHotwordChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.hotLists });
  void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.groupLists });
}

export function useCmsSearchWordList(params: CmsSearchWordListParams, enabled = true) {
  return useApiQuery(cmsSearchContract.wordList, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type CmsSearchWordSaveValues = Partial<BodyOf<typeof cmsSearchContract.wordCreate>>;

export function useSaveCmsSearchWord() {
  return useSaveMutation(cmsSearchContract.wordCreate, cmsSearchContract.wordUpdate, {
    invalidate: invalidateAfterCmsSearchWordChange,
  });
}

export function useDeleteCmsSearchWord() {
  return useApiMutation(cmsSearchContract.wordRemove, { invalidate: invalidateAfterCmsSearchWordChange });
}

export type CmsSearchWordBatchInput =
  | { action: 'update'; body: BodyOf<typeof cmsSearchContract.wordBatchUpdate> }
  | { action: 'delete'; body: BodyOf<typeof cmsSearchContract.wordBatchRemove> };

/**
 * 批量更新分组 / 状态或批量删除词条。
 * H5：mutationFn 按 action 在两个契约操作间分派，不是单一契约操作，故保留手写 useMutation。
 */
export function useBatchCmsSearchWords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CmsSearchWordBatchInput) =>
      input.action === 'update'
        ? api(cmsSearchContract.wordBatchUpdate, { body: input.body })
        : api(cmsSearchContract.wordBatchRemove, { body: input.body }),
    onSuccess: () => invalidateAfterCmsSearchWordChange(qc),
  });
}

export function useCmsHotKeywords(params: CmsHotKeywordParams) {
  return useApiQuery(cmsSearchContract.hotKeywords, { query: { ...params, siteId: params.siteId ?? 0, limit: 200 } }, {
    enabled: params.siteId !== undefined,
  });
}

export function useCmsHotwordGroups(siteId: number | undefined) {
  return useApiQuery(cmsSearchContract.hotwordGroups, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
  });
}

export type CmsHotwordGroupSaveValues = Partial<BodyOf<typeof cmsSearchContract.hotwordGroupCreate>>;

export function useSaveCmsHotwordGroup() {
  return useSaveMutation(cmsSearchContract.hotwordGroupCreate, cmsSearchContract.hotwordGroupUpdate, {
    invalidate: invalidateAfterCmsHotwordChange,
  });
}

export function useDeleteCmsHotwordGroup() {
  return useApiMutation(cmsSearchContract.hotwordGroupRemove, { invalidate: invalidateAfterCmsHotwordChange });
}

export type CmsHotwordSaveValues = Partial<BodyOf<typeof cmsSearchContract.hotwordCreate>>;

export function useSaveCmsHotword() {
  return useSaveMutation(cmsSearchContract.hotwordCreate, cmsSearchContract.hotwordUpdate, {
    invalidate: invalidateAfterCmsHotwordChange,
  });
}

export function useDeleteCmsHotword() {
  return useApiMutation(cmsSearchContract.hotwordRemove, { invalidate: invalidateAfterCmsHotwordChange });
}

/** 清空只删搜索日志聚合出的榜单条目，分组定义不变 */
export function useClearCmsHotKeywords() {
  return useApiMutation(cmsSearchContract.clearHotKeywords, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.hotLists }),
  });
}