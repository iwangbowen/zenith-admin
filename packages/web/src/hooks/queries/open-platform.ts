import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiScope,
  AppWebhookDelivery,
  AppWebhookSubscription,
  AppWebhookSubscriptionCreated,
  OpenApiCallLog,
  OpenApiStatsGroupItem,
  OpenApiStatsOverview,
  OpenApiStatsTrendPoint,
  OpenSignatureResult,
  OpenWebhookEventMeta,
  PaginatedResponse,
  RatePlan,
} from '@zenith/shared';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface ApiScopeListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  scopeGroup?: string;
  status?: 'enabled' | 'disabled';
}

export interface RatePlanListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

export interface WebhookListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  clientId?: string;
  status?: 'enabled' | 'disabled';
}

export interface WebhookDeliveryListParams {
  page: number;
  pageSize: number;
  subscriptionId?: number;
  clientId?: string;
  status?: AppWebhookDelivery['status'];
  eventType?: string;
}

export interface OpenApiStatsRangeParams {
  startTime: string;
  endTime: string;
  clientId?: string;
}

export interface OpenApiStatsTrendParams extends OpenApiStatsRangeParams {
  granularity: 'hour' | 'day';
}

export interface OpenApiLogListParams extends OpenApiStatsRangeParams {
  page: number;
  pageSize: number;
  success?: boolean;
  method?: string;
  statusCode?: number;
  keyword?: string;
}

export interface SignatureVerifyValues {
  appKey: string;
  method: string;
  path: string;
  query?: string;
  body?: string;
  timestamp: string;
  nonce: string;
  signature?: string;
}

export interface AlgorithmDoc {
  algorithm: string;
  timestampWindow: number;
  headers: { appKey: string; timestamp: string; nonce: string; signature: string };
  stringToSignFormat: string;
  steps: string[];
}

export const openPlatformKeys = {
  all: ['open-platform'] as const,
  appOptions: ['open-platform', 'app-options'] as const,
  apiScopes: {
    all: ['open-platform', 'api-scopes'] as const,
    lists: ['open-platform', 'api-scopes', 'list'] as const,
    list: (params: ApiScopeListParams) => ['open-platform', 'api-scopes', 'list', params] as const,
  },
  ratePlans: {
    all: ['open-platform', 'rate-plans'] as const,
    lists: ['open-platform', 'rate-plans', 'list'] as const,
    list: (params: RatePlanListParams) => ['open-platform', 'rate-plans', 'list', params] as const,
  },
  webhooks: {
    all: ['open-platform', 'webhooks'] as const,
    events: ['open-platform', 'webhooks', 'events'] as const,
    lists: ['open-platform', 'webhooks', 'list'] as const,
    list: (params: WebhookListParams) => ['open-platform', 'webhooks', 'list', params] as const,
    deliveriesLists: ['open-platform', 'webhooks', 'deliveries'] as const,
    deliveries: (params: WebhookDeliveryListParams) => ['open-platform', 'webhooks', 'deliveries', params] as const,
  },
  signature: {
    all: ['open-platform', 'signature'] as const,
    algorithm: ['open-platform', 'signature', 'algorithm'] as const,
  },
  stats: {
    all: ['open-platform', 'stats'] as const,
    overview: (params: OpenApiStatsRangeParams) => ['open-platform', 'stats', 'overview', params] as const,
    trend: (params: OpenApiStatsTrendParams) => ['open-platform', 'stats', 'trend', params] as const,
    byApp: (params: OpenApiStatsRangeParams) => ['open-platform', 'stats', 'by-app', params] as const,
    byEndpoint: (params: OpenApiStatsRangeParams) => ['open-platform', 'stats', 'by-endpoint', params] as const,
    logsLists: ['open-platform', 'stats', 'logs'] as const,
    logs: (params: OpenApiLogListParams) => ['open-platform', 'stats', 'logs', params] as const,
  },
};

export function useOpenAppOptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: openPlatformKeys.appOptions,
    queryFn: () => request.get<{ clientId: string; name: string }[]>('/api/oauth2/clients/options', { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useApiScopeList(params: ApiScopeListParams) {
  return useQuery({
    queryKey: openPlatformKeys.apiScopes.list(params),
    queryFn: () => request.get<PaginatedResponse<ApiScope>>(`/api/api-scopes${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveApiScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<ApiScope> }) =>
      (id === undefined ? request.post<ApiScope>('/api/api-scopes', values) : request.put<ApiScope>(`/api/api-scopes/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.apiScopes.all }),
  });
}

export function useDeleteApiScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/api-scopes/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.apiScopes.all }),
  });
}

export function useBatchDeleteApiScopes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.delete<null>('/api/api-scopes/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.apiScopes.all }),
  });
}

export function useRatePlanList(params: RatePlanListParams) {
  return useQuery({
    queryKey: openPlatformKeys.ratePlans.list(params),
    queryFn: () => request.get<PaginatedResponse<RatePlan>>(`/api/rate-plans${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<RatePlan> }) =>
      (id === undefined ? request.post<RatePlan>('/api/rate-plans', values) : request.put<RatePlan>(`/api/rate-plans/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.ratePlans.all }),
  });
}

export function useDeleteRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/rate-plans/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.ratePlans.all }),
  });
}

export function useWebhookEvents(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: openPlatformKeys.webhooks.events,
    queryFn: () => request.get<OpenWebhookEventMeta[]>('/api/app-webhooks/events', { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

export function useWebhookList(params: WebhookListParams) {
  return useQuery({
    queryKey: openPlatformKeys.webhooks.list(params),
    queryFn: () => request.get<PaginatedResponse<AppWebhookSubscription>>(`/api/app-webhooks${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<AppWebhookSubscriptionCreated>('/api/app-webhooks', values)
        : request.put<AppWebhookSubscription>(`/api/app-webhooks/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.webhooks.all }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/app-webhooks/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.webhooks.all }),
  });
}

export function useRegenerateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<{ id: number; secret: string }>(`/api/app-webhooks/${id}/regenerate-secret`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.webhooks.all }),
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/app-webhooks/${id}/test`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.webhooks.all }),
  });
}

export function useWebhookDeliveries(params: WebhookDeliveryListParams, enabled = true) {
  return useQuery({
    queryKey: openPlatformKeys.webhooks.deliveries(params),
    queryFn: () => request.get<PaginatedResponse<AppWebhookDelivery>>(`/api/app-webhooks/deliveries${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useBatchRetryWebhookDeliveries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.post<{ scheduled: number }>('/api/app-webhooks/deliveries/batch-retry', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.webhooks.deliveriesLists }),
  });
}

export function useRetryWebhookDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/app-webhooks/deliveries/${id}/retry`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: openPlatformKeys.webhooks.deliveriesLists }),
  });
}

export function useSignatureAlgorithm(enabled = true) {
  return useQuery({
    queryKey: openPlatformKeys.signature.algorithm,
    queryFn: () => request.get<AlgorithmDoc>('/api/open-signature/algorithm', { silent: true }).then(unwrap),
    enabled,
  });
}

export function useVerifySignature() {
  return useMutation({
    mutationFn: (values: SignatureVerifyValues) => request.post<OpenSignatureResult>('/api/open-signature/verify', values).then(unwrap),
  });
}

export function useOpenApiStatsOverview(params: OpenApiStatsRangeParams) {
  return useQuery({
    queryKey: openPlatformKeys.stats.overview(params),
    queryFn: () => request.get<OpenApiStatsOverview>(`/api/open-api-stats/overview${toQueryString(params)}`, { silent: true }).then(unwrap),
  });
}

export function useOpenApiStatsTrend(params: OpenApiStatsTrendParams) {
  return useQuery({
    queryKey: openPlatformKeys.stats.trend(params),
    queryFn: () => request.get<OpenApiStatsTrendPoint[]>(`/api/open-api-stats/trend${toQueryString(params)}`, { silent: true }).then(unwrap),
  });
}

export function useOpenApiStatsByApp(params: OpenApiStatsRangeParams) {
  return useQuery({
    queryKey: openPlatformKeys.stats.byApp(params),
    queryFn: () => request.get<OpenApiStatsGroupItem[]>(`/api/open-api-stats/by-app${toQueryString({ ...params, limit: 8 })}`, { silent: true }).then(unwrap),
  });
}

export function useOpenApiStatsByEndpoint(params: OpenApiStatsRangeParams) {
  return useQuery({
    queryKey: openPlatformKeys.stats.byEndpoint(params),
    queryFn: () => request.get<OpenApiStatsGroupItem[]>(`/api/open-api-stats/by-endpoint${toQueryString({ ...params, limit: 8 })}`, { silent: true }).then(unwrap),
  });
}

export function useOpenApiCallLogs(params: OpenApiLogListParams) {
  return useQuery({
    queryKey: openPlatformKeys.stats.logs(params),
    queryFn: () => request.get<PaginatedResponse<OpenApiCallLog>>(`/api/open-api-stats/logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}
