import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnalyticsEventMeta,
  AnalyticsOverview,
  AnalyticsSettings,
  ErrorAlertRule,
  ErrorAlertLog,
  ErrorEvent,
  ErrorGroup,
  ErrorOverview,
  FunnelResult,
  HeatmapData,
  HeatmapPageListItem,
  PageStats,
  PaginatedResponse,
  PathResult,
  RealtimeStats,
  RetentionResult,
  SessionListItem,
  SessionTimeline,
  AnalyticsSavedReport,
  TrendSeries,
  UserStats,
  UserTimeline,
  FeatureStats,
} from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

interface ErrorGroupDetail {
  group: ErrorGroup;
  symbolicatedStack: string | null;
  trend: { date: string; count: number }[];
  browsers: { name: string; value: number }[];
  os: { name: string; value: number }[];
  recentEvents: ErrorEvent[];
}

export interface AnalyticsEventsParams {
  page: number;
  pageSize: number;
  eventType?: string;
  eventName?: string;
  username?: string;
  pagePath?: string;
  deviceType?: string;
  startTime?: string;
  endTime?: string;
}

export interface AnalyticsMetaParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: AnalyticsEventMeta['status'];
  category?: string;
}

export interface AnalyticsSessionsParams {
  page: number;
  pageSize: number;
  username?: string;
  deviceType?: string;
}

export interface FrontendErrorGroupParams {
  page: number;
  pageSize: number;
  status?: string;
  errorType?: string;
  level?: string;
  keyword?: string;
}

export interface FrontendSourceMapParams {
  page: number;
  pageSize: number;
  release?: string;
}

export interface FrontendSimplePageParams {
  page: number;
  pageSize: number;
}

export interface AnalyticsRangeParams {
  days: number;
  startDate?: string;
  endDate?: string;
}

export const analyticsKeys = {
  all: ['analytics'] as const,
  overview: (range: AnalyticsRangeParams) => ['analytics', 'overview', range] as const,
  trends: (range: AnalyticsRangeParams, compare: boolean) => ['analytics', 'trends', range, compare] as const,
  realtime: ['analytics', 'realtime'] as const,
  pageStats: (days: number) => ['analytics', 'page-stats', days] as const,
  featureStats: (days: number) => ['analytics', 'feature-stats', days] as const,
  sessionsLists: ['analytics', 'sessions', 'list'] as const,
  sessions: (params: AnalyticsSessionsParams) => ['analytics', 'sessions', 'list', params] as const,
  funnel: ['analytics', 'funnel'] as const,
  retention: (days: number) => ['analytics', 'retention', days] as const,
  path: (days: number) => ['analytics', 'path', days] as const,
  userStats: (days: number) => ['analytics', 'user-stats', days] as const,
  userTimeline: (userId: number | null) => ['analytics', 'user-timeline', userId] as const,
  dimension: (dimension: string, days: number) => ['analytics', 'dimension', dimension, days] as const,
  heatmapPages: (days: number) => ['analytics', 'heatmap-pages', days] as const,
  heatmap: (pagePath: string, componentArea: string, days: number) => ['analytics', 'heatmap', pagePath, componentArea, days] as const,
  data: {
    all: ['analytics', 'data'] as const,
    eventsLists: ['analytics', 'data', 'events'] as const,
    events: (params: AnalyticsEventsParams) => ['analytics', 'data', 'events', params] as const,
    eventDetail: (id: number | undefined) => ['analytics', 'data', 'event-detail', id] as const,
    metaLists: ['analytics', 'data', 'meta'] as const,
    meta: (params: AnalyticsMetaParams) => ['analytics', 'data', 'meta', params] as const,
    rollup: (days: number) => ['analytics', 'data', 'rollup', days] as const,
    settings: ['analytics', 'data', 'settings'] as const,
  },
  frontendErrors: {
    all: ['analytics', 'frontend-errors'] as const,
    overview: (days: number) => ['analytics', 'frontend-errors', 'overview', days] as const,
    groupsLists: ['analytics', 'frontend-errors', 'groups'] as const,
    groups: (params: FrontendErrorGroupParams) => ['analytics', 'frontend-errors', 'groups', params] as const,
    groupDetail: (id: number | undefined) => ['analytics', 'frontend-errors', 'group-detail', id] as const,
    events: (params: FrontendSimplePageParams) => ['analytics', 'frontend-errors', 'events', params] as const,
    sourceMapsLists: ['analytics', 'frontend-errors', 'source-maps'] as const,
    sourceMaps: (params: FrontendSourceMapParams) => ['analytics', 'frontend-errors', 'source-maps', params] as const,
    alertsLists: ['analytics', 'frontend-errors', 'alerts'] as const,
    alerts: (params: FrontendSimplePageParams) => ['analytics', 'frontend-errors', 'alerts', params] as const,
    alertLogs: (params: FrontendSimplePageParams) => ['analytics', 'frontend-errors', 'alert-logs', params] as const,
    adminUsers: ['analytics', 'frontend-errors', 'admin-users'] as const,
  },
};

function rangeQuery(range: AnalyticsRangeParams): string {
  return range.startDate && range.endDate
    ? toQueryString({ startDate: range.startDate, endDate: range.endDate })
    : toQueryString({ days: range.days });
}

export function useAnalyticsOverview(range: AnalyticsRangeParams) {
  return useQuery({
    queryKey: analyticsKeys.overview(range),
    queryFn: () => request.get<AnalyticsOverview>(`/api/analytics/overview${rangeQuery(range)}`).then(unwrap),
  });
}

export function useAnalyticsTrends(range: AnalyticsRangeParams, compare = false) {
  return useQuery({
    queryKey: analyticsKeys.trends(range, compare),
    queryFn: () => request.get<TrendSeries>(`/api/analytics/trends${rangeQuery(range)}${compare ? '&compare=true' : ''}`).then(unwrap),
  });
}

export function useAnalyticsRealtime() {
  return useQuery({
    queryKey: analyticsKeys.realtime,
    queryFn: () => request.get<RealtimeStats>('/api/analytics/realtime', { silent: true }).then(unwrap),
    refetchInterval: 10_000,
  });
}

export function useAnalyticsPageStats(days: number) {
  return useQuery({
    queryKey: analyticsKeys.pageStats(days),
    queryFn: () => request.get<PageStats>(`/api/analytics/page-stats?days=${days}&limit=20`).then(unwrap),
  });
}

export function useAnalyticsFeatureStats(days: number) {
  return useQuery({
    queryKey: analyticsKeys.featureStats(days),
    queryFn: () => request.get<FeatureStats>(`/api/analytics/feature-stats?days=${days}&limit=30`).then(unwrap),
  });
}

export function useAnalyticsSessions(params: AnalyticsSessionsParams) {
  return useQuery({
    queryKey: analyticsKeys.sessions(params),
    queryFn: () => request.get<PaginatedResponse<SessionListItem>>(`/api/analytics/sessions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAnalyzeFunnel() {
  return useMutation({
    mutationFn: (values: { days: number; steps: Array<{ label: string; pagePath?: string; eventName?: string }> }) =>
      request.post<FunnelResult>('/api/analytics/funnel', values).then(unwrap),
  });
}

export function useAnalyticsRetention(days: number) {
  return useQuery({
    queryKey: analyticsKeys.retention(days),
    queryFn: () => request.get<RetentionResult>(`/api/analytics/retention?days=${days}`).then(unwrap),
  });
}

export function useAnalyticsPath(days: number) {
  return useQuery({
    queryKey: analyticsKeys.path(days),
    queryFn: () => request.get<PathResult>(`/api/analytics/path?days=${days}&limit=12`).then(unwrap),
  });
}

export function useAnalyticsUserStats(days: number) {
  return useQuery({
    queryKey: analyticsKeys.userStats(days),
    queryFn: () => request.get<UserStats>(`/api/analytics/user-stats?days=${days}&limit=20`).then(unwrap),
  });
}

export function useAnalyticsUserTimeline(userId: number | null, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.userTimeline(userId),
    queryFn: () => request.get<UserTimeline>(`/api/analytics/user-timeline?userId=${userId}&limit=100`).then(unwrap),
    enabled: enabled && userId != null,
  });
}

export function useSessionTimeline(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'session-timeline', sessionId] as const,
    queryFn: () => request.get<SessionTimeline>(`/api/analytics/session-timeline${toQueryString({ sessionId })}`).then(unwrap),
    enabled: enabled && !!sessionId,
  });
}

export function useSavedFunnelReports(enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'saved-reports', 'funnel'] as const,
    queryFn: () => request.get<{ list: AnalyticsSavedReport[] }>('/api/analytics/reports?type=funnel').then(unwrap),
    enabled,
  });
}

export function useSaveFunnelReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; config: Record<string, unknown> }) =>
      request.post<AnalyticsSavedReport>('/api/analytics/reports', { ...values, reportType: 'funnel' }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytics', 'saved-reports'] }),
  });
}

export function useDeleteFunnelReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/analytics/reports/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytics', 'saved-reports'] }),
  });
}

export function useAnalyticsDimension(dimension: string, days: number) {
  return useQuery({
    queryKey: analyticsKeys.dimension(dimension, days),
    queryFn: () => request.get<{ items: Array<{ name: string; value: number; percent: number }>; total: number }>(`/api/analytics/dimension?dimension=${dimension}&days=${days}&limit=12`).then(unwrap),
  });
}

export function useAnalyticsHeatmapPages(days: number) {
  return useQuery({
    queryKey: analyticsKeys.heatmapPages(days),
    queryFn: () => request.get<{ pages: HeatmapPageListItem[] }>(`/api/analytics/heatmap-pages?days=${days}`).then(unwrap),
  });
}

export function useAnalyticsHeatmap(pagePath: string, componentArea: string, days: number) {
  return useQuery({
    queryKey: analyticsKeys.heatmap(pagePath, componentArea, days),
    queryFn: () => request.get<HeatmapData>(`/api/analytics/heatmap${toQueryString({ pagePath, componentArea: componentArea || undefined, days })}`).then(unwrap),
    enabled: !!pagePath,
  });
}

export function useAnalyticsEvents(params: AnalyticsEventsParams) {
  return useQuery({
    queryKey: analyticsKeys.data.events(params),
    queryFn: () => request.get<PaginatedResponse<import('@zenith/shared').EventListItem>>(`/api/analytics/events${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsEventDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.data.eventDetail(id),
    queryFn: () => request.get<import('@zenith/shared').EventDetail>(`/api/analytics/events/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useAnalyticsEventMeta(params: AnalyticsMetaParams) {
  return useQuery({
    queryKey: analyticsKeys.data.meta(params),
    queryFn: () => request.get<PaginatedResponse<AnalyticsEventMeta>>(`/api/analytics/event-meta${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsRollup(days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.data.rollup(days),
    queryFn: () => request.get<{ items: Array<{ statDate: string; pv: number; uv: number; sessions: number; events: number; bounceSessions: number; totalDwellMs: number }> }>(`/api/analytics/rollup?days=${days}`).then(unwrap),
    enabled,
  });
}

export function useAnalyticsSettings(enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.data.settings,
    queryFn: () => request.get<AnalyticsSettings>('/api/analytics/settings').then(unwrap),
    enabled,
  });
}

export function useCleanAnalyticsEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => request.delete<null>(`/api/analytics/clean?days=${days}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.data.all }),
  });
}

export function useSaveAnalyticsEventMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<AnalyticsEventMeta>('/api/analytics/event-meta', values)
        : request.put<AnalyticsEventMeta>(`/api/analytics/event-meta/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.data.all }),
  });
}

export function useDeleteAnalyticsEventMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/analytics/event-meta/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.data.all }),
  });
}

export function useRebuildAnalyticsRollup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => request.post<null>(`/api/analytics/rollup/rebuild?days=${days}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.data.all }),
  });
}

export function useSaveAnalyticsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.put<AnalyticsSettings>('/api/analytics/settings', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.data.settings }),
  });
}

export function useFrontendErrorOverview(days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.overview(days),
    queryFn: () => request.get<ErrorOverview>(`/api/frontend-errors/overview?days=${days}`).then(unwrap),
    enabled,
  });
}

export function useFrontendErrorGroups(params: FrontendErrorGroupParams, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.groups(params),
    queryFn: () => request.get<PaginatedResponse<ErrorGroup>>(`/api/frontend-errors/groups${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFrontendErrorGroupDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.groupDetail(id),
    queryFn: () => request.get<ErrorGroupDetail>(`/api/frontend-errors/groups/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useFrontendAdminUsers(enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.adminUsers,
    queryFn: () => request.get<PaginatedResponse<{ id: number; nickname?: string | null; username: string }>>('/api/users?page=1&pageSize=100').then(unwrap),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useUpdateFrontendErrorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) => request.put<ErrorGroup>(`/api/frontend-errors/groups/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.all }),
  });
}

export function useBatchUpdateFrontendErrorGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: string }) => request.post<null>(`/api/frontend-errors/groups/batch-status?status=${status}`, { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.all }),
  });
}

export function useBatchDeleteFrontendErrorGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.delete<null>('/api/frontend-errors/groups/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.all }),
  });
}

export function useFrontendErrorEvents(params: FrontendSimplePageParams, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.events(params),
    queryFn: () => request.get<PaginatedResponse<ErrorEvent>>(`/api/frontend-errors/events${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFrontendSourceMaps(params: FrontendSourceMapParams, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.sourceMaps(params),
    queryFn: () => request.get<PaginatedResponse<import('@zenith/shared').SourceMapItem>>(`/api/frontend-errors/source-maps${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDeleteFrontendSourceMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/frontend-errors/source-maps/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.sourceMapsLists }),
  });
}

export function useSubmitFrontendSourceMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { release: string; fileName: string; content: string }) => request.post<import('@zenith/shared').SourceMapItem>('/api/frontend-errors/source-maps', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.sourceMapsLists }),
  });
}

export function useFrontendAlerts(params: FrontendSimplePageParams, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.alerts(params),
    queryFn: () => request.get<PaginatedResponse<ErrorAlertRule>>(`/api/frontend-errors/alerts${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveFrontendAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<ErrorAlertRule>('/api/frontend-errors/alerts', values)
        : request.put<ErrorAlertRule>(`/api/frontend-errors/alerts/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.alertsLists }),
  });
}

export function useDeleteFrontendAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/frontend-errors/alerts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.alertsLists }),
  });
}

export function useFrontendAlertLogs(params: FrontendSimplePageParams, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.frontendErrors.alertLogs(params),
    queryFn: () => request.get<PaginatedResponse<ErrorAlertLog>>(`/api/frontend-errors/alert-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}
