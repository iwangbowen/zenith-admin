import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { monitorHistoryQuerySchema } from '../validation';

// ─── 服务器快照 ───────────────────────────────────────────────────────────────

export const monitorPerCoreCpuSchema = z.object({
  index: z.int(),
  usage: z.number(),
  user: z.number(),
  system: z.number(),
  idle: z.number(),
}).meta({ id: 'MonitorPerCoreCpu' });

export type MonitorPerCoreCpu = z.infer<typeof monitorPerCoreCpuSchema>;

/** Linux /proc/meminfo 中有意义的字段，单位：字节 */
export const monitorLinuxMemInfoSchema = z.object({
  memTotal: z.number(),
  memFree: z.number(),
  memAvailable: z.number(),
  buffers: z.number(),
  cached: z.number(),
  shared: z.number(),
  swapTotal: z.number(),
  swapFree: z.number(),
  swapCached: z.number(),
  swapUsagePercent: z.number(),
  dirty: z.number(),
  writeback: z.number(),
}).meta({ id: 'MonitorLinuxMemInfo' });

export type MonitorLinuxMemInfo = z.infer<typeof monitorLinuxMemInfoSchema>;

export const monitorDiskInfoSchema = z.object({
  filesystem: z.string(),
  total: z.number(),
  used: z.number(),
  free: z.number(),
  usagePercent: z.number(),
  mount: z.string(),
}).meta({ id: 'MonitorDiskInfo' });

export type MonitorDiskInfo = z.infer<typeof monitorDiskInfoSchema>;

export const monitorNetIfaceStatsSchema = z.object({
  name: z.string(),
  rxBytes: z.number(),
  txBytes: z.number(),
  rxBps: z.number(),
  txBps: z.number(),
  rxPackets: z.number(),
  txPackets: z.number(),
  rxErrors: z.number(),
  txErrors: z.number(),
}).meta({ id: 'MonitorNetIfaceStats' });

export type MonitorNetIfaceStats = z.infer<typeof monitorNetIfaceStatsSchema>;

export const monitorTopProcessItemSchema = z.object({
  pid: z.int(),
  name: z.string(),
  cpu: z.number(),
  memPercent: z.number(),
  memBytes: z.number(),
}).meta({ id: 'MonitorTopProcessItem' });

export type MonitorTopProcessItem = z.infer<typeof monitorTopProcessItemSchema>;

export const monitorTopProcessesSchema = z.object({
  byCpu: z.array(monitorTopProcessItemSchema),
  byMemory: z.array(monitorTopProcessItemSchema),
}).meta({ id: 'MonitorTopProcesses' });

export type MonitorTopProcesses = z.infer<typeof monitorTopProcessesSchema>;

export const monitorTemperatureInfoSchema = z.object({
  cpu: z.number().nullable(),
  sensors: z.array(z.object({ label: z.string(), celsius: z.number() })),
}).meta({ id: 'MonitorTemperatureInfo' });

export type MonitorTemperatureInfo = z.infer<typeof monitorTemperatureInfoSchema>;

export const monitorEventLoopStatsSchema = z.object({
  meanMs: z.number(),
  p50Ms: z.number(),
  p95Ms: z.number(),
  p99Ms: z.number(),
  maxMs: z.number(),
  stddevMs: z.number(),
}).meta({ id: 'MonitorEventLoopStats' });

export type MonitorEventLoopStats = z.infer<typeof monitorEventLoopStatsSchema>;

export const monitorGcStatsSchema = z.object({
  totalCount: z.number().meta({ description: '自启动以来 GC 总次数' }),
  totalDurationMs: z.number().meta({ description: '自启动以来 GC 总耗时（毫秒）' }),
  byKind: z.record(z.string(), z.object({ count: z.number(), durationMs: z.number() })),
}).meta({ id: 'MonitorGcStats' });

export type MonitorGcStats = z.infer<typeof monitorGcStatsSchema>;

export const monitorHeapSpaceSchema = z.object({
  name: z.string(),
  size: z.number(),
  used: z.number(),
  available: z.number(),
}).meta({ id: 'MonitorHeapSpace' });

export type MonitorHeapSpace = z.infer<typeof monitorHeapSpaceSchema>;

export const monitorResourceUsageSchema = z.object({
  userCPUMicros: z.number(),
  systemCPUMicros: z.number(),
  maxRssBytes: z.number(),
  fsRead: z.number(),
  fsWrite: z.number(),
  voluntaryContextSwitches: z.number(),
  involuntaryContextSwitches: z.number(),
}).meta({ id: 'MonitorResourceUsage' });

export type MonitorResourceUsage = z.infer<typeof monitorResourceUsageSchema>;

export const monitorHttpStatsSchema = z.object({
  qps: z.number(),
  currentQps: z.number(),
  total: z.number(),
  errors: z.number(),
  errorRate: z.number(),
  total4xx: z.number(),
  total5xx: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  max: z.number(),
}).meta({ id: 'MonitorHttpStats' });

export type MonitorHttpStats = z.infer<typeof monitorHttpStatsSchema>;

export const monitorDbInfoSchema = z.object({
  name: z.string(),
  size: z.number(),
  activeConnections: z.number(),
  totalConnections: z.number(),
  tableCount: z.number(),
  connectionStates: z.object({
    active: z.number(),
    idle: z.number(),
    idleInTransaction: z.number(),
    other: z.number(),
  }),
  cacheHit: z.object({ blksHit: z.number(), blksRead: z.number(), ratio: z.number() }),
  transactions: z.object({ commit: z.number(), rollback: z.number(), deadlocks: z.number(), tempBytes: z.number() }),
  slowQueries: z.array(z.object({ query: z.string(), calls: z.number(), meanMs: z.number(), totalMs: z.number() })).nullable(),
  slowQueriesAvailable: z.boolean().meta({ description: 'pg_stat_statements 是否可用' }),
}).meta({ id: 'MonitorDbInfo' });

export type MonitorDbInfo = z.infer<typeof monitorDbInfoSchema>;

export const monitorRedisInfoSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number(),
  connectedClients: z.number(),
  blockedClients: z.number(),
  rejectedConnections: z.number(),
  usedMemory: z.number(),
  usedMemoryHuman: z.string(),
  usedMemoryRss: z.number(),
  memFragmentationRatio: z.number(),
  maxMemory: z.number(),
  maxMemoryPolicy: z.string(),
  totalCommandsProcessed: z.number(),
  keyspaceHits: z.number(),
  keyspaceMisses: z.number(),
  keyCount: z.number(),
  role: z.string(),
  rdbLastSaveTime: z.number(),
  rdbChangesSinceLastSave: z.number(),
  aofEnabled: z.boolean(),
  masterLinkStatus: z.string().nullable(),
  slowLog: z.array(z.object({ id: z.number(), timestamp: z.number(), durationMs: z.number(), command: z.string() })),
}).meta({ id: 'MonitorRedisInfo' });

export type MonitorRedisInfo = z.infer<typeof monitorRedisInfoSchema>;

export const monitorSnapshotSchema = z.object({
  os: z.object({
    platform: z.string(),
    release: z.string(),
    arch: z.string(),
    hostname: z.string(),
    uptimeSeconds: z.int(),
  }),
  cpu: z.object({
    model: z.string(),
    cores: z.int(),
    speed: z.number(),
    loadAvg: z.array(z.number()).meta({ description: '1 / 5 / 15 分钟平均负载' }),
    usage: z.number(),
    perCore: z.array(monitorPerCoreCpuSchema),
  }),
  memory: z.object({
    total: z.number(),
    used: z.number(),
    free: z.number(),
    usagePercent: z.number(),
    detail: monitorLinuxMemInfoSchema.nullable(),
  }),
  disk: z.object({
    total: z.number(),
    used: z.number(),
    free: z.number(),
    usagePercent: z.number(),
    mount: z.string(),
  }).nullable().meta({ description: '主磁盘（总容量最大的挂载点）' }),
  disks: z.array(monitorDiskInfoSchema),
  diskIo: z.object({ readBps: z.number(), writeBps: z.number() }),
  network: z.array(monitorNetIfaceStatsSchema),
  topProcesses: monitorTopProcessesSchema.nullable(),
  temperature: monitorTemperatureInfoSchema.nullable(),
  node: z.object({
    version: z.string(),
    uptime: z.int(),
    pid: z.int(),
    memoryUsage: z.object({
      rss: z.number(),
      heapTotal: z.number(),
      heapUsed: z.number(),
      external: z.number(),
      arrayBuffers: z.number(),
    }),
    cpuUsagePercent: z.number(),
    eventLoop: monitorEventLoopStatsSchema,
    gc: monitorGcStatsSchema,
    heapSpaces: z.array(monitorHeapSpaceSchema),
    resourceUsage: monitorResourceUsageSchema,
  }),
  http: monitorHttpStatsSchema,
  database: monitorDbInfoSchema.nullable(),
  redis: monitorRedisInfoSchema.nullable(),
}).meta({ id: 'MonitorSnapshot' });

export type MonitorSnapshot = z.infer<typeof monitorSnapshotSchema>;

// ─── 时序 ────────────────────────────────────────────────────────────────────

export const monitorTimeseriesPointSchema = z.object({
  t: z.number().meta({ description: '采样时间戳（毫秒）' }),
  cpu: z.number(),
  mem: z.number(),
  procCpu: z.number(),
  heap: z.number(),
  loopLagMean: z.number(),
  loopLagP99: z.number(),
  loopLagMax: z.number(),
  qps: z.number(),
  errorRate: z.number(),
  netRxBps: z.number(),
  netTxBps: z.number(),
  diskReadBps: z.number(),
  diskWriteBps: z.number(),
  dbConnections: z.number().optional().meta({ description: '数据库总连接数（外部采集器提供，滞后一个采样周期）' }),
  redisMemBytes: z.number().optional(),
  redisHitRate: z.number().optional().meta({ description: 'Redis 窗口命中率 0-100' }),
}).meta({ id: 'MonitorTimeseriesPoint' });

export type MonitorTimeseriesPoint = z.infer<typeof monitorTimeseriesPointSchema>;

export const monitorTimeseriesSchema = z.object({
  intervalSec: z.int(),
  capacity: z.int(),
  points: z.array(monitorTimeseriesPointSchema),
}).meta({ id: 'MonitorTimeseries' });

export type MonitorTimeseries = z.infer<typeof monitorTimeseriesSchema>;

export const monitorHistoryPointSchema = z.object({
  t: z.string(),
  cpu: z.number(),
  memory: z.number(),
  disk: z.number(),
  swap: z.number(),
  load1: z.number(),
  procCpu: z.number(),
  heap: z.number(),
  loopLag: z.number(),
  qps: z.number(),
  errorRate: z.number(),
  netRxBps: z.number(),
  netTxBps: z.number(),
  diskReadBps: z.number(),
  diskWriteBps: z.number(),
  cpuMax: z.number(),
  memoryMax: z.number(),
  diskMax: z.number(),
  swapMax: z.number(),
  load1Max: z.number(),
  procCpuMax: z.number(),
  heapMax: z.number(),
  loopLagMax: z.number(),
  qpsMax: z.number(),
  errorRateMax: z.number(),
  netRxBpsMax: z.number(),
  netTxBpsMax: z.number(),
  diskReadBpsMax: z.number(),
  diskWriteBpsMax: z.number(),
}).meta({ id: 'MonitorHistoryPoint' });

export type MonitorHistoryPoint = z.infer<typeof monitorHistoryPointSchema>;

export const monitorHistorySchema = z.object({
  range: z.string(),
  bucketSec: z.int(),
  points: z.array(monitorHistoryPointSchema),
}).meta({ id: 'MonitorHistory' });

export type MonitorHistory = z.infer<typeof monitorHistorySchema>;

// ─── WebSocket 连接 ───────────────────────────────────────────────────────────

export const monitorWsConnectionSchema = z.object({
  tokenId: z.string(),
  userId: z.int(),
  username: z.string().nullable(),
  nickname: z.string().nullable(),
  connectedAt: z.number(),
  lastActivityAt: z.number(),
  sent: z.int(),
  recv: z.int(),
}).meta({ id: 'MonitorWsConnection' });

export type MonitorWsConnection = z.infer<typeof monitorWsConnectionSchema>;

export const monitorWsDisconnectSchema = z.object({
  tokenId: z.string(),
  userId: z.int(),
  username: z.string().nullable(),
  nickname: z.string().nullable(),
  at: z.number(),
  reason: z.string(),
  duration: z.int(),
  sent: z.int(),
  recv: z.int(),
}).meta({ id: 'MonitorWsDisconnect' });

export type MonitorWsDisconnect = z.infer<typeof monitorWsDisconnectSchema>;

export const monitorWsMetricsSchema = z.object({
  currentConnections: z.int(),
  currentUsers: z.int(),
  totalConnects: z.int(),
  totalDisconnects: z.int(),
  totalSent: z.int(),
  totalRecv: z.int(),
  connections: z.array(monitorWsConnectionSchema),
  recentDisconnects: z.array(monitorWsDisconnectSchema),
}).meta({ id: 'MonitorWsMetrics' });

export type MonitorWsMetrics = z.infer<typeof monitorWsMetricsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const monitorContract = defineContract('/api/monitor', {
  snapshot: op.get('/', { response: monitorSnapshotSchema, summary: '获取服务器监控信息' }),
  timeseries: op.get('/timeseries', { response: monitorTimeseriesSchema, summary: '获取最近 1h 监控时序数据' }),
  history: op.get('/history', { query: monitorHistoryQuerySchema, response: monitorHistorySchema, summary: '获取持久化历史监控趋势（按时间范围分桶聚合）' }),
  ws: op.get('/ws', { response: monitorWsMetricsSchema, summary: '获取 WebSocket 实时连接监控' }),
  stream: op.get('/stream', {
    kind: 'sse',
    response: z.string(),
    summary: '实时推送监控指标（SSE）',
    description: '首帧推送完整快照（metrics）+ 全量时序（series）+ WS 指标（ws）；后续每个采样 tick 推送差量 patch（metrics:diff）、最新时序点（series:point）与 WS 指标全量（ws）。',
  }),
}, { tags: ['Monitor'] });
