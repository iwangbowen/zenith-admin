/**
 * IoT 遥测明细分区维护（PostgreSQL 原生 RANGE 日分区，不依赖 pg_partman / TimescaleDB）。
 *
 * 分区口径：
 * - 命名 iot_telemetry_pYYYYMMDD，边界为 UTC 日 [00:00, 次日 00:00)，在 JS 侧计算，
 *   以带 `+00` 的 timestamptz 字面量下发，不受会话时区影响
 * - 预建：启动 + 每小时任务确保 [今天 - 1, 今天 + PARTITION_AHEAD_DAYS] 存在
 * - 按需：写入命中「无分区」错误（乱序回填、任务漏跑）时按批次内日期补建后重试
 * - 清理：保留策略按分区上界 <= cutoff 整表 DROP；写入侧丢弃早于保留窗口的点，保证 DROP 过的区间不再回填
 *
 * 建分区会短暂持有父表 ACCESS EXCLUSIVE 锁（毫秒级，仅新分区首次创建），预建策略让它极少落在写入热路径上。
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { getPgErrorCode } from '../../lib/db-errors';
import logger from '../../lib/logger';
import { getPolicyRetentionDays } from '../../lib/retention/runner';
import { TtlCache } from '../../lib/ttl-cache';

export const IOT_TELEMETRY_TABLE = 'iot_telemetry';
const PARTITION_PREFIX = `${IOT_TELEMETRY_TABLE}_p`;
/** 预建到未来几天（任务每小时跑，容忍一周不调度） */
export const PARTITION_AHEAD_DAYS = 7;
/** 保留策略关闭（0 天）时，写入侧仍拒绝早于此天数的回填，避免无界补建历史分区 */
const BACKFILL_LIMIT_WHEN_RETENTION_OFF_DAYS = 365;
const RETENTION_CACHE_TTL_MS = 5 * 60_000;

const DAY_MS = 86_400_000;

export interface IotTelemetryPartition {
  name: string;
  /** 下界（含） */
  from: Date;
  /** 上界（不含） */
  to: Date;
}

// ─── 纯函数：命名与边界 ────────────────────────────────────────────────────────
export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function iotTelemetryPartitionName(day: Date): string {
  const d = utcDayStart(day);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${PARTITION_PREFIX}${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** timestamptz 字面量（带 +00，与分区键列类型一致） */
function boundLiteral(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}+00`;
}

/** 解析 pg_get_expr(relpartbound)：FOR VALUES FROM ('2026-09-03 00:00:00+00') TO (...)；偏移随会话时区渲染 */
export function parsePartitionBound(expr: string): { from: Date; to: Date } | null {
  const m = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(expr);
  if (!m) return null;
  const from = parseTimestamptzText(m[1]);
  const to = parseTimestamptzText(m[2]);
  return from && to ? { from, to } : null;
}

/** PostgreSQL timestamptz 文本：2026-09-03 08:00:00+08 / 2026-09-03 05:30:00+05:30 */
function parseTimestamptzText(text: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 覆盖 [from, to] 闭区间的全部 UTC 日起点 */
export function utcDaysBetween(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let t = utcDayStart(from).getTime(); t <= utcDayStart(to).getTime(); t += DAY_MS) {
    days.push(new Date(t));
  }
  return days;
}

/**
 * postgres 错误：行落不到任何分区（SQLSTATE 23514 check_violation，消息固定含 no partition of relation）。
 * drizzle 会把驱动错误包成 DrizzleQueryError（原错误在 cause），消息沿 cause 链逐层看。
 */
export function isMissingIotTelemetryPartitionError(err: unknown): boolean {
  if (getPgErrorCode(err) !== '23514') return false;
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 5; depth++) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes('no partition of relation')) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ─── 建分区 ────────────────────────────────────────────────────────────────────
/** 本进程已确认存在的分区名（DROP 时移除）；避免每次写入都发 DDL */
const knownPartitions = new Set<string>();

async function createPartition(executor: DbExecutor, day: Date, recheck: boolean): Promise<boolean> {
  const name = iotTelemetryPartitionName(day);
  if (!recheck && knownPartitions.has(name)) return false;
  const from = utcDayStart(day);
  const to = new Date(from.getTime() + DAY_MS);
  try {
    const res = await executor.execute(sql`
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = ${name}
    `);
    const exists = (res as unknown as unknown[]).length > 0;
    if (!exists) {
      await executor.execute(sql.raw(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${IOT_TELEMETRY_TABLE}" `
        + `FOR VALUES FROM ('${boundLiteral(from)}') TO ('${boundLiteral(to)}')`,
      ));
    }
    knownPartitions.add(name);
    return !exists;
  } catch (err) {
    // 42P07 duplicate_table：多实例并发建同一分区，另一方已建成
    if (getPgErrorCode(err) === '42P07') {
      knownPartitions.add(name);
      return false;
    }
    throw err;
  }
}

/**
 * 确保给定时间点所属的分区存在（去重到 UTC 日）；返回本次新建数。
 * `recheck` 绕过进程内缓存重新核对目录——写入命中「无分区」错误时使用（可能被其他实例 DROP 过）。
 */
export async function ensureIotTelemetryPartitionsFor(
  dates: Date[],
  options: { executor?: DbExecutor; recheck?: boolean } = {},
): Promise<number> {
  const executor = options.executor ?? db;
  const days = new Map<number, Date>();
  for (const d of dates) {
    const start = utcDayStart(d);
    days.set(start.getTime(), start);
  }
  let created = 0;
  for (const day of [...days.values()].sort((a, b) => a.getTime() - b.getTime())) {
    if (await createPartition(executor, day, options.recheck ?? false)) created += 1;
  }
  return created;
}

/** 滚动预建 [今天 - 1, 今天 + PARTITION_AHEAD_DAYS]（启动 + 每小时任务） */
export async function ensureIotTelemetryPartitions(now: Date = new Date()): Promise<string> {
  const today = utcDayStart(now);
  const days = utcDaysBetween(new Date(today.getTime() - DAY_MS), new Date(today.getTime() + PARTITION_AHEAD_DAYS * DAY_MS));
  const created = await ensureIotTelemetryPartitionsFor(days);
  return created > 0 ? `新建 ${created} 个分区` : '分区已就绪';
}

// ─── 查询与清理 ────────────────────────────────────────────────────────────────
export async function listIotTelemetryPartitions(): Promise<IotTelemetryPartition[]> {
  const res = await db.execute(sql`
    SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = ${IOT_TELEMETRY_TABLE}::regclass
    ORDER BY c.relname
  `);
  const rows = res as unknown as Array<{ name: string; bound: string }>;
  const out: IotTelemetryPartition[] = [];
  for (const row of rows) {
    const bound = parsePartitionBound(row.bound ?? '');
    if (bound) out.push({ name: row.name, ...bound });
  }
  return out;
}

function expiredPartitions(partitions: IotTelemetryPartition[], days: number, now = Date.now()): IotTelemetryPartition[] {
  const cutoff = now - days * DAY_MS;
  return partitions.filter((p) => p.to.getTime() <= cutoff);
}

async function countRows(name: string): Promise<number> {
  const res = await db.execute(sql.raw(`SELECT count(*)::int AS cnt FROM "${name}"`));
  return Number((res as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);
}

/** 保留策略预览：超期分区的明细行数 */
export async function countExpiredIotTelemetryRows(days: number): Promise<number> {
  if (days <= 0) return 0;
  let total = 0;
  for (const p of expiredPartitions(await listIotTelemetryPartitions(), days)) total += await countRows(p.name);
  return total;
}

/** 保留策略执行：整分区 DROP（秒级、零膨胀），返回被清理的明细行数 */
export async function dropExpiredIotTelemetryPartitions(days: number): Promise<number> {
  if (days <= 0) return 0;
  let deleted = 0;
  for (const p of expiredPartitions(await listIotTelemetryPartitions(), days)) {
    const rows = await countRows(p.name);
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${p.name}"`));
    knownPartitions.delete(p.name);
    deleted += rows;
    logger.info(`[iot] 已清理遥测分区 ${p.name}（${rows} 行）`);
  }
  return deleted;
}

// ─── 写入侧回填下限 ────────────────────────────────────────────────────────────
/** 保留天数缓存：单飞 + 过期用旧值，热路径每帧调用也不会打到配置表 */
const retentionCache = new TtlCache<'days', number>(RETENTION_CACHE_TTL_MS);

function retentionDays(): Promise<number> {
  return retentionCache.get('days', async () => {
    try {
      return await getPolicyRetentionDays(IOT_TELEMETRY_TABLE);
    } catch (err) {
      logger.debug(`[iot] 读取遥测保留天数失败，按不限制处理: ${(err as Error).message}`);
      return 0;
    }
  });
}

/**
 * 可接受的最早 reportedAt：早于保留窗口的点直接丢弃——它落在已被 / 即将被 DROP 的分区里，
 * 补建分区再写入只会让清理与写入互相追赶。
 */
export async function minAcceptableIotReportedAt(now: Date = new Date()): Promise<Date> {
  const days = await retentionDays();
  const limit = days > 0 ? days : BACKFILL_LIMIT_WHEN_RETENTION_OFF_DAYS;
  return new Date(now.getTime() - limit * DAY_MS);
}

/** 测试 / 手动维护用：清空进程内已知分区缓存 */
export function resetIotPartitionCache(): void {
  knownPartitions.clear();
  retentionCache.clear();
}
