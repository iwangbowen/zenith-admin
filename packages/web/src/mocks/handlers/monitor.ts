import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';

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
    perCore: [
      { index: 0, usage: 18, user: 12, system: 6, idle: 82 },
      { index: 1, usage: 9, user: 5, system: 4, idle: 91 },
      { index: 2, usage: 22, user: 16, system: 6, idle: 78 },
      { index: 3, usage: 7, user: 4, system: 3, idle: 93 },
      { index: 4, usage: 14, user: 10, system: 4, idle: 86 },
      { index: 5, usage: 11, user: 7, system: 4, idle: 89 },
      { index: 6, usage: 19, user: 13, system: 6, idle: 81 },
      { index: 7, usage: 6, user: 3, system: 3, idle: 94 },
    ],
  },
  memory: {
    total: 16 * 1024 * 1024 * 1024,
    used: 6 * 1024 * 1024 * 1024,
    free: 10 * 1024 * 1024 * 1024,
    usagePercent: 38,
    detail: {
      memTotal: 16 * 1024 * 1024 * 1024,
      memFree: 10 * 1024 * 1024 * 1024,
      memAvailable: 12 * 1024 * 1024 * 1024,
      buffers: 256 * 1024 * 1024,
      cached: 3 * 1024 * 1024 * 1024,
      shared: 64 * 1024 * 1024,
      swapTotal: 4 * 1024 * 1024 * 1024,
      swapFree: 4 * 1024 * 1024 * 1024,
      swapCached: 0,
      swapUsagePercent: 0,
      dirty: 12 * 1024 * 1024,
      writeback: 0,
    },
  },
  disk: {
    total: 512 * 1024 * 1024 * 1024,
    used: 128 * 1024 * 1024 * 1024,
    free: 384 * 1024 * 1024 * 1024,
    usagePercent: 25,
    mount: '/',
  },
  disks: [
    {
      filesystem: '/dev/nvme0n1p2',
      mount: '/',
      total: 512 * 1024 * 1024 * 1024,
      used: 128 * 1024 * 1024 * 1024,
      free: 384 * 1024 * 1024 * 1024,
      usagePercent: 25,
    },
    {
      filesystem: '/dev/nvme0n1p1',
      mount: '/boot',
      total: 1024 * 1024 * 1024,
      used: 320 * 1024 * 1024,
      free: 704 * 1024 * 1024,
      usagePercent: 31,
    },
    {
      filesystem: '/dev/sda1',
      mount: '/data',
      total: 2 * 1024 * 1024 * 1024 * 1024,
      used: 1.6 * 1024 * 1024 * 1024 * 1024,
      free: 0.4 * 1024 * 1024 * 1024 * 1024,
      usagePercent: 80,
    },
  ],
  network: [
    {
      name: 'eth0', rxBytes: 12_345_678_901, txBytes: 3_456_789_012,
      rxBps: 1_240_000, txBps: 320_000,
      rxPackets: 12_345_678, txPackets: 3_456_789,
      rxErrors: 0, txErrors: 0,
    },
    {
      name: 'docker0', rxBytes: 84_312_001, txBytes: 73_212_000,
      rxBps: 32_000, txBps: 28_000,
      rxPackets: 432_100, txPackets: 421_000,
      rxErrors: 0, txErrors: 0,
    },
  ],
  diskIo: { readBps: 4_700_000, writeBps: 1_800_000 },
  topProcesses: {
    byCpu: [
      { pid: 12345, name: 'node', cpu: 24.5, memPercent: 3.2, memBytes: 512 * 1024 * 1024 },
      { pid: 980, name: 'postgres', cpu: 12.1, memPercent: 2.1, memBytes: 340 * 1024 * 1024 },
      { pid: 651, name: 'redis-server', cpu: 6.4, memPercent: 0.6, memBytes: 96 * 1024 * 1024 },
      { pid: 1502, name: 'chrome', cpu: 4.2, memPercent: 5.4, memBytes: 870 * 1024 * 1024 },
      { pid: 222, name: 'systemd', cpu: 1.1, memPercent: 0.3, memBytes: 48 * 1024 * 1024 },
    ],
    byMemory: [
      { pid: 1502, name: 'chrome', cpu: 4.2, memPercent: 5.4, memBytes: 870 * 1024 * 1024 },
      { pid: 12345, name: 'node', cpu: 24.5, memPercent: 3.2, memBytes: 512 * 1024 * 1024 },
      { pid: 980, name: 'postgres', cpu: 12.1, memPercent: 2.1, memBytes: 340 * 1024 * 1024 },
      { pid: 651, name: 'redis-server', cpu: 6.4, memPercent: 0.6, memBytes: 96 * 1024 * 1024 },
      { pid: 222, name: 'systemd', cpu: 1.1, memPercent: 0.3, memBytes: 48 * 1024 * 1024 },
    ],
  },
  temperature: {
    cpu: 52.4,
    sensors: [
      { label: 'x86_pkg_temp', celsius: 52.4 },
      { label: 'Core 0', celsius: 50.1 },
      { label: 'Core 1', celsius: 49.8 },
      { label: 'acpitz', celsius: 45.0 },
    ],
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
  netRxBps: number; netTxBps: number; diskReadBps: number; diskWriteBps: number;
  dbConnections: number; redisMemBytes: number; redisHitRate: number;
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
      netRxBps: Math.max(0, Math.round(1_200_000 + wave * 600_000 + Math.random() * 300_000)),
      netTxBps: Math.max(0, Math.round(320_000 + wave * 160_000 + Math.random() * 80_000)),
      diskReadBps: Math.max(0, Math.round(4_000_000 + wave * 2_000_000 + Math.random() * 1_000_000)),
      diskWriteBps: Math.max(0, Math.round(1_500_000 + wave * 800_000 + Math.random() * 400_000)),
      dbConnections: Math.max(1, Math.round(12 + wave * 4 + Math.random() * 3)),
      redisMemBytes: Math.max(0, Math.round(18_000_000 + wave * 2_500_000 + Math.random() * 1_000_000)),
      redisHitRate: Math.min(100, Math.round((92 + wave * 4 + Math.random() * 3) * 10) / 10),
    });
  }
  return points;
}

const HISTORY_RANGE_CFG: Record<string, { windowSec: number; bucketSec: number }> = {
  '1h': { windowSec: 3600, bucketSec: 60 },
  '6h': { windowSec: 6 * 3600, bucketSec: 120 },
  '24h': { windowSec: 24 * 3600, bucketSec: 300 },
  '7d': { windowSec: 7 * 24 * 3600, bucketSec: 1800 },
  '30d': { windowSec: 30 * 24 * 3600, bucketSec: 7200 },
};

function fmtHistoryTime(d: Date): string {
  return dayjs(d).format('YYYY-MM-DD HH:mm:ss');
}

function buildHistory(range: string) {
  const cfg = HISTORY_RANGE_CFG[range] ?? HISTORY_RANGE_CFG['1h'];
  const count = Math.floor(cfg.windowSec / cfg.bucketSec);
  const now = Date.now();
  const points = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const t = new Date(now - i * cfg.bucketSec * 1000);
    const wave = Math.sin(i / 14);
    const base = {
      cpu: Math.max(0, Math.round((18 + wave * 12 + Math.random() * 6) * 10) / 10),
      memory: Math.max(0, Math.round((40 + wave * 6 + Math.random() * 3) * 10) / 10),
      disk: Math.max(0, Math.round((25 + i / count * 8) * 10) / 10),
      swap: 0,
      load1: Math.round((0.5 + Math.abs(wave) * 0.8) * 100) / 100,
      procCpu: Math.max(0, Math.round((5 + wave * 3 + Math.random() * 2) * 10) / 10),
      heap: Math.max(0, Math.round((58 + wave * 6) * 10) / 10),
      loopLag: Math.round((0.5 + Math.random() * 0.5) * 100) / 100,
      qps: Math.round((9 + wave * 5 + Math.random() * 3) * 100) / 100,
      errorRate: Math.round(Math.random() * 1.5 * 10) / 10,
      netRxBps: Math.max(0, Math.round(1_200_000 + wave * 700_000 + Math.random() * 300_000)),
      netTxBps: Math.max(0, Math.round(320_000 + wave * 180_000 + Math.random() * 90_000)),
      diskReadBps: Math.max(0, Math.round(4_000_000 + wave * 2_000_000 + Math.random() * 800_000)),
      diskWriteBps: Math.max(0, Math.round(1_500_000 + wave * 900_000 + Math.random() * 400_000)),
    };
    // 峰值 ≈ 均值 × 1.2~1.6（模拟桶内毛刺）
    const spike = 1.2 + Math.random() * 0.4;
    points.push({
      t: fmtHistoryTime(t),
      ...base,
      cpuMax: Math.min(100, Math.round(base.cpu * spike * 10) / 10),
      memoryMax: Math.min(100, Math.round(base.memory * (1 + Math.random() * 0.1) * 10) / 10),
      diskMax: Math.min(100, Math.round(base.disk * 1.02 * 10) / 10),
      swapMax: 0,
      load1Max: Math.round(base.load1 * spike * 100) / 100,
      procCpuMax: Math.round(base.procCpu * spike * 10) / 10,
      heapMax: Math.min(100, Math.round(base.heap * (1 + Math.random() * 0.15) * 10) / 10),
      loopLagMax: Math.round(base.loopLag * (2 + Math.random() * 2) * 100) / 100,
      qpsMax: Math.round(base.qps * spike * 100) / 100,
      errorRateMax: Math.round(base.errorRate * spike * 10) / 10,
      netRxBpsMax: Math.round(base.netRxBps * spike),
      netTxBpsMax: Math.round(base.netTxBps * spike),
      diskReadBpsMax: Math.round(base.diskReadBps * spike),
      diskWriteBpsMax: Math.round(base.diskWriteBps * spike),
    });
  }
  return { range, bucketSec: cfg.bucketSec, points };
}

function buildWsMetrics() {
  const now = Date.now();
  return {
    currentConnections: 3,
    currentUsers: 2,
    totalConnects: 128,
    totalDisconnects: 125,
    totalSent: 4521,
    totalRecv: 1023,
    connections: [
      { tokenId: 'a1b2c3d4e5f6', userId: 1, username: 'admin', nickname: '超级管理员', connectedAt: now - 1_200_000, lastActivityAt: now - 5_000, sent: 42, recv: 18 },
      { tokenId: 'f6e5d4c3b2a1', userId: 1, username: 'admin', nickname: '超级管理员', connectedAt: now - 320_000, lastActivityAt: now - 1_200, sent: 11, recv: 3 },
      { tokenId: '0123456789ab', userId: 2, username: 'demo', nickname: '演示账号', connectedAt: now - 60_000, lastActivityAt: now - 800, sent: 6, recv: 2 },
    ],
    recentDisconnects: [
      { tokenId: 'aaa11122233', userId: 2, username: 'demo', nickname: '演示账号', at: now - 30_000, reason: 'client-close', duration: 240_000, sent: 8, recv: 4 },
      { tokenId: 'bbb44455566', userId: 1, username: 'admin', nickname: '超级管理员', at: now - 600_000, reason: 'force-logout', duration: 3_600_000, sent: 96, recv: 31 },
    ],
  };
}

export const monitorHandlers = [
  http.get('/api/monitor', () => HttpResponse.json({ code: 0, message: 'success', data: baseStatus })),
  http.get('/api/monitor/timeseries', () =>
    HttpResponse.json({
      code: 0,
      message: 'success',
      data: { intervalSec: 10, capacity: 360, points: buildSeries() },
    })),
  http.get('/api/monitor/history', ({ request }) => {
    const range = new URL(request.url).searchParams.get('range') ?? '1h';
    return HttpResponse.json({ code: 0, message: 'success', data: buildHistory(range) });
  }),
  http.get('/api/monitor/ws', () => {
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: buildWsMetrics(),
    });
  }),
  // SSE 推送：首帧发送 metrics/series/ws 全量；后续每 10s 发送 metrics:diff + series:point + ws
  http.get('/api/monitor/stream', () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // 首帧：完整 snapshot + 全量时序 + WS 指标
        controller.enqueue(encoder.encode(`event: metrics\ndata: ${JSON.stringify(baseStatus)}\n\n`));
        controller.enqueue(encoder.encode(`event: series\ndata: ${JSON.stringify({ intervalSec: 10, capacity: 360, points: buildSeries() })}\n\n`));
        controller.enqueue(encoder.encode(`event: ws\ndata: ${JSON.stringify(buildWsMetrics())}\n\n`));
        // 后续：仅推送 cpu.usage / memory.usagePercent / http.currentQps 等少量抖动字段 + 最新时序点
        const timer = setInterval(() => {
          const wave = Math.sin(Date.now() / 12_000);
          const cpuVal = Math.max(0, Math.round(15 + wave * 8 + Math.random() * 5));
          const memVal = 38 + Math.round(wave * 2);
          const qpsVal = Math.max(0, Math.round(8 + wave * 4 + Math.random() * 3));
          const patch = {
            cpu: {
              usage: cpuVal,
              perCore: baseStatus.cpu.perCore.map((c) => ({
                ...c,
                usage: Math.max(0, Math.min(100, c.usage + Math.round((Math.random() - 0.5) * 10))),
              })),
            },
            memory: { usagePercent: memVal },
            http: {
              currentQps: qpsVal,
              qps: +(8 + wave * 2).toFixed(2),
            },
          };
          controller.enqueue(encoder.encode(`event: metrics:diff\ndata: ${JSON.stringify(patch)}\n\n`));
          const point = {
            t: Date.now(),
            cpu: cpuVal,
            mem: memVal,
            procCpu: Math.max(0, Math.round(4 + wave * 2 + Math.random() * 2)),
            heap: 60 + Math.round(wave * 5),
            loopLagMean: 0.4 + Math.random() * 0.3,
            loopLagP99: 1 + Math.random() * 1.5,
            qps: qpsVal,
            errorRate: Math.max(0, +(Math.random() * 1.2).toFixed(2)),
            netRxBps: Math.max(0, Math.round(1_200_000 + wave * 600_000 + Math.random() * 300_000)),
            netTxBps: Math.max(0, Math.round(320_000 + wave * 160_000 + Math.random() * 80_000)),
            diskReadBps: Math.max(0, Math.round(4_000_000 + wave * 2_000_000 + Math.random() * 1_000_000)),
            diskWriteBps: Math.max(0, Math.round(1_500_000 + wave * 800_000 + Math.random() * 400_000)),
            dbConnections: Math.max(1, Math.round(12 + wave * 4 + Math.random() * 3)),
            redisMemBytes: Math.max(0, Math.round(18_000_000 + wave * 2_500_000 + Math.random() * 1_000_000)),
            redisHitRate: Math.min(100, Math.round((92 + wave * 4 + Math.random() * 3) * 10) / 10),
          };
          controller.enqueue(encoder.encode(`event: series:point\ndata: ${JSON.stringify(point)}\n\n`));
          controller.enqueue(encoder.encode(`event: ws\ndata: ${JSON.stringify(buildWsMetrics())}\n\n`));
        }, 10_000);
        return () => clearInterval(timer);
      },
    });
    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),
];
