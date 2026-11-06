import { observabilityContract, type ObservabilitySummary } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';

const now = Date.now();
const window = (seconds: number) => ({
  from: new Date(now - seconds * 1000).toISOString(),
  to: new Date(now).toISOString(),
  seconds,
});

const summary: ObservabilitySummary = {
  generatedAt: new Date(now).toISOString(),
  status: 'unavailable',
  partial: true,
  window: window(300),
  sources: [
    { key: 'infrastructure', status: 'ok', generatedAt: new Date(now - 1000).toISOString(), ageSeconds: 1, error: null },
    { key: 'monitor-sampler', status: 'not_sampled', generatedAt: null, ageSeconds: null, error: null },
    { key: 'worker-heartbeat', status: 'ok', generatedAt: new Date(now - 3000).toISOString(), ageSeconds: 3, error: null },
    { key: 'queue-depth', status: 'stale', generatedAt: new Date(now - 45_000).toISOString(), ageSeconds: 45, error: null },
    { key: 'slo-engine', status: 'ok', generatedAt: new Date(now - 1000).toISOString(), ageSeconds: 1, error: null },
    { key: 'telemetry', status: 'unavailable', generatedAt: null, ageSeconds: null, error: 'telemetry_initialization_failed' },
  ],
  dependencies: {
    database: 'ok',
    redis: 'ok',
    invalidationBus: 'ok',
    workers: 'ok',
    telemetry: 'unavailable',
  },
  slos: [{
    key: 'api.request.success',
    name: 'API 请求成功率',
    target: 0.995,
    status: 'ok',
    achieved: 0.999,
    totalEvents: 1000,
    badEvents: 1,
    errorBudgetRemaining: 0.8,
    burnRateFast: 0.2,
    burnRateSlow: 0.35,
    fastWindow: window(300),
    slowWindow: window(3600),
  }],
  capacity: {
    database: { activeConnections: 3, observedConnections: 8, poolLimit: 20, utilization: 0.15 },
    redis: { connectedClients: 20, maxClients: null, utilization: null, usedMemory: 1024 * 1024 },
    workers: { active: 2, required: null },
    queues: {
      key: 'queue-depth',
      status: 'stale',
      generatedAt: new Date(now - 45_000).toISOString(),
      ageSeconds: 45,
      error: null,
      items: [{ name: 'jobs', ready: 2, active: 1, deferred: 0, failed: 0 }],
    },
  },
};

export const observabilityHandlers = [
  mock(observabilityContract.summary, ({ ok }) => ok(summary, 'success')),
];
