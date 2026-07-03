import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, SslCertificate } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface SslCertificateRecord extends SslCertificate {
  daysRemaining: number | null;
}

export interface SslCertificateListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: string;
}

export const sslCertificateKeys = {
  all: ['ssl-certificates'] as const,
  lists: ['ssl-certificates', 'list'] as const,
  list: (params: SslCertificateListParams) => ['ssl-certificates', 'list', params] as const,
  detail: (id: number | undefined) => ['ssl-certificates', 'detail', id] as const,
};

export function useSslCertificateList(params: SslCertificateListParams) {
  return useQuery({
    queryKey: sslCertificateKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<SslCertificateRecord>>(`/api/ssl-certificates${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSslCertificateDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: sslCertificateKeys.detail(id),
    queryFn: () => request.get<SslCertificateRecord>(`/api/ssl-certificates/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useGenerateSslCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/ssl-certificates/generate', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: sslCertificateKeys.all }),
  });
}

export function useUploadSslCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/ssl-certificates/upload', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: sslCertificateKeys.all }),
  });
}

export function useDeleteSslCertificate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ssl-certificates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: sslCertificateKeys.all }),
  });
}
