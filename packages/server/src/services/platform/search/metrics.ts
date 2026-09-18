import type { GlobalSearchType } from '@zenith/shared/platform';

export type GlobalSearchMetricStatus = 'success' | 'failure' | 'timeout';

export interface GlobalSearchMetricSnapshot {
  readonly type: GlobalSearchType;
  readonly success: number;
  readonly failure: number;
  readonly timeout: number;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
}

interface MutableMetric {
  success: number;
  failure: number;
  timeout: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

// The adapter type is a bounded enum.  No query text, tenant, user or result
// payload is retained here, so this can safely be exposed to process metrics.
const metrics = new Map<GlobalSearchType, MutableMetric>();

export function recordGlobalSearchMetric(type: GlobalSearchType, status: GlobalSearchMetricStatus, durationMs: number): void {
  const metric = metrics.get(type) ?? { success: 0, failure: 0, timeout: 0, totalDurationMs: 0, maxDurationMs: 0 };
  metric[status] += 1;
  metric.totalDurationMs += Math.max(0, Math.round(durationMs));
  metric.maxDurationMs = Math.max(metric.maxDurationMs, Math.max(0, Math.round(durationMs)));
  metrics.set(type, metric);
}

export function getGlobalSearchMetrics(): GlobalSearchMetricSnapshot[] {
  return [...metrics.entries()].map(([type, value]) => ({ type, ...value }));
}

export function resetGlobalSearchMetricsForTest(): void {
  metrics.clear();
}
