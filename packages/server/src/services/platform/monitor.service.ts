import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../../db';
import { sql, inArray } from 'drizzle-orm';
import { users } from '../../db/schema';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { metricsSampler } from '../../lib/metrics-sampler';
import { getWsSnapshot } from '../../lib/ws-manager';
import { listProcesses } from '../ops/processes.service';

const execFileAsync = promisify(execFile);

// ─── 慢指标缓存（DB / Redis / 磁盘） ─────────────────────────────────
const SLOW_TTL_MS = 10_000;
type CacheEntry<T> = { at: number; value: T };
const cache: {
  db?: CacheEntry<DbInfo | null>;
  redis?: CacheEntry<RedisInfo | null>;
  disks?: CacheEntry<DiskInfo[] | null>;
  meminfo?: CacheEntry<LinuxMemInfo | null>;
  topProcs?: CacheEntry<TopProcesses | null>;
  temperature?: CacheEntry<TemperatureInfo | null>;
} = {};

function fresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
  if (entry && Date.now() - entry.at < SLOW_TTL_MS) return entry.value;
  return undefined;
}

// ─── 类型 ──────────────────────────────────────────
export interface DiskInfo {
  filesystem: string;
  total: number;
  used: number;
  free: number;
  usagePercent: number;
  mount: string;
}

export interface TopProcessItem {
  pid: number;
  name: string;
  cpu: number;
  memPercent: number;
  memBytes: number;
}

export interface TopProcesses {
  byCpu: TopProcessItem[];
  byMemory: TopProcessItem[];
}

export interface TemperatureSensor {
  label: string;
  celsius: number;
}

export interface TemperatureInfo {
  cpu: number | null;
  sensors: TemperatureSensor[];
}

/** Linux /proc/meminfo 中有意义的字段，单位：字节 */
export interface LinuxMemInfo {
  memTotal: number;
  memFree: number;
  memAvailable: number;
  buffers: number;
  cached: number;
  shared: number;
  swapTotal: number;
  swapFree: number;
  swapCached: number;
  swapUsagePercent: number;
  dirty: number;
  writeback: number;
}

interface DbConnectionStateBreakdown {
  active: number;
  idle: number;
  idleInTransaction: number;
  other: number;
}
interface DbCacheHit { blksHit: number; blksRead: number; ratio: number }
interface DbTxStats { commit: number; rollback: number; deadlocks: number; tempBytes: number }
export interface DbSlowQuery { query: string; calls: number; meanMs: number; totalMs: number }
export interface DbInfo {
  name: string;
  size: number;
  activeConnections: number;
  totalConnections: number;
  tableCount: number;
  connectionStates: DbConnectionStateBreakdown;
  cacheHit: DbCacheHit;
  transactions: DbTxStats;
  slowQueries: DbSlowQuery[] | null;
  slowQueriesAvailable: boolean;
}

export interface RedisSlowEntry { id: number; timestamp: number; durationMs: number; command: string }
export interface RedisInfo {
  version: string;
  uptimeSeconds: number;
  connectedClients: number;
  blockedClients: number;
  rejectedConnections: number;
  usedMemory: number;
  usedMemoryHuman: string;
  usedMemoryRss: number;
  memFragmentationRatio: number;
  maxMemory: number;
  maxMemoryPolicy: string;
  totalCommandsProcessed: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  keyCount: number;
  role: string;
  rdbLastSaveTime: number;
  rdbChangesSinceLastSave: number;
  aofEnabled: boolean;
  masterLinkStatus: string | null;
  slowLog: RedisSlowEntry[];
}

// ─── 磁盘信息（多挂载点，异步、非阻塞） ──────────────────────────────
const DISK_FS_BLACKLIST = new Set([
  'tmpfs', 'devtmpfs', 'devpts', 'sysfs', 'proc', 'cgroup', 'cgroup2',
  'pstore', 'bpf', 'mqueue', 'debugfs', 'tracefs', 'configfs',
  'fusectl', 'hugetlbfs', 'rpc_pipefs', 'autofs', 'binfmt_misc',
  'overlay', 'squashfs', 'fuse.snapfuse', 'fuse.lxcfs',
]);

function shouldSkipMount(mount: string, fsType: string): boolean {
  if (DISK_FS_BLACKLIST.has(fsType)) return true;
  if (mount.startsWith('/snap/') || mount.startsWith('/var/lib/docker/')
    || mount.startsWith('/run/') || mount.startsWith('/sys/')
    || mount.startsWith('/proc/') || mount.startsWith('/dev/')
    || mount.startsWith('/boot/efi')) return true;
  return false;
}

export async function getDisks(): Promise<DiskInfo[] | null> {
  const cached = fresh(cache.disks);
  if (cached !== undefined) return cached;
  try {
    const disks: DiskInfo[] = [];
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile', '-NonInteractive', '-Command',
          "Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | Select-Object Name,Used,Free | ConvertTo-Json -Compress",
        ],
        { timeout: 5000 },
      );
      const parsed: unknown = JSON.parse(stdout || '[]');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const itRaw of arr) {
        const it = itRaw as { Name?: string; Used?: number | string; Free?: number | string };
        const used = Number(it.Used ?? 0);
        const free = Number(it.Free ?? 0);
        const total = used + free;
        if (total <= 0) continue;
        disks.push({
          filesystem: `${it.Name ?? ''}:`,
          total,
          used,
          free,
          usagePercent: Math.round((used / total) * 100),
          mount: `${it.Name ?? ''}:`,
        });
      }
    } else {
      const { stdout } = await execFileAsync('df', ['-PB1', '-T'], { timeout: 5000 });
      const lines = stdout.trim().split('\n').slice(1);
      const seen = new Set<string>();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 7) continue;
        const filesystem = parts[0];
        const fsType = parts[1];
        const total = Number.parseInt(parts[2], 10);
        const used = Number.parseInt(parts[3], 10);
        const free = Number.parseInt(parts[4], 10);
        const mount = parts.slice(6).join(' ');
        if (!Number.isFinite(total) || total <= 0) continue;
        if (shouldSkipMount(mount, fsType)) continue;
        const key = `${filesystem}|${mount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        disks.push({
          filesystem,
          total,
          used,
          free,
          usagePercent: Math.round((used / total) * 100),
          mount,
        });
      }
      disks.sort((a, b) => b.total - a.total);
    }
    cache.disks = { at: Date.now(), value: disks };
    return disks;
  } catch (err) {
    logger.warn('[monitor] getDisks failed', { err: String(err) });
    cache.disks = { at: Date.now(), value: null };
    return null;
  }
}

// ─── Linux meminfo（其他平台返回 null） ────────────────────────
export async function getLinuxMemInfo(): Promise<LinuxMemInfo | null> {
  if (process.platform !== 'linux') return null;
  const cached = fresh(cache.meminfo);
  if (cached !== undefined) return cached;
  try {
    const text = await fs.readFile('/proc/meminfo', 'utf8');
    const map: Record<string, number> = {};
    for (const line of text.split('\n')) {
      const m = /^(\w+):\s+(\d+)\s*kB/.exec(line);
      if (m) map[m[1]] = Number(m[2]) * 1024;
    }
    const swapTotal = map.SwapTotal ?? 0;
    const swapFree = map.SwapFree ?? 0;
    const value: LinuxMemInfo = {
      memTotal: map.MemTotal ?? 0,
      memFree: map.MemFree ?? 0,
      memAvailable: map.MemAvailable ?? 0,
      buffers: map.Buffers ?? 0,
      cached: map.Cached ?? 0,
      shared: map.Shmem ?? 0,
      swapTotal,
      swapFree,
      swapCached: map.SwapCached ?? 0,
      swapUsagePercent: swapTotal > 0 ? Math.round(((swapTotal - swapFree) / swapTotal) * 100) : 0,
      dirty: map.Dirty ?? 0,
      writeback: map.Writeback ?? 0,
    };
    cache.meminfo = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn('[monitor] getLinuxMemInfo failed', { err: String(err) });
    cache.meminfo = { at: Date.now(), value: null };
    return null;
  }
}

// ─── Redis ──────────────────────────────────────────────────────────────
export function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of info.split('\r\n')) {
    if (line && !line.startsWith('#')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        result[line.slice(0, colonIdx)] = line.slice(colonIdx + 1);
      }
    }
  }
  return result;
}

export async function getRedisInfo(): Promise<RedisInfo | null> {
  const cached = fresh(cache.redis);
  if (cached !== undefined) return cached;
  try {
    const [infoStr, dbSize, slowRaw] = await Promise.all([
      redis.info(),
      redis.dbsize(),
      redis.slowlog('GET', 10).catch(() => []),
    ]);
    const info = parseRedisInfo(infoStr);
    const slowLog: RedisSlowEntry[] = Array.isArray(slowRaw)
      ? (slowRaw as Array<[number, number, number, string[]]>).map((entry) => ({
          id: Number(entry[0] ?? 0),
          timestamp: Number(entry[1] ?? 0),
          durationMs: Math.round((Number(entry[2] ?? 0) / 1000) * 100) / 100,
          command: Array.isArray(entry[3]) ? entry[3].join(' ') : String(entry[3] ?? ''),
        }))
      : [];
    const value: RedisInfo = {
      version: info.redis_version ?? 'Unknown',
      uptimeSeconds: Number(info.uptime_in_seconds ?? 0),
      connectedClients: Number(info.connected_clients ?? 0),
      blockedClients: Number(info.blocked_clients ?? 0),
      rejectedConnections: Number(info.rejected_connections ?? 0),
      usedMemory: Number(info.used_memory ?? 0),
      usedMemoryHuman: info.used_memory_human ?? '',
      usedMemoryRss: Number(info.used_memory_rss ?? 0),
      memFragmentationRatio: Number(info.mem_fragmentation_ratio ?? 0),
      maxMemory: Number(info.maxmemory ?? 0),
      maxMemoryPolicy: info.maxmemory_policy ?? 'noeviction',
      totalCommandsProcessed: Number(info.total_commands_processed ?? 0),
      keyspaceHits: Number(info.keyspace_hits ?? 0),
      keyspaceMisses: Number(info.keyspace_misses ?? 0),
      keyCount: dbSize,
      role: info.role ?? 'Unknown',
      rdbLastSaveTime: Number(info.rdb_last_save_time ?? 0),
      rdbChangesSinceLastSave: Number(info.rdb_changes_since_last_save ?? 0),
      aofEnabled: info.aof_enabled === '1',
      masterLinkStatus: info.master_link_status ?? null,
      slowLog,
    };
    cache.redis = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn('[monitor] getRedisInfo failed', { err: String(err) });
    cache.redis = { at: Date.now(), value: null };
    return null;
  }
}

// ─── 数据库 ────────────────────────────────────────────────────────────
export async function getDbInfo(): Promise<DbInfo | null> {
  const cached = fresh(cache.db);
  if (cached !== undefined) return cached;
  try {
    const [meta, stateRows, tableRow, statRow] = await Promise.all([
      db.execute(sql`
        SELECT pg_database_size(current_database()) AS size,
               current_database() AS name
      `),
      db.execute(sql`
        SELECT state, count(*)::int AS c
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state
      `),
      db.execute(sql`
        SELECT count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `),
      db.execute(sql`
        SELECT blks_hit::bigint AS blks_hit,
               blks_read::bigint AS blks_read,
               xact_commit::bigint AS xact_commit,
               xact_rollback::bigint AS xact_rollback,
               deadlocks::bigint AS deadlocks,
               temp_bytes::bigint AS temp_bytes
        FROM pg_stat_database
        WHERE datname = current_database()
      `),
    ]);

    const states: DbConnectionStateBreakdown = { active: 0, idle: 0, idleInTransaction: 0, other: 0 };
    let totalConn = 0;
    for (const row of stateRows as unknown as Array<{ state: string | null; c: number | string }>) {
      const c = Number(row.c);
      totalConn += c;
      switch (row.state) {
        case 'active': states.active += c; break;
        case 'idle': states.idle += c; break;
        case 'idle in transaction':
        case 'idle in transaction (aborted)':
          states.idleInTransaction += c; break;
        default: states.other += c; break;
      }
    }

    const m = (meta as unknown as Array<{ size: string | number; name: string }>)[0];
    const t = (tableRow as unknown as Array<{ count: string | number }>)[0];
    const s = (statRow as unknown as Array<Record<string, string | number>>)[0] ?? {};
    const blksHit = Number(s.blks_hit ?? 0);
    const blksRead = Number(s.blks_read ?? 0);
    const totalBlks = blksHit + blksRead;

    const slowQueries = await getSlowQueries();
    const value: DbInfo = {
      name: m?.name ?? 'Unknown',
      size: Number(m?.size ?? 0),
      activeConnections: states.active,
      totalConnections: totalConn,
      tableCount: Number(t?.count ?? 0),
      connectionStates: states,
      cacheHit: {
        blksHit,
        blksRead,
        ratio: totalBlks > 0 ? Math.round((blksHit / totalBlks) * 10000) / 100 : 0,
      },
      transactions: {
        commit: Number(s.xact_commit ?? 0),
        rollback: Number(s.xact_rollback ?? 0),
        deadlocks: Number(s.deadlocks ?? 0),
        tempBytes: Number(s.temp_bytes ?? 0),
      },
      slowQueries,
      slowQueriesAvailable: slowQueries !== null,
    };
    cache.db = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn('[monitor] getDbInfo failed', { err: String(err) });
    cache.db = { at: Date.now(), value: null };
    return null;
  }
}

/**
 * 慢查询 Top 5（依赖 pg_stat_statements 扩展）。
 * 未安装扩展时返回 null（前端展示「需启用 pg_stat_statements 扩展」）。
 */
async function getSlowQueries(): Promise<DbSlowQuery[] | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT query,
             calls::bigint AS calls,
             mean_exec_time::float AS mean_ms,
             total_exec_time::float AS total_ms
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY mean_exec_time DESC
      LIMIT 5
    `)) as unknown as Array<{ query: string; calls: number | string; mean_ms: number | string; total_ms: number | string }>;
    return rows.map((r) => ({
      query: typeof r.query === 'string' ? r.query.slice(0, 500) : String(r.query),
      calls: Number(r.calls ?? 0),
      meanMs: Math.round(Number(r.mean_ms ?? 0) * 100) / 100,
      totalMs: Math.round(Number(r.total_ms ?? 0) * 100) / 100,
    }));
  } catch {
    return null;
  }
}

// ─── Top 进程（按 CPU / 内存）─────────────────────────────────────────
export async function getTopProcesses(limit = 5): Promise<TopProcesses | null> {
  const cached = fresh(cache.topProcs);
  if (cached !== undefined) return cached;
  try {
    const { processes } = await listProcesses();
    const map = (p: typeof processes[number]): TopProcessItem => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round((p.cpu ?? 0) * 10) / 10,
      memPercent: Math.round((p.memoryPercent ?? 0) * 10) / 10,
      memBytes: Math.round(p.memory ?? 0),
    });
    const byCpu = [...processes].sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)).slice(0, limit).map(map);
    const byMemory = [...processes].sort((a, b) => (b.memory ?? 0) - (a.memory ?? 0)).slice(0, limit).map(map);
    const result: TopProcesses = { byCpu, byMemory };
    cache.topProcs = { at: Date.now(), value: result };
    return result;
  } catch (err) {
    logger.warn('[monitor] getTopProcesses failed', { err: String(err) });
    cache.topProcs = { at: Date.now(), value: null };
    return null;
  }
}

// ─── CPU 温度（Linux /sys/class/thermal；其他平台返回 null）────────────
export async function getCpuTemperature(): Promise<TemperatureInfo | null> {
  const cached = fresh(cache.temperature);
  if (cached !== undefined) return cached;
  if (process.platform !== 'linux') {
    cache.temperature = { at: Date.now(), value: null };
    return null;
  }
  try {
    const base = '/sys/class/thermal';
    const zones = await fs.readdir(base).catch(() => [] as string[]);
    const sensors: TemperatureSensor[] = [];
    for (const zone of zones) {
      if (!zone.startsWith('thermal_zone')) continue;
      const [tempRaw, typeRaw] = await Promise.all([
        fs.readFile(`${base}/${zone}/temp`, 'utf8').catch(() => ''),
        fs.readFile(`${base}/${zone}/type`, 'utf8').catch(() => zone),
      ]);
      const milli = Number.parseInt(tempRaw.trim(), 10);
      if (!Number.isFinite(milli)) continue;
      sensors.push({ label: typeRaw.trim() || zone, celsius: Math.round((milli / 1000) * 10) / 10 });
    }
    // CPU 温度：优先匹配 x86_pkg_temp / coretemp / cpu，否则取最高传感器
    const cpuSensor = sensors.find((s) => /pkg|core|cpu|k10temp|soc/i.test(s.label));
    const cpu = cpuSensor?.celsius ?? (sensors.length > 0 ? Math.max(...sensors.map((s) => s.celsius)) : null);
    const result: TemperatureInfo = { cpu, sensors };
    cache.temperature = { at: Date.now(), value: result };
    return result;
  } catch (err) {
    logger.warn('[monitor] getCpuTemperature failed', { err: String(err) });
    cache.temperature = { at: Date.now(), value: null };
    return null;
  }
}

// ─── 主入口 ────────────────────────────────────────────────────────────
export async function getMonitorStatus() {
  const [dbInfo, redisInfo, disks, memInfo, topProcesses, temperature] = await Promise.all([
    getDbInfo(),
    getRedisInfo(),
    getDisks(),
    getLinuxMemInfo(),
    getTopProcesses(),
    getCpuTemperature(),
  ]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const sample = metricsSampler.getLatest();
  const cpuUsage = sample?.cpu ?? 0;
  const procCpu = sample?.procCpu ?? 0;
  const perCore = metricsSampler.getPerCore();
  const network = metricsSampler.getNetwork();

  const httpWindow = metricsSampler.http.windowStats();
  const httpPercentiles = metricsSampler.http.percentiles();
  const httpTotals = metricsSampler.http.totals();

  // 以"总容量最大"那个磁盘作为兜底"主磁盘"字段，保证总览进度条仍可用
  const primaryDisk = disks && disks.length > 0 ? disks[0] : null;

  return {
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(os.uptime()),
    },
    cpu: {
      model: cpus[0]?.model ?? 'Unknown',
      cores: cpus.length,
      speed: cpus[0]?.speed ?? 0,
      loadAvg: os.loadavg(),
      usage: cpuUsage,
      perCore,
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 100),
      detail: memInfo,
    },
    disk: primaryDisk
      ? {
          total: primaryDisk.total,
          used: primaryDisk.used,
          free: primaryDisk.free,
          usagePercent: primaryDisk.usagePercent,
          mount: primaryDisk.mount,
        }
      : null,
    disks: disks ?? [],
    diskIo: metricsSampler.getDiskIo(),
    network,
    topProcesses,
    temperature,
    node: {
      version: process.version,
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      cpuUsagePercent: procCpu,
      eventLoop: metricsSampler.eventLoopStats(),
      gc: metricsSampler.gcStats(),
      heapSpaces: metricsSampler.heapSpaces(),
      resourceUsage: metricsSampler.resourceUsage(),
    },
    http: {
      ...httpWindow,
      ...httpPercentiles,
      ...httpTotals,
      currentQps: metricsSampler.http.currentQps(),
    },
    database: dbInfo,
    redis: redisInfo,
  };
}

/**
 * 时序数据：返回采样器中的环形缓冲（默认最近 1h）。
 */
export function getMonitorTimeseries() {
  const series = metricsSampler.getSeries();
  return {
    intervalSec: 10,
    capacity: 360,
    points: series,
  };
}

/**
 * WebSocket 监控数据：返回当前所有 WS 连接、累计统计和最近断开记录。
 * 自动关联 users 表查询用户昵称。
 */
export async function getWsMetrics() {
  const snap = getWsSnapshot();
  const userIds = new Set<number>();
  for (const c of snap.connections) userIds.add(c.userId);
  for (const d of snap.recentDisconnects) userIds.add(d.userId);
  const userMap = new Map<number, { username: string | null; nickname: string | null }>();
  if (userIds.size > 0) {
    const rows = await db
      .select({ id: users.id, username: users.username, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, [...userIds]));
    for (const r of rows) userMap.set(r.id, { username: r.username ?? null, nickname: r.nickname ?? null });
  }
  return {
    currentConnections: snap.currentConnections,
    currentUsers: snap.currentUsers,
    totalConnects: snap.totalConnects,
    totalDisconnects: snap.totalDisconnects,
    totalSent: snap.totalSent,
    totalRecv: snap.totalRecv,
    connections: snap.connections.map((c) => ({
      ...c,
      username: userMap.get(c.userId)?.username ?? null,
      nickname: userMap.get(c.userId)?.nickname ?? null,
    })),
    recentDisconnects: snap.recentDisconnects.map((d) => ({
      ...d,
      username: userMap.get(d.userId)?.username ?? null,
      nickname: userMap.get(d.userId)?.nickname ?? null,
    })),
  };
}

// ─── 外部慢指标采集器（DB / Redis 时序） ─────────────────────────────
/**
 * 注册轻量 DB / Redis 指标采集器到 metricsSampler：
 * 每个采样 tick 异步执行一次（pg_stat_activity 计数 + redis INFO 两个 section），
 * 结果并入下一帧时序点。Redis 命中率使用两次采样间的 delta（窗口命中率）。
 */
export function registerMonitorExtCollector(): void {
  let lastHits = 0;
  let lastMisses = 0;
  let primed = false;
  metricsSampler.registerExtCollector(async () => {
    const [connRows, redisInfoRaw] = await Promise.all([
      db.execute(sql`SELECT count(*)::int AS c FROM pg_stat_activity WHERE datname = current_database()`)
        .catch(() => null),
      redis.info().catch(() => null),
    ]);
    const dbConnections = connRows
      ? Number((connRows as unknown as Array<{ c: number | string }>)[0]?.c ?? 0)
      : 0;
    let redisMemBytes = 0;
    let redisHitRate = 0;
    if (redisInfoRaw) {
      const info: Record<string, string> = {};
      for (const line of redisInfoRaw.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) info[line.slice(0, idx)] = line.slice(idx + 1).trim();
      }
      redisMemBytes = Number(info.used_memory ?? 0);
      const hits = Number(info.keyspace_hits ?? 0);
      const misses = Number(info.keyspace_misses ?? 0);
      if (primed) {
        const dh = Math.max(0, hits - lastHits);
        const dm = Math.max(0, misses - lastMisses);
        redisHitRate = dh + dm > 0 ? Math.round((dh / (dh + dm)) * 1000) / 10 : 100;
      }
      lastHits = hits;
      lastMisses = misses;
      primed = true;
    }
    return { dbConnections, redisMemBytes, redisHitRate };
  });
}
