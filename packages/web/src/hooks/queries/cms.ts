import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse, CmsSite, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment,
  CmsFriendLink, CmsSearchResult, CmsContentStatus, CmsFragmentType, AsyncTask,
  CmsContentVersion, CmsRedirect, CmsLinkWord, CmsComment, CmsCommentStatus,
  CmsAdSlot, CmsAd, CmsForm, CmsFormSubmission, CmsSensitiveWord, CmsPushLog,
  CmsSearchWord, CmsHotKeyword, CmsCollectRule, CmsCollectItem, CmsPage,
  CmsEditLock, CmsPreviewLink, CmsContentVersionDiff, CmsDashboardStats,
  CmsThemeTemplateManifest, CmsPublishChannel, CmsContentOpLog, CmsErrorProneWord, CmsTextCheckResult,
  CmsTemplateHealth, CmsThemeSettingField,
  CmsContentType, CmsSurvey, CmsSurveyStats, CmsVisitStats, CmsSearchAnalytics,
  CmsResource, CmsResourceType, CmsResourceReference, UpdateCmsResourceInput, CropCmsResourceInput,
  CmsPoll, CmsPollStatus, CmsPollResults,
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
  themeTemplates: (code: string | undefined) => ['cms-sites', 'themes', code, 'templates'] as const,
  themeSettingsSchema: (code: string | undefined) => ['cms-sites', 'themes', code, 'settings-schema'] as const,
  templateHealth: (id: number | undefined, theme: string | undefined) => ['cms-sites', 'detail', id, 'template-health', theme ?? ''] as const,
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

/** 主题可选模板清单（站点默认模板 / 栏目 / 内容模板下拉） */
export function useCmsThemeTemplates(themeCode: string | undefined) {
  return useQuery({
    queryKey: cmsSiteKeys.themeTemplates(themeCode),
    queryFn: () => request.get<CmsThemeTemplateManifest>(`/api/cms/sites/themes/${themeCode}/templates`).then(unwrap),
    enabled: !!themeCode,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 主题参数声明（后台主题参数面板动态表单） */
export function useCmsThemeSettingsSchema(themeCode: string | undefined) {
  return useQuery({
    queryKey: cmsSiteKeys.themeSettingsSchema(themeCode),
    queryFn: () => request.get<CmsThemeSettingField[]>(`/api/cms/sites/themes/${themeCode}/settings-schema`).then(unwrap),
    enabled: !!themeCode,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 站点模板健康检查（失效模板引用扫描；theme 传目标主题可做切换前预检） */
export function useCmsSiteTemplateHealth(siteId: number | undefined, theme: string | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsSiteKeys.templateHealth(siteId, theme),
    queryFn: () => request
      .get<CmsTemplateHealth>(`/api/cms/sites/${siteId}/template-health${theme ? `?theme=${encodeURIComponent(theme)}` : ''}`)
      .then(unwrap),
    enabled: enabled && siteId !== undefined,
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

// ═══ 发布通道 ═══════════════════════════════════════════════════════════════
export const cmsPublishChannelKeys = {
  all: ['cms-publish-channels'] as const,
  lists: ['cms-publish-channels', 'list'] as const,
  list: (siteId: number | undefined) => ['cms-publish-channels', 'list', siteId] as const,
};

/** 站点发布通道列表（含停用；后台管理与站点默认模板页签共用） */
export function useCmsPublishChannels(siteId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsPublishChannelKeys.list(siteId),
    queryFn: () => request.get<CmsPublishChannel[]>(`/api/cms/publish-channels?siteId=${siteId}`).then(unwrap),
    enabled: enabled && siteId !== undefined,
  });
}

export function useSaveCmsPublishChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsPublishChannel>('/api/cms/publish-channels', values)
        : request.put<CmsPublishChannel>(`/api/cms/publish-channels/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPublishChannelKeys.all }),
  });
}

export function useDeleteCmsPublishChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/publish-channels/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPublishChannelKeys.all }),
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

/** 栏目运维（P1）：合并 / 清空 / 批量新增 */
export function useMergeCmsChannels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sourceIds: number[]; targetId: number }) =>
      request.post<null>('/api/cms/channels/merge', body).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsChannelKeys.all });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.all });
    },
  });
}

export function useClearCmsChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/cms/channels/${id}/clear`, {}).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsChannelKeys.all });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.all });
    },
  });
}

export function useBatchCreateCmsChannels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { siteId: number; parentId: number; names: string[] }) =>
      request.post<null>('/api/cms/channels/batch-create', body).then(unwrap),
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
  contentType?: CmsContentType;
  keyword?: string;
  deleted?: boolean;
  archived?: boolean;
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

/** 回收站/归档批量操作：recycle / restore / purge / archive / unarchive */
export function useCmsContentBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: 'recycle' | 'restore' | 'purge' | 'archive' | 'unarchive'; ids: number[] }) =>
      request.post<null>(`/api/cms/contents/${action}`, { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.all }),
  });
}

/** 内容操作日志时间线（打开抽屉时启用） */
export function useCmsContentOpLogs(contentId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cms-contents', 'op-logs', contentId] as const,
    queryFn: () => request.get<CmsContentOpLog[]>(`/api/cms/contents/${contentId}/op-logs`).then(unwrap),
    enabled: enabled && contentId !== undefined,
  });
}

/** 内容词库检查（敏感词 + 易错词命中） */
export function useCmsCheckText() {
  return useMutation({
    mutationFn: (text: string) => request.post<CmsTextCheckResult>('/api/cms/contents/check-text', { text }).then(unwrap),
  });
}

/** 内容 Excel 批量导入（任务中心异步执行） */
export function useImportCmsContents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { fileId: string; siteId: number; channelId: number }) =>
      request.post<AsyncTask>('/api/cms/contents/import', payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsContentKeys.lists }),
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

/** 版本差异对比（历史版本 vs 当前内容） */
export function useCmsVersionDiff(contentId: number | undefined, versionId: number | undefined) {
  return useQuery({
    queryKey: [...cmsVersionKeys.all, 'diff', contentId, versionId] as const,
    queryFn: () => request.get<CmsContentVersionDiff[]>(`/api/cms/contents/${contentId}/versions/${versionId}/diff`).then(unwrap),
    enabled: contentId !== undefined && versionId !== undefined,
  });
}

// ─── 编辑锁 / 草稿预览 ─────────────────────────────────────────────────────────
/** 抢占/心跳续期编辑锁（打开编辑页调用，之后每 30s 心跳一次） */
export function acquireCmsEditLock(contentId: number): Promise<CmsEditLock> {
  return request.post<CmsEditLock>(`/api/cms/contents/${contentId}/edit-lock`, {}, { silent: true }).then(unwrap);
}

/** 释放编辑锁（离开编辑页调用，仅持有人生效） */
export function releaseCmsEditLock(contentId: number): Promise<null> {
  return request.delete<null>(`/api/cms/contents/${contentId}/edit-lock`, undefined, { silent: true }).then(unwrap);
}

/** 生成草稿预览链接 */
export function useCmsPreviewLink() {
  return useMutation({
    mutationFn: (contentId: number) =>
      request.post<CmsPreviewLink>(`/api/cms/contents/${contentId}/preview-link`, {}).then(unwrap),
  });
}

// ─── 数据看板 ─────────────────────────────────────────────────────────────────
export const cmsDashboardKeys = {
  all: ['cms-dashboard'] as const,
  stats: (siteId: number | undefined) => ['cms-dashboard', 'stats', siteId] as const,
};

export function useCmsDashboardStats(siteId: number | undefined) {
  return useQuery({
    queryKey: cmsDashboardKeys.stats(siteId),
    queryFn: () => request.get<CmsDashboardStats>(`/api/cms/dashboard/stats?siteId=${siteId}`).then(unwrap),
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
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
  /** 来源筛选：member=会员评论 guest=游客评论 */
  source?: 'member' | 'guest';
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

// ─── 素材中心（P2）────────────────────────────────────────────────────────────
export interface CmsResourceListParams {
  page: number;
  pageSize: number;
  siteId: number;
  type?: CmsResourceType;
  keyword?: string;
}

export const cmsResourceKeys = {
  all: ['cms-resources'] as const,
  lists: ['cms-resources', 'list'] as const,
  list: (params: CmsResourceListParams) => ['cms-resources', 'list', params] as const,
  references: (id: number) => ['cms-resources', 'references', id] as const,
};

export function useCmsResourceList(params: CmsResourceListParams, enabled = true) {
  return useQuery({
    queryKey: cmsResourceKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsResource>>(`/api/cms/resources${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsResourceReferences(id: number | null) {
  return useQuery({
    queryKey: cmsResourceKeys.references(id ?? 0),
    queryFn: () => request.get<CmsResourceReference[]>(`/api/cms/resources/${id}/references`).then(unwrap),
    enabled: id != null,
  });
}

export function useUploadCmsResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, file }: { siteId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return request.post<CmsResource>(`/api/cms/resources/upload?siteId=${siteId}`, formData).then(unwrap);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useUpdateCmsResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: UpdateCmsResourceInput }) =>
      request.put<CmsResource>(`/api/cms/resources/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useCropCmsResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rect }: { id: number; rect: CropCmsResourceInput }) =>
      request.post<CmsResource>(`/api/cms/resources/${id}/crop`, rect).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useDeleteCmsResources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.post<null>('/api/cms/resources/delete', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

// ─── 轻量投票（P3）────────────────────────────────────────────────────────────
export interface CmsPollListParams {
  page: number;
  pageSize: number;
  siteId: number;
  status?: CmsPollStatus;
}

export const cmsPollKeys = {
  all: ['cms-polls'] as const,
  lists: ['cms-polls', 'list'] as const,
  list: (params: CmsPollListParams) => ['cms-polls', 'list', params] as const,
  results: (id: number) => ['cms-polls', 'results', id] as const,
};

export function useCmsPollList(params: CmsPollListParams, enabled = true) {
  return useQuery({
    queryKey: cmsPollKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsPoll>>(`/api/cms/polls${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsPollResults(id: number | null) {
  return useQuery({
    queryKey: cmsPollKeys.results(id ?? 0),
    queryFn: () => request.get<CmsPollResults>(`/api/cms/polls/${id}/results`).then(unwrap),
    enabled: id != null,
  });
}

export function useSaveCmsPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<CmsPoll>(`/api/cms/polls/${id}`, values) : request.post<CmsPoll>('/api/cms/polls', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPollKeys.all }),
  });
}

export function useSetCmsPollStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: CmsPollStatus }) =>
      request.post<CmsPoll>(`/api/cms/polls/${id}/status`, { status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPollKeys.all }),
  });
}

export function useDeleteCmsPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/polls/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPollKeys.all }),
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

// ═══ 易错词库（P1）═══════════════════════════════════════════════════════════
export interface CmsErrorProneWordListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const cmsErrorProneWordKeys = {
  all: ['cms-error-prone-words'] as const,
  lists: ['cms-error-prone-words', 'list'] as const,
  list: (params: CmsErrorProneWordListParams) => ['cms-error-prone-words', 'list', params] as const,
};

export function useCmsErrorProneWordList(params: CmsErrorProneWordListParams) {
  return useQuery({
    queryKey: cmsErrorProneWordKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsErrorProneWord>>(`/api/cms/error-prone-words${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCmsErrorProneWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsErrorProneWord>('/api/cms/error-prone-words', values)
        : request.put<CmsErrorProneWord>(`/api/cms/error-prone-words/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsErrorProneWordKeys.all }),
  });
}

export function useDeleteCmsErrorProneWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/error-prone-words/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsErrorProneWordKeys.all }),
  });
}

// ═══ 问卷调查（P3）═══════════════════════════════════════════════════════════
export interface CmsSurveyListParams {
  page: number;
  pageSize: number;
  siteId: number;
  keyword?: string;
  status?: string;
}

export const cmsSurveyKeys = {
  all: ['cms-surveys'] as const,
  lists: ['cms-surveys', 'list'] as const,
  list: (params: CmsSurveyListParams) => ['cms-surveys', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-surveys', 'detail', id] as const,
  stats: (id: number | undefined) => ['cms-surveys', 'stats', id] as const,
};

export function useCmsSurveyList(params: CmsSurveyListParams, enabled = true) {
  return useQuery({
    queryKey: cmsSurveyKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsSurvey>>(`/api/cms/surveys${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsSurveyDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsSurveyKeys.detail(id),
    queryFn: () => request.get<CmsSurvey>(`/api/cms/surveys/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useCmsSurveyStats(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsSurveyKeys.stats(id),
    queryFn: () => request.get<CmsSurveyStats>(`/api/cms/surveys/${id}/stats`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveCmsSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsSurvey>('/api/cms/surveys', values)
        : request.put<CmsSurvey>(`/api/cms/surveys/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSurveyKeys.all }),
  });
}

export function useDeleteCmsSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/surveys/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsSurveyKeys.all }),
  });
}

// ═══ 访问统计（P4）═══════════════════════════════════════════════════════════
export const cmsStatKeys = {
  visits: (siteId: number | undefined, days: number) => ['cms-stats', 'visits', siteId, days] as const,
  search: (siteId: number | undefined, days: number) => ['cms-stats', 'search', siteId, days] as const,
};

export function useCmsVisitStats(siteId: number | undefined, days: number) {
  return useQuery({
    queryKey: cmsStatKeys.visits(siteId, days),
    queryFn: () => request.get<CmsVisitStats>(`/api/cms/stats/visits?siteId=${siteId}&days=${days}`).then(unwrap),
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}

export function useCmsSearchAnalytics(siteId: number | undefined, days: number) {
  return useQuery({
    queryKey: cmsStatKeys.search(siteId, days),
    queryFn: () => request.get<CmsSearchAnalytics>(`/api/cms/stats/search?siteId=${siteId}&days=${days}`).then(unwrap),
    enabled: siteId !== undefined,
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

// ─── 栏目授权用户（P5 栏目级数据权限）─────────────────────────────────────────
export function useCmsChannelUsers(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cms-channels', 'users', channelId] as const,
    queryFn: () => request.get<{ userIds: number[]; users: { id: number; username: string; nickname: string }[] }>(`/api/cms/channels/${channelId}/users`).then(unwrap),
    enabled: enabled && channelId !== undefined,
  });
}

export function useSetCmsChannelUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, userIds }: { channelId: number; userIds: number[] }) =>
      request.put<null>(`/api/cms/channels/${channelId}/users`, { userIds }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-channels'] }),
  });
}

// ─── 站点导入（P5 整站备份迁移；导出走 request.download 直接下载）─────────────
export interface CmsSiteImportResult {
  siteId: number;
  siteName: string;
  siteCode: string;
  counts: Record<string, number>;
}

export function useImportCmsSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pkg: Record<string, unknown>) =>
      request.post<CmsSiteImportResult>('/api/cms/sites/import', pkg).then(unwrap),
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

// ─── P3 Batch6：可视化页面搭建 ────────────────────────────────────────────────
export const cmsPageKeys = {
  all: ['cms', 'pages'] as const,
  lists: ['cms', 'pages', 'list'] as const,
  list: (params: object) => ['cms', 'pages', 'list', params] as const,
  detail: (id: number | undefined) => ['cms', 'pages', 'detail', id ?? null] as const,
};

export function useCmsPageList(params: { page: number; pageSize: number; siteId: number | undefined; keyword?: string }) {
  return useQuery({
    queryKey: cmsPageKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsPage>>(`/api/cms/pages${toQueryString(params)}`).then(unwrap),
    enabled: !!params.siteId,
    placeholderData: keepPreviousData,
  });
}

export function useCmsPageDetail(id: number | undefined) {
  return useQuery({
    queryKey: cmsPageKeys.detail(id),
    queryFn: () => request.get<CmsPage>(`/api/cms/pages/${id}`).then(unwrap),
    enabled: !!id,
  });
}

export function useSaveCmsPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id
        ? request.put<CmsPage>(`/api/cms/pages/${id}`, values)
        : request.post<CmsPage>('/api/cms/pages', values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPageKeys.all }),
  });
}

export function useDeleteCmsPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/pages/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPageKeys.all }),
  });
}
