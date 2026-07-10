import { useCallback } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiResponse,
  PaginatedResponse,
  ReportDashboard,
  ReportDashboardCategory,
  ReportDashboardComment,
  ReportDashboardEmbedToken,
  ReportDashboardLifecycleStatus,
  ReportDashboardShare,
  ReportDashboardVersion,
  ReportDashboardVersionDiff,
  ReportDatasetQueryOptions,
  ReportPublicAccessSession,
  ReportPublicDashboard,
  ReportWidget,
  ReportWidgetDataResult,
  ReportExecutionStats,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { useReportLookup } from './report-lookups';

export interface ReportDashboardListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  lifecycleStatus?: ReportDashboardLifecycleStatus;
  categoryId?: number;
  favorited?: boolean;
}

export interface ReportDashboardCommentListParams {
  page: number;
  pageSize: number;
  widgetId?: string;
}

export const reportDashboardKeys = {
  all: ['report', 'dashboards'] as const,
  lists: ['report', 'dashboards', 'list'] as const,
  list: (params: ReportDashboardListParams) => ['report', 'dashboards', 'list', params] as const,
  detail: (id: number | undefined, mode: 'auto' | 'draft' | 'published' = 'auto') =>
    ['report', 'dashboards', 'detail', id, mode] as const,
  batch: (ids: number[], mode: 'auto' | 'draft' | 'published' = 'auto') =>
    ['report', 'dashboards', 'batch', [...ids].sort((a, b) => a - b), mode] as const,
  categories: ['report', 'dashboards', 'categories'] as const,
  categoryLookup: (params: { keyword?: string; limit?: number }) => ['report', 'dashboards', 'category-lookup', params] as const,
  lookup: (params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number }) => ['report', 'dashboards', 'lookup', params] as const,
  healthSummary: (dashboardId: number | undefined, params: Record<string, unknown>) => ['report', 'dashboards', 'health-summary', dashboardId, params] as const,
  comments: (id: number | undefined, params: ReportDashboardCommentListParams) =>
    ['report', 'dashboards', 'comments', id, params] as const,
  shares: (id: number | undefined) => ['report', 'dashboards', 'shares', id] as const,
  embedTokens: (id: number | undefined) => ['report', 'dashboards', 'embedTokens', id] as const,
  versions: (id: number | undefined) => ['report', 'dashboards', 'versions', id] as const,
  versionDiff: (dashboardId: number | undefined, left: number, right: number) =>
    ['report', 'dashboards', 'version-diff', dashboardId, left, right] as const,
  dashboardData: (
    dashboardId: number | undefined,
    mode: 'auto' | 'draft' | 'published',
    filters: Record<string, unknown>,
    limit: number,
    widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  ) => ['report', 'dashboards', 'data', dashboardId, mode, filters, limit, widgetQueries ?? null] as const,
  publicAccess: (token: string | undefined) => ['report', 'dashboards', 'public-access', token] as const,
  publicDashboard: (token: string | undefined, session: string | undefined) =>
    ['report', 'dashboards', 'public', token, session ?? ''] as const,
  publicData: (
    token: string | undefined,
    session: string | undefined,
    filters: Record<string, unknown>,
    widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  ) => ['report', 'dashboards', 'public-data', token, session ?? '', filters, widgetQueries ?? null] as const,
};

export function useReportDashboardList(params: ReportDashboardListParams) {
  return useQuery({
    queryKey: reportDashboardKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportDashboard>>(`/api/report/dashboards${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useReportDashboardCategories() {
  return useQuery({
    queryKey: reportDashboardKeys.categories,
    queryFn: () => request.get<ReportDashboardCategory[]>('/api/report/categories').then(unwrap),
  });
}

export function useReportDashboardCategoryLookup(params: { keyword?: string; limit?: number } = {}, enabled = true) {
  return useReportLookup('categories', params, enabled);
}

export function useReportDashboardLookup(params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number } = {}, enabled = true) {
  return useReportLookup('dashboards', params, enabled);
}

export function useReportDashboardDetail(
  id: number | undefined,
  enabled = true,
  mode: 'auto' | 'draft' | 'published' = 'auto',
) {
  return useQuery({
    queryKey: reportDashboardKeys.detail(id, mode),
    queryFn: () => request.get<ReportDashboard>(`/api/report/dashboards/${id}${toQueryString({ mode })}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useReportDashboardBatch(ids: number[], enabled = true, mode: 'auto' | 'draft' | 'published' = 'auto') {
  return useQuery({
    queryKey: reportDashboardKeys.batch(ids, mode),
    queryFn: () => request.post<ReportDashboard[]>('/api/report/dashboards/batch', { ids, mode }).then(unwrap),
    enabled: enabled && ids.length > 0,
  });
}

export function useSaveReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<ReportDashboard>(`/api/report/dashboards/${id}`, values) : request.post<ReportDashboard>('/api/report/dashboards', values)).then(unwrap),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.all });
      if (vars.id) {
        void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.id, 'auto') });
        void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.id, 'draft') });
      }
    },
  });
}

export function usePublishReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, expectedRevision, remark }: { dashboardId: number; expectedRevision: number; remark?: string }) =>
      request.post<ReportDashboard>(`/api/report/dashboards/${dashboardId}/publish`, { expectedRevision, remark }).then(unwrap),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.all });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.dashboardId, 'auto') });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(vars.dashboardId) });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(vars.dashboardId) });
    },
  });
}

export function useOfflineReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, expectedRevision, remark }: { dashboardId: number; expectedRevision: number; remark?: string }) =>
      request.post<ReportDashboard>(`/api/report/dashboards/${dashboardId}/offline`, { expectedRevision, remark }).then(unwrap),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.all });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.dashboardId, 'auto') });
    },
  });
}

export function useDeleteReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/dashboards/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useBatchReportDashboardStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: 'enabled' | 'disabled' }) =>
      request.put<null>('/api/report/dashboards/batch-status', { ids, status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useCloneReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name?: string }) =>
      request.post<ReportDashboard>(`/api/report/dashboards/${id}/clone`, name ? { name } : {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useSaveReportDashboardCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id
        ? request.put<ReportDashboardCategory>(`/api/report/categories/${id}`, values)
        : request.post<ReportDashboardCategory>('/api/report/categories', values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.categories }),
  });
}

export function useDeleteReportDashboardCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/categories/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.categories }),
  });
}

export function useReportDashboardHealthSummary(
  dashboardId: number | undefined,
  params: { startAt?: string; endAt?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: reportDashboardKeys.healthSummary(dashboardId, params),
    queryFn: () => request.get<ReportExecutionStats>(`/api/report/executions/stats${toQueryString({ dashboardId, ...params })}`).then(unwrap),
    enabled: enabled && !!dashboardId,
  });
}

export function useToggleReportDashboardFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<{ favorited: boolean }>(`/api/report/dashboards/${id}/favorite`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useReportDashboardComments(
  id: number | undefined,
  params: ReportDashboardCommentListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: reportDashboardKeys.comments(id, params),
    queryFn: () => request.get<PaginatedResponse<ReportDashboardComment>>(
      `/api/report/dashboards/${id}/comments${toQueryString(params)}`,
      { silent: true },
    ).then(unwrap),
    enabled: enabled && !!id,
    placeholderData: keepPreviousData,
  });
}

export function useCreateReportDashboardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, widgetId, parentId, content }: { dashboardId: number; widgetId?: string | null; parentId?: number | null; content: string }) =>
      request.post<ReportDashboardComment>(`/api/report/dashboards/${dashboardId}/comments`, { widgetId: widgetId ?? null, parentId: parentId ?? null, content }, { silent: true }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['report', 'dashboards', 'comments', vars.dashboardId] }),
  });
}

export function useUpdateReportDashboardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, commentId, content }: { dashboardId: number; commentId: number; content: string }) =>
      request.put<ReportDashboardComment>(`/api/report/dashboards/${dashboardId}/comments/${commentId}`, { content }, { silent: true }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['report', 'dashboards', 'comments', vars.dashboardId] }),
  });
}

export function useResolveReportDashboardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, commentId, resolved }: { dashboardId: number; commentId: number; resolved: boolean }) =>
      request.post<ReportDashboardComment>(`/api/report/dashboards/${dashboardId}/comments/${commentId}/resolve`, { resolved }, { silent: true }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['report', 'dashboards', 'comments', vars.dashboardId] }),
  });
}

export function useDeleteReportDashboardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, commentId }: { dashboardId: number; commentId: number }) =>
      request.delete<null>(`/api/report/dashboards/${dashboardId}/comments/${commentId}`, undefined, { silent: true }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['report', 'dashboards', 'comments', vars.dashboardId] }),
  });
}

export function useReportDashboardShares(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.shares(id),
    queryFn: () => request.get<ReportDashboardShare[]>(`/api/report/dashboards/${id}/shares`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useCreateReportDashboardShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, values }: { dashboardId: number; values: Record<string, unknown> }) =>
      request.post<ReportDashboardShare>(`/api/report/dashboards/${dashboardId}/shares`, values).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(vars.dashboardId) }),
  });
}

export function useUpdateReportDashboardShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, dashboardId: _dashboardId, values }: { shareId: number; dashboardId: number; values: Record<string, unknown> }) =>
      request.put<ReportDashboardShare>(`/api/report/dashboards/shares/${shareId}`, values).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(vars.dashboardId) }),
  });
}

export function useDeleteReportDashboardShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (share: ReportDashboardShare) => request.delete<null>(`/api/report/dashboards/shares/${share.id}`).then(unwrap),
    onSuccess: (_data, share) => qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(share.dashboardId) }),
  });
}

export function useReportDashboardEmbedTokens(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.embedTokens(id),
    queryFn: () => request.get<ReportDashboardEmbedToken[]>(`/api/report/dashboards/${id}/embed-tokens`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useCreateReportDashboardEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, values }: { dashboardId: number; values: Record<string, unknown> }) =>
      request.post<ReportDashboardEmbedToken>(`/api/report/dashboards/${dashboardId}/embed-tokens`, values).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.embedTokens(vars.dashboardId) }),
  });
}

export function useRevokeReportDashboardEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ embedTokenId, dashboardId: _dashboardId }: { embedTokenId: number; dashboardId: number }) =>
      request.post<null>(`/api/report/dashboards/embed-tokens/${embedTokenId}/revoke`).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.embedTokens(vars.dashboardId) }),
  });
}

export function useReportDashboardVersions(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.versions(id),
    queryFn: () => request.get<ReportDashboardVersion[]>(`/api/report/dashboards/${id}/versions`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useReportDashboardVersionDiff(dashboardId: number | undefined, left: number, right: number, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.versionDiff(dashboardId, left, right),
    queryFn: () => request.get<ReportDashboardVersionDiff>(`/api/report/dashboards/${dashboardId}/versions/diff${toQueryString({ left, right })}`).then(unwrap),
    enabled: enabled && !!dashboardId,
  });
}

export function useSaveReportDashboardVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, remark }: { dashboardId: number; remark?: string }) =>
      request.post<ReportDashboardVersion>(`/api/report/dashboards/${dashboardId}/versions`, { remark }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(vars.dashboardId) }),
  });
}

export function useRestoreReportDashboardVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, versionId, expectedRevision }: { dashboardId: number; versionId: number; expectedRevision: number }) =>
      request.post<null>(`/api/report/dashboards/${dashboardId}/versions/${versionId}/restore`, { expectedRevision }).then(unwrap),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.all });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(vars.dashboardId) });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.dashboardId, 'draft') });
    },
  });
}

export interface DashboardWidgetDataState {
  data: ReportWidgetDataResult['data'] | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_WIDGET_STATE: DashboardWidgetDataState = { data: null, loading: false, error: null };

function buildStableJitter(base: number | false | undefined, key: string): number | false | undefined {
  if (!base || base <= 0) return base;
  const hash = Array.from(key).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) % 9973, 17);
  const delta = Math.max(250, Math.min(3000, Math.round(base * 0.08)));
  return base + (hash % (delta * 2 + 1)) - delta;
}

export function useReportDashboardWidgetData(
  dashboardId: number | undefined,
  widgets: ReportWidget[],
  filterValues: Record<string, unknown>,
  options?: {
    limit?: number;
    refetchInterval?: number | false;
    widgetQueries?: Record<string, ReportDatasetQueryOptions>;
    mode?: 'auto' | 'draft' | 'published';
  },
) {
  const queryClient = useQueryClient();
  const limit = options?.limit ?? 500;
  const mode = options?.mode ?? 'auto';
  const dataQuery = useQuery({
    queryKey: reportDashboardKeys.dashboardData(dashboardId, mode, filterValues, limit, options?.widgetQueries),
    queryFn: ({ signal }) => request.post<Record<string, ReportWidgetDataResult>>(
      `/api/report/dashboards/${dashboardId}/data${toQueryString({ mode })}`,
      { filters: filterValues, limit, widgetQueries: options?.widgetQueries },
      { silent: true, signal },
    ).then(unwrap),
    enabled: !!dashboardId,
    refetchInterval: buildStableJitter(options?.refetchInterval, `dashboard:${dashboardId ?? 'none'}:${mode}`),
  });

  const get = useCallback((widget: ReportWidget): DashboardWidgetDataState => {
    if (!widget.datasetId) return EMPTY_WIDGET_STATE;
    const item = dataQuery.data?.[widget.i];
    return {
      data: item?.data ?? null,
      loading: dataQuery.isFetching,
      error: item?.error?.message ?? (dataQuery.error instanceof Error ? dataQuery.error.message : null),
    };
  }, [dataQuery.data, dataQuery.error, dataQuery.isFetching]);

  const refresh = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: reportDashboardKeys.dashboardData(dashboardId, mode, filterValues, limit, options?.widgetQueries), type: 'active' });
  }, [dashboardId, filterValues, limit, mode, options?.widgetQueries, queryClient]);

  return { get, refresh, query: dataQuery };
}

export function usePublicReportDashboardAccess() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password?: string }) =>
      request.post<ReportPublicAccessSession>(`/api/report/public/dashboards/${token}/access`, { password }, { skipAuth: true, silent: true }) as Promise<ApiResponse<ReportPublicAccessSession>>,
  });
}

export function usePublicReportDashboard(token: string | undefined, session: string | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.publicDashboard(token, session),
    queryFn: () => request.get<ReportPublicDashboard>(`/api/report/public/dashboards/${token}`, {
      skipAuth: true,
      silent: true,
      headers: session ? { session } : undefined,
    }).then(unwrap),
    enabled: enabled && !!token && !!session,
  });
}

export function usePublicReportDashboardData(
  token: string | undefined,
  session: string | undefined,
  filters: Record<string, unknown>,
  widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  enabled = true,
) {
  return useQuery({
    queryKey: reportDashboardKeys.publicData(token, session, filters, widgetQueries),
    queryFn: ({ signal }) => request.post<Record<string, ReportWidgetDataResult>>(
      `/api/report/public/dashboards/${token}/data`,
      { filters, widgetQueries },
      { skipAuth: true, silent: true, signal, headers: session ? { session } : undefined },
    ).then(unwrap),
    enabled: enabled && !!token && !!session,
  });
}
