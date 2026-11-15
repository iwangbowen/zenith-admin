import { recordRateLimitEvent } from '../lib/rate-limit-stats';
import { limiterRedis } from '../lib/rate-limit-redis';
import { selectRateLimitRule, type RateLimitOptions, type RateLimitWindow } from '@zenith/shared/platform';
import { createHash } from 'node:crypto';
import { matchedRoutes } from 'hono/route';
import { DEFAULT_RATE_LIMIT_RULES, CODE_RATE_LIMIT_NAMES } from '@zenith/shared/platform';
import { onInvalidate, onInvalidationReset } from '../lib/invalidation-bus';
import { installIdentityRateLimiter } from '../lib/rate-limit-stage';
import type { MiddlewareHandler, Context } from 'hono';
import type { RateLimitKeyType, RateLimitMode, RateLimitAlgorithm } from '@zenith/shared/platform';
import ipRangeCheck from 'ip-range-check';
import redis from '../lib/redis';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import logger from '../lib/logger';
import { db } from '../db';
import { rateLimitRules } from '../db/schema';

export type RateLimitName = 'auth' | 'captcha' | 'sensitive' | 'analytics-ingest' | 'error-report' | 'replay-ingest' | 'report_public_share' | 'workflow_public_callback' | 'push_public_callback' | 'payment_public_link_pay' | 'payment_public_link_session' | 'chat_send' | 'chatbi_ask' | 'report_chatbi_write' | 'report_fill_write' | 'ai_chat_send' | 'ai_share_view' | 'drive_public_share' | 'chunk_upload';
export type { RateLimitKeyType, RateLimitMode, RateLimitAlgorithm };

export interface RuleConfig extends RateLimitOptions {
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: RateLimitKeyType;
  enabled: boolean;
  mode: RateLimitMode;
  algorithm: RateLimitAlgorithm;
  allowlist: string[];
  priority: number;
  alertThreshold: number | null;
  blockedMessage: string | null;
  pathPatterns: string[];
}

const DEFAULTS = DEFAULT_RATE_LIMIT_RULES;

const ruleCache = new Map<string, RuleConfig>(Object.entries(DEFAULTS));

const RL_PREFIX = `${config.redis.keyPrefix}rl:`;
const RL_BAN_PREFIX = `${config.redis.keyPrefix}rlban:`;
const STATS_PREFIX = `${config.redis.keyPrefix}rlstats:`;
/**
 * 统计写入失败的日志节流：Redis 故障时命中统计会对每个请求都失败，
 * 逐条 warn 会在故障期间淹没日志。每分钟最多报一次，并带上累计失败数。
 */
const STATS_LOG_INTERVAL_MS = 60_000;
let statsFailureCount = 0;
let statsFailureLoggedAt = 0;

function reportStatsFailure(scope: string, err: unknown): void {
  statsFailureCount += 1;
  const now = Date.now();
  if (now - statsFailureLoggedAt < STATS_LOG_INTERVAL_MS) return;
  statsFailureLoggedAt = now;
  const suppressed = statsFailureCount;
  statsFailureCount = 0;
  logger.warn(`[rate-limit] ${scope} stats write failed (${suppressed} occurrence(s) in the last minute)`, err);
}

/**
 * 计数身份：不含规则名前缀的标识（IP / `u:{userId}` / `ip|path`）。
 * Redis 计数键由 applyRule 统一拼接 `{name}|{identity}` 做规则级隔离；
 * 统计与解封均使用裸身份，前后端不再各自拆前缀。
 */
export function safeRateLimitPath(c: Context): string {
  const routes = matchedRoutes(c).filter(route => route.method !== 'ALL' && !route.path.endsWith('*'));
  return (routes.at(-1)?.path ?? '/api/[unmatched]').replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}
function identityFor(rule: RuleConfig, c: Context): string | null {
  if (rule.keyType === 'user') {
    const user = c.get('user'); const member = c.get('member'); const principal = c.get('openPrincipal');
    if (user) return 'u:' + (user.tenantId ?? 'platform') + ':' + user.userId;
    if (member) return 'm:' + (member.tenantId ?? 'platform') + ':' + member.memberId;
    if (principal) return 'a:' + (principal.tenantId ?? 'platform') + ':' + principal.app.clientId;
    return null;
  }
  if (rule.keyType === 'ip_path') return getClientIp(c) + '|r:' + createHash('sha256').update(c.req.path).digest('hex').slice(0, 32);
  return getClientIp(c);
}

/** 最近拦截记录的 zset member 结构（JSON 序列化，字段可含任意分隔符） */
export interface RecentBlockRecord {
  id: string;
  ts: number;
  key: string;
  path: string;
  /** 观察模式命中：只记数未实际拦截 */
  monitored?: boolean;
  /** 手动封禁命中：无视限额与观察模式直接拦截 */
  banned?: boolean;
}

export const MULTI_WINDOW_SCRIPT = `local banned = redis.call('PTTL', KEYS[1])
if banned > 0 then return {-1, banned, 0, 0} end
local now = tonumber(ARGV[1])
local n = tonumber(ARGV[2])
local sliding = ARGV[3] == 'sliding_window'
local worstCount = 0
local remaining = 1000000000
local retry = 1
local over = 0
for i = 1,n do
 local window = tonumber(ARGV[3+i*2-1])
 local limit = tonumber(ARGV[3+i*2])
 local base = KEYS[i+1]
 local count = 0
 local wait = window
 if sliding then
  local bucket = math.floor(now/window)
  local elapsed = now-bucket*window
  local currentKey = base..':'..bucket
  local previousKey = base..':'..(bucket-1)
  local current = redis.call('INCR', currentKey)
  if current == 1 then redis.call('PEXPIRE', currentKey, window*2) end
  local previous = tonumber(redis.call('GET', previousKey) or '0')
  count = current+previous*(1-elapsed/window)
  if count > limit then
   over = 1
   local need = current+1-limit
   if need <= 0 and previous > 0 then wait=math.max(1,(count+1-limit)*window/previous)
   elseif current > 0 then wait=window-elapsed+math.max(0,(1-(limit-1)/current)*window) end
  end
 else
  count = redis.call('INCR',base)
  if count == 1 then redis.call('PEXPIRE',base,window) end
  wait=redis.call('PTTL',base)
  if count > limit then over=1 end
 end
 worstCount=math.max(worstCount,count)
 remaining=math.min(remaining,math.max(0,math.floor(limit-count)))
 if count > limit then retry=math.max(retry,wait) end
end
return {over, math.ceil(retry), remaining, math.ceil(worstCount)}
`;

function recordDecision(rule: RuleConfig, c: Context, identity: string, decision: import('../lib/rate-limit-stats').LimitDecision): void {
  recordRateLimitEvent({ name: rule.name, key: identity, path: safeRateLimitPath(c), method: c.req.method, decision, correlationId: c.get('requestId') ?? null }, { threshold: rule.alertThreshold, userIds: rule.alertUserIds ?? [], cooldownSeconds: rule.alertCooldownSeconds ?? 3600 });
}
/**
 * 白名单豁免：条目为 IP、CIDR（如 10.0.0.0/8）或 `u:{userId}`。
 * 命中者跳过计数与拦截；条目非法时忽略该条（不影响其余条目）。
 */
function isAllowlisted(rule: RuleConfig, c: Context): boolean {
  if (rule.allowlist.length === 0) return false;
  let userId: number | undefined;
  try {
    userId = c.get('user')?.userId;
  } catch {
    userId = undefined;
  }
  const ip = getClientIp(c);
  const identity = identityFor(rule, c);
  for (const entry of rule.allowlist) {
    if (entry === identity) return true;
    if (entry.startsWith('u:')) {
      if (userId !== undefined && entry === `u:${userId}`) return true;
      continue;
    }
    try {
      if (ipRangeCheck(ip, entry)) return true;
    } catch {
      /* 非法 IP/CIDR 条目忽略 */
    }
  }
  return false;
}

/**
 * 应用一条规则（named 中间件与 pathBoundRateLimit 共用）。
 *
 * - 白名单命中直接放行，不计数
 * - 手动封禁命中无视限额与观察模式，直接 429（封禁是显式管理动作）
 * - 每个响应都带标准草案头 RateLimit-Limit / Remaining / Reset，客户端可感知余量提前退避
 * - 超限时 enforce 模式返回 429 + Retry-After；monitor 模式只记拦截统计并放行
 * - Redis 故障时放行：被保护接口的可用性优先于限流精确性
 */
async function applyRule(rule: RuleConfig, c: Context, next: () => Promise<void>): Promise<Response | void> {
  markApplied(c, rule.name);
  const identity = identityFor(rule, c);
  if (!identity) return next();
  const banKey = RL_BAN_PREFIX + rule.name + '|' + identity;
  try {
    const ttl = await limiterRedis.pttl(banKey);
    if (ttl > 0) {
      recordDecision(rule, c, identity, 'banned');
      return c.json(errBody('访问已被临时封禁，请稍后再试', 429), 429, { 'Retry-After': String(Math.max(1, Math.ceil(ttl / 1000))) });
    }
  } catch (err) { return unavailable(rule, c, next, err); }
  if (isAllowlisted(rule, c)) { recordDecision(rule, c, identity, 'exempt'); return next(); }
  const counterKey = counterBase(rule, identity);
  const windows: RateLimitWindow[] = [{ windowMs: rule.windowMs, limit: rule.limit }, ...(rule.extraWindows ?? [])];
  let over: number; let retryMs: number; let remaining: number;
  try {
    [over, retryMs, remaining] = await limiterRedis.eval(MULTI_WINDOW_SCRIPT, windows.length + 1, banKey, ...windows.map((_, i) => i === 0 ? counterKey : counterKey + ':w' + i), String(Date.now()), String(windows.length), rule.algorithm, ...windows.flatMap(w => [String(w.windowMs), String(w.limit)])) as [number, number, number];
  } catch (err) { return unavailable(rule, c, next, err); }
  const resetSec = Math.max(1, Math.ceil(retryMs / 1000));
  const prior = Number(c.res.headers.get('RateLimit-Remaining') ?? Number.MAX_SAFE_INTEGER);
  if (remaining < prior) {
    c.header('RateLimit-Limit', String(rule.limit)); c.header('RateLimit-Remaining', String(remaining)); c.header('RateLimit-Reset', String(resetSec));
  }
  if (over === -1) {
    recordDecision(rule, c, identity, 'banned');
    return c.json(errBody('访问已被临时封禁，请稍后再试', 429), 429, { 'Retry-After': String(resetSec) });
  }
  if (!over) { recordDecision(rule, c, identity, 'allowed'); return next(); }
  recordDecision(rule, c, identity, rule.mode === 'monitor' ? 'monitored' : 'blocked');
  if (rule.mode === 'monitor') return next();
  return c.json(errBody(rule.blockedMessage ?? '请求过于频繁，请稍后再试', 429), 429, { 'Retry-After': String(resetSec) });
}

/**
 * 同一请求内的规则去重标记：一条规则可能同时通过路由级 named 中间件与
 * 全局 pathBoundRateLimit（管理页可给任意规则配 pathPatterns）命中同一请求，
 * 不去重会对同一计数窗口 +2，实际限额减半。谁先应用谁生效，后者跳过。
 */
const APPLIED_VAR = 'rateLimitApplied';

function alreadyApplied(c: Context, name: string): boolean {
  const applied = c.get(APPLIED_VAR) as Set<string> | undefined;
  return applied?.has(name) ?? false;
}

function markApplied(c: Context, name: string): void {
  let applied = c.get(APPLIED_VAR) as Set<string> | undefined;
  if (!applied) {
    applied = new Set();
    c.set(APPLIED_VAR, applied);
  }
  applied.add(name);
}

function makeNamed(name: RateLimitName): MiddlewareHandler {
  return async (c, next) => {
    await ensureRateLimitRules();
    const rule = ruleCache.get(name);
    if (!rule?.enabled || rule.methods?.length && !rule.methods.includes(c.req.method)) return next();
    if (alreadyApplied(c, name)) return next();
    return applyRule(rule, c, next);
  };
}

export const authRateLimit: MiddlewareHandler = makeNamed('auth');
export const captchaRateLimit: MiddlewareHandler = makeNamed('captcha');
export const sensitiveRateLimit: MiddlewareHandler = makeNamed('sensitive');

/** 内置规则名称集合（不可删除） */
export const PREDEFINED_NAMES = new Set<string>(Object.keys(DEFAULTS));

/**
 * 代码中通过 authRateLimit / namedRateLimit(...) 静态挂载的规则名。
 * 新增代码挂载点时必须同步维护（rate-limit.test.ts 有一致性校验兜底）；
 * 用于管理页的「挂载来源」标识——无代码挂载且无路径绑定的规则是死规则。
 */
export const CODE_MOUNTED_NAMES = new Set<string>(CODE_RATE_LIMIT_NAMES);

/** 规则挂载来源：code=代码挂载；path=路径绑定；code_path=两者皆有；none=未生效 */
export function getMountSource(name: string, pathPatterns: string[]): 'code' | 'path' | 'code_path' | 'none' {
  const code = CODE_MOUNTED_NAMES.has(name);
  const path = pathPatterns.length > 0;
  if (code && path) return 'code_path';
  if (code) return 'code';
  if (path) return 'path';
  return 'none';
}

/** 通过规则名称动态应用限流（支持自定义规则） */
export function namedRateLimit(name: string): MiddlewareHandler {
  return makeNamed(name as RateLimitName);
}

async function applyPathRules(c: Context, next: () => Promise<void>, identityStage: boolean): Promise<Response | void> {
  await ensureRateLimitRules();
  const selected = selectRateLimitRule([...ruleCache.values()], c.req.method, c.req.path, identityStage);
  if (!selected || alreadyApplied(c, selected.name)) return next();
  return applyRule(selected, c, next);
}
export const pathBoundRateLimit: MiddlewareHandler = (c, next) => applyPathRules(c, next, false);
installIdentityRateLimiter((c, next) => applyPathRules(c, next, true));

function counterBase(rule: RuleConfig, identity: string): string {
  const spec = createHash('sha256').update(JSON.stringify([rule.algorithm, rule.windowMs, rule.keyType, rule.methods ?? [], rule.extraWindows ?? [], rule.pathPatterns])).digest('hex').slice(0, 12);
  return RL_PREFIX + rule.name + '|' + identity + '|' + spec;
}
let loadedAt = 0;
let reload: Promise<void> | undefined;
let generation = 0;
export function refreshRateLimitRules(): Promise<void> {
  if (reload) return reload;
  const startedGeneration = generation;
  reload = (async () => {
    const rows = await db.select().from(rateLimitRules);
    const next = new Map<string, RuleConfig>(Object.entries(DEFAULTS));
    for (const row of rows) next.set(row.name, { ...row, ...row.options, allowlist: row.allowlist ?? [], pathPatterns: row.pathPatterns ?? [] });
    ruleCache.clear();
    for (const [key, rule] of next) ruleCache.set(key, rule);
    loadedAt = generation === startedGeneration ? Date.now() : 0;
  })().finally(() => { reload = undefined; });
  return reload;
}
async function ensureRateLimitRules(): Promise<void> {
  if (Date.now() - loadedAt < 30_000) return;
  try { await refreshRateLimitRules(); }
  catch (err) { reportStatsFailure('configuration', err); }
}
const invalidateRules = () => { loadedAt = 0; generation += 1; };
onInvalidate('rate_limit_rules', invalidateRules);
onInvalidationReset(invalidateRules);
export async function bootstrapRateLimitRules(): Promise<void> {
  await db.insert(rateLimitRules).values(Object.values(DEFAULTS)).onConflictDoNothing();
  await refreshRateLimitRules();
}
export function getRateLimitRuntimeState() {
  return { loadedAt, rules: ruleCache.size, fresh: loadedAt > 0 && Date.now() - loadedAt < 30_000 };
}

/** 当前缓存中的所有规则配置 */
export function listRuleConfigs(): RuleConfig[] {
  return [...ruleCache.values()];
}

/**
 * 解封某个 key（清除该 key 在 rate-limit Redis 中的计数窗口）。
 *
 * `key` 为不含规则名前缀的计数身份（IP / `u:{userId}` / `ip|path`，
 * 与统计接口 recentBlocks 返回的 key 字段一致）；Redis 计数键为
 * `{name}|{identity}`（见 applyRule），这里负责补回前缀。
 * 只清除额度，保留命中记录和临时封禁。
 */
export async function unblockRateLimitKey(name: string, key: string): Promise<boolean> {
  const ruleConfig = ruleCache.get(name);
  if (!ruleConfig) return false;
  const base = counterBase(ruleConfig, key);
  // 滑动窗口的计数分布在带桶序号的键上；按规则当前窗口宽度推导本桶与上一桶
  const keysToDelete = [base];
  const rule = ruleCache.get(name);
  if (rule && rule.windowMs > 0) {
    const windows = [{ windowMs: rule.windowMs }, ...(rule.extraWindows ?? [])];
    windows.forEach((window, i) => {
      const keyBase = i === 0 ? base : base + ':w' + i;
      const bucket = Math.floor(Date.now() / window.windowMs);
      keysToDelete.push(keyBase, keyBase + ':' + bucket, keyBase + ':' + (bucket - 1));
    });
  }
  const n = await redis.del(...keysToDelete);
  return n > 0;
}

// ─── 手动封禁 ─────────────────────────────────────────────────────────────────

export interface RateLimitBan {
  name: string;
  key: string;
  ttlMs: number;
  reason: string;
  createdBy: number | null;
}

/**
 * 手动封禁某个身份：无视限额与观察模式，封禁期内该身份在此规则下的请求一律 429。
 * 封禁键带 TTL 自动过期；解除用 unbanRateLimitKey。
 */
export async function banRateLimitKey(name: string, key: string, durationSeconds: number, metadata = { reason: '管理员临时封禁', createdBy: null as number | null }): Promise<void> {
  await redis.set(`${RL_BAN_PREFIX}${name}|${key}`, JSON.stringify(metadata), 'PX', durationSeconds * 1000);
}

export async function unbanRateLimitKey(name: string, key: string): Promise<boolean> {
  const n = await redis.del(`${RL_BAN_PREFIX}${name}|${key}`);
  return n > 0;
}

/** 活跃封禁列表：SCAN 封禁键空间（管理页低频操作，键量级 = 活跃封禁数） */
export async function listRateLimitBans(): Promise<RateLimitBan[]> {
  const bans: RateLimitBan[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${RL_BAN_PREFIX}*`, 'COUNT', 200);
    cursor = next;
    for (const redisKey of keys) {
      const suffix = redisKey.slice(RL_BAN_PREFIX.length);
      const sep = suffix.indexOf('|');
      if (sep <= 0) continue;
      const ttlMs = await redis.pttl(redisKey);
      if (ttlMs <= 0) continue;
      const raw = await redis.get(redisKey);
      const metadata = raw ? JSON.parse(raw) as {reason?: string;createdBy?: number} : {};
      bans.push({ name: suffix.slice(0, sep), key: suffix.slice(sep + 1), ttlMs, reason: metadata.reason ?? '', createdBy: metadata.createdBy ?? null });
    }
  } while (cursor !== '0');
  return bans.sort((a, b) => a.ttlMs - b.ttlMs);
}

export const RATE_LIMIT_KEYS = {
  rlPrefix: RL_PREFIX,
  statsPrefix: STATS_PREFIX,
} as const;

function unavailable(rule: RuleConfig, c: Context, next: () => Promise<void>, error: unknown): Promise<Response | void> | Response {
  reportStatsFailure('counter', error);
  recordDecision(rule, c, identityFor(rule, c) ?? getClientIp(c), 'degraded');
  if (rule.failMode === 'closed') return c.json(errBody('限流服务暂时不可用，请稍后重试', 503), 503, { 'X-Zenith-Error': 'rate-limit-unavailable', 'Retry-After': '1' });
  return next();
}
