import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsSearchContract, cmsStaticContract, type CmsHotwordGroup, type CmsSearchWord } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, useApiMutation } from '@/lib/contract-query';

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
  test: (params: CmsSearchTestParams) => contractKey(cmsSearchContract.test, { query: { ...params, siteId: params.siteId ?? 0, pageSize: 10 } }),
  segment: (siteId: number | undefined, text: string) => contractKey(cmsSearchContract.segment, { query: { siteId: siteId ?? 0, text } }),
};

export function useCmsSearchTest(params: CmsSearchTestParams, enabled: boolean) {
  return useQuery({
    ...apiQueryOptions(cmsSearchContract.test, { query: { ...params, siteId: params.siteId ?? 0, pageSize: 10 } }),
    enabled: enabled && params.siteId !== undefined && !!params.keyword,
    placeholderData: keepPreviousData,
  });
}

export function useCmsSegmentPreview(siteId: number | undefined, text: string, enabled: boolean) {
  return useQuery({
    ...apiQueryOptions(cmsSearchContract.segment, { query: { siteId: siteId ?? 0, text } }),
    enabled: enabled && siteId !== undefined && !!text,
  });
}

// ─── 检索词典 / 热词 ──────────────────────────────────────────────────────────
export type CmsSearchWordListParams = NonNullable<QueryOf<typeof cmsSearchContract.wordList>>;

export type CmsHotKeywordParams = Omit<NonNullable<QueryOf<typeof cmsSearchContract.hotKeywords>>, 'siteId' | 'limit'> & { siteId: number | undefined };

/** 词典、热词、热词分组共用一个失效根：改词典会重建站点词典，热词榜与分组互相引用 */
export const cmsSearchWordKeys = {
  lists: contractKey(cmsSearchContract.wordList),
  hotLists: contractKey(cmsSearchContract.hotKeywords),
  groupLists: contractKey(cmsSearchContract.hotwordGroups),
  list: (params: CmsSearchWordListParams) => contractKey(cmsSearchContract.wordList, { query: params }),
  hot: (params: CmsHotKeywordParams) => contractKey(cmsSearchContract.hotKeywords, { query: { ...params, siteId: params.siteId ?? 0, limit: 200 } }),
  groups: (siteId: number | undefined) => contractKey(cmsSearchContract.hotwordGroups, { query: { siteId: siteId ?? 0 } }),
};

function useInvalidateSearchWords() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.lists });
    void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.hotLists });
    void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.groupLists });
  };
}

export function useCmsSearchWordList(params: CmsSearchWordListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSearchContract.wordList, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type CmsSearchWordSaveValues = Partial<BodyOf<typeof cmsSearchContract.wordCreate>>;

export function useSaveCmsSearchWord() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CmsSearchWordSaveValues }): Promise<CmsSearchWord> =>
      id === undefined
        ? api(cmsSearchContract.wordCreate, { body: values as BodyOf<typeof cmsSearchContract.wordCreate> })
        : api(cmsSearchContract.wordUpdate, { params: { id }, body: values }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCmsSearchWord() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: (id: number) => api(cmsSearchContract.wordRemove, { params: { id } }),
    onSuccess: () => invalidate(),
  });
}

export type CmsSearchWordBatchInput =
  | { action: 'update'; body: BodyOf<typeof cmsSearchContract.wordBatchUpdate> }
  | { action: 'delete'; body: BodyOf<typeof cmsSearchContract.wordBatchRemove> };

export function useBatchCmsSearchWords() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: (input: CmsSearchWordBatchInput) =>
      input.action === 'update'
        ? api(cmsSearchContract.wordBatchUpdate, { body: input.body })
        : api(cmsSearchContract.wordBatchRemove, { body: input.body }),
    onSuccess: () => invalidate(),
  });
}

export function useCmsHotKeywords(params: CmsHotKeywordParams) {
  return useQuery({
    ...apiQueryOptions(cmsSearchContract.hotKeywords, { query: { ...params, siteId: params.siteId ?? 0, limit: 200 } }),
    enabled: params.siteId !== undefined,
  });
}

export function useCmsHotwordGroups(siteId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsSearchContract.hotwordGroups, { query: { siteId: siteId ?? 0 } }),
    enabled: siteId !== undefined,
  });
}

export type CmsHotwordGroupSaveValues = Partial<BodyOf<typeof cmsSearchContract.hotwordGroupCreate>>;

export function useSaveCmsHotwordGroup() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CmsHotwordGroupSaveValues }): Promise<CmsHotwordGroup> =>
      id === undefined
        ? api(cmsSearchContract.hotwordGroupCreate, { body: values as BodyOf<typeof cmsSearchContract.hotwordGroupCreate> })
        : api(cmsSearchContract.hotwordGroupUpdate, { params: { id }, body: values }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCmsHotwordGroup() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: (id: number) => api(cmsSearchContract.hotwordGroupRemove, { params: { id } }),
    onSuccess: () => invalidate(),
  });
}

export type CmsHotwordSaveValues = Partial<BodyOf<typeof cmsSearchContract.hotwordCreate>>;

export function useSaveCmsHotword() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CmsHotwordSaveValues }): Promise<null> =>
      id === undefined
        ? api(cmsSearchContract.hotwordCreate, { body: values as BodyOf<typeof cmsSearchContract.hotwordCreate> })
        : api(cmsSearchContract.hotwordUpdate, { params: { id }, body: values }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCmsHotword() {
  const invalidate = useInvalidateSearchWords();
  return useMutation({
    mutationFn: (id: number) => api(cmsSearchContract.hotwordRemove, { params: { id } }),
    onSuccess: () => invalidate(),
  });
}

export function useClearCmsHotKeywords() {
  return useApiMutation(cmsSearchContract.clearHotKeywords, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsSearchWordKeys.hotLists }),
  });
}
