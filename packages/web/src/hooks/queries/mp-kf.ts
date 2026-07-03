import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpKfAccount, MpKfRoutingConfig, MpKfSession, MpKfSessionDetail, MpKfSessionStats, MpKfSessionStatus, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpKfAccountListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export interface MpKfSessionListParams {
  status: MpKfSessionStatus;
  keyword?: string;
  page: number;
  pageSize: number;
}

export const mpKfKeys = {
  all: ['mp', 'kf'] as const,
  accounts: ['mp', 'kf', 'accounts'] as const,
  accountLists: (accountId: number | null | undefined) => ['mp', 'kf', 'accounts', accountId] as const,
  accountList: (accountId: number | null | undefined, params: MpKfAccountListParams) => ['mp', 'kf', 'accounts', accountId, params] as const,
  sessions: ['mp', 'kf', 'sessions'] as const,
  sessionLists: (accountId: number | null | undefined) => ['mp', 'kf', 'sessions', accountId] as const,
  sessionList: (accountId: number | null | undefined, params: MpKfSessionListParams) => ['mp', 'kf', 'sessions', accountId, params] as const,
  sessionStats: (accountId: number | null | undefined) => ['mp', 'kf', 'sessions', accountId, 'stats'] as const,
  sessionDetail: (id: number | null | undefined) => ['mp', 'kf', 'sessions', 'detail', id] as const,
  routingConfig: (accountId: number | null | undefined) => ['mp', 'kf', 'sessions', accountId, 'config'] as const,
};

export function useMpKfAccountList(accountId: number | null | undefined, params: MpKfAccountListParams) {
  return useQuery({
    queryKey: mpKfKeys.accountList(accountId, params),
    queryFn: () =>
      request.get<PaginatedResponse<MpKfAccount>>(`/api/mp/kf-accounts${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useSyncMpKfAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<null>('/api/mp/kf-accounts/sync', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.accounts }),
  });
}

export function useSaveMpKfAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined ? request.post<MpKfAccount>('/api/mp/kf-accounts', values) : request.put<MpKfAccount>(`/api/mp/kf-accounts/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.accounts }),
  });
}

export function useDeleteMpKfAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/kf-accounts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.accounts }),
  });
}

export function useMpKfSessionList(accountId: number | null | undefined, params: MpKfSessionListParams) {
  return useQuery({
    queryKey: mpKfKeys.sessionList(accountId, params),
    queryFn: () =>
      request.get<PaginatedResponse<MpKfSession>>(`/api/mp/kf-sessions${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useMpKfSessionStats(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpKfKeys.sessionStats(accountId),
    queryFn: () => request.get<MpKfSessionStats>(`/api/mp/kf-sessions/stats${toQueryString({ accountId })}`).then(unwrap),
    enabled: !!accountId,
  });
}

export function useMpKfSessionDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: mpKfKeys.sessionDetail(id),
    queryFn: () => request.get<MpKfSessionDetail>(`/api/mp/kf-sessions/${id}`).then(unwrap),
    enabled: enabled && id != null,
  });
}

export function useMpKfRoutingConfig(accountId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: mpKfKeys.routingConfig(accountId),
    queryFn: () => request.get<MpKfRoutingConfig>(`/api/mp/kf-sessions/config${toQueryString({ accountId })}`).then(unwrap),
    enabled: enabled && !!accountId,
  });
}

export function useRateMpKfSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request.post<null>(`/api/mp/kf-sessions/${id}/rate`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.sessions }),
  });
}

export function useAcceptMpKfSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kfId }: { id: number; kfId: number }) => request.post<null>(`/api/mp/kf-sessions/${id}/accept`, { kfId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.sessions }),
  });
}

export function useTransferMpKfSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toKfId, remark }: { id: number; toKfId: number; remark?: string }) =>
      request.post<null>(`/api/mp/kf-sessions/${id}/transfer`, { toKfId, remark }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.sessions }),
  });
}

export function useCloseMpKfSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/mp/kf-sessions/${id}/close`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.sessions }),
  });
}

export function useReplyMpKfSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request.post<null>(`/api/mp/kf-sessions/${id}/reply`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.sessions }),
  });
}

export function useSaveMpKfRoutingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, values }: { accountId: number; values: Record<string, unknown> }) =>
      request.put<null>(`/api/mp/kf-sessions/config${toQueryString({ accountId })}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpKfKeys.sessions }),
  });
}
