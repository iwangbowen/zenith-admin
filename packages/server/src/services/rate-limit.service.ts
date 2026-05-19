import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { rateLimitRules } from '../db/schema';
import type { RateLimitRuleRow } from '../db/schema';
import redis from '../lib/redis';
import { config } from '../config';
import { formatDateTime } from '../lib/datetime';
import {
  listRuleConfigs,
  refreshRateLimitRules,
  unblockRateLimitKey,
  type RuleConfig,
} from '../middleware/rate-limit';

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
    blockedMessage: row.blockedMessage,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
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
          blockedMessage: r.blockedMessage,
        })),
      );
      rows = await db.select().from(rateLimitRules);
    }
  }
  return rows.map(mapRule);
}

export interface UpdateRateLimitRuleInput {
  windowMs?: number;
  limit?: number;
  keyType?: 'ip' | 'user' | 'ip_path';
  enabled?: boolean;
  description?: string | null;
  blockedMessage?: string | null;
}

export async function updateRateLimitRule(id: number, patch: UpdateRateLimitRuleInput) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  if (!row) throw new HTTPException(404, { message: '规则不存在' });
  await db
    .update(rateLimitRules)
    .set({
      ...(patch.windowMs === undefined ? {} : { windowMs: patch.windowMs }),
      ...(patch.limit === undefined ? {} : { limit: patch.limit }),
      ...(patch.keyType === undefined ? {} : { keyType: patch.keyType }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.blockedMessage === undefined ? {} : { blockedMessage: patch.blockedMessage }),
    })
    .where(eq(rateLimitRules.id, id));
  await refreshRateLimitRules();
  const [updated] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  return mapRule(updated);
}

async function readNumber(key: string): Promise<number> {
  const v = await redis.get(key);
  return v ? Number(v) || 0 : 0;
}

interface RecentBlock {
  at: string;
  key: string;
  path: string;
}

async function readRecent(name: string): Promise<RecentBlock[]> {
  const raw = await redis.zrevrange(`${STATS_PREFIX}${name}:recent`, 0, 99);
  return raw.map((item) => {
    const [ts, key, path = ''] = item.split('|');
    return {
      at: formatDateTime(new Date(Number(ts) || 0)),
      key: key ?? '',
      path,
    };
  });
}

/** 聚合所有规则的统计数据（命中/拦截/最近拦截） */
export async function getRateLimitStats() {
  const cfgs: RuleConfig[] = listRuleConfigs();
  const items = await Promise.all(
    cfgs.map(async (cfg) => {
      const [hit, blocked, recent] = await Promise.all([
        readNumber(`${STATS_PREFIX}${cfg.name}:hit`),
        readNumber(`${STATS_PREFIX}${cfg.name}:blocked`),
        readRecent(cfg.name),
      ]);
      return {
        name: cfg.name,
        description: cfg.description,
        windowMs: cfg.windowMs,
        limit: cfg.limit,
        keyType: cfg.keyType,
        enabled: cfg.enabled,
        hitCount: hit,
        blockedCount: blocked,
        blockRate: hit > 0 ? Math.round((blocked / hit) * 10000) / 100 : 0,
        recentBlocks: recent,
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
  );
  return { reset: true };
}
