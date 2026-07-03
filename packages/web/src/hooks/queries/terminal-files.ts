import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { dockerKeys } from './docker';

export interface FileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
}
export interface DirListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}
export interface RootInfo {
  home: string;
  isWindows: boolean;
  drives: string[];
}
export interface SftpEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
  permissions?: string;
}
export interface SftpListing {
  path: string;
  parent: string | null;
  entries: SftpEntry[];
}
export interface DockerFileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink';
}
export interface FileContent {
  path: string;
  content: string;
  size: number;
}

export const terminalFileKeys = {
  all: ['terminal-files'] as const,
  rootInfo: ['terminal-files', 'root-info'] as const,
  localBrowsePrefix: ['terminal-files', 'browse'] as const,
  localBrowse: (path: string) => ['terminal-files', 'browse', 'local', path] as const,
  localContent: (path: string) => ['terminal-files', 'content', 'local', path] as const,
  sftpHome: (profileId: number) => ['terminal-files', 'sftp-home', profileId] as const,
  sftpBrowsePrefix: (profileId: number) => ['terminal-files', 'browse', 'sftp', profileId] as const,
  sftpBrowse: (profileId: number, path: string) => ['terminal-files', 'browse', 'sftp', profileId, path] as const,
  sftpContent: (profileId: string, path: string) => ['terminal-files', 'content', 'sftp', profileId, path] as const,
  dockerBrowsePrefix: (containerId: string) => ['terminal-files', 'browse', 'docker', containerId] as const,
  dockerBrowse: (containerId: string, path: string) => ['terminal-files', 'browse', 'docker', containerId, path] as const,
  dockerContent: (containerId: string, path: string) => ['terminal-files', 'content', 'docker', containerId, path] as const,
};

export const rootInfoQueryOptions = () => ({
  queryKey: terminalFileKeys.rootInfo,
  queryFn: () => request.get<RootInfo>('/api/terminal-files/root-info').then(unwrap),
});

export const localBrowseQueryOptions = (path: string, options?: { silent?: boolean }) => ({
  queryKey: terminalFileKeys.localBrowse(path),
  queryFn: () => request.get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(path)}`, { silent: options?.silent }).then(unwrap),
});

export const sftpHomeQueryOptions = (profileId: number) => ({
  queryKey: terminalFileKeys.sftpHome(profileId),
  queryFn: () => request.get<{ home: string }>(`/api/ssh-sftp/${profileId}/home`, { silent: true }).then(unwrap),
});

export const sftpBrowseQueryOptions = (profileId: number, path: string, options?: { silent?: boolean }) => ({
  queryKey: terminalFileKeys.sftpBrowse(profileId, path),
  queryFn: () => request.get<SftpListing>(`/api/ssh-sftp/${profileId}/list?path=${encodeURIComponent(path)}`, { silent: options?.silent }).then(unwrap),
});

export const dockerBrowseQueryOptions = (containerId: string, path: string, options?: { silent?: boolean }) => ({
  queryKey: terminalFileKeys.dockerBrowse(containerId, path),
  queryFn: () => request.get<DockerFileEntry[]>(`/api/docker/${containerId}/files?path=${encodeURIComponent(path)}`, { silent: options?.silent }).then(unwrap),
});

export const fileContentQueryOptions = (filePath: string, readUrl: string) => ({
  queryKey: ['terminal-files', 'content', filePath] as const,
  queryFn: () => request.get<FileContent | { content: string }>(readUrl).then(unwrap),
});

export function useFileContent(filePath: string, readUrl: string, enabled: boolean) {
  return useQuery({
    ...fileContentQueryOptions(filePath, readUrl),
    enabled,
  });
}

export async function fetchLocalDir(qc: QueryClient, path: string, options?: { silent?: boolean }) {
  return qc.fetchQuery(localBrowseQueryOptions(path, options));
}

export async function fetchSftpDir(qc: QueryClient, profileId: number, path: string, options?: { silent?: boolean }) {
  return qc.fetchQuery(sftpBrowseQueryOptions(profileId, path, options));
}

export async function fetchDockerDir(qc: QueryClient, containerId: string, path: string, options?: { silent?: boolean }) {
  return qc.fetchQuery(dockerBrowseQueryOptions(containerId, path, options));
}

export function useSaveFileContent(filePath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, body }: { url: string; body: Record<string, string> }) => request.put<FileContent>(url, body).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['terminal-files', 'content', filePath] }),
  });
}

export function useLocalFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (op: { kind: 'delete'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'create'; path: string; type: 'dir' | 'file' }) => {
      if (op.kind === 'delete') return request.delete<null>(`/api/terminal-files/entry?path=${encodeURIComponent(op.path)}`).then(unwrap);
      if (op.kind === 'rename') return request.post<null>('/api/terminal-files/rename', { from: op.from, to: op.to }).then(unwrap);
      return request.post<FileEntry>('/api/terminal-files/create', { path: op.path, type: op.type }).then(unwrap);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.localBrowsePrefix }),
  });
}

export function useLocalFileUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress, silent }: { formData: FormData; onProgress?: (percent: number) => void; silent?: boolean }) =>
      request.postForm<FileEntry>('/api/terminal-files/upload', formData, { onProgress, silent }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.localBrowsePrefix }),
  });
}

export function useSftpFileMutation(profileId: number) {
  const qc = useQueryClient();
  const api = `/api/ssh-sftp/${profileId}`;
  return useMutation({
    mutationFn: async (
      op:
        | { kind: 'delete'; path: string }
        | { kind: 'rename'; from: string; to: string }
        | { kind: 'create'; path: string; type: 'dir' | 'file' }
        | { kind: 'chmod'; path: string; mode: number },
    ) => {
      if (op.kind === 'delete') return request.delete<null>(`${api}/entry?path=${encodeURIComponent(op.path)}`).then(unwrap);
      if (op.kind === 'rename') return request.post<null>(`${api}/rename`, { from: op.from, to: op.to }).then(unwrap);
      if (op.kind === 'chmod') return request.post<null>(`${api}/chmod`, { path: op.path, mode: op.mode }).then(unwrap);
      return request.post<SftpEntry>(`${api}/create`, { path: op.path, type: op.type }).then(unwrap);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.sftpBrowsePrefix(profileId) }),
  });
}

export function useDockerExplorerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' | 'restart' }) =>
      request.post<null>(`/api/docker/${id}/${action}`, {}).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dockerKeys.all });
      void qc.invalidateQueries({ queryKey: terminalFileKeys.all });
    },
  });
}
