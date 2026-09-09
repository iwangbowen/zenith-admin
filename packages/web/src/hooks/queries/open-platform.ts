import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import {
  apiScopeContract,
  appWebhookContract,
  oauth2ClientContract,
  openApiStatsContract,
  openSignatureContract,
  paymentWebhookContract,
  ratePlanContract,
  type AppWebhookContract,
} from '@zenith/shared/open-platform';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { useSaveMutation, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

// ─── API Scope ───────────────────────────────────────────────────────────────

export const {
  keys: apiScopeKeys,
  useList: useApiScopeList,
  useDetail: useApiScopeDetail,
  useSave: useSaveApiScope,
  useDelete: useDeleteApiScopes,
} = createResourceQueries(apiScopeContract);

// ─── 限流套餐 ─────────────────────────────────────────────────────────────────

export const {
  keys: ratePlanKeys,
  useList: useRatePlanList,
  useDetail: useRatePlanDetail,
  useSave: useSaveRatePlan,
  useDelete: useDeleteRatePlans,
} = createResourceQueries(ratePlanContract);

// ─── 应用选项（供 Webhook / SDK / 统计筛选下拉） ──────────────────────────────

export function useOpenAppOptions(options?: { enabled?: boolean }) {
  return useApiQuery(oauth2ClientContract.options, {
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
    requestOptions: { silent: true },
  });
}

// ─── Webhook 订阅（开放平台 / 支付中心共用同一订阅模型） ──────────────────────

export type WebhookApiScope = 'open' | 'payment';

export type WebhookListParams = QueryOf<AppWebhookContract['list']>;

export type WebhookDeliveryListParams = QueryOf<AppWebhookContract['deliveries']>;

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveWebhookValues = Partial<BodyOf<AppWebhookContract['create']>>;

function webhookContractOf(scope: WebhookApiScope): AppWebhookContract {
  return scope === 'payment' ? paymentWebhookContract : appWebhookContract;
}

export function webhookKeys(scope: WebhookApiScope) {
  const contract = webhookContractOf(scope);
  return {
    all: [resourceKeyOf(contract.basePath)] as const,
    events: contractKey(contract.events),
    lists: contractKey(contract.list),
    list: (params: WebhookListParams) => contractKey(contract.list, { query: params }),
    deliveriesLists: contractKey(contract.deliveries),
    deliveries: (params: WebhookDeliveryListParams) => contractKey(contract.deliveries, { query: params }),
  };
}

/** 同一条订阅可同时出现在开放平台与支付中心视图，任一侧写操作后两侧一并失效 */
function invalidateWebhookCaches(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: webhookKeys('open').all });
  void qc.invalidateQueries({ queryKey: webhookKeys('payment').all });
}

export function useWebhookEvents(scope: WebhookApiScope = 'open', options?: { enabled?: boolean }) {
  return useApiQuery(webhookContractOf(scope).events, {
    staleTime: LOOKUP_STALE_TIME,
    enabled: options?.enabled ?? true,
    requestOptions: { silent: true },
  });
}

export function useWebhookList(params: WebhookListParams, scope: WebhookApiScope = 'open') {
  return useApiQuery(webhookContractOf(scope).list, { query: params }, { placeholderData: keepPreviousData });
}

/** 无 id 走创建（POST，返回含一次性 secret），有 id 走更新（PUT） */
export function useSaveWebhook(scope: WebhookApiScope = 'open') {
  const contract = webhookContractOf(scope);
  return useSaveMutation(contract.create, contract.update, {
    invalidate: (qc) => invalidateWebhookCaches(qc),
  });
}

export function useDeleteWebhook(scope: WebhookApiScope = 'open') {
  return useApiMutation(webhookContractOf(scope).remove, { invalidate: invalidateWebhookCaches });
}

export function useRegenerateWebhookSecret(scope: WebhookApiScope = 'open') {
  return useApiMutation(webhookContractOf(scope).regenerateSecret, { invalidate: invalidateWebhookCaches });
}

export function useTestWebhook(scope: WebhookApiScope = 'open') {
  return useApiMutation(webhookContractOf(scope).test, { invalidate: invalidateWebhookCaches });
}

export function useWebhookDeliveries(params: WebhookDeliveryListParams, enabled = true, scope: WebhookApiScope = 'open') {
  return useApiQuery(webhookContractOf(scope).deliveries, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useBatchRetryWebhookDeliveries(scope: WebhookApiScope = 'open') {
  return useApiMutation(webhookContractOf(scope).batchRetryDeliveries, { invalidate: invalidateWebhookCaches });
}

export function useRetryWebhookDelivery(scope: WebhookApiScope = 'open') {
  return useApiMutation(webhookContractOf(scope).retryDelivery, { invalidate: invalidateWebhookCaches });
}

// ─── 签名验签工具 ─────────────────────────────────────────────────────────────

export type SignatureVerifyValues = BodyOf<typeof openSignatureContract.verify>;

export function useSignatureAlgorithm(enabled = true) {
  return useApiQuery(openSignatureContract.algorithm, { enabled, requestOptions: { silent: true } });
}

export function useVerifySignature() {
  return useApiMutation(openSignatureContract.verify);
}

// ─── 调用统计 ─────────────────────────────────────────────────────────────────

export type OpenApiStatsRangeParams = QueryOf<typeof openApiStatsContract.overview>;

export type OpenApiStatsTrendParams = QueryOf<typeof openApiStatsContract.trend>;

export type OpenApiLogListParams = QueryOf<typeof openApiStatsContract.logs>;

/** 统计页各查询的公共前缀（概览 / 趋势 / 分组 / 日志共用一个资源根） */
export const openApiStatsKeys = {
  all: [resourceKeyOf(openApiStatsContract.basePath)] as const,
};

/** Top N 榜单在页面中固定取前 8 */
const STATS_GROUP_LIMIT = 8;

export function useOpenApiStatsOverview(params: OpenApiStatsRangeParams) {
  return useApiQuery(openApiStatsContract.overview, { query: params }, { requestOptions: { silent: true } });
}

export function useOpenApiStatsTrend(params: OpenApiStatsTrendParams) {
  return useApiQuery(openApiStatsContract.trend, { query: params }, { requestOptions: { silent: true } });
}

export function useOpenApiStatsByApp(params: OpenApiStatsRangeParams) {
  return useApiQuery(openApiStatsContract.byApp, { query: { ...params, limit: STATS_GROUP_LIMIT } }, { requestOptions: { silent: true } });
}

export function useOpenApiStatsByEndpoint(params: OpenApiStatsRangeParams) {
  return useApiQuery(openApiStatsContract.byEndpoint, { query: { ...params, limit: STATS_GROUP_LIMIT } }, { requestOptions: { silent: true } });
}

export function useOpenApiCallLogs(params: OpenApiLogListParams) {
  return useApiQuery(openApiStatsContract.logs, { query: params }, { placeholderData: keepPreviousData });
}
