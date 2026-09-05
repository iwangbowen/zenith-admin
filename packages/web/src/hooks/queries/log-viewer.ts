import type { QueryOf } from '@zenith/shared/core';
import { logViewerContract } from '@zenith/shared/ops';
import { contractKey, urlOf, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export interface LogViewerContentParams {
  path: string;
  lines: number;
  hostId?: number;
}

type LogViewerContentQuery = NonNullable<QueryOf<typeof logViewerContract.content>>;

function toContentQuery({ path, lines, hostId }: LogViewerContentParams): LogViewerContentQuery {
  return { path, lines: String(lines), ...hostQueryOf(hostId) };
}

export const logViewerKeys = {
  all: ['log-viewer'] as const,
  content: (params: LogViewerContentParams) => contractKey(logViewerContract.content, { query: toContentQuery(params) }),
  roots: (hostId?: number) => contractKey(logViewerContract.roots, { query: hostQueryOf(hostId) }),
};

export function useLogViewerContent(params: LogViewerContentParams, enabled = true) {
  return useApiQuery(logViewerContract.content, { query: toContentQuery(params) }, { enabled: enabled && !!params.path });
}

/** 服务端允许读取的日志目录白名单（本机为应用日志目录 + LOG_VIEWER_ROOTS，远端为 LOG_VIEWER_ROOTS） */
export function useLogViewerRoots(hostId?: number) {
  return useApiQuery(logViewerContract.roots, { query: hostQueryOf(hostId) }, { staleTime: 5 * 60_000 });
}

/** tail -f 流式地址（`streamText` 消费） */
export function logViewerStreamUrl(path: string, hostId?: number | null) {
  return urlOf(logViewerContract.stream, { query: { path, ...hostQueryOf(hostId) } });
}

export function logViewerDownloadUrl(path: string, hostId?: number | null) {
  return urlOf(logViewerContract.download, { query: { path, ...hostQueryOf(hostId) } });
}
