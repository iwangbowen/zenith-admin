import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { apiScopeContract, oauth2ClientContract, ratePlanContract } from '@zenith/shared/open-platform';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type OAuth2AppListParams = QueryOf<typeof oauth2ClientContract.list>;

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveOAuth2AppValues = BodyOf<typeof oauth2ClientContract.update>;

const OAUTH2_APP_KEY = resourceKeyOf(oauth2ClientContract.basePath);

export const oauth2AppKeys = {
  all: [OAUTH2_APP_KEY] as const,
  lists: contractKey(oauth2ClientContract.list),
  list: (params: OAuth2AppListParams) => contractKey(oauth2ClientContract.list, { query: params }),
  detail: (id: number) => contractKey(oauth2ClientContract.detail, { params: { id } }),
  grantsPrefix: contractKey(oauth2ClientContract.grants),
  grants: (id: number, page: number, pageSize: number) => contractKey(oauth2ClientContract.grants, { params: { id }, query: { page, pageSize } }),
  tokensPrefix: contractKey(oauth2ClientContract.tokens),
  tokens: (clientId: string, page: number, pageSize: number) => contractKey(oauth2ClientContract.tokens, { query: { clientId, page, pageSize } }),
  myGrantsPrefix: contractKey(oauth2ClientContract.myGrants),
  myGrants: (page: number, pageSize: number) => contractKey(oauth2ClientContract.myGrants, { query: { page, pageSize } }),
};

export function useOAuth2AppList(params: OAuth2AppListParams) {
  return useApiQuery(oauth2ClientContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useOAuth2AppDetail(id: number | undefined, enabled = true) {
  return useApiQuery(oauth2ClientContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 限流套餐下拉源（启用项）：静态字典型数据，与应用增删改无关 */
export function useOAuth2RatePlans() {
  return useApiQuery(ratePlanContract.options, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}

/** API Scope 下拉源（启用项）：静态字典型数据，与应用增删改无关 */
export function useOAuth2ApiScopes() {
  return useApiQuery(apiScopeContract.options, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}

function invalidateApp(qc: QueryClient, id: number) {
  void qc.invalidateQueries({ queryKey: oauth2AppKeys.detail(id) });
  void qc.invalidateQueries({ queryKey: oauth2AppKeys.lists });
}

/** 无 id 走创建（POST，返回含一次性 clientSecret），有 id 走更新（PUT） */
export function useSaveOAuth2App() {
  return useSaveMutation(oauth2ClientContract.create, oauth2ClientContract.update, {
    invalidate: (qc, _data, { id }) => {
      if (id !== undefined) void qc.invalidateQueries({ queryKey: oauth2AppKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.lists });
    },
  });
}

export function useDeleteOAuth2App() {
  return useApiMutation(oauth2ClientContract.remove, {
    invalidate: (qc, _output, { params }) => {
      // 详情与授权记录必须移除而非失效：失效会让已删除记录在下次挂载时重新请求并 404
      qc.removeQueries({ queryKey: oauth2AppKeys.detail(params.id) });
      qc.removeQueries({ queryKey: contractKey(oauth2ClientContract.grants, { params: { id: params.id }, query: {} }) });
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.lists });
      // 应用删除后其令牌一并失效
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.tokensPrefix });
    },
  });
}

export function useRegenerateOAuth2AppSecret() {
  return useApiMutation(oauth2ClientContract.regenerateSecret, {
    invalidate: (qc, _output, { params }) => invalidateApp(qc, params.id),
  });
}

export function useReviewOAuth2App() {
  return useApiMutation(oauth2ClientContract.review, {
    invalidate: (qc, _output, { params }) => invalidateApp(qc, params.id),
  });
}

export function useOAuth2AppGrants(id: number, page: number, pageSize: number) {
  return useApiQuery(oauth2ClientContract.grants, { params: { id }, query: { page, pageSize } }, { placeholderData: keepPreviousData });
}

export function useOAuth2AppTokens(clientId: string | undefined, page: number, pageSize: number) {
  return useApiQuery(oauth2ClientContract.tokens, { query: { clientId: clientId ?? '', page, pageSize } }, {
    placeholderData: keepPreviousData,
    enabled: Boolean(clientId),
  });
}

/** 吊销令牌只影响令牌列表与授权记录，不改变应用本身 */
export function useRevokeOAuth2Token() {
  return useApiMutation(oauth2ClientContract.revokeToken, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.tokensPrefix });
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.grantsPrefix });
    },
  });
}

// ─── 我的已授权应用（用户自助）──────────────────────────────────────────────

export function useMyOAuth2Grants(page: number, pageSize: number, enabled = true) {
  return useApiQuery(oauth2ClientContract.myGrants, { query: { page, pageSize } }, { placeholderData: keepPreviousData, enabled });
}

/** 撤销会连带作废该用户在该应用下的令牌，管理端的令牌与授权记录同步过期 */
export function useRevokeMyOAuth2Grant() {
  return useApiMutation(oauth2ClientContract.revokeMyGrant, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.myGrantsPrefix });
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.tokensPrefix });
      void qc.invalidateQueries({ queryKey: oauth2AppKeys.grantsPrefix });
    },
  });
}
