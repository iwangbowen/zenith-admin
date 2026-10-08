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
  jobsBacklog: z.number().nullable().optional(),
  jobsStuck: z.number().nullable().optional(),
  jobsDead: z.number().nullable().optional(),
  jobsFailed1h: z.number().nullable().optional(),
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
  connId: z.string().meta({ description: '进程内唯一的连接标识；同一 token 多标签页各有一条' }),
  nodeId: z.string(),
  tokenId: z.string(),
  userId: z.int(),
  tenantId: z.int().nullable().meta({ description: '连接所属租户；为空表示平台侧用户，读取时按 userId 现解析' }),
  username: z.string().nullable(),
  nickname: z.string().nullable(),
  ip: z.string().nullable().meta({ description: '握手时采集的客户端 IP（经可信代理链判定）' }),
  userAgent: z.string().nullable().meta({ description: '握手时的 User-Agent 原文（截断 512 字符），前端据此派生浏览器 / 系统 / 端形态' }),
  lastMessageType: z.string().nullable().meta({ description: '该连接最近一条业务消息的类型，不含 ping / pong；方向由 lastDirection 给出' }),
  lastMessageAt: z.number().nullable(),
  lastDirection: z.enum(['inbound', 'outbound']).nullable(),
  connectedAt: z.number(),
  lastActivityAt: z.number(),
  sent: z.int(),
  recv: z.int(),
}).meta({ id: 'MonitorWsConnection' });

export type MonitorWsConnection = z.infer<typeof monitorWsConnectionSchema>;

export const monitorWsDisconnectSchema = z.object({
  connId: z.string(),
  nodeId: z.string(),
  tokenId: z.string(),
  userId: z.int(),
  username: z.string().nullable(),
  nickname: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  at: z.number(),
  reason: z.string(),
  duration: z.int(),
  sent: z.int(),
  recv: z.int(),
}).meta({ id: 'MonitorWsDisconnect' });

export type MonitorWsDisconnect = z.infer<typeof monitorWsDisconnectSchema>;

export const monitorWsMessageSchema = z.object({
  id: z.string(),
  at: z.number(),
  direction: z.enum(['inbound', 'outbound']),
  nodeId: z.string(),
  connId: z.string().nullable(),
  userId: z.int().nullable(),
  type: z.string(),
  topic: z.string().nullable(),
  bytes: z.int(),
  success: z.boolean().meta({ description: '本节点帧解析 / 写出是否成功；不代表业务处理结果或客户端已确认收到' }),
}).meta({ id: 'MonitorWsMessage' });

export type MonitorWsMessage = z.infer<typeof monitorWsMessageSchema>;

/** 在线连接的心跳累计信息，不保存帧载荷、不推断客户端收到 pong 或 RTT。 */
export const monitorWsHeartbeatSchema = z.object({
  nodeId: z.string(),
  connId: z.string(),
  userId: z.int(),
  pingCount: z.int().nonnegative().meta({ description: '自连接建立以来收到的 ping 次数' }),
  pongCount: z.int().nonnegative().meta({ description: '自连接建立以来成功写出的 pong 次数' }),
  failedCount: z.int().nonnegative(),
  lastPingAt: z.number().nullable(),
  lastPongAt: z.number().nullable(),
  lastFailureAt: z.number().nullable(),
}).meta({ id: 'MonitorWsHeartbeat' });

export type MonitorWsHeartbeat = z.infer<typeof monitorWsHeartbeatSchema>;

export const monitorWsNodeSchema = z.object({
  nodeId: z.string(),
  connections: z.int(),
  users: z.int(),
  sent: z.int(),
  recv: z.int(),
}).meta({ id: 'MonitorWsNode' });

export type MonitorWsNode = z.infer<typeof monitorWsNodeSchema>;

export const monitorWsTopicSchema = z.object({
  topic: z.string(),
  messages: z.int(),
  bytes: z.int(),
}).meta({ id: 'MonitorWsTopic' });

export type MonitorWsTopic = z.infer<typeof monitorWsTopicSchema>;

/**
 * Redis 扇出在单个节点上的投递画像。
 *
 * 跨进程推送是 at-most-once：订阅降级（`degraded`）期间发出的信封不会补发，
 * 发布方也无法得知对端是否收到，因此每个节点的订阅状态与丢弃计数是「跨节点丢消息」
 * 唯一可观测的痕迹。计数是进程级累计值，进程重启后归零（与累计收发同样会回退）。
 */
export const monitorWsFanoutNodeSchema = z.object({
  nodeId: z.string(),
  state: z.enum(['idle', 'subscribed', 'degraded']).meta({ description: '本进程到扇出频道的订阅状态' }),
  published: z.int().meta({ description: '本进程发布的扇出信封数（含本进程自己跳过的那一封）' }),
  publishFailed: z.int().meta({ description: '发布失败数（Redis 不可用等），对应本次推送其他进程收不到' }),
  delivered: z.int().meta({ description: '本进程收到并成功投递的远端信封数' }),
  dropped: z.int().meta({ description: '本进程丢弃的远端信封数（畸形 / 无处理器 / 处理器异常）' }),
}).meta({ id: 'MonitorWsFanoutNode' });

export type MonitorWsFanoutNode = z.infer<typeof monitorWsFanoutNodeSchema>;

export const monitorWsFanoutSchema = z.object({
  published: z.int(),
  publishFailed: z.int(),
  delivered: z.int(),
  dropped: z.int(),
  subscribedNodes: z.int().meta({ description: '订阅正常的节点数' }),
  degradedNodes: z.int().meta({ description: '订阅降级的节点数；大于 0 时跨进程推送正在丢失' }),
  nodes: z.array(monitorWsFanoutNodeSchema).meta({ description: '集群内各节点的扇出画像（含本进程）' }),
}).meta({ id: 'MonitorWsFanout' });

export type MonitorWsFanout = z.infer<typeof monitorWsFanoutSchema>;

/** 按租户聚合的连接态与累计收发，由可见范围内的连接明细现算 */
export const monitorWsTenantSchema = z.object({
  tenantId: z.int().nullable().meta({ description: '租户 ID；为空表示平台侧用户' }),
  tenantName: z.string().nullable().meta({ description: '租户名称；平台侧为空' }),
  connections: z.int(),
  users: z.int(),
  sent: z.int(),
  recv: z.int(),
  idle: z.int().meta({ description: '其中空闲连接数（最后活动超过 120 秒）' }),
}).meta({ id: 'MonitorWsTenant' });

export type MonitorWsTenant = z.infer<typeof monitorWsTenantSchema>;

export const monitorWsMetricsSchema = z.object({
  currentConnections: z.int().meta({ description: '当前连接数（受租户可见范围约束）' }),
  currentUsers: z.int().meta({ description: '当前在线用户数（受租户可见范围约束）' }),
  totalConnects: z.int().meta({ description: '平台级累计连接次数，跨进程求和；无按用户历史，不随可见范围过滤' }),
  totalDisconnects: z.int().meta({ description: '平台级累计断开次数，跨进程求和；不随可见范围过滤' }),
  totalSent: z.int().meta({ description: '平台级累计发送消息数，跨进程求和；不随可见范围过滤（节点重启后计数归零，该值会回退）' }),
  totalRecv: z.int().meta({ description: '平台级累计接收消息数，跨进程求和；不随可见范围过滤（节点重启后计数归零，该值会回退）' }),
  messages: z.array(monitorWsMessageSchema).meta({ description: '独立保留最近 200 条非心跳业务消息元数据，受限视角只含可见用户消息，不含业务载荷' }),
  controlMessages: z.array(monitorWsMessageSchema).meta({ description: '独立保留最近 100 条 ping / pong 元数据，受限视角只含可见用户消息' }),
  exceptionMessages: z.array(monitorWsMessageSchema).meta({ description: '独立保留最近 100 条解析 / 写出异常，包括失败心跳，受限视角只含可见用户消息' }),
  heartbeats: z.array(monitorWsHeartbeatSchema).meta({ description: '在线连接的累计心跳摘要，受限视角只含可见用户连接' }),
  nodes: z.array(monitorWsNodeSchema).meta({ description: '按网关节点聚合的连接 / 收发统计，由可见明细现算' }),
  topics: z.array(monitorWsTopicSchema).meta({ description: '按 Topic 聚合的采样消息数与字节数，由可见明细现算' }),
  connections: z.array(monitorWsConnectionSchema).meta({ description: '在线连接明细，受限视角只含可见用户的连接' }),
  recentDisconnects: z.array(monitorWsDisconnectSchema).meta({ description: '最近断开记录，受限视角只含可见用户的记录' }),
  tenants: z.array(monitorWsTenantSchema).meta({ description: '按租户聚合的连接态与收发，由可见明细现算，按连接数降序；平台级用户归入 tenantId 为空的一项' }),
  fanout: monitorWsFanoutSchema.meta({ description: '平台级 Redis 扇出投递统计，不随可见范围过滤' }),
}).meta({ id: 'MonitorWsMetrics' });

export type MonitorWsMetrics = z.infer<typeof monitorWsMetricsSchema>;

/**
 * WebSocket 趋势点（每个采样 tick 一帧，10 秒/点）。
 *
 * 口径混用是刻意为之，别把两类字段混同：
 * - `connections` / `users` / `idle` 是瞬时值（该帧采样时刻的在线态）；
 * - `connects` / `disconnects` / `sent` / `recv` 是**本采样周期的增量**（相邻两帧计数器之差），
 *   进程重启导致计数器回退时该帧直接丢弃，不产生负值；
 * - `failed` 是采样窗口（最近 200 条）内的失败条数，不是周期增量——失败明细没有累计计数器可差分。
 */
export const monitorWsTrendPointSchema = z.object({
  t: z.number().meta({ description: '采样时间戳（毫秒）' }),
  connections: z.int().meta({ description: '当前连接数（瞬时值）' }),
  users: z.int().meta({ description: '当前在线用户数（瞬时值）' }),
  idle: z.int().meta({ description: '空闲连接数（最后活动超过 120 秒，瞬时值）' }),
  connects: z.int().meta({ description: '本周期新建连接数（增量）' }),
  disconnects: z.int().meta({ description: '本周期断开连接数（增量）' }),
  sent: z.int().meta({ description: '本周期发送消息数（增量）' }),
  recv: z.int().meta({ description: '本周期接收消息数（增量）' }),
  failed: z.int().meta({ description: '采样窗口内失败消息数（非增量）' }),
}).meta({ id: 'MonitorWsTrendPoint' });

export type MonitorWsTrendPoint = z.infer<typeof monitorWsTrendPointSchema>;

export const monitorWsTrendSchema = z.object({
  intervalSec: z.int().meta({ description: '采样间隔（秒）' }),
  capacity: z.int().meta({ description: '环形缓冲容量（点数）' }),
  points: z.array(monitorWsTrendPointSchema).meta({ description: '按时间升序的趋势点；服务启动初期不足容量' }),
}).meta({ id: 'MonitorWsTrend' });

export type MonitorWsTrend = z.infer<typeof monitorWsTrendSchema>;

/**
 * 持久化趋势的历史分桶点（每桶一行，时间升序）。
 * 与实时点同名字段同口径，但聚合方式不同：瞬时列取桶内末值，增量列为桶内之和，
 * 失败列取桶内峰值 —— 因此长窗口上不能用「增量 ÷ intervalSec」算速率，要用 `bucketSec`。
 */
export const monitorWsTrendHistoryPointSchema = z.object({
  t: z.string().meta({ description: '分桶起始时间（服务端本地时间字符串）' }),
  connections: z.int().meta({ description: '桶内末值：当前连接数' }),
  users: z.int().meta({ description: '桶内末值：在线用户数' }),
  idle: z.int().meta({ description: '桶内末值：空闲连接数' }),
  connects: z.int().meta({ description: '桶内新建连接数合计' }),
  disconnects: z.int().meta({ description: '桶内断开连接数合计' }),
  sent: z.int().meta({ description: '桶内发送消息数合计' }),
  recv: z.int().meta({ description: '桶内接收消息数合计' }),
  failed: z.int().meta({ description: '桶内失败消息数峰值' }),
}).meta({ id: 'MonitorWsTrendHistoryPoint' });

export type MonitorWsTrendHistoryPoint = z.infer<typeof monitorWsTrendHistoryPointSchema>;

export const monitorWsTrendHistorySchema = z.object({
  range: z.string(),
  bucketSec: z.int().meta({ description: '分桶秒数；换算速率时分母用它而不是实时采样的 intervalSec' }),
  points: z.array(monitorWsTrendHistoryPointSchema),
}).meta({ id: 'MonitorWsTrendHistory' });

export type MonitorWsTrendHistory = z.infer<typeof monitorWsTrendHistorySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const monitorContract = defineContract('/api/monitor', {
  snapshot: op.get('/', { access: { permission: 'system:monitor:view' }, response: monitorSnapshotSchema, summary: '获取服务器监控信息' }),
  timeseries: op.get('/timeseries', { access: { permission: 'system:monitor:view' }, response: monitorTimeseriesSchema, summary: '获取最近 1h 监控时序数据' }),
  history: op.get('/history', { access: { permission: 'system:monitor:view' }, query: monitorHistoryQuerySchema, response: monitorHistorySchema, summary: '获取持久化历史监控趋势（按时间范围分桶聚合）' }),
  ws: op.get('/ws', {
    access: { permission: 'system:monitor:view' },
    response: monitorWsMetricsSchema,
    summary: '获取 WebSocket 实时连接监控',
    description: '可见范围与「在线用户」页一致：平台管理员在平台视角看全部，切到租户视角或非平台管理员只看本租户，且看不到绑定平台超管角色用户的连接；累计计数器为平台级，不受该范围约束。',
  }),
  wsTrend: op.get('/ws/trend', {
    access: { permission: 'system:monitor:view' },
    response: monitorWsTrendSchema,
    summary: '获取 WebSocket 连接趋势（最近 1 小时，10 秒/点）',
    description: '来自 api 进程的采样 tick（与系统指标采样器同一节拍），读的是进程内环形缓冲，'
      + '进程重启后重新累积；需要跨重启回溯请用 wsTrendHistory。'
      + '连接数 / 在线用户 / 空闲连接为瞬时值，连接、断开、收发为周期增量，失败为采样窗口口径；'
      + '计数器回退（节点重启）时丢弃该帧，因此趋势中不出现负值，但会出现断点。',
  }),
  wsTrendHistory: op.get('/ws/trend/history', {
    access: { permission: 'system:monitor:view' },
    query: monitorHistoryQuerySchema,
    response: monitorWsTrendHistorySchema,
    summary: '获取 WebSocket 连接趋势的持久化历史（按时间范围分桶聚合）',
    description: '数据来自每分钟落库的 ws_metric_samples：瞬时列取桶内末值、增量列取桶内之和、'
      + '失败列取桶内峰值，分桶窗口与系统指标历史一致；最长可回看 7 天，更早的采样由数据保留策略清理。',
  }),
  stream: op.get('/stream', {
    access: { permission: 'system:monitor:view' },
    kind: 'sse',
    response: z.string(),
    summary: '实时推送监控指标（SSE）',
    description: '首帧推送完整快照（metrics）+ 全量时序（series）+ WS 指标（ws）；后续每个采样 tick 推送差量 patch（metrics:diff）、最新时序点（series:point）与 WS 指标全量（ws）。',
  }),
}, { tags: ['Monitor'] });
