import type { MiddlewareHandler, Context } from 'hono';
import type { RateLimitKeyType, RateLimitMode, RateLimitAlgorithm } from '@zenith/shared/platform';
import ipRangeCheck from 'ip-range-check';
import redis from '../lib/redis';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import logger from '../lib/logger';
import dayjs from 'dayjs';
import { db } from '../db';
import { rateLimitRules } from '../db/schema';
import { currentUser } from '../lib/context';

export type RateLimitName = 'auth' | 'captcha' | 'sensitive' | 'analytics-ingest' | 'error-report' | 'replay-ingest' | 'report_public_share' | 'workflow_public_callback' | 'push_public_callback' | 'payment_public_link' | 'chat_send' | 'chatbi_ask' | 'report_chatbi_write' | 'report_fill_write' | 'ai_chat_send' | 'ai_share_view' | 'drive_public_share' | 'chunk_upload';
export type { RateLimitKeyType, RateLimitMode, RateLimitAlgorithm };

export interface RuleConfig {
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

/** 新列的默认取值：内置规则与 DB 缺省行为保持一致 */
const RULE_BASE = { mode: 'enforce', algorithm: 'fixed_window', allowlist: [] as string[], priority: 0, alertThreshold: null } as const;

const DEFAULTS: Record<RateLimitName, RuleConfig> = {
  auth:      { ...RULE_BASE, name: 'auth',      description: '登录接口限流',          windowMs: 3 * 60 * 1000,      limit: 20, keyType: 'ip', enabled: true, blockedMessage: '登录尝试过于频繁，请 3 分钟后再试', pathPatterns: [] },
  captcha:   { ...RULE_BASE, name: 'captcha',   description: '验证码接口限流',        windowMs: 60 * 1000,          limit: 30, keyType: 'ip', enabled: true, blockedMessage: '验证码请求过于频繁，请稍后再试', pathPatterns: [] },
  sensitive: { ...RULE_BASE, name: 'sensitive', description: '敏感操作（注册/重置）限流', windowMs: 60 * 60 * 1000,  limit: 5,  keyType: 'ip', enabled: true, blockedMessage: '操作过于频繁，请 1 小时后重试', pathPatterns: [] },
  'analytics-ingest': { ...RULE_BASE, name: 'analytics-ingest', description: '匿名埋点事件上报限流', windowMs: 60 * 1000, limit: 120, keyType: 'ip', enabled: true, blockedMessage: '埋点上报过于频繁，请稍后再试', pathPatterns: [] },
  'error-report': { ...RULE_BASE, name: 'error-report', description: '匿名前端错误上报限流', windowMs: 60 * 1000, limit: 60, keyType: 'ip', enabled: true, blockedMessage: '错误上报过于频繁，请稍后再试', pathPatterns: [] },
  'replay-ingest': { ...RULE_BASE, name: 'replay-ingest', description: '会话回放分片上报限流', windowMs: 60 * 1000, limit: 60, keyType: 'ip', enabled: true, blockedMessage: '回放上报过于频繁，请稍后再试', pathPatterns: [] },
  report_public_share: { ...RULE_BASE, name: 'report_public_share', description: '报表公开分享访问限流（无需登录，防滥用/防爆破）', windowMs: 60 * 1000, limit: 120, keyType: 'ip', enabled: true, blockedMessage: '访问过于频繁，请稍后再试', pathPatterns: ['/api/report/public/*'] },
  workflow_public_callback: { ...RULE_BASE, name: 'workflow_public_callback', description: '工作流公开回调接口限流', windowMs: 60 * 1000, limit: 120, keyType: 'ip_path', enabled: true, blockedMessage: '工作流回调请求过于频繁，请稍后再试', pathPatterns: ['/api/public/workflow/external-callback/*', '/api/public/workflow/trigger-callback/*'] },
  push_public_callback: { ...RULE_BASE, name: 'push_public_callback', description: '推送供应商回执回调限流', windowMs: 60 * 1000, limit: 300, keyType: 'ip', enabled: true, blockedMessage: '回执回调过于频繁，请稍后再试', pathPatterns: ['/api/public/push/callbacks/*'] },
  payment_public_link: { ...RULE_BASE, name: 'payment_public_link', description: '公开支付链接下单限流', windowMs: 60 * 1000, limit: 10, keyType: 'ip_path', enabled: true, blockedMessage: '支付请求过于频繁，请稍后再试', pathPatterns: [] },
  chat_send: { ...RULE_BASE, name: 'chat_send', description: '聊天消息发送限流（按用户）', windowMs: 60 * 1000, limit: 60, keyType: 'user', enabled: true, blockedMessage: '消息发送过于频繁，请稍后再试', pathPatterns: [] },
  chatbi_ask: { ...RULE_BASE, name: 'chatbi_ask', description: 'ChatBI 提问限流（按用户）', windowMs: 60 * 1000, limit: 10, keyType: 'user', enabled: true, blockedMessage: 'ChatBI 提问过于频繁，请稍后再试', pathPatterns: [] },
  report_chatbi_write: { ...RULE_BASE, name: 'report_chatbi_write', description: 'ChatBI 写操作限流（按用户）', windowMs: 60 * 1000, limit: 30, keyType: 'user', enabled: true, blockedMessage: 'ChatBI 操作过于频繁，请稍后再试', pathPatterns: [] },
  report_fill_write: { ...RULE_BASE, name: 'report_fill_write', description: '报表填报写操作限流（按用户）', windowMs: 60 * 1000, limit: 30, keyType: 'user', enabled: true, blockedMessage: '填报操作过于频繁，请稍后再试', pathPatterns: [] },
  ai_chat_send: { ...RULE_BASE, name: 'ai_chat_send', description: 'AI 对话发送限流（按用户）', windowMs: 60 * 1000, limit: 15, keyType: 'user', enabled: true, blockedMessage: 'AI 对话过于频繁，请稍后再试', pathPatterns: [] },
  ai_share_view: { ...RULE_BASE, name: 'ai_share_view', description: 'AI 对话分享页访问限流（无需登录，防滥用）', windowMs: 60 * 1000, limit: 60, keyType: 'ip', enabled: true, blockedMessage: '访问过于频繁，请稍后再试', pathPatterns: [] },
  drive_public_share: { ...RULE_BASE, name: 'drive_public_share', description: '网盘外链公开访问限流（无需登录，防密码爆破 / 防滥用）', windowMs: 60 * 1000, limit: 120, keyType: 'ip', enabled: true, blockedMessage: '访问过于频繁，请稍后再试', pathPatterns: ['/api/drive/public/*'] },
  // 与 shared seed 的 SEED_RATE_LIMIT_RULES 同步：代码默认保证既有环境部署后即生效，DB 行供管理员调参覆盖
  chunk_upload: { ...RULE_BASE, name: 'chunk_upload', description: '分片上传单片接口限流（按用户）：分片不小于 5MB，正常上传远达不到该速率，只拦异常刷片', windowMs: 60 * 1000, limit: 3000, keyType: 'user', enabled: true, blockedMessage: '分片上传过于频繁，请稍后再试', pathPatterns: ['/api/files/upload/chunk', '/api/drive/nodes/upload/chunk', '/api/app-releases/releases/*/artifacts/upload/chunk', '/api/iot/firmwares/upload/chunk'] },
};

const ruleCache = new Map<string, RuleConfig>(Object.entries(DEFAULTS));

const RL_PREFIX = `${config.redis.keyPrefix}rl:`;
const RL_BAN_PREFIX = `${config.redis.keyPrefix}rlban:`;
const STATS_PREFIX = `${config.redis.keyPrefix}rlstats:`;
const STATS_TTL = 7 * 24 * 60 * 60;
const HOURLY_TTL = 25 * 60 * 60;
/** 按日序列（30d 趋势）与按日 Top 来源的保留期 */
const DAILY_TTL = 32 * 24 * 60 * 60;
const TOP_TTL = 7 * 24 * 60 * 60;

function currentHourKey(): string {
  return dayjs().format('YYYY-MM-DD HH');
}

function currentDayKey(): string {
  return dayjs().format('YYYY-MM-DD');
}

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
function identityFor(rule: RuleConfig, c: Context): string {
  if (rule.keyType === 'user') {
    try {
      const u = currentUser();
      return u?.userId ? `u:${u.userId}` : getClientIp(c);
    } catch {
      return getClientIp(c);
    }
  }
  if (rule.keyType === 'ip_path') {
    return `${getClientIp(c)}|${c.req.path}`;
  }
  return getClientIp(c);
}

/** 最近拦截记录的 zset member 结构（JSON 序列化，字段可含任意分隔符） */
export interface RecentBlockRecord {
  ts: number;
  key: string;
  path: string;
  /** 观察模式命中：只记数未实际拦截 */
  monitored?: boolean;
  /** 手动封禁命中：无视限额与观察模式直接拦截 */
  banned?: boolean;
}

/**
 * 固定窗口计数（Lua 原子执行）：先查封禁键，再 INCR 并在首个请求上设置窗口 TTL。
 * 返回 [窗口内计数, 剩余窗口毫秒]；封禁中返回 [-1, 封禁剩余毫秒]。
 * 脚本体极小，直接 EVAL 免去 SHA 缓存管理。
 */
const FIXED_WINDOW_SCRIPT = `
local ban = redis.call('PTTL', KEYS[2])
if ban > 0 then return {-1, ban} end
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/**
 * 滑动窗口（两桶加权近似，Cloudflare 同款算法）：按窗口宽度分桶计数，
 * 加权计数 = 当前桶 + 上一桶 × 上一桶在滑动窗口中的剩余占比。
 * 消除固定窗口在边界处最多 2× 限额的突刺；桶保留两个窗口供下一窗口加权。
 * 返回 [当前桶计数, 上一桶计数]；封禁中返回 [-1, 封禁剩余毫秒]。
 */
const SLIDING_WINDOW_SCRIPT = `
local ban = redis.call('PTTL', KEYS[3])
if ban > 0 then return {-1, ban} end
local curr = redis.call('INCR', KEYS[1])
if curr == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1] * 2)
end
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
return {curr, prev}
`;

interface LimiterHit {
  /** 窗口内计数（含当前请求）；-1 表示命中手动封禁 */
  count: number;
  /** 距窗口重置（或封禁解除）的毫秒数 */
  resetMs: number;
}

async function fixedWindowHit(counterKey: string, banKey: string, windowMs: number): Promise<LimiterHit> {
  const [count, ttl] = (await redis.eval(FIXED_WINDOW_SCRIPT, 2, counterKey, banKey, String(windowMs))) as [number, number];
  return { count, resetMs: ttl > 0 ? ttl : windowMs };
}

async function slidingWindowHit(counterKey: string, banKey: string, windowMs: number): Promise<LimiterHit> {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const elapsed = now - bucket * windowMs;
  const [curr, prevOrBanTtl] = (await redis.eval(
    SLIDING_WINDOW_SCRIPT, 3, `${counterKey}:${bucket}`, `${counterKey}:${bucket - 1}`, banKey, String(windowMs),
  )) as [number, number];
  if (curr === -1) return { count: -1, resetMs: prevOrBanTtl };
  const weighted = curr + prevOrBanTtl * (1 - elapsed / windowMs);
  return { count: weighted, resetMs: windowMs - elapsed };
}

/** 拦截统计（fire-and-forget）：blocked 计数 + 最近记录 + 小时/日序列 + Top 来源 + 突增告警 */
function recordBlockedStats(rule: RuleConfig, c: Context, identity: string, banned = false): void {
  void (async () => {
    try {
      const blockedKey = `${STATS_PREFIX}${rule.name}:blocked`;
      const recentKey = `${STATS_PREFIX}${rule.name}:recent`;
      const hourlyBlockedKey = `${STATS_PREFIX}${rule.name}:hourly:blocked`;
      const dailyBlockedKey = `${STATS_PREFIX}${rule.name}:daily:blocked`;
      const topKey = `${STATS_PREFIX}${rule.name}:top:${currentDayKey()}`;
      const ts = Date.now();
      const hk = currentHourKey();
      const record: RecentBlockRecord = { ts, key: identity, path: c.req.path };
      if (banned) record.banned = true;
      else if (rule.mode === 'monitor') record.monitored = true;
      const results = await redis
        .multi()
        .incr(blockedKey)
        .expire(blockedKey, STATS_TTL)
        .zadd(recentKey, ts, JSON.stringify(record))
        .zremrangebyrank(recentKey, 0, -201)
        .expire(recentKey, STATS_TTL)
        .hincrby(hourlyBlockedKey, hk, 1)
        .expire(hourlyBlockedKey, HOURLY_TTL)
        .hincrby(dailyBlockedKey, currentDayKey(), 1)
        .expire(dailyBlockedKey, DAILY_TTL)
        .zincrby(topKey, 1, identity)
        .expire(topKey, TOP_TTL)
        .exec();
      // 突增告警：小时拦截数达到阈值时通知（去重在 alert service 内做）。
      // exec 结果按链式顺序排列，索引 5 = hourlyBlockedKey 的 hincrby 返回值
      if (rule.alertThreshold !== null && rule.alertThreshold > 0 && results) {
        const hourlyBlocked = Number(results[5]?.[1] ?? 0);
        if (hourlyBlocked >= rule.alertThreshold) {
          void import('../services/platform/rate-limit-alert.service')
            .then((m) => m.maybeSendRateLimitSpikeAlert({
              ruleName: rule.name,
              threshold: rule.alertThreshold as number,
              blockedCount: hourlyBlocked,
              hourKey: hk,
            }))
            .catch(() => {});
        }
      }
    } catch (err) {
      reportStatsFailure('blocked', err);
    }
  })();
}

/**
 * 命中统计（fire-and-forget）：统计只服务于限流看板，其失败不应拖慢或中断被保护的接口。
 * 限流判定本身由 applyRule 同步完成，不受影响。
 */
function recordHitStats(name: string): void {
  void (async () => {
    try {
      const k = `${STATS_PREFIX}${name}:hit`;
      const hk = currentHourKey();
      const hourlyHitsKey = `${STATS_PREFIX}${name}:hourly:hits`;
      const dailyHitsKey = `${STATS_PREFIX}${name}:daily:hits`;
      await redis
        .multi()
        .incr(k)
        .expire(k, STATS_TTL)
        .hincrby(hourlyHitsKey, hk, 1)
        .expire(hourlyHitsKey, HOURLY_TTL)
        .hincrby(dailyHitsKey, currentDayKey(), 1)
        .expire(dailyHitsKey, DAILY_TTL)
        .exec();
    } catch (err) {
      reportStatsFailure('hit', err);
    }
  })();
}

/**
 * 白名单豁免：条目为 IP、CIDR（如 10.0.0.0/8）或 `u:{userId}`。
 * 命中者跳过计数与拦截；条目非法时忽略该条（不影响其余条目）。
 */
function isAllowlisted(rule: RuleConfig, c: Context): boolean {
  if (rule.allowlist.length === 0) return false;
  let userId: number | undefined;
  try {
    userId = currentUser()?.userId;
  } catch {
    userId = undefined;
  }
  const ip = getClientIp(c);
  for (const entry of rule.allowlist) {
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
  if (isAllowlisted(rule, c)) return next();
  recordHitStats(rule.name);
  const identity = identityFor(rule, c);
  const counterKey = `${RL_PREFIX}${rule.name}|${identity}`;
  const banKey = `${RL_BAN_PREFIX}${rule.name}|${identity}`;
  let hit: LimiterHit;
  try {
    hit = rule.algorithm === 'sliding_window'
      ? await slidingWindowHit(counterKey, banKey, rule.windowMs)
      : await fixedWindowHit(counterKey, banKey, rule.windowMs);
  } catch (err) {
    reportStatsFailure('counter', err);
    return next();
  }
  if (hit.count === -1) {
    recordBlockedStats(rule, c, identity, true);
    return c.json(errBody('访问已被临时封禁，请稍后再试', 429), 429, {
      'Retry-After': String(Math.ceil(hit.resetMs / 1000)),
    });
  }
  const resetSec = Math.ceil(hit.resetMs / 1000);
  c.header('RateLimit-Limit', String(rule.limit));
  c.header('RateLimit-Remaining', String(Math.max(0, Math.floor(rule.limit - hit.count))));
  c.header('RateLimit-Reset', String(resetSec));
  if (hit.count <= rule.limit) return next();
  recordBlockedStats(rule, c, identity);
  if (rule.mode === 'monitor') return next();
  return c.json(errBody(rule.blockedMessage ?? '请求过于频繁，请稍后再试', 429), 429, {
    'Retry-After': String(resetSec),
  });
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
    const rule = ruleCache.get(name);
    if (!rule?.enabled) return next();
    if (alreadyApplied(c, name)) return next();
    return applyRule(rule, c, next);
  };
}

export const authRateLimit: MiddlewareHandler = makeNamed('auth');
export const captchaRateLimit: MiddlewareHandler = makeNamed('captcha');
export const sensitiveRateLimit: MiddlewareHandler = makeNamed('sensitive');

/** 内置规则名称集合（不可删除） */
export const PREDEFINED_NAMES = new Set(['auth', 'captcha', 'sensitive', 'analytics-ingest', 'error-report', 'replay-ingest', 'report_public_share', 'workflow_public_callback', 'push_public_callback', 'payment_public_link', 'chat_send', 'chatbi_ask', 'report_chatbi_write', 'report_fill_write', 'ai_chat_send', 'ai_share_view', 'drive_public_share', 'chunk_upload']);

/**
 * 代码中通过 authRateLimit / namedRateLimit(...) 静态挂载的规则名。
 * 新增代码挂载点时必须同步维护（rate-limit.test.ts 有一致性校验兜底）；
 * 用于管理页的「挂载来源」标识——无代码挂载且无路径绑定的规则是死规则。
 */
export const CODE_MOUNTED_NAMES = new Set(['auth', 'captcha', 'sensitive', 'analytics-ingest', 'error-report', 'replay-ingest', 'payment_public_link', 'chat_send', 'chatbi_ask', 'report_chatbi_write', 'report_fill_write', 'ai_chat_send', 'ai_share_view']);

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

const PATH_PATTERN_CACHE = new Map<string, RegExp>();

/**
 * 路径模式 → 正则：结尾的 `/*` 匹配任意多级后缀（含恰好到该前缀本身），路径中间的 `*` 只匹配一个路径段
 * （如 `/api/app-releases/releases/*\/artifacts/upload/chunk`），其余字符按字面匹配。
 */
function pathPatternRegex(pattern: string): RegExp {
  let regex = PATH_PATTERN_CACHE.get(pattern);
  if (!regex) {
    const anySuffix = pattern.endsWith('/*');
    const core = anySuffix ? pattern.slice(0, -2) : pattern;
    const source = core.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+');
    regex = new RegExp(`^${source}${anySuffix ? '(?:/.*)?' : ''}$`);
    PATH_PATTERN_CACHE.set(pattern, regex);
  }
  return regex;
}

function matchesPath(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => pathPatternRegex(pattern).test(path));
}

/**
 * 全局路径绑定限流中间件：自动应用 pathPatterns 匹配的规则。
 * 多条规则命中同一路径时取 priority 最大者（同优先级按规则缓存序取先出现者），
 * 一个请求只应用一条路径绑定规则。
 */
export const pathBoundRateLimit: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  let selected: RuleConfig | undefined;
  for (const rule of ruleCache.values()) {
    if (!rule.enabled || !rule.pathPatterns.length) continue;
    if (!matchesPath(rule.pathPatterns, path)) continue;
    if (!selected || rule.priority > selected.priority) selected = rule;
  }
  if (!selected || alreadyApplied(c, selected.name)) return next();
  return applyRule(selected, c, next);
};

/** 从数据库加载规则到内存缓存 */
export async function refreshRateLimitRules(): Promise<void> {
  try {
    const rows = await db.select().from(rateLimitRules);
    const next = new Map<string, RuleConfig>(Object.entries(DEFAULTS));
    for (const r of rows) {
      next.set(r.name, {
        name: r.name,
        description: r.description,
        windowMs: r.windowMs,
        limit: r.limit,
        keyType: r.keyType,
        enabled: r.enabled,
        mode: r.mode,
        algorithm: r.algorithm,
        allowlist: r.allowlist ?? [],
        priority: r.priority,
        alertThreshold: r.alertThreshold,
        blockedMessage: r.blockedMessage,
        pathPatterns: r.pathPatterns ?? [],
      });
    }
    ruleCache.clear();
    for (const [k, v] of next) ruleCache.set(k, v);
    logger.info(`[rate-limit] reloaded ${rows.length} rule(s) from DB`);
  } catch (err) {
    logger.warn('[rate-limit] DB load failed, using defaults', err);
  }
}

/** 服务启动时调用，预热规则缓存 */
export async function bootstrapRateLimitRules(): Promise<void> {
  await refreshRateLimitRules();
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
 * 同时从最近拦截记录中移除该身份的条目。
 */
export async function unblockRateLimitKey(name: string, key: string): Promise<boolean> {
  const base = `${RL_PREFIX}${name}|${key}`;
  // 滑动窗口的计数分布在带桶序号的键上；按规则当前窗口宽度推导本桶与上一桶
  const keysToDelete = [base];
  const rule = ruleCache.get(name);
  if (rule && rule.windowMs > 0) {
    const bucket = Math.floor(Date.now() / rule.windowMs);
    keysToDelete.push(`${base}:${bucket}`, `${base}:${bucket - 1}`);
  }
  const n = await redis.del(...keysToDelete);
  try {
    const recentKey = `${STATS_PREFIX}${name}:recent`;
    const members = await redis.zrange(recentKey, '0', '-1');
    const toRemove = members.filter((m) => {
      try {
        return (JSON.parse(m) as RecentBlockRecord).key === key;
      } catch {
        return false;
      }
    });
    if (toRemove.length > 0) await redis.zrem(recentKey, ...toRemove);
  } catch {
    /* ignore */
  }
  return n > 0;
}

// ─── 手动封禁 ─────────────────────────────────────────────────────────────────

export interface RateLimitBan {
  name: string;
  key: string;
  /** 剩余毫秒 */
  ttlMs: number;
}

/**
 * 手动封禁某个身份：无视限额与观察模式，封禁期内该身份在此规则下的请求一律 429。
 * 封禁键带 TTL 自动过期；解除用 unbanRateLimitKey。
 */
export async function banRateLimitKey(name: string, key: string, durationSeconds: number): Promise<void> {
  await redis.set(`${RL_BAN_PREFIX}${name}|${key}`, '1', 'PX', durationSeconds * 1000);
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
      bans.push({ name: suffix.slice(0, sep), key: suffix.slice(sep + 1), ttlMs });
    }
  } while (cursor !== '0');
  return bans.sort((a, b) => a.ttlMs - b.ttlMs);
}

export const RATE_LIMIT_KEYS = {
  rlPrefix: RL_PREFIX,
  statsPrefix: STATS_PREFIX,
} as const;
