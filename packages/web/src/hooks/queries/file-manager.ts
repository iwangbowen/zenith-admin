import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface FsEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  permissions?: string;
  uid?: number;
  gid?: number;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface RootInfo {
  home: string;
  isWindows: boolean;
  drives: string[];
}

export const fileManagerKeys = {
  all: ['file-manager'] as const,
  rootInfo: ['file-manager', 'root-info'] as const,
  browseRoot: ['file-manager', 'browse'] as const,
  browse: (path: string) => ['file-manager', 'browse', path] as const,
  checksum: (path: string | undefined, algo: string | undefined) => ['file-manager', 'checksum', path, algo] as const,
  search: (dir: string, keyword: string) => ['file-manager', 'search', dir, keyword] as const,
};

export function useTerminalRootInfo() {
  return useQuery({
    queryKey: fileManagerKeys.rootInfo,
    queryFn: () => request.get<RootInfo>('/api/terminal-files/root-info').then(unwrap),
  });
}

export function useTerminalFileList(path: string, enabled = true) {
  return useQuery({
    queryKey: fileManagerKeys.browse(path),
    queryFn: () => request.get<DirListing>(`/api/terminal-files/list${toQueryString({ path })}`).then(unwrap),
    enabled: enabled && path !== '',
    placeholderData: keepPreviousData,
  });
}

export function useTerminalChecksum(path: string | undefined, algo: 'md5' | 'sha1' | 'sha256' | undefined, enabled = true) {
  return useQuery({
    queryKey: fileManagerKeys.checksum(path, algo),
    queryFn: () =>
      request
        .get<{ algo: string; hash: string; size: number }>(`/api/terminal-files/checksum${toQueryString({ path, algo })}`)
        .then(unwrap),
    enabled: enabled && path !== undefined && algo !== undefined,
  });
}

export function useTerminalSearch(dir: string, keyword: string, enabled = true) {
  return useQuery({
    queryKey: fileManagerKeys.search(dir, keyword),
    queryFn: () => request.get<FsEntry[]>(`/api/terminal-files/search${toQueryString({ dir, keyword })}`).then(unwrap),
    enabled: enabled && keyword.trim() !== '',
  });
}

export function useTerminalFileOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ endpoint, values }: { endpoint: string; values: Record<string, unknown> }) =>
      request.post<null>(endpoint, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileManagerKeys.browseRoot }),
  });
}

export function useDeleteTerminalEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paths: string[]) => {
      for (const path of paths) {
        await request.delete<null>(`/api/terminal-files/entry${toQueryString({ path })}`).then(unwrap);
      }
      return paths.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fileManagerKeys.browseRoot }),
  });
}

export function useUploadTerminalFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress }: { formData: FormData; onProgress?: (percent: number) => void }) =>
      request.postForm<null>('/api/terminal-files/upload', formData, { onProgress }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileManagerKeys.browseRoot }),
  });
}
