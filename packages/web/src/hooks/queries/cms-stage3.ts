import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AsyncTask,
  CmsPublishingDetail,
  CmsPublishingTask,
  CmsPublishArtifact,
  CmsPublishArtifactStatus,
  CmsPublishSubmitInput,
  CmsPublishTargetType,
  CmsTemplate,
  CmsTemplateDetail,
  CmsTemplateDiffItem,
  CmsTemplateDslDocument,
  CmsTemplateType,
  CmsTemplateValidationReport,
  CmsTemplateVersion,
  CmsThemeImpactReport,
  CmsThemePackage,
  CmsThemePackageValidationReport,
  PaginatedResponse,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface CmsTemplateListParams {
  page: number;
  pageSize: number;
  siteId?: number;
  themeCode?: string;
  type?: CmsTemplateType;
  status?: string;
  keyword?: string;
}

export const cmsTemplateKeys = {
  all: ['cms-templates'] as const,
  lists: ['cms-templates', 'list'] as const,
  list: (params: CmsTemplateListParams) => ['cms-templates', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-templates', 'detail', id] as const,
};

export function useCmsTemplateList(params: CmsTemplateListParams) {
  return useQuery({
    queryKey: cmsTemplateKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsTemplate>>(`/api/cms/templates${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCmsTemplateDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsTemplateKeys.detail(id),
    queryFn: () => request.get<CmsTemplateDetail>(`/api/cms/templates/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useValidateCmsTemplate() {
  return useMutation({
    mutationFn: (dsl: CmsTemplateDslDocument) =>
      request.post<CmsTemplateValidationReport>('/api/cms/templates/validate', { dsl }, { silent: true }).then(unwrap),
  });
}

export function useCreateCmsTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request.post<CmsTemplateDetail>('/api/cms/templates', values).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsTemplateKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites', 'themes'] });
    },
  });
}

export function useUpdateCmsTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request.put<CmsTemplate>(`/api/cms/templates/${id}`, values).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsTemplateKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites', 'themes'] });
    },
  });
}

export function useSaveCmsTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dsl, changeNote }: { id: number; dsl: CmsTemplateDslDocument; changeNote?: string }) =>
      request.post<CmsTemplateVersion>(`/api/cms/templates/${id}/versions`, { dsl, changeNote }).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: cmsTemplateKeys.all });
      void qc.invalidateQueries({ queryKey: cmsTemplateKeys.detail(variables.id) });
    },
  });
}

export function useCmsTemplateAction(action: 'activate' | 'deactivate' | 'rollback') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: number; version?: number }) =>
      request.post<{ template: CmsTemplate; tasks: AsyncTask[] }>(
        `/api/cms/templates/${id}/${action}`,
        version ? { version } : {},
      ).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsTemplateKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites', 'themes'] });
    },
  });
}

export function useCmsTemplateDiff() {
  return useMutation({
    mutationFn: ({ id, from, to }: { id: number; from: number; to: number }) =>
      request.get<{ changes: CmsTemplateDiffItem[] }>(`/api/cms/templates/${id}/diff?from=${from}&to=${to}`).then(unwrap),
  });
}

export function usePreviewCmsTemplate() {
  return useMutation({
    mutationFn: ({ id, siteId, path, version }: { id: number; siteId: number; path: string; version?: number }) =>
      request.post<{ html: string; status: number }>(`/api/cms/templates/${id}/preview`, { siteId, path, version }).then(unwrap),
  });
}

export interface CmsThemePackageListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  code?: string;
  status?: string;
}

export const cmsThemePackageKeys = {
  all: ['cms-theme-packages'] as const,
  lists: ['cms-theme-packages', 'list'] as const,
  list: (params: CmsThemePackageListParams) => ['cms-theme-packages', 'list', params] as const,
  impact: (siteId: number | undefined, code?: string, packageId?: number) => ['cms-theme-packages', 'impact', siteId, code ?? '', packageId ?? 0] as const,
};

export function useCmsThemePackageList(params: CmsThemePackageListParams) {
  return useQuery({
    queryKey: cmsThemePackageKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsThemePackage>>(`/api/cms/themes${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useValidateCmsThemePackage() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request.postForm<CmsThemePackageValidationReport>('/api/cms/themes/validate', form, { silent: true }).then(unwrap);
    },
  });
}

export function useImportCmsThemePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request.postForm<AsyncTask>('/api/cms/themes/import', form).then(unwrap);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsThemePackageKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites'] });
      void qc.invalidateQueries({ queryKey: ['async-tasks', 'mine'] });
    },
  });
}

export function useActivateCmsThemePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, siteId }: { id: number; siteId: number }) =>
      request.post<{ package: CmsThemePackage; siteName: string; task: AsyncTask }>(`/api/cms/themes/${id}/activate`, { siteId }).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsThemePackageKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites'] });
    },
  });
}

export function useActivateBuiltinCmsTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, siteId }: { code: 'default' | 'docs'; siteId: number }) =>
      request.post<{ themeCode: string; siteName: string; task: AsyncTask }>(`/api/cms/themes/builtin/${code}/activate`, { siteId }).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsThemePackageKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites'] });
    },
  });
}

export function useCmsThemeSiteAction(action: 'rollback' | 'deactivate') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, themeCode, packageId }: { siteId: number; themeCode: string; packageId: number }) =>
      request.post<Record<string, unknown>>(`/api/cms/themes/${action}`, { siteId, themeCode, packageId }).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsThemePackageKeys.all });
      void qc.invalidateQueries({ queryKey: ['cms-sites'] });
    },
  });
}

export function useSetCmsThemePackageStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'validated' | 'disabled' }) =>
      request.put<CmsThemePackage>(`/api/cms/themes/${id}/status`, { status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsThemePackageKeys.all }),
  });
}

export function usePreviewCmsThemePackage() {
  return useMutation({
    mutationFn: ({ id, siteId, path }: { id: number; siteId: number; path: string }) =>
      request.post<{ html: string; status: number }>(`/api/cms/themes/${id}/preview`, { siteId, path }).then(unwrap),
  });
}

export function useCmsThemeImpact(siteId: number | undefined, themeCode?: string, packageId?: number, enabled = true) {
  return useQuery({
    queryKey: cmsThemePackageKeys.impact(siteId, themeCode, packageId),
    queryFn: () => request.get<CmsThemeImpactReport>(`/api/cms/themes/impact${toQueryString({ siteId, themeCode, packageId })}`).then(unwrap),
    enabled: enabled && siteId !== undefined,
  });
}

export interface CmsPublishingListParams {
  page: number;
  pageSize: number;
  siteId?: number;
  targetType?: CmsPublishTargetType;
  status?: string;
  taskType?: string;
  createdBy?: string;
  startTime?: string;
  endTime?: string;
  keyword?: string;
}

export interface CmsPublishArtifactListParams {
  page: number;
  pageSize: number;
  siteId?: number;
  taskId?: number;
  targetType?: CmsPublishTargetType;
  status?: CmsPublishArtifactStatus;
  startTime?: string;
  endTime?: string;
  keyword?: string;
}

export const cmsPublishingKeys = {
  all: ['cms-publishing'] as const,
  lists: ['cms-publishing', 'list'] as const,
  list: (params: CmsPublishingListParams) => ['cms-publishing', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-publishing', 'detail', id] as const,
  artifacts: ['cms-publishing', 'artifacts'] as const,
  artifactList: (params: CmsPublishArtifactListParams) => ['cms-publishing', 'artifacts', params] as const,
};

export function useCmsPublishingList(params: CmsPublishingListParams, enabled = true) {
  return useQuery({
    queryKey: cmsPublishingKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CmsPublishingTask>>(`/api/cms/publishing${toQueryString(params)}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => query.state.data?.list.some((item) => ['pending', 'running'].includes(item.status)) ? 4000 : false,
  });
}

export function useCmsPublishingDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsPublishingKeys.detail(id),
    queryFn: () => request.get<CmsPublishingDetail>(`/api/cms/publishing/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
    refetchInterval: (query) => query.state.data && ['pending', 'running'].includes(query.state.data.task.status) ? 3000 : false,
  });
}

export function useCmsPublishArtifactList(params: CmsPublishArtifactListParams, enabled = true) {
  return useQuery({
    queryKey: cmsPublishingKeys.artifactList(params),
    queryFn: () => request.get<PaginatedResponse<CmsPublishArtifact>>(`/api/cms/publishing/artifacts${toQueryString(params)}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSubmitCmsPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CmsPublishSubmitInput) =>
      request.post<AsyncTask>('/api/cms/publishing/submit', input).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPublishingKeys.all }),
  });
}

export function useCmsPublishingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'cancel' | 'resume' | 'restart' | 'rebuild' }) =>
      request.post<AsyncTask>(`/api/cms/publishing/${id}/${action}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPublishingKeys.all }),
  });
}

export function useBatchCmsPublishingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: 'cancel' | 'resume' | 'restart' | 'rebuild' }) =>
      request.post<{ affected: number; errors: Array<{ id: number; message: string }> }>('/api/cms/publishing/batch-action', { ids, action }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsPublishingKeys.all }),
  });
}
