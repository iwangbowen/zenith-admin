import { MONITOR_METRICS, MONITOR_METRIC_META, type MonitorMetric } from '@zenith/shared/platform';
import { mapWithConcurrency } from '../../lib/concurrency';
import { section } from '../../lib/probe-section';
import logger from '../../lib/logger';

type MetricValues = Partial<Record<MonitorMetric, number | null>>;
type MetricRead = MetricValues | null | Promise<MetricValues | null>;

export interface MonitorMetricRequest {
  metric: MonitorMetric;
  tenantId: number | null;
}

type MetricSource = { metrics: readonly MonitorMetric[] } & (
  | { scope: 'global'; read: () => MetricRead }
  | { scope: 'tenant'; read: (tenantId: number | null) => MetricRead }
);

const sources = new Map<MonitorMetric, MetricSource>();
let sealed = false;

export function registerMonitorMetricSource(source: MetricSource): void {
  if (sealed) throw new Error('监控指标来源已经冻结');
  const metrics = new Set<MonitorMetric>();
  for (const metric of source.metrics) {
    if (MONITOR_METRIC_META[metric]?.scope !== source.scope) throw new Error(`监控指标范围不符: ${metric}`);
    if (metrics.has(metric) || sources.has(metric)) throw new Error(`重复的监控指标来源: ${metric}`);
    metrics.add(metric);
  }
  for (const metric of metrics) sources.set(metric, source);
}

export function sealMonitorMetricSources(): void {
  const missing = MONITOR_METRICS.filter(metric => !sources.has(metric));
  if (missing.length > 0) throw new Error(`缺少监控指标来源: ${missing.join(', ')}`);
  sealed = true;
}

interface SourceRead {
  source: MetricSource;
  tenantId: number | null;
  requests: MonitorMetricRequest[];
}

/** Each global source runs once, and each tenant source runs once per requested tenant. */
export async function collectMonitorMetrics(requests: readonly MonitorMetricRequest[]): Promise<Map<number | null, MetricValues>> {
  const grouped = new Map<MetricSource, Map<number | null, SourceRead>>();
  const reads: SourceRead[] = [];
  for (const request of requests) {
    const source = sources.get(request.metric);
    if (!source) throw new Error(`缺少监控指标来源: ${request.metric}`);
    let tenants = grouped.get(source);
    if (!tenants) {
      tenants = new Map();
      grouped.set(source, tenants);
    }
    const tenantId = source.scope === 'global' ? null : request.tenantId;
    let read = tenants.get(tenantId);
    if (!read) {
      read = { source, tenantId, requests: [] };
      tenants.set(tenantId, read);
      reads.push(read);
    }
    read.requests.push(request);
  }

  const snapshots = new Map<number | null, MetricValues>();
  await mapWithConcurrency(reads, 4, async ({ source, tenantId, requests: sourceRequests }) => {
    const result = await section(async () => source.scope === 'global' ? source.read() : source.read(tenantId));
    if (!result.available) {
      logger.warn('[monitor] 告警指标采集不可用', { metrics: source.metrics, tenantId, reason: result.reason });
    }
    for (const request of sourceRequests) {
      const values = snapshots.get(request.tenantId) ?? {};
      const value = result.data?.[request.metric];
      values[request.metric] = typeof value === 'number' && Number.isFinite(value) ? value : null;
      snapshots.set(request.tenantId, values);
    }
  });
  return snapshots;
}
