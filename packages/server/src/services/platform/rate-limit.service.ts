import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { db } from '../../db';
import { rateLimitRules } from '../../db/schema';
import type { RateLimitRuleRow } from '../../db/schema';
import redis from '../../lib/redis';
import { config } from '../../config';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import {
  listRuleConfigs,
  refreshRateLimitRules,
  unblockRateLimitKey,
  banRateLimitKey,
  unbanRateLimitKey,
  listRateLimitBans,
  getMountSource,
  PREDEFINED_NAMES,
  type RuleConfig,
  type RecentBlockRecord,
} from '../../middleware/rate-limit';
import { requireRow } from '../../lib/db-assert';

const STATS_PREFIX = `${config.redis.keyPrefix}rlstats:`;

function mapRule(row: RateLimitRuleRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    windowMs: row.windowMs,
    limit: row.limit,
    keyType: row.keyType,
    enabled: row.enabled,
    mode: row.mode,
    algorithm: row.algorithm,
    allowlist: row.allowlist ?? [],
    priority: row.priority,
    alertThreshold: row.alertThreshold,
    blockedMessage: row.blockedMessage,
    pathPatterns: row.pathPatterns ?? [],
    predefined: PREDEFINED_NAMES.has(row.name),
    mountSource: getMountSource(row.name, row.pathPatterns ?? []),
    ...formatTimestamps(row),
  };
}

/** 列出 DB 中所有规则；若 DB 为空则用默认规则填充并落库 */
export async function listRateLimitRules() {
  let rows = await db.select().from(rateLimitRules);
  if (rows.length === 0) {
    const defaults = listRuleConfigs();
    if (defaults.length > 0) {
      await db.insert(rateLimitRules).values(
        defaults.map((r) => ({
          name: r.name,
          description: r.description,
          windowMs: r.windowMs,
          limit: r.limit,
          keyType: r.keyType,
          enabled: r.enabled,
          mode: r.mode,
          algorithm: r.algorithm,
          allowlist: r.allowlist,
          priority: r.priority,
          alertThreshold: r.alertThreshold,
          blockedMessage: r.blockedMessage,
          // 路径绑定是规则配置的一部分：漏掉会导致重启后 DB 行覆盖代码默认值，
          // 仅靠 pathPatterns 生效的公开端点限流（report_public_share 等）静默失效
          pathPatterns: r.pathPatterns,
        })),
      );
      rows = await db.select().from(rateLimitRules);
    }
  }
  return rows.map(mapRule);
}

export async function getRateLimitRuleBeforeAudit(id: number) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  return mapRule(requireRow(row, '规则不存在'));
}

export interface UpdateRateLimitRuleInput {
  windowMs?: number;
  limit?: number;
  keyType?: 'ip' | 'user' | 'ip_path';
  enabled?: boolean;
  mode?: 'enforce' | 'monitor';
  algorithm?: 'fixed_window' | 'sliding_window';
  allowlist?: string[];
  priority?: number;
  alertThreshold?: number | null;
  description?: string | null;
  blockedMessage?: string | null;
  pathPatterns?: string[];
}

export interface CreateRateLimitRuleInput {
  name: string;
  description?: string | null;
  windowMs: number;
  limit: number;
  keyType: 'ip' | 'user' | 'ip_path';
  enabled: boolean;
  mode?: 'enforce' | 'monitor';
  algorithm?: 'fixed_window' | 'sliding_window';
  allowlist?: string[];
  priority?: number;
  alertThreshold?: number | null;
  blockedMessage?: string | null;
  pathPatterns?: string[];
}

export async function updateRateLimitRule(id: number, patch: UpdateRateLimitRuleInput) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  requireRow(row, '规则不存在');
  await db
    .update(rateLimitRules)
    .set({
      ...(patch.windowMs === undefined ? {} : { windowMs: patch.windowMs }),
      ...(patch.limit === undefined ? {} : { limit: patch.limit }),
      ...(patch.keyType === undefined ? {} : { keyType: patch.keyType }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.mode === undefined ? {} : { mode: patch.mode }),
      ...(patch.algorithm === undefined ? {} : { algorithm: patch.algorithm }),
      ...(patch.allowlist === undefined ? {} : { allowlist: patch.allowlist }),
      ...(patch.priority === undefined ? {} : { priority: patch.priority }),
      ...(patch.alertThreshold === undefined ? {} : { alertThreshold: patch.alertThreshold }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.blockedMessage === undefined ? {} : { blockedMessage: patch.blockedMessage }),
      ...(patch.pathPatterns === undefined ? {} : { pathPatterns: patch.pathPatterns }),
    })
    .where(eq(rateLimitRules.id, id));
  await refreshRateLimitRules();
  const [updated] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  return mapRule(updated);
}

export async function createRateLimitRule(input: CreateRateLimitRuleInput) {
  const [existing] = await db.select({ id: rateLimitRules.id }).from(rateLimitRules).where(eq(rateLimitRules.name, input.name));
  if (existing) throw new HTTPException(400, { message: `规则名称 "${input.name}" 已存在` });
  const [row] = await db
    .insert(rateLimitRules)
    .values({
      name: input.name,
      description: input.description ?? null,
      windowMs: input.windowMs,
      limit: input.limit,
      keyType: input.keyType,
      enabled: input.enabled,
      mode: input.mode ?? 'enforce',
      algorithm: input.algorithm ?? 'fixed_window',
      allowlist: input.allowlist ?? [],
      priority: input.priority ?? 0,
      alertThreshold: input.alertThreshold ?? null,
      blockedMessage: input.blockedMessage ?? null,
      pathPatterns: input.pathPatterns ?? [],
    })
    .returning();
  await refreshRateLimitRules();
  return mapRule(row);
}

export async function deleteRateLimitRule(id: number) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  const existingRule = requireRow(row, '规则不存在');
  if (PREDEFINED_NAMES.has(existingRule.name)) throw new HTTPException(400, { message: '内置规则不可删除' });
  await db.delete(rateLimitRules).where(eq(rateLimitRules.id, id));
  await refreshRateLimitRules();
  return { deleted: true };
}

async function readNumber(key: string): Promise<number> {
  const v = await redis.get(key);
  return v ? Number(v) || 0 : 0;
}

interface RecentBlock {
  at: string;
  key: string;
  path: string;
  monitored: boolean;
  banned: boolean;
}

async function readRecent(name: string): Promise<RecentBlock[]> {
  const raw = await redis.zrevrange(`${STATS_PREFIX}${name}:recent`, 0, 99);
  const items: RecentBlock[] = [];
  for (const member of raw) {
    // member 为 JSON（见 middleware RecentBlockRecord）；无法解析的条目直接丢弃
    try {
      const record = JSON.parse(member) as RecentBlockRecord;
      items.push({
        at: formatDateTime(new Date(record.ts)),
        key: record.key,
        path: record.path,
        monitored: record.monitored === true,
        banned: record.banned === true,
      });
    } catch {
      /* skip malformed entry */
    }
  }
  return items;
}

interface HourlyPoint {
  hour: string;
  hits: number;
  blocked: number;
}

async function readHourlySeries(name: string): Promise<HourlyPoint[]> {
  const [hitsMap, blockedMap] = await Promise.all([
    redis.hgetall(`${STATS_PREFIX}${name}:hourly:hits`),
    redis.hgetall(`${STATS_PREFIX}${name}:hourly:blocked`),
  ]);
  const now = dayjs().startOf('hour');
  const series: HourlyPoint[] = [];
  for (let i = 23; i >= 0; i--) {
    const t = now.subtract(i, 'hour');
    const hk = t.format('YYYY-MM-DD HH');
    series.push({
      hour: t.format('MM-DD HH:00'),
      hits: Number(hitsMap[hk] ?? 0) || 0,
      blocked: Number(blockedMap[hk] ?? 0) || 0,
    });
  }
  return series;
}

interface DailyPoint {
  day: string;
  hits: number;
  blocked: number;
}

async function readDailySeries(name: string): Promise<DailyPoint[]> {
  const [hitsMap, blockedMap] = await Promise.all([
    redis.hgetall(`${STATS_PREFIX}${name}:daily:hits`),
    redis.hgetall(`${STATS_PREFIX}${name}:daily:blocked`),
  ]);
  const today = dayjs().startOf('day');
  const series: DailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const t = today.subtract(i, 'day');
    const dk = t.format('YYYY-MM-DD');
    series.push({
      day: t.format('MM-DD'),
      hits: Number(hitsMap[dk] ?? 0) || 0,
      blocked: Number(blockedMap[dk] ?? 0) || 0,
    });
  }
  return series;
}

interface TopSource {
  key: string;
  count: number;
}

/** 今日 Top-N 拦截来源（按日 zincrby 聚合） */
async function readTopSources(name: string, limit = 10): Promise<TopSource[]> {
  const raw = await redis.zrevrange(`${STATS_PREFIX}${name}:top:${dayjs().format('YYYY-MM-DD')}`, 0, limit - 1, 'WITHSCORES');
  const items: TopSource[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    items.push({ key: raw[i], count: Number(raw[i + 1]) || 0 });
  }
  return items;
}

/** 聚合所有规则的统计数据（命中/拦截/最近拦截/趋势/Top 来源） */
export async function getRateLimitStats() {
  const cfgs: RuleConfig[] = listRuleConfigs();
  const items = await Promise.all(
    cfgs.map(async (cfg) => {
      const [hit, blocked, recent, hourlySeries, dailySeries, topSources] = await Promise.all([
        readNumber(`${STATS_PREFIX}${cfg.name}:hit`),
        readNumber(`${STATS_PREFIX}${cfg.name}:blocked`),
        readRecent(cfg.name),
        readHourlySeries(cfg.name),
        readDailySeries(cfg.name),
        readTopSources(cfg.name),
      ]);
      return {
        name: cfg.name,
        description: cfg.description,
        windowMs: cfg.windowMs,
        limit: cfg.limit,
        keyType: cfg.keyType,
        enabled: cfg.enabled,
        mode: cfg.mode,
        hitCount: hit,
        blockedCount: blocked,
        blockRate: hit > 0 ? Math.round((blocked / hit) * 10000) / 100 : 0,
        recentBlocks: recent,
        hourlySeries,
        dailySeries,
        topSources,
      };
    }),
  );
  return { items };
}

/** 解封指定 key（清除 Redis 计数窗口） */
export async function unblockRateLimit(name: string, key: string) {
  if (!key) throw new HTTPException(400, { message: 'key 不能为空' });
  const ok = await unblockRateLimitKey(name, key);
  return { unblocked: ok };
}

/** 清空指定规则的统计（hit / blocked / recent） */
export async function resetRateLimitStats(name: string) {
  await redis.del(
    `${STATS_PREFIX}${name}:hit`,
    `${STATS_PREFIX}${name}:blocked`,
    `${STATS_PREFIX}${name}:recent`,
    `${STATS_PREFIX}${name}:hourly:hits`,
    `${STATS_PREFIX}${name}:hourly:blocked`,
  );
  return { reset: true };
}

// ─── 手动封禁 ─────────────────────────────────────────────────────────────────

function ensureRuleExists(name: string): void {
  if (!listRuleConfigs().some((r) => r.name === name)) {
    throw new HTTPException(404, { message: `规则 ${name} 不存在` });
  }
}

/** 手动封禁：封禁期内该身份在此规则下的请求一律 429（无视限额与观察模式） */
export async function banRateLimit(name: string, key: string, durationSeconds: number) {
  ensureRuleExists(name);
  await banRateLimitKey(name, key, durationSeconds);
  return { banned: true };
}

export async function unbanRateLimit(name: string, key: string) {
  const ok = await unbanRateLimitKey(name, key);
  return { unbanned: ok };
}

/** 活跃封禁列表（带到期时间） */
export async function listRateLimitActiveBans() {
  const bans = await listRateLimitBans();
  const now = Date.now();
  return bans.map((b) => ({
    name: b.name,
    key: b.key,
    expiresAt: formatDateTime(new Date(now + b.ttlMs)),
    remainingSeconds: Math.max(1, Math.ceil(b.ttlMs / 1000)),
  }));
}
