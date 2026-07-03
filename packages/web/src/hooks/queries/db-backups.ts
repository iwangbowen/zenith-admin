import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupType, DbBackup, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface DbBackupListParams {
  page: number;
  pageSize: number;
  status?: string;
  type?: string;
}

export const dbBackupKeys = {
  all: ['db-backups'] as const,
  lists: ['db-backups', 'list'] as const,
  list: (params: DbBackupListParams) => ['db-backups', 'list', params] as const,
};

export function useDbBackupList(params: DbBackupListParams, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: dbBackupKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<DbBackup>>(`/api/db-backups${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCreateDbBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { type: BackupType; name?: string }) => request.post<DbBackup>('/api/db-backups', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbBackupKeys.all }),
  });
}

export function useDeleteDbBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/db-backups/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dbBackupKeys.all }),
  });
}
