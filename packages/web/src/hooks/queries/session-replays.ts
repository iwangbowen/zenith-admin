import { keepPreviousData } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { sessionReplayContract } from '@zenith/shared/analytics';
import { contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { request } from '@/utils/request';

export type ReplayListParams = QueryOf<typeof sessionReplayContract.list>;
export type ReplayAccessLogParams = QueryOf<typeof sessionReplayContract.accessLogs>;

export const replayKeys = {
  all: [resourceKeyOf(sessionReplayContract.basePath)] as const,
  lists: contractKey(sessionReplayContract.list),
  list: (params: ReplayListParams) => contractKey(sessionReplayContract.list, { query: params }),
  detail: (id: string) => contractKey(sessionReplayContract.detail, { params: { id } }),
  stats: contractKey(sessionReplayContract.stats),
  accessLogs: contractKey(sessionReplayContract.accessLogs),
};

/** 存储统计（容量看板） */
export function useReplayStorageStats() {
  return useApiQuery(sessionReplayContract.stats, {
    staleTime: 30_000,
    requestOptions: { silent: true },
  });
}

/** 有点击热力数据的页面清单 */
export function useHeatmapPages(days: number, enabled = true) {
  return useApiQuery(sessionReplayContract.heatmapPages, { query: { days } }, {
    enabled,
    staleTime: 60_000,
  });
}

/** 页面点击热力聚合 */
export function useClickHeatmap(pagePath: string, days: number, enabled = true) {
  return useApiQuery(sessionReplayContract.heatmap, { query: { pagePath, days } }, {
    enabled: enabled && pagePath !== '',
  });
}

/** 回放访问审计（manage 权限） */
export function useReplayAccessLogs(params: ReplayAccessLogParams, enabled = true) {
  return useApiQuery(sessionReplayContract.accessLogs, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useReplayList(params: ReplayListParams) {
  return useApiQuery(sessionReplayContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useReplayDetail(id: string | null, enabled = true) {
  return useApiQuery(sessionReplayContract.detail, { params: { id: id ?? '' } }, {
    enabled: enabled && id !== null,
    // recording 会话自动追流：3s 轮询拿新分片清单，终态停止
    refetchInterval: (query) => (query.state.data?.status === 'recording' ? 3000 : false),
  });
}

export function useBatchDeleteReplays() {
  return useApiMutation(sessionReplayContract.removeBatch, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: replayKeys.lists }),
  });
}

/** 拉取回放分片事件（服务端 gzip 透传，浏览器自动解压） */
export async function fetchReplaySegmentEvents(replayId: string, seq: number): Promise<unknown[]> {
  const blob = await request.getBlob(urlOf(sessionReplayContract.segmentData, { params: { id: replayId, seq } }));
  if (!blob) return [];
  try {
    const events = JSON.parse(await blob.text()) as unknown[];
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}
