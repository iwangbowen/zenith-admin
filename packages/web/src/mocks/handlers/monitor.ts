import { http, HttpResponse } from 'msw';

const baseStatus = {
  os: {
    platform: 'linux',
    arch: 'x64',
    hostname: 'zenith-demo',
    release: '5.15.0',
    uptimeSeconds: 86400,
  },
  cpu: {
    model: 'Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz',
    cores: 8,
    speed: 3800,
    loadAvg: [0.42, 0.51, 0.6] as const,
    usage: 12,
  },
  memory: {
    total: 16 * 1024 * 1024 * 1024,
    used: 6 * 1024 * 1024 * 1024,
    free: 10 * 1024 * 1024 * 1024,
    usagePercent: 38,
  },
  disk: {
    total: 512 * 1024 * 1024 * 1024,
    used: 128 * 1024 * 1024 * 1024,
    free: 384 * 1024 * 1024 * 1024,
    usagePercent: 25,
    mount: '/',
  },
  node: {
    version: 'v20.0.0',
    pid: 12345,
    uptime: 3600,
    memoryUsage: {
      rss: 64 * 1024 * 1024,
      heapTotal: 48 * 1024 * 1024,
      heapUsed: 32 * 1024 * 1024,
      external: 1 * 1024 * 1024,
    },
    cpuUsagePercent: 4.5,
    eventLoop: { meanMs: 0.42, p50Ms: 0.36, p95Ms: 1.2, p99Ms: 2.4, maxMs: 8.6, stddevMs: 0.5 },
    gc: {
      totalCount: 124,
      totalDurationMs: 86.5,
      byKind: {
        minor: { count: 110, durationMs: 32.4 },
        major: { count: 8, durationMs: 38.6 },
        incremental: { count: 6, durationMs: 15.5 },
      },
    },
    heapSpaces: [
      { name: 'new_space', size: 16 * 1024 * 1024, used: 6 * 1024 * 1024, available: 10 * 1024 * 1024 },
      { name: 'old_space', size: 32 * 1024 * 1024, used: 22 * 1024 * 1024, available: 10 * 1024 * 1024 },
    ],
    resourceUsage: {
      userCPUMicros: 4_200_000,
      systemCPUMicros: 1_100_000,
      maxRssBytes: 70 * 1024 * 1024,
      fsRead: 1024,
      fsWrite: 2048,
      voluntaryContextSwitches: 32_000,
      involuntaryContextSwitches: 1_200,
    },
  },
  http: {
    qps: 8.7, currentQps: 12, total: 522, errors: 4, errorRate: 0.77,
    total4xx: 18, total5xx: 2, p50: 24.3, p95: 89.2, p99: 154.6, max: 421.8,
  },
  database: {
    name: 'zenith_admin',
    size: 8 * 1024 * 1024,
    activeConnections: 3,
    totalConnections: 10,
    tableCount: 12,
    connectionStates: { active: 3, idle: 6, idleInTransaction: 1, other: 0 },
    cacheHit: { blksHit: 88_421, blksRead: 1_023, ratio: 98.86 },
    transactions: { commit: 12_345, rollback: 87, deadlocks: 0, tempBytes: 0 },
    slowQueries: null,
    slowQueriesAvailable: false,
  },
  redis: {
    version: '7.2.4',
    uptimeSeconds: 86400,
    connectedClients: 2,
    blockedClients: 0,
    rejectedConnections: 0,
    usedMemory: 2 * 1024 * 1024,
    usedMemoryHuman: '2.00M',
    usedMemoryRss: 6 * 1024 * 1024,
    memFragmentationRatio: 1.21,
    maxMemory: 0,
    maxMemoryPolicy: 'noeviction',
    totalCommandsProcessed: 15842,
    keyspaceHits: 1024,
    keyspaceMisses: 32,
    keyCount: 5,
    role: 'master',
    rdbLastSaveTime: Math.floor(Date.now() / 1000) - 600,
    rdbChangesSinceLastSave: 12,
    aofEnabled: false,
    masterLinkStatus: null,
    slowLog: [],
  },
};

function buildSeries(): Array<{
  t: number; cpu: number; mem: number; procCpu: number; heap: number;
  loopLagMean: number; loopLagP99: number; qps: number; errorRate: number;
}> {
  const now = Date.now();
  const points = [];
  for (let i = 359; i >= 0; i -= 1) {
    const t = now - i * 10_000;
    const wave = Math.sin(i / 12);
    points.push({
      t,
      cpu: Math.max(0, Math.round(15 + wave * 8 + Math.random() * 5)),
      mem: 38 + Math.round(wave * 2),
      procCpu: Math.max(0, Math.round(4 + wave * 2 + Math.random() * 2)),
      heap: 60 + Math.round(wave * 5),
      loopLagMean: 0.4 + Math.random() * 0.3,
      loopLagP99: 1 + Math.random() * 1.5,
      qps: Math.max(0, Math.round(8 + wave * 4 + Math.random() * 3)),
      errorRate: Math.max(0, +(Math.random() * 1.2).toFixed(2)),
    });
  }
  return points;
}

export const monitorHandlers = [
  http.get('/api/monitor', () => HttpResponse.json({ code: 0, message: 'success', data: baseStatus })),
  http.get('/api/monitor/timeseries', () =>
    HttpResponse.json({
      code: 0,
      message: 'success',
      data: { intervalSec: 10, capacity: 360, points: buildSeries() },
    })),
];
