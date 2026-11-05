import { resourceKeyOf } from '@zenith/shared/core';
import { traceContract, type TraceNodeKind } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const traceKeys = {
  all: [resourceKeyOf(traceContract.basePath)] as const,
  of: (correlationId: string) => contractKey(traceContract.timeline, { params: { correlationId } }),
  recent: (days: number) => contractKey(traceContract.recent, { query: { days } }),
  failures: (params: { days: number; kind: TraceNodeKind | undefined }) => contractKey(traceContract.recentFailures, { query: params }),
};

/** 最近链路（无 ID 浏览入口） */
export function useRecentTraces(days: number) {
  return useApiQuery(traceContract.recent, { query: { days } });
}

/** 链路时间线（纯读；correlationId 为空时不请求） */
export function useTraceTimeline(correlationId: string | null) {
  return useApiQuery(traceContract.timeline, { params: { correlationId: correlationId ?? '' } }, { enabled: Boolean(correlationId) });
}

/** 最近失败链路（排障入口） */
export function useRecentTraceFailures(days: number, kind: TraceNodeKind | undefined, enabled = true) {
  return useApiQuery(traceContract.recentFailures, { query: { days, kind } }, { enabled });
}
