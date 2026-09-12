import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type InputOf, type QueryOf } from '@zenith/shared/core';
import { wikiCommentContract } from '@zenith/shared/wiki';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { wikiDocKeys } from './wiki-docs';
import { wikiStatsKeys } from './wiki-query-keys';

export type WikiCommentListParams = NonNullable<QueryOf<typeof wikiCommentContract.list>>;

export const wikiCommentKeys = {
  all: [resourceKeyOf(wikiCommentContract.basePath)] as const,
  lists: contractKey(wikiCommentContract.list),
  /** 某文档下的评论树（阅读页挂载） */
  doc: (docId: number) => contractKey(wikiCommentContract.docComments, { params: { id: docId } }),
};

export function useWikiDocComments(docId: number | undefined, enabled = true) {
  return useApiQuery(wikiCommentContract.docComments, { params: { id: docId ?? 0 } }, { enabled: enabled && docId !== undefined });
}

export function useWikiCommentList(params: WikiCommentListParams) {
  return useApiQuery(wikiCommentContract.list, { query: params }, { placeholderData: keepPreviousData });
}

/** 评论树、管理列表、文档详情（commentCount）、概览统计四处联动 */
function invalidateCommentSurfaces(qc: QueryClient, docId: number) {
  void qc.invalidateQueries({ queryKey: wikiCommentKeys.doc(docId) });
  void qc.invalidateQueries({ queryKey: wikiCommentKeys.lists });
  void qc.invalidateQueries({ queryKey: wikiDocKeys.detail(docId) });
  void qc.invalidateQueries({ queryKey: wikiStatsKeys.overview });
}

export function useCreateWikiComment() {
  return useApiMutation(wikiCommentContract.create, {
    invalidate: (qc, _output, { body }) => invalidateCommentSurfaces(qc, body.docId),
  });
}

export function useUpdateWikiCommentStatus() {
  return useApiMutation(wikiCommentContract.updateStatus, {
    invalidate: (qc, saved) => invalidateCommentSurfaces(qc, saved.docId),
  });
}

/**
 * 删除类接口只返回提示文案、路径里也没有 docId，精确失效所需的 docId 由调用方随变量带入
 * （评论树 / 详情 commentCount 都按文档分组，不能退化为全量失效）；docId 只交给 invalidate，不参与请求。
 */
type DeleteWikiCommentVariables = InputOf<typeof wikiCommentContract.deleteMine> & { docId: number };

export function useDeleteMyWikiComment() {
  return useApiMutation<typeof wikiCommentContract.deleteMine, DeleteWikiCommentVariables>(wikiCommentContract.deleteMine, {
    invalidate: (qc, _output, { docId }) => invalidateCommentSurfaces(qc, docId),
  });
}

export function useRemoveWikiComment() {
  return useApiMutation<typeof wikiCommentContract.remove, InputOf<typeof wikiCommentContract.remove> & { docId: number }>(wikiCommentContract.remove, {
    invalidate: (qc, _output, { docId }) => invalidateCommentSurfaces(qc, docId),
  });
}

/** 标记问题已解决：评论树与管理列表联动（详情 commentCount 不变，无需失效） */
export function useResolveWikiComment() {
  return useApiMutation(wikiCommentContract.resolve, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: wikiCommentKeys.doc(saved.docId) });
      void qc.invalidateQueries({ queryKey: wikiCommentKeys.lists });
    },
  });
}
