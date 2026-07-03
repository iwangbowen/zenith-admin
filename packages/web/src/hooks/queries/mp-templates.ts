import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpMessageTemplate, MpTemplateSendLog, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpTemplateListParams {
  page: number;
  pageSize: number;
}

export interface MpTemplateLogListParams {
  page: number;
  pageSize: number;
  status?: string;
}

export interface MpTemplateSyncResult {
  created: number;
  updated: number;
}

export interface MpTemplateBatchSendResult {
  success: number;
  failed: number;
  total: number;
}

export interface MpTemplateIndustry {
  primaryIndustry: { firstClass: string; secondClass: string } | null;
  secondaryIndustry: { firstClass: string; secondClass: string } | null;
}

export const mpTemplateKeys = {
  all: ['mp', 'templates'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'templates', accountId] as const,
  list: (accountId: number | null | undefined, params: MpTemplateListParams) => ['mp', 'templates', accountId, params] as const,
  logLists: (accountId: number | null | undefined) => ['mp', 'templates', accountId, 'logs'] as const,
  logList: (accountId: number | null | undefined, params: MpTemplateLogListParams) => ['mp', 'templates', accountId, 'logs', params] as const,
  industry: (accountId: number | null | undefined) => ['mp', 'templates', accountId, 'industry'] as const,
};

export function useMpTemplateList(accountId: number | null | undefined, params: MpTemplateListParams) {
  return useQuery({
    queryKey: mpTemplateKeys.list(accountId, params),
    queryFn: () => request.get<PaginatedResponse<MpMessageTemplate>>(`/api/mp/templates${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useMpTemplateLogList(accountId: number | null | undefined, params: MpTemplateLogListParams) {
  return useQuery({
    queryKey: mpTemplateKeys.logList(accountId, params),
    queryFn: () => request.get<PaginatedResponse<MpTemplateSendLog>>(`/api/mp/templates/logs${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useMpTemplateIndustry(accountId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: mpTemplateKeys.industry(accountId),
    queryFn: () => request.get<MpTemplateIndustry>(`/api/mp/templates/industry${toQueryString({ accountId })}`).then(unwrap),
    enabled: enabled && !!accountId,
  });
}

export function useSyncMpTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<MpTemplateSyncResult>('/api/mp/templates/sync', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTemplateKeys.all }),
  });
}

export function useSendMpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/mp/templates/send', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTemplateKeys.all }),
  });
}

export function useBatchSendMpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<MpTemplateBatchSendResult>('/api/mp/templates/batch-send', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTemplateKeys.all }),
  });
}

export function useSaveMpTemplateIndustry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.put<null>('/api/mp/templates/industry', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTemplateKeys.all }),
  });
}

export function useDeleteMpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/templates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTemplateKeys.all }),
  });
}
