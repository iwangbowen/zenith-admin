import type { OutputOf } from '@zenith/shared/core';
import { observabilityContract } from '@zenith/shared/platform';
import { config } from '../../config';
import { checkInfraHealth } from '../../lib/health-checks';
import { countActiveWorkerNodes, getQueueDepths } from '../../lib/pg-boss-scheduler';
import { getMonitorStatus } from './monitor.service';
import { metricsSampler } from '../../lib/metrics-sampler';

type ObservabilitySummary = OutputOf<typeof observabilityContract.summary>;

function nowWindow(seconds = 300): ObservabilitySummary['window'] {
  const to = new Date();
  const from = new Date(to.getTime() - seconds * 1000);
  return { from: from.toISOString(), to: to.toISOString(), seconds };
}

function source(key: string, status: ObservabilitySummary['status'], error: string | null = null): ObservabilitySummary['sources'][number] {
  const generatedAt = new Date().toISOString();
  return { key, status, generatedAt, ageSeconds: 0, error };
}

function dependencyStatus(value: 'ok' | 'degraded' | 'error' | undefined): ObservabilitySummary['status'] {
  if (value === 'ok') return 'ok';
  if (value === 'degraded') return 'degraded';
  return 'unavailable';
}

/**
 * First observability v2 read model. It deliberately exposes only bounded aggregates;
 * raw Prometheus and infrastructure payloads stay behind the server boundary.
 */
export async function getObservabilitySummary(): Promise<ObservabilitySummary> {
  const [infra, monitor, workers, queues] = await Promise.allSettled([
    checkInfraHealth(),
    getMonitorStatus(),
    countActiveWorkerNodes(),
    getQueueDepths(),
  ]);

  const window = nowWindow(60);
  const monitorValue = monitor.status === 'fulfilled' ? monitor.value : null;
  const infraValue = infra.status === 'fulfilled' ? infra.value : null;
  const activeWorkers = workers.status === 'fulfilled' ? workers.value : null;
  const queueValue = queues.status === 'fulfilled' ? queues.value : [];
  const db = monitorValue?.database ?? null;
  const redis = monitorValue?.redis ?? null;

  const dependencies: Record<string, ObservabilitySummary['status']> = {
    database: dependencyStatus(infraValue?.database),
    redis: dependencyStatus(infraValue?.redis),
    invalidationBus: dependencyStatus(infraValue?.invalidationBus),
    workers: activeWorkers === null ? 'unavailable' : activeWorkers > 0 ? 'ok' : 'degraded',
    telemetry: 'degraded',
  };

  const httpWindow = metricsSampler.http.windowStats(60);
  const hasHttpSamples = httpWindow.total > 0;
  const apiAchieved = hasHttpSamples ? Math.max(0, 1 - httpWindow.errorRate / 100) : null;
  const apiTarget = 0.995;
  const apiSlo: ObservabilitySummary['slos'][number] = {
    key: 'api.request.success',
    name: 'API 请求成功率',
    target: apiTarget,
    status: apiAchieved === null ? 'unavailable' : apiAchieved >= apiTarget ? 'ok' : 'degraded',
    achieved: apiAchieved,
    totalEvents: hasHttpSamples ? httpWindow.total : null,
    badEvents: hasHttpSamples ? httpWindow.errors : null,
    errorBudgetRemaining: apiAchieved === null ? null : Math.max(0, (apiAchieved - (1 - apiTarget)) / apiTarget),
    burnRateFast: apiAchieved === null ? null : Math.max(0, (1 - apiAchieved) / (1 - apiTarget)),
    burnRateSlow: null,
    window,
  };

  const sourceRows = [
    infra.status === 'fulfilled' ? source('infrastructure', 'ok') : source('infrastructure', 'unavailable', String(infra.reason)),
    monitor.status === 'fulfilled' ? source('monitor-sampler', 'ok') : source('monitor-sampler', 'unavailable', String(monitor.reason)),
    workers.status === 'fulfilled' ? source('worker-heartbeat', 'ok') : source('worker-heartbeat', 'unavailable', String(workers.reason)),
    queues.status === 'fulfilled' ? source('queue-depth', 'ok') : source('queue-depth', 'unavailable', String(queues.reason)),
    source('slo-engine', apiAchieved === null ? 'unavailable' : 'ok', apiAchieved === null ? '最近 60 秒没有请求样本' : null),
  ];

  const hasUnavailable = sourceRows.some((row) => row.status === 'unavailable');
  const hasDegraded = sourceRows.some((row) => row.status === 'degraded') || Object.values(dependencies).includes('degraded');

  return {
    generatedAt: new Date().toISOString(),
    status: hasUnavailable ? 'unavailable' : hasDegraded ? 'degraded' : 'ok',
    partial: hasUnavailable || hasDegraded,
    window,
    sources: sourceRows,
    dependencies,
    slos: [apiSlo],
    capacity: {
      database: {
        activeConnections: db?.activeConnections ?? null,
        totalConnections: db?.totalConnections ?? null,
        utilization: db && db.totalConnections > 0 ? db.activeConnections / db.totalConnections : null,
      },
      redis: {
        connectedClients: redis?.connectedClients ?? null,
        maxClients: redis?.maxClients ?? null,
        utilization: redis && redis.maxClients > 0 ? redis.connectedClients / redis.maxClients : null,
        usedMemory: redis?.usedMemory ?? null,
      },
      workers: { active: activeWorkers, required: config.roles.worker ? 1 : 1 },
      queues: queueValue.map((queue) => ({
        name: queue.queue,
        ready: queue.ready,
        active: queue.active,
        deferred: queue.deferred,
        failed: queue.failed,
      })),
    },
  };
}
