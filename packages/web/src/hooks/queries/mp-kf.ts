import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { mpKfAccountContract, mpKfSessionContract } from '@zenith/shared/mp';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

// ─── 客服账号 ────────────────────────────────────────────────────────────────

export type MpKfAccountListParams = QueryOf<typeof mpKfAccountContract.list>;

export const {
  keys: mpKfAccountKeys,
  useList: useMpKfAccountList,
  useSave: useSaveMpKfAccount,
  useDelete: useDeleteMpKfAccounts,
} = createResourceQueries(mpKfAccountContract);

/** 同步只重建客服账号清单 */
export function useSyncMpKfAccounts() {
  return useApiMutation(mpKfAccountContract.sync, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpKfAccountKeys.lists }),
  });
}

// ─── 会话治理 ────────────────────────────────────────────────────────────────

export type MpKfSessionListParams = QueryOf<typeof mpKfSessionContract.list>;

/** 会话只有列表与详情走标准资源形态；状态流转见下方各操作 */
export const {
  keys: mpKfSessionKeys,
  useList: useMpKfSessionList,
  useDetail: useMpKfSessionDetail,
} = createResourceQueries(mpKfSessionContract);

export const mpKfSessionStatsKeys = {
  /** 全部概览统计查询的公共前缀 */
  all: contractKey(mpKfSessionContract.stats),
  detail: (accountId: number | null | undefined) => contractKey(mpKfSessionContract.stats, { query: { accountId: accountId ?? 0 } }),
};

export const mpKfRoutingConfigKeys = {
  detail: (accountId: number | null | undefined) => contractKey(mpKfSessionContract.config, { query: { accountId: accountId ?? 0 } }),
};

export function useMpKfSessionStats(accountId: number | null | undefined) {
  return useApiQuery(mpKfSessionContract.stats, { query: { accountId: accountId ?? 0 } }, { enabled: !!accountId });
}

export function useMpKfRoutingConfig(accountId: number | null | undefined, enabled = true) {
  return useApiQuery(mpKfSessionContract.config, { query: { accountId: accountId ?? 0 } }, { enabled: enabled && !!accountId });
}

/** 会话状态流转同时改变工作台列表、概览计数与该会话详情 */
const invalidateSession = (qc: QueryClient, id: number) => {
  void qc.invalidateQueries({ queryKey: mpKfSessionKeys.lists });
  void qc.invalidateQueries({ queryKey: mpKfSessionStatsKeys.all });
  void qc.invalidateQueries({ queryKey: mpKfSessionKeys.detail(id) });
};

export function useAcceptMpKfSession() {
  return useApiMutation(mpKfSessionContract.accept, {
    invalidate: (qc, _output, { params }) => invalidateSession(qc, params.id),
  });
}

export function useTransferMpKfSession() {
  return useApiMutation(mpKfSessionContract.transfer, {
    invalidate: (qc, _output, { params }) => invalidateSession(qc, params.id),
  });
}

export function useCloseMpKfSession() {
  return useApiMutation(mpKfSessionContract.close, {
    invalidate: (qc, _output, { params }) => invalidateSession(qc, params.id),
  });
}

export function useReplyMpKfSession() {
  return useApiMutation(mpKfSessionContract.reply, {
    invalidate: (qc, _output, { params }) => invalidateSession(qc, params.id),
  });
}

export function useRateMpKfSession() {
  return useApiMutation(mpKfSessionContract.rate, {
    invalidate: (qc, _output, { params }) => invalidateSession(qc, params.id),
  });
}

/** 路由配置只影响后续分派，不改变已有会话 */
export function useSaveMpKfRoutingConfig() {
  return useApiMutation(mpKfSessionContract.updateConfig, {
    invalidate: (qc, _output, { query }) => void qc.invalidateQueries({ queryKey: mpKfRoutingConfigKeys.detail(query.accountId) }),
  });
}
