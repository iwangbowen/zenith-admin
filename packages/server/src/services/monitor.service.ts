import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import redis from '../lib/redis';
import logger from '../lib/logger';
import { metricsSampler } from '../lib/metrics-sampler';

const execFileAsync = promisify(execFile);

// ─── 慢指标缓存（DB / Redis / 磁盘） ─────────────────────────────────
const SLOW_TTL_MS = 10_000;
type CacheEntry<T> = { at: number; value: T };
const cache: { db?: CacheEntry<DbInfo | null>; redis?: CacheEntry<RedisInfo | null>; disk?: CacheEntry<DiskInfo | null> } = {};

function fresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
  if (entry && Date.now() - entry.at < SLOW_TTL_MS) return entry.value;
  return undefined;
}

// ─── 类型 ─────────────────────────────────────────────────────────────
interface DiskInfo { total: number; used: number; free: number; mount: string }

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

// ─── 磁盘信息（异步、非阻塞） ──────────────────────────────────────────
export async function getDiskInfo(): Promise<DiskInfo | null> {
  const cached = fresh(cache.disk);
  if (cached !== undefined) return cached;
  try {
    let info: DiskInfo | null = null;
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-PSDrive C | Format-List Used,Free'],
        { timeout: 5000 },
      );
      const usedMatch = /Used\s*:\s*(\d+)/.exec(stdout);
      const freeMatch = /Free\s*:\s*(\d+)/.exec(stdout);
      if (usedMatch && freeMatch) {
        const used = Number.parseInt(usedMatch[1], 10);
        const free = Number.parseInt(freeMatch[1], 10);
        info = { total: used + free, used, free, mount: 'C:' };
      }
    } else {
      const { stdout } = await execFileAsync('df', ['-B1', '/'], { timeout: 3000 });
      const lines = stdout.trim().split('\n');
      const last = lines.at(-1);
      if (lines.length >= 2 && last) {
        const parts = last.trim().split(/\s+/);
        if (parts.length >= 6) {
          const total = Number.parseInt(parts[1], 10);
          const used = Number.parseInt(parts[2], 10);
          const free = Number.parseInt(parts[3], 10);
          info = { total, used, free, mount: parts[5] };
        }
      }
    }
    cache.disk = { at: Date.now(), value: info };
    return info;
  } catch (err) {
    logger.warn('[monitor] getDiskInfo failed', { err: String(err) });
    cache.disk = { at: Date.now(), value: null };
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

// ─── 主入口 ────────────────────────────────────────────────────────────
export async function getMonitorStatus() {
  const [dbInfo, redisInfo, disk] = await Promise.all([getDbInfo(), getRedisInfo(), getDiskInfo()]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const sample = metricsSampler.getLatest();
  const cpuUsage = sample?.cpu ?? 0;
  const procCpu = sample?.procCpu ?? 0;

  const httpWindow = metricsSampler.http.windowStats();
  const httpPercentiles = metricsSampler.http.percentiles();
  const httpTotals = metricsSampler.http.totals();

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
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 100),
    },
    disk: disk
      ? {
          total: disk.total,
          used: disk.used,
          free: disk.free,
          usagePercent: Math.round((disk.used / disk.total) * 100),
          mount: disk.mount,
        }
      : null,
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
