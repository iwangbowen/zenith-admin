import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsWidgetContract, type CmsWidgetRendererKey, type CmsWidgetType } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CmsWidgetListParams = NonNullable<QueryOf<typeof cmsWidgetContract.list>>;

const resource = createResourceQueries(cmsWidgetContract, {
  // 预览按草稿渲染，保存草稿后必须回源；renderers / slots 是站点级配置，不随单个部件变化
  onSaved: (qc, saved) => void qc.invalidateQueries({ queryKey: cmsWidgetKeys.previewsOf(saved.id) }),
});

export const cmsWidgetKeys = {
  ...resource.keys,
  refs: (id: number | undefined) => contractKey(cmsWidgetContract.refs, { params: { id: id ?? 0 } }),
  preview: (id: number | undefined, rendererKey?: CmsWidgetRendererKey) =>
    contractKey(cmsWidgetContract.preview, { params: { id: id ?? 0 }, query: { rendererKey } }),
  /** 某部件全部展示模板的预览（失效 / 移除时按 params 前缀匹配） */
  previewsOf: (id: number) => [...contractKey(cmsWidgetContract.preview), { params: { id } }] as const,
  optionsPrefix: contractKey(cmsWidgetContract.options),
  options: (siteId: number | undefined) => contractKey(cmsWidgetContract.options, { query: { siteId: siteId ?? 0 } }),
  renderers: (siteId: number | undefined, type: CmsWidgetType) =>
    contractKey(cmsWidgetContract.renderers, { query: { siteId: siteId ?? 0, type } }),
  slots: (siteId: number | undefined) => contractKey(cmsWidgetContract.slots, { query: { siteId: siteId ?? 0 } }),
  sourceRefs: (sourceType: 'content' | 'channel', sourceId: number | undefined) =>
    contractKey(cmsWidgetContract.sourceRefs, { query: { sourceType, sourceId: sourceId ?? 0 } }),
};

export function useCmsWidgetList(params: Omit<CmsWidgetListParams, 'siteId'> & { siteId: number | undefined }) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.list, { query: { ...params, siteId: params.siteId ?? 0 } }),
    enabled: params.siteId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export const useCmsWidgetDetail = resource.useDetail;

export function usePublishedCmsWidgets(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.options, { query: { siteId: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useCmsWidgetRenderers(
  siteId: number | undefined,
  type: CmsWidgetType = 'manual-list',
  enabled = true,
) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.renderers, { query: { siteId: siteId ?? 0, type } }),
    enabled: enabled && siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useCmsWidgetRefs(id: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.refs, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function useCmsWidgetSourceRefs(
  sourceType: 'content' | 'channel',
  sourceId: number | undefined,
  enabled = true,
) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.sourceRefs, { query: { sourceType, sourceId: sourceId ?? 0 } }),
    enabled: enabled && sourceId !== undefined,
  });
}

export function useCmsWidgetPreview(
  id: number | undefined,
  rendererKey?: CmsWidgetRendererKey,
  enabled = true,
) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.preview, { params: { id: id ?? 0 }, query: { rendererKey } }),
    enabled: enabled && id !== undefined,
  });
}

export function useCmsWidgetSlots(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsWidgetContract.slots, { query: { siteId: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
  });
}

export const useSaveCmsWidget = resource.useSave;

/** 发布后部件才可被选用，可选部件下拉随之变化 */
export function usePublishCmsWidget() {
  return useApiMutation(cmsWidgetContract.publish, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.optionsPrefix });
    },
  });
}

export function useOfflineCmsWidget() {
  return useApiMutation(cmsWidgetContract.offline, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.optionsPrefix });
    },
  });
}

/** 删除后引用与预览都不再有对应资源 */
export function useDeleteCmsWidget() {
  return useApiMutation(cmsWidgetContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: cmsWidgetKeys.detail(params.id) });
      qc.removeQueries({ queryKey: cmsWidgetKeys.refs(params.id) });
      qc.removeQueries({ queryKey: cmsWidgetKeys.previewsOf(params.id) });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.optionsPrefix });
    },
  });
}

/** 批量操作异步执行，结果未知，刷新列表与可选部件即可 */
export function useCmsWidgetBatch() {
  return useApiMutation(cmsWidgetContract.batch, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsWidgetKeys.optionsPrefix });
    },
  });
}

/** slots(siteId) 已精确定位到该站点的插槽配置，无需再广播整个部件域 */
export function useSaveCmsWidgetSlot() {
  return useApiMutation(cmsWidgetContract.saveSlot, {
    invalidate: (qc, _output, { body }) => void qc.invalidateQueries({ queryKey: cmsWidgetKeys.slots(body.siteId) }),
  });
}
