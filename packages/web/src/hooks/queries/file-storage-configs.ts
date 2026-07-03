import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateFileStorageConfigInput,
  FileStorageConfig,
  PaginatedResponse,
  StorageBrowseResult,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface FileStorageConfigListParams {
  page: number;
  pageSize: number;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export const fileStorageConfigKeys = {
  all: ['file-storage-configs'] as const,
  lists: ['file-storage-configs', 'list'] as const,
  list: (params: FileStorageConfigListParams) => ['file-storage-configs', 'list', params] as const,
  detail: (id: number | undefined) => ['file-storage-configs', 'detail', id] as const,
  defaultConfig: ['file-storage-configs', 'default'] as const,
  browseRoot: ['file-storage-configs', 'browse'] as const,
  browse: (configId: number | undefined, path: string) => ['file-storage-configs', 'browse', configId, path] as const,
};

export function useFileStorageConfigList(params: FileStorageConfigListParams) {
  return useQuery({
    queryKey: fileStorageConfigKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<FileStorageConfig>>(`/api/file-storage-configs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useFileStorageConfigDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: fileStorageConfigKeys.detail(id),
    queryFn: () => request.get<FileStorageConfig>(`/api/file-storage-configs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useDefaultFileStorageConfig() {
  return useQuery({
    queryKey: fileStorageConfigKeys.defaultConfig,
    queryFn: () => request.get<FileStorageConfig | null>('/api/file-storage-configs/default').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useStorageBrowse(configId: number | undefined, path: string, enabled = true) {
  return useQuery({
    queryKey: fileStorageConfigKeys.browse(configId, path),
    queryFn: () =>
      request
        .get<StorageBrowseResult>(`/api/files/browse${toQueryString({ storageConfigId: configId, path })}`)
        .then(unwrap),
    enabled: enabled && configId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSaveFileStorageConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CreateFileStorageConfigInput | Record<string, unknown> }) =>
      (id === undefined
        ? request.post<FileStorageConfig>('/api/file-storage-configs', values)
        : request.put<FileStorageConfig>(`/api/file-storage-configs/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileStorageConfigKeys.all }),
  });
}

export function useDeleteFileStorageConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/file-storage-configs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileStorageConfigKeys.all }),
  });
}

export function useSetDefaultFileStorageConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.put<FileStorageConfig>(`/api/file-storage-configs/${id}/default`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileStorageConfigKeys.all }),
  });
}

export function useTestFileStorageConfig() {
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<null>('/api/file-storage-configs/test', values)
        : request.post<null>(`/api/file-storage-configs/${id}/test`, values)
      ).then(unwrap),
  });
}
