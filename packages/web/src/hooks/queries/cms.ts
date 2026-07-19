import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse, CmsSite, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment,
  CmsFriendLink, CmsSearchResult, CmsContentStatus, CmsFragmentType, AsyncTask,
  CmsContentVersion, CmsRedirect, CmsLinkWord, CmsComment, CmsCommentStatus,
  CmsAdSlot, CmsAd, CmsForm, CmsFormSubmission, CmsSensitiveWord, CmsPushLog,
  CmsSearchWord, CmsHotKeyword, CmsCollectRule, CmsCollectItem,
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

// ═══ P2：版本 / SEO / 评论 / 广告 / 表单 / 敏感词 ═══════════════════════════════

// ─── 内容版本 ─────────────────────────────────────────────────────────────────
export const cmsVersionKeys = {
  all: ['cms-content-versions'] as const,
  list: (contentId: number | undefined) => ['cms-content-versions', contentId] as const,
};

export function useCmsContentVersions(contentId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsVersionKeys.list(contentId),
    queryFn: () => request.get<CmsContentVersion[]>(`/api/cms/contents/${contentId}/versions`).then(unwrap),
    enabled: enabled && contentId !== undefined,
  });
}

export function useRestoreCmsContentVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contentId, versionId }: { contentId: number; versionId: number }) =>
      request.post<CmsContent>(`/api/cms/contents/${contentId}/versions/${versionId}/restore`, {}).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsContentKeys.all });
      void qc.invalidateQueries({ queryKey: cmsVersionKeys.all });
    },
  });
}

// ─── SEO：重定向 / 内链词 / 推送 ────────────────────────────────────────────────
export interface CmsSeoListParams {
  page: number;
  pageSize: number;
  siteId: number;
  keyword?: string;
}

export const cmsRedirectKeys = {
  all: ['cms-redirects'] as const,
  lists: ['cms-redirects', 'list'] as const,
  list: (params: CmsSeoListParams) => ['cms-redirects', 'list', params] as const,
};

export function useCmsRedirectList(params: CmsSeoListParams, enabled = true) {
  return useQuery({
    queryKey: cmsRedirectKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsRedirect>>(`/api/cms/seo/redirects${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveCmsRedirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsRedirect>('/api/cms/seo/redirects', values)
        : request.put<CmsRedirect>(`/api/cms/seo/redirects/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsRedirectKeys.all }),
  });
}

export function useDeleteCmsRedirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/seo/redirects/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsRedirectKeys.all }),
  });
}

export const cmsLinkWordKeys = {
  all: ['cms-link-words'] as const,
  lists: ['cms-link-words', 'list'] as const,
  list: (params: CmsSeoListParams) => ['cms-link-words', 'list', params] as const,
};

export function useCmsLinkWordList(params: CmsSeoListParams, enabled = true) {
  return useQuery({
    queryKey: cmsLinkWordKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsLinkWord>>(`/api/cms/seo/link-words${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveCmsLinkWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsLinkWord>('/api/cms/seo/link-words', values)
        : request.put<CmsLinkWord>(`/api/cms/seo/link-words/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsLinkWordKeys.all }),
  });
}

export function useDeleteCmsLinkWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/seo/link-words/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsLinkWordKeys.all }),
  });
}

export const cmsPushLogKeys = {
  all: ['cms-push-logs'] as const,
  lists: ['cms-push-logs', 'list'] as const,
  list: (params: { page: number; pageSize: number; siteId: number }) => ['cms-push-logs', 'list', params] as const,
};

export function useCmsPushLogList(params: { page: number; pageSize: number; siteId: number }, enabled = true) {
  return useQuery({
    queryKey: cmsPushLogKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsPushLog>>(`/api/cms/seo/push-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { siteId: number; urls: string[]; engines?: string[] }) =>
      request.post<{ engine: string; submitted: boolean; reason?: string }[]>('/api/cms/seo/push', body).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPushLogKeys.all }),
  });
}

// ─── 评论 ─────────────────────────────────────────────────────────────────────
export interface CmsCommentListParams {
  page: number;
  pageSize: number;
  siteId: number;
  status?: CmsCommentStatus;
}

export const cmsCommentKeys = {
  all: ['cms-comments'] as const,
  lists: ['cms-comments', 'list'] as const,
  list: (params: CmsCommentListParams) => ['cms-comments', 'list', params] as const,
};

export function useCmsCommentList(params: CmsCommentListParams, enabled = true) {
  return useQuery({
    queryKey: cmsCommentKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsComment>>(`/api/cms/comments${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsCommentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: 'approve' | 'reject' | 'delete'; ids: number[] }) =>
      request.post<null>(`/api/cms/comments/${action}`, { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsCommentKeys.all }),
  });
}

// ─── 广告 ─────────────────────────────────────────────────────────────────────
export const cmsAdKeys = {
  all: ['cms-ads'] as const,
  lists: ['cms-ads', 'list'] as const,
  slots: (siteId: number | undefined) => ['cms-ads', 'slots', siteId] as const,
  list: (params: { page: number; pageSize: number; siteId: number; slotId?: number }) => ['cms-ads', 'list', params] as const,
};

export function useCmsAdSlots(siteId: number | undefined) {
  return useQuery({
    queryKey: cmsAdKeys.slots(siteId),
    queryFn: () => request.get<CmsAdSlot[]>(`/api/cms/ads/slots?siteId=${siteId}`).then(unwrap),
    enabled: siteId !== undefined,
  });
}

export function useSaveCmsAdSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsAdSlot>('/api/cms/ads/slots', values)
        : request.put<CmsAdSlot>(`/api/cms/ads/slots/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsAdKeys.all }),
  });
}

export function useDeleteCmsAdSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/ads/slots/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsAdKeys.all }),
  });
}

export function useCmsAdList(params: { page: number; pageSize: number; siteId: number; slotId?: number }, enabled = true) {
  return useQuery({
    queryKey: cmsAdKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsAd>>(`/api/cms/ads${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveCmsAd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsAd>('/api/cms/ads', values)
        : request.put<CmsAd>(`/api/cms/ads/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsAdKeys.all }),
  });
}

export function useDeleteCmsAd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/ads/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsAdKeys.all }),
  });
}

// ─── 表单 ─────────────────────────────────────────────────────────────────────
export const cmsFormKeys = {
  all: ['cms-forms'] as const,
  lists: ['cms-forms', 'list'] as const,
  list: (params: CmsSeoListParams) => ['cms-forms', 'list', params] as const,
  submissions: (formId: number | undefined, page: number, pageSize: number) => ['cms-forms', 'submissions', formId, page, pageSize] as const,
};

export function useCmsFormList(params: CmsSeoListParams, enabled = true) {
  return useQuery({
    queryKey: cmsFormKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsForm>>(`/api/cms/forms${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveCmsForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsForm>('/api/cms/forms', values)
        : request.put<CmsForm>(`/api/cms/forms/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFormKeys.all }),
  });
}

export function useDeleteCmsForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/forms/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFormKeys.all }),
  });
}

export function useCmsFormSubmissions(formId: number | undefined, page: number, pageSize: number) {
  return useQuery({
    queryKey: cmsFormKeys.submissions(formId, page, pageSize),
    queryFn: () => request.get<PaginatedResponse<CmsFormSubmission>>(`/api/cms/forms/${formId}/submissions${toQueryString({ page, pageSize })}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: formId !== undefined,
  });
}

export function useDeleteCmsFormSubmissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formId, ids }: { formId: number; ids: number[] }) =>
      request.post<null>(`/api/cms/forms/${formId}/submissions/delete`, { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsFormKeys.all }),
  });
}

// ─── 敏感词 ───────────────────────────────────────────────────────────────────
export interface CmsSensitiveWordListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const cmsSensitiveWordKeys = {
  all: ['cms-sensitive-words'] as const,
  lists: ['cms-sensitive-words', 'list'] as const,
  list: (params: CmsSensitiveWordListParams) => ['cms-sensitive-words', 'list', params] as const,
};

export function useCmsSensitiveWordList(params: CmsSensitiveWordListParams) {
  return useQuery({
    queryKey: cmsSensitiveWordKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsSensitiveWord>>(`/api/cms/sensitive-words${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCmsSensitiveWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsSensitiveWord>('/api/cms/sensitive-words', values)
        : request.put<CmsSensitiveWord>(`/api/cms/sensitive-words/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSensitiveWordKeys.all }),
  });
}

export function useDeleteCmsSensitiveWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/sensitive-words/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSensitiveWordKeys.all }),
  });
}

// ─── 站点授权用户 ─────────────────────────────────────────────────────────────
export function useCmsSiteUsers(siteId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cms-sites', 'users', siteId] as const,
    queryFn: () => request.get<{ userIds: number[]; users: { id: number; username: string; nickname: string }[] }>(`/api/cms/sites/${siteId}/users`).then(unwrap),
    enabled: enabled && siteId !== undefined,
  });
}

export function useSetCmsSiteUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, userIds }: { siteId: number; userIds: number[] }) =>
      request.put<null>(`/api/cms/sites/${siteId}/users`, { userIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSiteKeys.all }),
  });
}

// ═══ P3 Batch1 ════════════════════════════════════════════════════════════════

// ─── 检索词典 / 热词 ──────────────────────────────────────────────────────────
export const cmsSearchWordKeys = {
  all: ['cms-search-words'] as const,
  lists: ['cms-search-words', 'list'] as const,
  list: (params: { page: number; pageSize: number; keyword?: string }) => ['cms-search-words', 'list', params] as const,
  hot: (siteId: number | undefined) => ['cms-search-words', 'hot', siteId] as const,
};

export function useCmsSearchWordList(params: { page: number; pageSize: number; keyword?: string }) {
  return useQuery({
    queryKey: cmsSearchWordKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsSearchWord>>(`/api/cms/search/words${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCmsSearchWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsSearchWord>('/api/cms/search/words', values)
        : request.put<CmsSearchWord>(`/api/cms/search/words/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSearchWordKeys.all }),
  });
}

export function useDeleteCmsSearchWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/search/words/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSearchWordKeys.all }),
  });
}

export function useCmsHotKeywords(siteId: number | undefined) {
  return useQuery({
    queryKey: cmsSearchWordKeys.hot(siteId),
    queryFn: () => request.get<CmsHotKeyword[]>(`/api/cms/search/hot-keywords?siteId=${siteId}&limit=30`).then(unwrap),
    enabled: siteId !== undefined,
  });
}

export function useClearCmsHotKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siteId: number) => request.post<null>('/api/cms/search/hot-keywords/clear', { siteId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSearchWordKeys.all }),
  });
}

// ─── 内容批量操作 / 分发 ──────────────────────────────────────────────────────
export function useCmsContentBatchOps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: 'batch-move' | 'batch-flags' | 'batch-tag' | 'distribute'; body: Record<string, unknown> }) =>
      request.post<null>(`/api/cms/contents/${action}`, body).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.all }),
  });
}

export function useDuplicateCmsContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<CmsContent>(`/api/cms/contents/${id}/duplicate`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.all }),
  });
}

// ─── 站点开通统计 / 死链检测 ──────────────────────────────────────────────────
export function useEnableSiteAnalytics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siteId: number) => request.post<{ siteKey: string; created: boolean }>(`/api/cms/sites/${siteId}/enable-analytics`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSiteKeys.all }),
  });
}

export function useCmsDeadlinkCheck() {
  return useMutation({
    mutationFn: (siteId: number) => request.post<AsyncTask>('/api/cms/seo/deadlink-check', { siteId }).then(unwrap),
  });
}

// ─── P3 Batch5：采集中心 ──────────────────────────────────────────────────────
export const cmsCollectKeys = {
  all: ['cms', 'collect'] as const,
  lists: ['cms', 'collect', 'list'] as const,
  list: (params: object) => ['cms', 'collect', 'list', params] as const,
  items: (ruleId: number, params: object) => ['cms', 'collect', 'items', ruleId, params] as const,
};

export function useCmsCollectRules(params: { page: number; pageSize: number; siteId: number | undefined; keyword?: string }) {
  return useQuery({
    queryKey: cmsCollectKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsCollectRule>>(`/api/cms/collect/rules${toQueryString(params)}`).then(unwrap),
    enabled: !!params.siteId,
    placeholderData: keepPreviousData,
  });
}

export function useSaveCmsCollectRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id
        ? request.put<CmsCollectRule>(`/api/cms/collect/rules/${id}`, values)
        : request.post<CmsCollectRule>('/api/cms/collect/rules', values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsCollectKeys.all }),
  });
}

export function useDeleteCmsCollectRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/collect/rules/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsCollectKeys.all }),
  });
}

export function useRunCmsCollectRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<AsyncTask>(`/api/cms/collect/rules/${id}/run`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsCollectKeys.all }),
  });
}

export function useCmsCollectItems(ruleId: number | undefined, params: { page: number; pageSize: number; status?: string }) {
  return useQuery({
    queryKey: cmsCollectKeys.items(ruleId ?? 0, params),
    queryFn: () => request.get<PaginatedResponse<CmsCollectItem>>(`/api/cms/collect/rules/${ruleId}/items${toQueryString(params)}`).then(unwrap),
    enabled: !!ruleId,
    placeholderData: keepPreviousData,
  });
}
