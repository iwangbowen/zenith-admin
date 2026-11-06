import type { OutputOf } from '@zenith/shared/core';
import { observabilityContract, type ObservabilitySourceStatus } from '@zenith/shared/platform';
import { config } from '../../config';
import { checkInfraHealth } from '../../lib/health-checks';
import { countActiveWorkerNodes, getQueueDepthSnapshot } from '../../lib/pg-boss-scheduler';
import { getMonitorSampleState, getMonitorStatus } from './monitor.service';
import { getTelemetryStatus } from '../../lib/telemetry';
import { metricsSampler, type HttpWindowStats } from '../../lib/metrics-sampler';

type ObservabilitySummary = OutputOf<typeof observabilityContract.summary>;

const FAST_WINDOW_SECONDS = 5 * 60;
const SLOW_WINDOW_SECONDS = 60 * 60;
const API_SLO_TARGET = 0.995;
const SOURCE_STALE_AFTER_SECONDS = 30;

function windowOf(seconds: number, now = Date.now()): ObservabilitySummary['window'] {
  const to = new Date(now);
  const from = new Date(now - seconds * 1000);
  return { from: from.toISOString(), to: to.toISOString(), seconds };
}

function sampled<T>(promise: Promise<T>): Promise<{ value: T; sampledAt: number }> {
  return promise.then((value) => ({ value, sampledAt: Date.now() }));
}

function ageSeconds(generatedAt: number | null, now: number): number | null {
  if (generatedAt === null) return null;
  return Math.max(0, (now - generatedAt) / 1000);
}

function source(
  key: string,
  generatedAt: number | null,
  now: number,
  error: string | null = null,
  staleAfterSeconds = SOURCE_STALE_AFTER_SECONDS,
): ObservabilitySummary['sources'][number] {
  const age = ageSeconds(generatedAt, now);
  let status: ObservabilitySourceStatus;
  if (generatedAt === null) status = error ? 'unavailable' : 'not_sampled';
  else if (error) status = 'degraded';
  else if (age !== null && age > staleAfterSeconds) status = 'stale';
  else status = 'ok';
  return {
    key,
    status,
    generatedAt: generatedAt === null ? null : new Date(generatedAt).toISOString(),
    ageSeconds: age,
    error,
  };
}

function dependencyStatus(value: 'ok' | 'degraded' | 'error' | undefined): ObservabilitySummary['status'] {
  if (value === 'ok') return 'ok';
  if (value === 'degraded') return 'degraded';
  return 'unavailable';
}

function burnRate(stats: HttpWindowStats, target: number): number | null {
  if (stats.total <= 0) return null;
  const allowedBadRate = 1 - target;
  if (allowedBadRate <= 0) return null;
  const value = Math.max(0, (stats.errors / stats.total) / allowedBadRate);
  return Math.round(value * 10_000) / 10_000;
}

function achieved(stats: HttpWindowStats): number | null {
  if (stats.total <= 0) return null;
  return Math.max(0, Math.min(1, (stats.total - stats.errors) / stats.total));
}

function remainingBudget(stats: HttpWindowStats, target: number): number | null {
  const burn = burnRate(stats, target);
  return burn === null ? null : Math.max(0, Math.min(1, 1 - burn));
}

function sloStatus(achievedValue: number | null, target: number): ObservabilitySummary['status'] {
  if (achievedValue === null) return 'unavailable';
  return achievedValue >= target ? 'ok' : 'degraded';
}

function sourceStatusIsUnavailable(status: ObservabilitySummary['sources'][number]['status']): boolean {
  return status === 'unavailable' || status === 'not_sampled';
}

/**
 * First observability v2 read model. It deliberately exposes only bounded aggregates;
 * raw Prometheus and infrastructure payloads stay behind the server boundary.
 */
export async function getObservabilitySummary(): Promise<ObservabilitySummary> {
  const [infra, monitor, workers, queues] = await Promise.allSettled([
    sampled(checkInfraHealth()),
    sampled(getMonitorStatus()),
    sampled(countActiveWorkerNodes()),
    getQueueDepthSnapshot(),
  ]);
  const now = Date.now();
  const monitorValue = monitor.status === 'fulfilled' ? monitor.value.value : null;
  const infraValue = infra.status === 'fulfilled' ? infra.value.value : null;
  const activeWorkers = workers.status === 'fulfilled' ? workers.value.value : null;
  const queueSnapshot = queues.status === 'fulfilled'
    ? queues.value
    : { status: 'error' as const, generatedAt: null, queues: null, error: 'queue_read_error' };
  const db = monitorValue?.database ?? null;
  const redis = monitorValue?.redis ?? null;
  const monitorSampleState = getMonitorSampleState();
  const telemetry = getTelemetryStatus();
  const telemetryStatus: ObservabilitySummary['status'] = telemetry.status === 'ready' || telemetry.status === 'disabled'
    ? 'ok'
    : telemetry.status === 'starting' ? 'degraded' : 'unavailable';

  const dependencies: Record<string, ObservabilitySummary['status']> = {
    database: dependencyStatus(infraValue?.database),
    redis: dependencyStatus(infraValue?.redis),
    invalidationBus: dependencyStatus(infraValue?.invalidationBus),
    workers: activeWorkers === null ? 'unavailable' : activeWorkers > 0 ? 'ok' : 'degraded',
    telemetry: telemetryStatus,
  };

  const fastStats = metricsSampler.http.windowStats(FAST_WINDOW_SECONDS);
  const slowStats = metricsSampler.http.windowStats(SLOW_WINDOW_SECONDS);
  const apiAchieved = achieved(fastStats);
  const apiSlo: ObservabilitySummary['slos'][number] = {
    key: 'api.request.success',
    name: 'API 请求成功率',
    target: API_SLO_TARGET,
    status: sloStatus(apiAchieved, API_SLO_TARGET),
    achieved: apiAchieved,
    totalEvents: fastStats.total > 0 ? fastStats.total : null,
    badEvents: fastStats.total > 0 ? fastStats.errors : null,
    errorBudgetRemaining: remainingBudget(fastStats, API_SLO_TARGET),
    burnRateFast: burnRate(fastStats, API_SLO_TARGET),
    burnRateSlow: burnRate(slowStats, API_SLO_TARGET),
    fastWindow: windowOf(FAST_WINDOW_SECONDS, now),
    slowWindow: windowOf(SLOW_WINDOW_SECONDS, now),
  };

  const infraError = infraValue && Object.values(infraValue).some((value) => value === 'error')
    ? 'infrastructure_check_failed'
    : infraValue && Object.values(infraValue).some((value) => value === 'degraded')
      ? 'infrastructure_degraded'
      : null;
  const sourceRows = [
    infra.status === 'fulfilled'
      ? source('infrastructure', infra.value.sampledAt, now, infraError)
      : source('infrastructure', null, now, 'infrastructure_unavailable'),
    monitor.status === 'fulfilled'
      ? source('monitor-sampler', monitorSampleState.generatedAt, now, monitorSampleState.error)
      : source('monitor-sampler', null, now, 'monitor_sampler_unavailable'),
    workers.status === 'fulfilled'
      ? source('worker-heartbeat', workers.value.sampledAt, now)
      : source('worker-heartbeat', null, now, 'worker_heartbeat_unavailable'),
    source(
      'queue-depth',
      queueSnapshot.generatedAt ? Date.parse(queueSnapshot.generatedAt) : null,
      now,
      queueSnapshot.error,
    ),
    source(
      'slo-engine',
      fastStats.latestAt,
      now,
      fastStats.total > 0 ? null : 'no_http_samples',
      FAST_WINDOW_SECONDS,
    ),
    source(
      'telemetry',
      telemetry.status === 'ready' || telemetry.status === 'disabled' ? now : null,
      now,
      telemetry.error,
    ),
  ];

  const hasUnavailable = sourceRows.some((row) => sourceStatusIsUnavailable(row.status))
    || Object.values(dependencies).includes('unavailable');
  const hasDegraded = sourceRows.some((row) => row.status === 'degraded' || row.status === 'stale')
    || Object.values(dependencies).includes('degraded')
    || apiSlo.status === 'degraded';
  const queueItems = queueSnapshot.queues?.map((queue) => ({
    name: queue.queue,
    ready: queue.ready,
    active: queue.active,
    deferred: queue.deferred,
    failed: queue.failed,
  })) ?? null;
  const poolLimit = config.database.maxConnections;

  return {
    generatedAt: new Date(now).toISOString(),
    status: hasUnavailable ? 'unavailable' : hasDegraded ? 'degraded' : 'ok',
    partial: hasUnavailable || hasDegraded,
    window: windowOf(FAST_WINDOW_SECONDS, now),
    sources: sourceRows,
    dependencies,
    slos: [apiSlo],
    capacity: {
      database: {
        activeConnections: db?.activeConnections ?? null,
        observedConnections: db?.totalConnections ?? null,
        poolLimit,
        utilization: db && poolLimit > 0 ? Math.min(1, db.activeConnections / poolLimit) : null,
      },
      redis: {
        connectedClients: redis?.connectedClients ?? null,
        maxClients: redis && redis.maxClients > 0 ? redis.maxClients : null,
        utilization: redis && redis.maxClients > 0
          ? Math.min(1, redis.connectedClients / redis.maxClients)
          : null,
        usedMemory: redis?.usedMemory ?? null,
      },
      workers: { active: activeWorkers, required: config.workerRequired },
      queues: {
        key: 'queue-depth',
        status: sourceRows.find((row) => row.key === 'queue-depth')?.status ?? 'unavailable',
        generatedAt: queueSnapshot.generatedAt,
        ageSeconds: queueSnapshot.generatedAt ? ageSeconds(Date.parse(queueSnapshot.generatedAt), now) : null,
        error: queueSnapshot.error,
        items: queueSnapshot.queues === null ? null : queueItems,
      },
    },
  };
}

export const observabilityInternals = {
  burnRate,
  achieved,
  remainingBudget,
  source,
};
