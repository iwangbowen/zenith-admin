import { useCallback, useMemo } from 'react';
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiResponse,
  PaginatedResponse,
  ReportDashboard,
  ReportDashboardCategory,
  ReportDashboardComment,
  ReportDashboardShare,
  ReportDashboardVersion,
  ReportDataResult,
  ReportPublicDashboard,
  ReportWidget,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { createLimiter, toQueryString, unwrap } from '@/lib/query';

/** 报表组件取数共享并发闸门（查看页/设计器/嵌入共用，一屏大盘不至于瞬时打爆后端） */
export const reportDataLimiter = createLimiter(6);

export interface ReportDashboardListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  categoryId?: number;
  favorited?: boolean;
}

export const reportDashboardKeys = {
  all: ['report', 'dashboards'] as const,
  lists: ['report', 'dashboards', 'list'] as const,
  list: (params: ReportDashboardListParams) => ['report', 'dashboards', 'list', params] as const,
  detail: (id: number | undefined) => ['report', 'dashboards', 'detail', id] as const,
  categories: ['report', 'dashboards', 'categories'] as const,
  comments: (id: number | undefined) => ['report', 'dashboards', 'comments', id] as const,
  shares: (id: number | undefined) => ['report', 'dashboards', 'shares', id] as const,
  versions: (id: number | undefined) => ['report', 'dashboards', 'versions', id] as const,
  widgetDataAll: (dashboardId: number | undefined) => ['report', 'dashboards', 'widget-data', dashboardId] as const,
  widgetData: (dashboardId: number | undefined, datasetId: number, params: Record<string, unknown>, limit: number) =>
    ['report', 'dashboards', 'widget-data', dashboardId, datasetId, params, limit] as const,
  publicDashboard: (token: string | undefined, password: string | undefined) =>
    ['report', 'dashboards', 'public', token, password ?? ''] as const,
  publicData: (token: string | undefined, password: string | undefined, filters: Record<string, unknown>) =>
    ['report', 'dashboards', 'public-data', token, password ?? '', filters] as const,
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

export function useReportDashboardDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.detail(id),
    queryFn: () => request.get<ReportDashboard>(`/api/report/dashboards/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useSaveReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<ReportDashboard> }) =>
      (id ? request.put<ReportDashboard>(`/api/report/dashboards/${id}`, values) : request.post<ReportDashboard>('/api/report/dashboards', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useDeleteReportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/dashboards/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useToggleReportDashboardFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/report/dashboards/${id}/favorite`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDashboardKeys.all }),
  });
}

export function useReportDashboardComments(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.comments(id),
    queryFn: () => request.get<ReportDashboardComment[]>(`/api/report/dashboards/${id}/comments`, { silent: true }).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useCreateReportDashboardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, content }: { dashboardId: number; content: string }) =>
      request.post<ReportDashboardComment>(`/api/report/dashboards/${dashboardId}/comments`, { widgetId: null, content }, { silent: true }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.comments(vars.dashboardId) }),
  });
}

export function useDeleteReportDashboardComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, commentId }: { dashboardId: number; commentId: number }) =>
      request.delete<null>(`/api/report/dashboards/${dashboardId}/comments/${commentId}`, undefined, { silent: true }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.comments(vars.dashboardId) }),
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
    mutationFn: ({ dashboardId, password, expireAt }: { dashboardId: number; password?: string; expireAt?: string | null }) =>
      request.post<ReportDashboardShare>(`/api/report/dashboards/${dashboardId}/shares`, { enabled: true, password: password || undefined, expireAt }).then(unwrap),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(vars.dashboardId) }),
  });
}

export function useToggleReportDashboardShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (share: ReportDashboardShare) =>
      request.put<null>(`/api/report/dashboards/shares/${share.id}`, { enabled: !share.enabled }).then(unwrap),
    onSuccess: (_data, share) => qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(share.dashboardId) }),
  });
}

export function useDeleteReportDashboardShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (share: ReportDashboardShare) => request.delete<null>(`/api/report/dashboards/shares/${share.id}`).then(unwrap),
    onSuccess: (_data, share) => qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(share.dashboardId) }),
  });
}

export function useReportDashboardVersions(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.versions(id),
    queryFn: () => request.get<ReportDashboardVersion[]>(`/api/report/dashboards/${id}/versions`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useSaveReportDashboardVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dashboardId: number) => request.post<null>(`/api/report/dashboards/${dashboardId}/versions`, {}).then(unwrap),
    onSuccess: (_data, dashboardId) => qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(dashboardId) }),
  });
}

export function useRestoreReportDashboardVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, versionId }: { dashboardId: number; versionId: number }) =>
      request.post<ReportDashboard>(`/api/report/dashboards/${dashboardId}/versions/${versionId}/restore`).then(unwrap),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.all });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(vars.dashboardId) });
    },
  });
}

function computeWidgetParams(widget: ReportWidget, filterValues: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const binding of widget.paramBindings ?? []) {
    if (binding.filterId && binding.param) params[binding.param] = filterValues[binding.filterId];
  }
  return params;
}

export interface DashboardWidgetDataState {
  data: ReportDataResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_WIDGET_STATE: DashboardWidgetDataState = { data: null, loading: false, error: null };

export function useReportDashboardWidgetData(
  dashboardId: number | undefined,
  widgets: ReportWidget[],
  filterValues: Record<string, unknown>,
  options?: { limit?: number; refetchInterval?: number | false },
) {
  const queryClient = useQueryClient();
  const limit = options?.limit ?? 500;
  const entries = useMemo(() => {
    const map = new Map<string, { key: string; datasetId: number; params: Record<string, unknown> }>();
    for (const widget of widgets ?? []) {
      if (!widget.datasetId) continue;
      const params = computeWidgetParams(widget, filterValues);
      const key = `${widget.datasetId}:${JSON.stringify(params)}`;
      if (!map.has(key)) map.set(key, { key, datasetId: widget.datasetId, params });
    }
    return Array.from(map.values());
  }, [widgets, filterValues]);

  const stateMap = useQueries({
    queries: entries.map((entry) => ({
      queryKey: reportDashboardKeys.widgetData(dashboardId, entry.datasetId, entry.params, limit),
      queryFn: () => reportDataLimiter(() =>
        request.post<ReportDataResult>(`/api/report/datasets/${entry.datasetId}/data`, { params: entry.params, limit }, { silent: true }).then(unwrap)),
      enabled: !!dashboardId,
      refetchInterval: options?.refetchInterval,
    })),
    // combine：返回值引用稳定（仅底层查询结果变化时重算），可安全用于下游依赖
    combine: (results) => {
      const map = new Map<string, DashboardWidgetDataState>();
      entries.forEach((entry, index) => {
        const query = results[index];
        map.set(entry.key, {
          data: query?.data ?? null,
          loading: query?.isFetching ?? false,
          error: query?.error instanceof Error ? query.error.message : null,
        });
      });
      return map;
    },
  });

  const get = useCallback((widget: ReportWidget): DashboardWidgetDataState => {
    if (!widget.datasetId) return EMPTY_WIDGET_STATE;
    const key = `${widget.datasetId}:${JSON.stringify(computeWidgetParams(widget, filterValues))}`;
    return stateMap.get(key) ?? EMPTY_WIDGET_STATE;
  }, [filterValues, stateMap]);

  const refresh = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: reportDashboardKeys.widgetDataAll(dashboardId), type: 'active' });
  }, [queryClient, dashboardId]);

  return { get, refresh };
}

export function usePublicReportDashboard(token: string | undefined, password: string | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.publicDashboard(token, password),
    queryFn: () => request.post<ReportPublicDashboard>(`/api/report/public/dashboards/${token}`, { password }, { skipAuth: true, silent: true }) as Promise<ApiResponse<ReportPublicDashboard>>,
    enabled: enabled && !!token,
  });
}

export function usePublicReportDashboardData(token: string | undefined, password: string | undefined, filters: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.publicData(token, password, filters),
    queryFn: async () => {
      const res = await request.post<Record<string, ReportDataResult>>(`/api/report/public/dashboards/${token}/data`, { password, filters }, { skipAuth: true, silent: true });
      return res.code === 0 ? res.data : {};
    },
    enabled: enabled && !!token,
  });
}
