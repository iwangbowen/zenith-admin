import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileAccessUrl, FileStats, ManagedFile, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface FileListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  provider?: string;
  fileType?: string;
  startTime?: string;
  endTime?: string;
}

export const fileKeys = {
  all: ['files'] as const,
  lists: ['files', 'list'] as const,
  list: (params: FileListParams) => ['files', 'list', params] as const,
  detail: (id: string | undefined) => ['files', 'detail', id] as const,
  stats: ['files', 'stats'] as const,
};

export function useFileList(params: FileListParams) {
  return useQuery({
    queryKey: fileKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ManagedFile>>(`/api/files${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useFileDetail(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: fileKeys.detail(id),
    queryFn: () => request.get<ManagedFile>(`/api/files/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useFileStats() {
  return useQuery({
    queryKey: fileKeys.stats,
    queryFn: () => request.get<FileStats>('/api/files/stats').then(unwrap),
  });
}

/**
 * 解析文件访问直链（presigned 每次签发新鲜 URL，故为普通函数而非 useQuery，禁止进缓存）。
 * purpose=download 时云直链会附带 attachment disposition。
 * silent：失败由调用方降级处理（fetchManagedFileBlob 回退代理），不弹全局错误 toast。
 */
export function getFileAccessUrl(id: string, purpose?: 'preview' | 'download'): Promise<FileAccessUrl> {
  return request.get<FileAccessUrl>(`/api/files/${id}/access-url${purpose ? `?purpose=${purpose}` : ''}`, { silent: true }).then(unwrap);
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress }: { formData: FormData; onProgress?: (percent: number) => void }) =>
      request.postForm<ManagedFile>('/api/files/upload', formData, { onProgress }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request.delete<null>(`/api/files/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

export function useBatchDeleteFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => request.delete<null>('/api/files/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}
