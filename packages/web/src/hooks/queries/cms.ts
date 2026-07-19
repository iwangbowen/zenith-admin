import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse, CmsSite, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment,
  CmsFriendLink, CmsSearchResult, CmsContentStatus, CmsFragmentType, AsyncTask,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap, LOOKUP_STALE_TIME } from '@/lib/query';

// ═══ 站点 ═══════════════════════════════════════════════════════════════════
export interface CmsSiteListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const cmsSiteKeys = {
  all: ['cms-sites'] as const,
  lists: ['cms-sites', 'list'] as const,
  list: (params: CmsSiteListParams) => ['cms-sites', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-sites', 'detail', id] as const,
  allSites: ['cms-sites', 'all'] as const,
  themes: ['cms-sites', 'themes'] as const,
};

export function useCmsSiteList(params: CmsSiteListParams) {
  return useQuery({
    queryKey: cmsSiteKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsSite>>(`/api/cms/sites${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

/** 全部启用站点（各 CMS 页面顶部站点切换器共用） */
export function useAllCmsSites() {
  return useQuery({
    queryKey: cmsSiteKeys.allSites,
    queryFn: () => request.get<CmsSite[]>('/api/cms/sites/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useCmsThemes() {
  return useQuery({
    queryKey: cmsSiteKeys.themes,
    queryFn: () => request.get<{ code: string; label: string }[]>('/api/cms/sites/themes').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveCmsSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsSite>('/api/cms/sites', values)
        : request.put<CmsSite>(`/api/cms/sites/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSiteKeys.all }),
  });
}

export function useDeleteCmsSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/sites/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSiteKeys.all }),
  });
}

// ═══ 内容模型 ═══════════════════════════════════════════════════════════════
export interface CmsModelListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const cmsModelKeys = {
  all: ['cms-models'] as const,
  lists: ['cms-models', 'list'] as const,
  list: (params: CmsModelListParams) => ['cms-models', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-models', 'detail', id] as const,
  allModels: ['cms-models', 'all'] as const,
};

export function useCmsModelList(params: CmsModelListParams) {
  return useQuery({
    queryKey: cmsModelKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsModel>>(`/api/cms/models${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAllCmsModels() {
  return useQuery({
    queryKey: cmsModelKeys.allModels,
    queryFn: () => request.get<CmsModel[]>('/api/cms/models/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useCmsModelDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsModelKeys.detail(id),
    queryFn: () => request.get<CmsModel>(`/api/cms/models/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveCmsModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsModel>('/api/cms/models', values)
        : request.put<CmsModel>(`/api/cms/models/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsModelKeys.all }),
  });
}

export function useDeleteCmsModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/models/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsModelKeys.all }),
  });
}

// ═══ 栏目 ═══════════════════════════════════════════════════════════════════
export const cmsChannelKeys = {
  all: ['cms-channels'] as const,
  lists: ['cms-channels', 'list'] as const,
  list: (params: { siteId: number | undefined }) => ['cms-channels', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-channels', 'detail', id] as const,
};

export function useCmsChannelTree(siteId: number | undefined) {
  return useQuery({
    queryKey: cmsChannelKeys.list({ siteId }),
    queryFn: () => request.get<CmsChannel[]>(`/api/cms/channels/tree?siteId=${siteId}`).then(unwrap),
    enabled: siteId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSaveCmsChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsChannel>('/api/cms/channels', values)
        : request.put<CmsChannel>(`/api/cms/channels/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsChannelKeys.all }),
  });
}

export function useDeleteCmsChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/channels/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsChannelKeys.all }),
  });
}

// ═══ 内容 ═══════════════════════════════════════════════════════════════════
export interface CmsContentListParams {
  page: number;
  pageSize: number;
  siteId: number;
  channelId?: number;
  status?: CmsContentStatus;
  keyword?: string;
  deleted?: boolean;
}

export const cmsContentKeys = {
  all: ['cms-contents'] as const,
  lists: ['cms-contents', 'list'] as const,
  list: (params: CmsContentListParams) => ['cms-contents', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-contents', 'detail', id] as const,
};

export function useCmsContentList(params: CmsContentListParams, enabled = true) {
  return useQuery({
    queryKey: cmsContentKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsContent>>(`/api/cms/contents${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsContentDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsContentKeys.detail(id),
    queryFn: () => request.get<CmsContent>(`/api/cms/contents/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveCmsContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsContent>('/api/cms/contents', values)
        : request.put<CmsContent>(`/api/cms/contents/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.all }),
  });
}

/** 状态流转：submit / publish / offline / reject */
export function useCmsContentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: 'submit' | 'publish' | 'offline' | 'reject'; body?: Record<string, unknown> }) =>
      request.post<CmsContent>(`/api/cms/contents/${id}/${action}`, body ?? {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.all }),
  });
}

/** 回收站批量操作：recycle / restore / purge */
export function useCmsContentBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: 'recycle' | 'restore' | 'purge'; ids: number[] }) =>
      request.post<null>(`/api/cms/contents/${action}`, { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.all }),
  });
}

// ═══ 标签 ═══════════════════════════════════════════════════════════════════
export interface CmsTagListParams {
  page: number;
  pageSize: number;
  siteId: number;
  keyword?: string;
}

export const cmsTagKeys = {
  all: ['cms-tags'] as const,
  lists: ['cms-tags', 'list'] as const,
  list: (params: CmsTagListParams) => ['cms-tags', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-tags', 'detail', id] as const,
  allTags: (siteId: number | undefined) => ['cms-tags', 'all', siteId] as const,
};

export function useCmsTagList(params: CmsTagListParams, enabled = true) {
  return useQuery({
    queryKey: cmsTagKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsTag>>(`/api/cms/tags${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAllCmsTags(siteId: number | undefined) {
  return useQuery({
    queryKey: cmsTagKeys.allTags(siteId),
    queryFn: () => request.get<CmsTag[]>(`/api/cms/tags/all?siteId=${siteId}`).then(unwrap),
    enabled: siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveCmsTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsTag>('/api/cms/tags', values)
        : request.put<CmsTag>(`/api/cms/tags/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsTagKeys.all }),
  });
}

export function useDeleteCmsTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/tags/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsTagKeys.all }),
  });
}

// ═══ 碎片 ═══════════════════════════════════════════════════════════════════
export interface CmsFragmentListParams {
  page: number;
  pageSize: number;
  siteId: number;
  keyword?: string;
  type?: CmsFragmentType;
}

export const cmsFragmentKeys = {
  all: ['cms-fragments'] as const,
  lists: ['cms-fragments', 'list'] as const,
  list: (params: CmsFragmentListParams) => ['cms-fragments', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-fragments', 'detail', id] as const,
};

export function useCmsFragmentList(params: CmsFragmentListParams, enabled = true) {
  return useQuery({
    queryKey: cmsFragmentKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsFragment>>(`/api/cms/fragments${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveCmsFragment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsFragment>('/api/cms/fragments', values)
        : request.put<CmsFragment>(`/api/cms/fragments/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFragmentKeys.all }),
  });
}

export function useDeleteCmsFragment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/fragments/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFragmentKeys.all }),
  });
}

// ═══ 友情链接 ═══════════════════════════════════════════════════════════════
export interface CmsFriendLinkListParams {
  page: number;
  pageSize: number;
  siteId: number;
  keyword?: string;
  status?: string;
}

export const cmsFriendLinkKeys = {
  all: ['cms-friend-links'] as const,
  lists: ['cms-friend-links', 'list'] as const,
  list: (params: CmsFriendLinkListParams) => ['cms-friend-links', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-friend-links', 'detail', id] as const,
};

export function useCmsFriendLinkList(params: CmsFriendLinkListParams, enabled = true) {
  return useQuery({
    queryKey: cmsFriendLinkKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsFriendLink>>(`/api/cms/friend-links${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveCmsFriendLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsFriendLink>('/api/cms/friend-links', values)
        : request.put<CmsFriendLink>(`/api/cms/friend-links/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.all }),
  });
}

export function useDeleteCmsFriendLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/friend-links/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.all }),
  });
}

// ═══ 静态化 / 检索 ═══════════════════════════════════════════════════════════
export function useCmsStaticBuild() {
  return useMutation({
    mutationFn: (siteId: number) => request.post<AsyncTask>('/api/cms/static/build', { siteId }).then(unwrap),
  });
}

export function useCmsSearchReindex() {
  return useMutation({
    mutationFn: (siteId: number | null) => request.post<AsyncTask>('/api/cms/search/reindex', { siteId }).then(unwrap),
  });
}

export const cmsSearchKeys = {
  all: ['cms-search'] as const,
  test: (params: { siteId: number | undefined; keyword: string; page: number }) => ['cms-search', 'test', params] as const,
  segment: (text: string) => ['cms-search', 'segment', text] as const,
};

export function useCmsSearchTest(params: { siteId: number | undefined; keyword: string; page: number }, enabled: boolean) {
  return useQuery({
    queryKey: cmsSearchKeys.test(params),
    queryFn: () => request.get<PaginatedResponse<CmsSearchResult>>(
      `/api/cms/search/test${toQueryString({ ...params, pageSize: 10 })}`,
    ).then(unwrap),
    enabled: enabled && params.siteId !== undefined && !!params.keyword,
    placeholderData: keepPreviousData,
  });
}

export function useCmsSegmentPreview(text: string, enabled: boolean) {
  return useQuery({
    queryKey: cmsSearchKeys.segment(text),
    queryFn: () => request.get<{ tokens: string[] }>(`/api/cms/search/segment${toQueryString({ text })}`).then(unwrap),
    enabled: enabled && !!text,
  });
}
