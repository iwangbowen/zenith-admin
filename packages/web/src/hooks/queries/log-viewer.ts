import type { QueryOf } from '@zenith/shared/core';
import { logViewerContract } from '@zenith/shared/ops';
import { contractKey, urlOf, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export type LogViewerContentQuery = NonNullable<QueryOf<typeof logViewerContract.content>>;

/** 页面持有的路径 + 主机选择 + 读取参数 → 契约 `content` 查询入参 */
export interface LogViewerContentParams extends Omit<LogViewerContentQuery, 'hostId'> {
  hostId?: number | null;
}

function toContentQuery({ hostId, ...rest }: LogViewerContentParams): LogViewerContentQuery {
  return { ...rest, ...hostQueryOf(hostId) };
}

export const logViewerKeys = {
  all: ['log-viewer'] as const,
  content: (params: LogViewerContentParams) => contractKey(logViewerContract.content, { query: toContentQuery(params) }),
};

/** 日志内容随时在变，不复用 30s 内的缓存：每次挂载 / 切换都回源 */
export function useLogViewerContent(params: LogViewerContentParams, enabled = true) {
  return useApiQuery(logViewerContract.content, { query: toContentQuery(params) }, { enabled: enabled && !!params.path, staleTime: 0 });
}

/** SSE 实时跟踪地址（event: log；`request.fetchRaw` + `readSseStream` 消费） */
export function logViewerTailUrl(path: string, hostId?: number | null) {
  return urlOf(logViewerContract.tail, { query: { path, ...hostQueryOf(hostId) } });
}

export function logViewerDownloadUrl(path: string, hostId?: number | null) {
  return urlOf(logViewerContract.download, { query: { path, ...hostQueryOf(hostId) } });
}
