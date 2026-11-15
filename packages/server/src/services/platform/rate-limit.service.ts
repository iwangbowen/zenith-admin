import type { z } from 'zod';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createRateLimitRuleSchema, updateRateLimitRuleSchema, rateLimitDiagnoseSchema, rateLimitMatches, rateLimitPathMatches, selectRateLimitRule, type RateLimitOptions } from '@zenith/shared/platform';
import { getApiCatalog } from '../identity/api-catalog.service';
import { getRateLimitRuntimeState } from '../../middleware/rate-limit';
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
    ...row.options,
    methods: row.options.methods ?? [], extraWindows: row.options.extraWindows ?? [], failMode: row.options.failMode ?? 'open',
    policyVersion: createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 12),
    loadState: getRateLimitRuntimeState().fresh ? 'loaded' as const : 'pending' as const,
    matchedOperationCount: getRateLimitOperations().filter(op => rateLimitMatches({ ...row, methods: row.options.methods }, op.method, op.path)).length,
    warnings: !getMountSource(row.name, row.pathPatterns).includes('code') && !row.pathPatterns.length ? ['未绑定接口，不会执行'] : [],
    ...formatTimestamps(row),
  };
}

/** Read-only: built-ins are initialized before API readiness, never by GET. */
export async function listRateLimitRules() {
  const rows = await db.select().from(rateLimitRules);
  return rows.sort((a, b) => a.name.localeCompare(b.name)).map(mapRule);
}

export async function getRateLimitRuleBeforeAudit(id: number) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  return mapRule(requireRow(row, '规则不存在'));
}

export type UpdateRateLimitRuleInput = z.output<typeof updateRateLimitRuleSchema>;
export type CreateRateLimitRuleInput = z.output<typeof createRateLimitRuleSchema>;
const OPTION_KEYS = ['methods', 'extraWindows', 'failMode', 'alertUserIds', 'alertCooldownSeconds'] as const;
function optionsFrom(input: UpdateRateLimitRuleInput): RateLimitOptions {
  return Object.fromEntries(OPTION_KEYS.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
}
function validatePolicy(input: UpdateRateLimitRuleInput, merged: { enabled: boolean; name: string; pathPatterns: string[]; options: RateLimitOptions; keyType: string }): void {
  for (const entry of input.allowlist ?? []) {
    if (/^[um]:[0-9]+$/.test(entry) || /^[uma]:(?:platform|[0-9]+):[A-Za-z0-9_-]+$/.test(entry)) continue;
    const [ip, prefix] = entry.split('/');
    const family = isIP(ip);
    if (!family || prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))) throw new HTTPException(400, { message: '非法豁免身份或 IP/CIDR：' + entry });
  }
  if (merged.enabled && !PREDEFINED_NAMES.has(merged.name) && !merged.pathPatterns.length) throw new HTTPException(400, { message: '启用自定义规则前必须绑定接口，可先保存为停用规则' });
  if (merged.enabled && merged.pathPatterns.some(pattern => rateLimitPathMatches(pattern, '/api/rate-limit/rules') || rateLimitPathMatches(pattern, '/api/health/readyz'))) throw new HTTPException(400, { message: '绑定范围覆盖管理恢复或健康探针，请缩小路径范围' });
  if (new Set([input.windowMs, ...(merged.options.extraWindows ?? []).map(w => w.windowMs)].filter(Boolean)).size !== [input.windowMs, ...(merged.options.extraWindows ?? []).map(w => w.windowMs)].filter(Boolean).length) throw new HTTPException(400, { message: '附加窗口不能与主窗口重复' });
}

export async function updateRateLimitRule(id: number, patch: UpdateRateLimitRuleInput) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  requireRow(row, '规则不存在');
  const options = { ...row.options, ...optionsFrom(patch) };
  validatePolicy(patch, { ...row, ...patch, options });
  await db
    .update(rateLimitRules)
    .set({
      options,
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
  validatePolicy(input, { ...input, pathPatterns: input.pathPatterns ?? [], options: optionsFrom(input) });
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
      options: optionsFrom(input),
      mode: input.mode ?? 'monitor',
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

export function getRateLimitOperations() {
  return getApiCatalog().items.map(item => ({ method: item.method.toUpperCase(), path: item.fullPath, summary: item.summary, security: item.security }))
    .concat([{ method: 'GET', path: '/s/{code}', summary: '公开短链跳转', security: 'none' }]);
}
export function diagnoseRateLimit(input: z.output<typeof rateLimitDiagnoseSchema>) {
  const path = input.path.split('?')[0];
  const rules = listRuleConfigs();
  const ipRule = selectRateLimitRule(rules, input.method, path, false);
  const identityRule = input.principal === 'anonymous' ? undefined : selectRateLimitRule(rules, input.method, path, true);
  const selected = [ipRule?.name, identityRule?.name].filter((name): name is string => Boolean(name));
  const template = getRateLimitOperations().find(op => op.method === input.method && rateLimitPathMatches(op.path, path))?.path ?? '/[unmatched]';
  return { path: template, method: input.method, selected, matches: rules.filter(rule => rateLimitMatches(rule, input.method, path)).map(rule => ({ name: rule.name, selected: selected.includes(rule.name), stage: rule.keyType === 'user' ? '认证后' : '认证前', reason: !rule.enabled ? '规则已停用' : rule.keyType === 'user' && input.principal === 'anonymous' ? '无已认证身份，不执行身份规则' : selected.includes(rule.name) ? '路径和方法匹配，按优先级选中' : '被同阶段更高优先级规则覆盖' })), note: '仅诊断配置匹配，不消耗额度；当前并发额度、具名业务保护和认证结果仍以真实请求为准。' };
}
