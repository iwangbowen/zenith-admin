import type { QueryClient } from '@tanstack/react-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type OutputOf } from '@zenith/shared/core';
import {
  dockerContract,
  hostFileContract,
  sshSftpContract,
  terminalFileContract,
  type FileChecksumAlgo,
  type FsEntryType,
} from '@zenith/shared/ops';
import { asyncTaskContract } from '@zenith/shared/tasks';
import { request } from '@/utils/request';
import { api, apiQueryOptions, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { dockerKeys } from './docker';

/**
 * 宿主机 / SFTP / 远程主机 / 容器四类文件系统的前端数据访问层。
 *
 * 消费者：文件管理器页（FileManagerPage）与终端页的三个 Explorer（本地 / SFTP / Docker）
 * + 在线编辑（EditorTab）。四类目录浏览各自按契约 query key 缓存，写操作按所属目录前缀失效。
 */

// ─── query key 前缀（按契约操作派生；写操作按目录树整体失效，跨目录 move / copy 无法精确到单目录） ───

export const terminalFileKeys = {
  all: [resourceKeyOf(terminalFileContract.basePath)] as const,
  rootInfo: contractKey(terminalFileContract.rootInfo),
  localBrowsePrefix: contractKey(terminalFileContract.list),
  localBrowse: (path: string) => contractKey(terminalFileContract.list, { query: { path } }),
  localContent: (path: string) => contractKey(terminalFileContract.content, { query: { path } }),
  checksumPrefix: contractKey(terminalFileContract.checksum),
  checksum: (path: string | undefined, algo: FileChecksumAlgo | undefined) =>
    contractKey(terminalFileContract.checksum, { query: { path: path ?? '', algo } }),
  search: (dir: string, keyword: string) => contractKey(terminalFileContract.search, { query: { dir, keyword } }),
  dirSizePrefix: contractKey(terminalFileContract.dirSize),
  dirSize: (path: string | undefined) => contractKey(terminalFileContract.dirSize, { query: { path: path ?? '' } }),
  sftpHome: (profileId: number) => contractKey(sshSftpContract.home, { params: { profileId } }),
  sftpBrowsePrefix: (profileId: number) => [...contractKey(sshSftpContract.list), { params: { profileId } }] as const,
  sftpBrowse: (profileId: number, path: string) => contractKey(sshSftpContract.list, { params: { profileId }, query: { path } }),
  hostHome: (hostId: number) => contractKey(hostFileContract.home, { params: { hostId } }),
  hostBrowsePrefix: (hostId: number) => [...contractKey(hostFileContract.list), { params: { hostId } }] as const,
  hostBrowse: (hostId: number, path: string) => contractKey(hostFileContract.list, { params: { hostId }, query: { path } }),
  hostContentPrefix: (hostId: number) => [...contractKey(hostFileContract.content), { params: { hostId } }] as const,
  hostContent: (hostId: number, path: string) => contractKey(hostFileContract.content, { params: { hostId }, query: { path } }),
  dockerBrowsePrefix: (containerId: string) => [...contractKey(dockerContract.containerFiles), { params: { id: containerId } }] as const,
  dockerBrowse: (containerId: string, path: string) => contractKey(dockerContract.containerFiles, { params: { id: containerId }, query: { path } }),
};

// ─── 可预取的 queryOptions（Explorer 树按需 fetchQuery） ───────────────────────

export const rootInfoQueryOptions = () => apiQueryOptions(terminalFileContract.rootInfo);

export const localBrowseQueryOptions = (path: string, options?: { silent?: boolean }) =>
  apiQueryOptions(terminalFileContract.list, { query: { path } }, { requestOptions: { silent: options?.silent } });

export const sftpHomeQueryOptions = (profileId: number) =>
  apiQueryOptions(sshSftpContract.home, { params: { profileId } }, { requestOptions: { silent: true } });

export const sftpBrowseQueryOptions = (profileId: number, path: string, options?: { silent?: boolean }) =>
  apiQueryOptions(sshSftpContract.list, { params: { profileId }, query: { path } }, { requestOptions: { silent: options?.silent } });

export const hostBrowseQueryOptions = (hostId: number, path: string, options?: { silent?: boolean }) =>
  apiQueryOptions(hostFileContract.list, { params: { hostId }, query: { path } }, { requestOptions: { silent: options?.silent } });

export const dockerBrowseQueryOptions = (containerId: string, path: string, options?: { silent?: boolean }) =>
  apiQueryOptions(dockerContract.containerFiles, { params: { id: containerId }, query: { path } }, { requestOptions: { silent: options?.silent } });

export async function fetchLocalDir(qc: QueryClient, path: string, options?: { silent?: boolean }) {
  return qc.fetchQuery(localBrowseQueryOptions(path, options));
}

export async function fetchSftpDir(qc: QueryClient, profileId: number, path: string, options?: { silent?: boolean }) {
  return qc.fetchQuery(sftpBrowseQueryOptions(profileId, path, options));
}

export async function fetchDockerDir(qc: QueryClient, containerId: string, path: string, options?: { silent?: boolean }) {
  return qc.fetchQuery(dockerBrowseQueryOptions(containerId, path, options));
}

// ─── 远程主机文件（平台运维主机） ─────────────────────────────────────────────

export function useHostFileHome(hostId: number) {
  return useApiQuery(hostFileContract.home, { params: { hostId } });
}

export function useHostFileList(hostId: number, path: string, enabled = true) {
  return useQuery({
    ...hostBrowseQueryOptions(hostId, path),
    enabled: enabled && path !== '',
    placeholderData: keepPreviousData,
  });
}

export function useHostFileContent(hostId: number, path: string, enabled = true) {
  return useApiQuery(hostFileContract.content, { params: { hostId }, query: { path } }, { enabled: enabled && path !== '' });
}

/** 目录项写操作的统一变量形态（本地 / SFTP / 远程主机共用） */
export type FsEntryOperation =
  | { kind: 'delete'; path: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'create'; path: string; type: FsEntryType }
  | { kind: 'chmod'; path: string; mode: number }
  | { kind: 'write'; path: string; content: string; baseEtag?: string };

export function useHostFileMutation(hostId: number) {
  const qc = useQueryClient();
  const params = { hostId };
  return useMutation({
    mutationFn: async (op: FsEntryOperation) => {
      switch (op.kind) {
        case 'delete': return api(hostFileContract.remove, { params, query: { path: op.path } });
        case 'rename': return api(hostFileContract.rename, { params, body: { from: op.from, to: op.to } });
        case 'chmod': return api(hostFileContract.chmod, { params, body: { path: op.path, mode: op.mode } });
        case 'write': return api(hostFileContract.saveContent, { params, body: { path: op.path, content: op.content, baseEtag: op.baseEtag } });
        case 'create': return api(hostFileContract.create, { params, body: { path: op.path, type: op.type } });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: terminalFileKeys.hostBrowsePrefix(hostId) });
      void qc.invalidateQueries({ queryKey: terminalFileKeys.hostContentPrefix(hostId) });
    },
  });
}

interface UploadVariables {
  formData: FormData;
  onProgress?: (percent: number) => void;
  silent?: boolean;
}

/** 上传带进度，走 XHR 表单通道而非 api() */
export function useHostFileUpload(hostId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress }: UploadVariables) =>
      request.postForm<OutputOf<typeof hostFileContract.upload>>(urlOf(hostFileContract.upload, { params: { hostId } }), formData, { onProgress }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.hostBrowsePrefix(hostId) }),
  });
}

export function hostFileDownloadUrl(hostId: number, path: string) {
  return urlOf(hostFileContract.download, { params: { hostId }, query: { path } });
}

// ─── 在线编辑：三类来源的文本文件 ──────────────────────────────────────────────

/** 编辑器打开的文件引用：本地路径 / SFTP（个人 SSH 配置）/ 容器内文件（只读） */
export type EditableFileRef =
  | { kind: 'local'; path: string }
  | { kind: 'sftp'; profileId: number; path: string }
  | { kind: 'docker'; containerId: string; path: string };

/** 统一的文本内容载荷；容器文件没有版本标识 */
export interface EditableFileContent {
  content: string;
  etag?: string;
}

async function readEditableFile(ref: EditableFileRef): Promise<EditableFileContent> {
  switch (ref.kind) {
    case 'local': return api(terminalFileContract.content, { query: { path: ref.path } });
    case 'sftp': return api(sshSftpContract.content, { params: { profileId: ref.profileId }, query: { path: ref.path } });
    case 'docker': return api(dockerContract.containerFileContent, { params: { id: ref.containerId }, query: { path: ref.path } });
  }
}

const editableContentKey = (ref: EditableFileRef) => ['terminal-files', 'editor-content', ref] as const;

export function useFileContent(ref: EditableFileRef, enabled: boolean) {
  return useQuery({
    queryKey: editableContentKey(ref),
    queryFn: () => readEditableFile(ref),
    enabled,
  });
}

/** 保存文本：本地与 SFTP 均返回目录项；容器文件只读，调用方不得对其触发保存 */
export function useSaveFileContent(ref: EditableFileRef) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, baseEtag }: { content: string; baseEtag?: string }) => {
      if (ref.kind === 'local') return api(terminalFileContract.saveContent, { body: { path: ref.path, content, baseEtag } });
      if (ref.kind === 'sftp') return api(sshSftpContract.saveContent, { params: { profileId: ref.profileId }, body: { path: ref.path, content, baseEtag } });
      throw new Error('容器内文件为只读');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editableContentKey(ref) }),
  });
}

export function editableFileDownloadUrl(ref: EditableFileRef): string {
  if (ref.kind === 'local') return urlOf(terminalFileContract.download, { query: { path: ref.path } });
  if (ref.kind === 'sftp') return urlOf(sshSftpContract.download, { params: { profileId: ref.profileId }, query: { path: ref.path } });
  return '';
}

// ─── 文件管理器页专用查询（宿主机） ────────────────────────────────────────────

export function useTerminalRootInfo() {
  return useQuery(rootInfoQueryOptions());
}

/** 目录浏览（keepPreviousData：目录切换保留旧列表避免闪白） */
export function useTerminalFileList(path: string, enabled = true) {
  return useQuery({
    ...localBrowseQueryOptions(path),
    enabled: enabled && path !== '',
    placeholderData: keepPreviousData,
  });
}

/** 文件夹选择器（移动 / 复制目标）目录浏览，与主列表共享缓存 */
export function useTerminalPickerList(path: string, enabled = true) {
  return useQuery({
    ...localBrowseQueryOptions(path),
    enabled: enabled && path !== '',
  });
}

export function useTerminalChecksum(path: string | undefined, algo: FileChecksumAlgo | undefined, enabled = true) {
  return useApiQuery(terminalFileContract.checksum, { query: { path: path ?? '', algo } }, {
    enabled: enabled && path !== undefined && algo !== undefined,
    // 文件内容随时可能变化，每次打开都重新计算
    staleTime: 0,
  });
}

/** 目录大小统计（递归遍历，服务端可能截断，见 truncated 标记；每次按需重新计算） */
export function useTerminalDirSize(path: string | undefined, enabled = true) {
  return useApiQuery(terminalFileContract.dirSize, { query: { path: path ?? '' } }, {
    enabled: enabled && path !== undefined,
    staleTime: 0,
  });
}

/** 递归深度搜索（按需触发，keyword 为空不发请求；每次搜索都要新鲜结果，不走 staleTime） */
export function useTerminalSearch(dir: string, keyword: string, enabled = true) {
  return useApiQuery(terminalFileContract.search, { query: { dir, keyword } }, {
    enabled: enabled && keyword.trim() !== '',
    staleTime: 0,
  });
}

/** 文件管理器的目录项操作（rename / create / move / copy / chmod） */
export type TerminalFileOperation =
  | { kind: 'rename' | 'move' | 'copy'; from: string; to: string }
  | { kind: 'create'; path: string; type: FsEntryType }
  | { kind: 'chmod'; path: string; mode: number };

/** 成功后失效所有目录浏览缓存（操作可能跨目录，如 move / copy，无法精确到单目录） */
export function useTerminalFileOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (op: TerminalFileOperation): Promise<null> => {
      switch (op.kind) {
        case 'rename': await api(terminalFileContract.rename, { body: { from: op.from, to: op.to } }); break;
        case 'move': await api(terminalFileContract.move, { body: { from: op.from, to: op.to } }); break;
        case 'copy': await api(terminalFileContract.copy, { body: { from: op.from, to: op.to } }); break;
        case 'create': await api(terminalFileContract.create, { body: { path: op.path, type: op.type } }); break;
        case 'chmod': await api(terminalFileContract.chmod, { body: { path: op.path, mode: op.mode } }); break;
      }
      return null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.localBrowsePrefix }),
  });
}

/** 批量删除条目（逐个串行删除，任一失败即中断抛出） */
export function useDeleteTerminalEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paths: string[]) => {
      for (const path of paths) {
        await api(terminalFileContract.remove, { query: { path } });
      }
      return paths.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.localBrowsePrefix }),
  });
}

export function terminalFileDownloadUrl(path: string) {
  return urlOf(terminalFileContract.download, { query: { path } });
}

/**
 * 压缩 / 解压：服务端提交异步任务并返回任务记录。
 * 任务进度与取消由任务托盘统一承载，页面只需提示「已提交」。
 */
export function useTerminalCompress() {
  return useApiMutation(terminalFileContract.compress);
}

export function useTerminalExtract() {
  return useApiMutation(terminalFileContract.extract);
}

/** 轮询等待任务进入终态；用于「打包后立即下载」这类必须等结果的串联流程 */
export async function waitForAsyncTask(taskId: number, options: { intervalMs?: number; timeoutMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  for (;;) {
    const task = await api(asyncTaskContract.detail, { params: { id: taskId } }, { silent: true });
    if (task.status !== 'pending' && task.status !== 'running') return task;
    if (Date.now() > deadline) throw new Error('任务执行超时');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ─── 终端页 Explorer：本地 / SFTP / Docker ────────────────────────────────────

export function useLocalFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (op: FsEntryOperation) => {
      switch (op.kind) {
        case 'delete': return api(terminalFileContract.remove, { query: { path: op.path } });
        case 'rename': return api(terminalFileContract.rename, { body: { from: op.from, to: op.to } });
        case 'create': return api(terminalFileContract.create, { body: { path: op.path, type: op.type } });
        case 'chmod': return api(terminalFileContract.chmod, { body: { path: op.path, mode: op.mode } });
        case 'write': return api(terminalFileContract.saveContent, { body: { path: op.path, content: op.content, baseEtag: op.baseEtag } });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.localBrowsePrefix }),
  });
}

export function useLocalFileUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress, silent }: UploadVariables) =>
      request.postForm<OutputOf<typeof terminalFileContract.upload>>(urlOf(terminalFileContract.upload), formData, { onProgress, silent }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.localBrowsePrefix }),
  });
}

export function useSftpFileMutation(profileId: number) {
  const qc = useQueryClient();
  const params = { profileId };
  return useMutation({
    mutationFn: async (op: FsEntryOperation) => {
      switch (op.kind) {
        case 'delete': return api(sshSftpContract.remove, { params, query: { path: op.path } });
        case 'rename': return api(sshSftpContract.rename, { params, body: { from: op.from, to: op.to } });
        case 'chmod': return api(sshSftpContract.chmod, { params, body: { path: op.path, mode: op.mode } });
        case 'write': return api(sshSftpContract.saveContent, { params, body: { path: op.path, content: op.content, baseEtag: op.baseEtag } });
        case 'create': return api(sshSftpContract.create, { params, body: { path: op.path, type: op.type } });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalFileKeys.sftpBrowsePrefix(profileId) }),
  });
}

/** SFTP 上传（超限等错误由全局提示统一呈现） */
export function uploadSftpFile(profileId: number, formData: FormData) {
  return request.postForm<OutputOf<typeof sshSftpContract.upload>>(urlOf(sshSftpContract.upload, { params: { profileId } }), formData);
}

export function sftpDownloadUrl(profileId: number, path: string) {
  return urlOf(sshSftpContract.download, { params: { profileId }, query: { path } });
}

export function useDockerExplorerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' | 'restart' }) => {
      const op = action === 'start' ? dockerContract.start : action === 'stop' ? dockerContract.stop : dockerContract.restart;
      return api(op, { params: { id } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dockerKeys.all });
      void qc.invalidateQueries({ queryKey: terminalFileKeys.all });
    },
  });
}
