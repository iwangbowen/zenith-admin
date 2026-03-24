import { Hono } from 'hono';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import redis from '../lib/redis';

const monitorRouter = new Hono();

monitorRouter.use('*', authMiddleware);

function getCpuUsage(): Promise<number> {
  return new Promise((resolve) => {
    const cpus1 = os.cpus();
    setTimeout(() => {
      const cpus2 = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      for (let i = 0; i < cpus1.length; i++) {
        const cpu1 = cpus1[i];
        const cpu2 = cpus2[i];
        for (const type in cpu2.times) {
          const t = type as keyof typeof cpu2.times;
          totalTick += cpu2.times[t] - cpu1.times[t];
        }
        totalIdle += cpu2.times.idle - cpu1.times.idle;
      }
      const usage = 100 - Math.round((100 * totalIdle) / totalTick);
      resolve(Math.max(0, Math.min(100, usage)));
    }, 500);
  });
}

function getDiskInfo() {
  try {
    const output = execSync('df -B1 / --output=size,used,avail 2>/dev/null || df -B1 /', { encoding: 'utf8', timeout: 3000 });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines.at(-1)!.trim().split(/\s+/);
      if (parts.length >= 3) {
        const total = Number.parseInt(parts[0], 10);
        const used = Number.parseInt(parts[1], 10);
        const free = Number.parseInt(parts[2], 10);
        return { total, used, free };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function parseRedisInfo(info: string): Record<string, string> {
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

async function getRedisInfo() {
  try {
    const [infoStr, dbSize] = await Promise.all([redis.info(), redis.dbsize()]);
    const info = parseRedisInfo(infoStr);
    return {
      version: info.redis_version ?? 'Unknown',
      uptimeSeconds: Number(info.uptime_in_seconds ?? 0),
      connectedClients: Number(info.connected_clients ?? 0),
      usedMemory: Number(info.used_memory ?? 0),
      usedMemoryHuman: info.used_memory_human ?? '',
      totalCommandsProcessed: Number(info.total_commands_processed ?? 0),
      keyspaceHits: Number(info.keyspace_hits ?? 0),
      keyspaceMisses: Number(info.keyspace_misses ?? 0),
      keyCount: dbSize,
      role: info.role ?? 'Unknown',
    };
  } catch {
    return null;
  }
}

async function getDbInfo() {
  try {
    const [dbSizeResult] = await db.execute(
      sql`SELECT pg_database_size(current_database()) AS size, current_database() AS name`
    );
    const [connResult] = await db.execute(
      sql`SELECT count(*) AS active FROM pg_stat_activity WHERE state = 'active'`
    );
    const [totalConnResult] = await db.execute(
      sql`SELECT count(*) AS total FROM pg_stat_activity`
    );
    const [tableResult] = await db.execute(
      sql`SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    return {
      name: (dbSizeResult as { name: string }).name,
      size: Number((dbSizeResult as { size: string }).size),
      activeConnections: Number((connResult as { active: string }).active),
      totalConnections: Number((totalConnResult as { total: string }).total),
      tableCount: Number((tableResult as { count: string }).count),
    };
  } catch {
    return null;
  }
}

monitorRouter.get('/', guard({ permission: 'system:monitor:view' }), async (c) => {
  const [cpuUsage, dbInfo, redisInfo] = await Promise.all([getCpuUsage(), getDbInfo(), getRedisInfo()]);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const cpus = os.cpus();

  const disk = getDiskInfo();

  const data = {
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
        }
      : null,
    node: {
      version: process.version,
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
    },
    database: dbInfo,
    redis: redisInfo,
  };

  return c.json({ code: 0, message: 'success', data });
});

export default monitorRouter;
