import { currentUser } from '../../lib/context';
import type { QueryOutputOf } from '@zenith/shared/core';
import { rateLimitContract } from '@zenith/shared/platform';
import { readRateLimitMetrics, resetRateLimitMetrics, rateLimitStatsHealth } from '../../lib/rate-limit-stats';
import type { z } from 'zod';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import {
  createRateLimitRuleSchema,
  updateRateLimitRuleSchema,
  rateLimitDiagnoseSchema,
  rateLimitMatches,
  rateLimitPathMatches,
  selectRateLimitRule,
  type RateLimitOptions,
} from '@zenith/shared/platform';
import { getApiCatalog } from '../identity/api-catalog.service';
import { getRateLimitRuntimeState } from '../../middleware/rate-limit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { rateLimitRules, users } from '../../db/schema';
import type { RateLimitRuleRow } from '../../db/schema';
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
} from '../../middleware/rate-limit';
import { requireRow } from '../../lib/db-assert';

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
    methods: row.options.methods ?? [],
    extraWindows: row.options.extraWindows ?? [],
    failMode: row.options.failMode ?? 'open',
    policyVersion: createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 12),
    loadState: getRateLimitRuntimeState().fresh ? ('loaded' as const) : ('pending' as const),
    matchedOperationCount: getRateLimitOperations().filter((op) =>
      rateLimitMatches({ ...row, methods: row.options.methods }, op.method, op.path),
    ).length,
    warnings:
      !getMountSource(row.name, row.pathPatterns).includes('code') && !row.pathPatterns.length
        ? ['未绑定接口，不会执行']
        : [],
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
  return Object.fromEntries(OPTION_KEYS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}
function validatePolicy(
  input: UpdateRateLimitRuleInput,
  merged: { enabled: boolean; name: string; pathPatterns: string[]; options: RateLimitOptions; keyType: string },
): void {
  for (const entry of input.allowlist ?? []) {
    if (/^[um]:[0-9]+$/.test(entry) || /^[uma]:(?:platform|[0-9]+):[A-Za-z0-9_-]+$/.test(entry)) continue;
    const [ip, prefix] = entry.split('/');
    const family = isIP(ip);
    if (!family || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))))
      throw new HTTPException(400, { message: '非法豁免身份或 IP/CIDR：' + entry });
  }
  if (merged.enabled && !PREDEFINED_NAMES.has(merged.name) && !merged.pathPatterns.length)
    throw new HTTPException(400, { message: '启用自定义规则前必须绑定接口，可先保存为停用规则' });
  if (
    merged.enabled &&
    merged.pathPatterns.some(
      (pattern) =>
        rateLimitPathMatches(pattern, '/api/rate-limit/rules') || rateLimitPathMatches(pattern, '/api/health/readyz'),
    )
  )
    throw new HTTPException(400, { message: '绑定范围覆盖管理恢复或健康探针，请缩小路径范围' });
  if (
    new Set([input.windowMs, ...(merged.options.extraWindows ?? []).map((w) => w.windowMs)].filter(Boolean)).size !==
    [input.windowMs, ...(merged.options.extraWindows ?? []).map((w) => w.windowMs)].filter(Boolean).length
  )
    throw new HTTPException(400, { message: '附加窗口不能与主窗口重复' });
}

async function validateAlertRecipients(ids: number[] | undefined) {
  if (!ids?.length) return;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.tenantId), eq(users.status, 'enabled')));
  if (rows.length !== new Set(ids).size) throw new HTTPException(400, { message: '告警接收人必须是启用的平台用户' });
}

export async function updateRateLimitRule(id: number, patch: UpdateRateLimitRuleInput) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  requireRow(row, '规则不存在');
  await validateAlertRecipients(patch.alertUserIds);
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
  await validateAlertRecipients(input.alertUserIds);
  validatePolicy(input, { ...input, pathPatterns: input.pathPatterns ?? [], options: optionsFrom(input) });
  const [existing] = await db
    .select({ id: rateLimitRules.id })
    .from(rateLimitRules)
    .where(eq(rateLimitRules.name, input.name));
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

async function metricsFor(cfg: RuleConfig, details = false) {
  const data = await readRateLimitMetrics(cfg.name, details);
  return {
    name: cfg.name,
    description: cfg.description,
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    keyType: cfg.keyType,
    enabled: cfg.enabled,
    mode: cfg.mode,
    hitCount: data.hits,
    blockedCount: data.blocked,
    blockRate: data.hits ? Math.round((data.blocked / data.hits) * 10000) / 100 : 0,
    monitoredCount: data.monitored,
    bannedCount: data.banned,
    exemptCount: data.exempt,
    degradedCount: data.degraded,
    recentBlocks: data.events.map((event) => ({
      ...event,
      at: formatDateTime(new Date(event.ts)),
      monitored: event.decision === 'monitored',
      banned: event.decision === 'banned',
    })),
    hourlySeries: data.hourlySeries,
    dailySeries: data.dailySeries,
    topSources: data.topSources,
  };
}
export async function getRateLimitStats() {
  return {
    items: await Promise.all(listRuleConfigs().map((cfg) => metricsFor(cfg))),
    ...rateLimitStatsHealth(),
    scope: '最近24个小时桶的规则命中次数；同一请求可命中多个保护层，不等于HTTP请求数',
  };
}
export async function getRateLimitDetailStats(id: number) {
  const [row] = await db.select().from(rateLimitRules).where(eq(rateLimitRules.id, id));
  const rule = requireRow(row, '规则不存在');
  return metricsFor({ ...rule, ...rule.options }, true);
}
export async function listRateLimitEvents(query: QueryOutputOf<typeof rateLimitContract.events>) {
  const rules = listRuleConfigs().filter((rule) => !query.name || rule.name.includes(query.name));
  const rows = (await Promise.all(rules.map((rule) => metricsFor(rule, true))))
    .flatMap((stat) => stat.recentBlocks.map((event) => ({ ...event, name: stat.name })))
    .filter(
      (event) =>
        (!query.decision || event.decision === query.decision) &&
        (!query.keyword || event.key.includes(query.keyword) || event.path.includes(query.keyword)),
    )
    .sort((a, b) => b.ts - a.ts || (b.id ?? '').localeCompare(a.id ?? ''));
  return {
    list: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    total: rows.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** 解封指定 key（清除 Redis 计数窗口） */
export async function unblockRateLimit(name: string, key: string) {
  if (!key) throw new HTTPException(400, { message: 'key 不能为空' });
  const ok = await unblockRateLimitKey(name, key);
  return { unblocked: ok };
}

/** 清空指定规则的统计（hit / blocked / recent） */
export async function resetRateLimitStats(name: string) {
  ensureRuleExists(name);
  await resetRateLimitMetrics(name);
  return { reset: true };
}

// ─── 手动封禁 ─────────────────────────────────────────────────────────────────

function ensureRuleExists(name: string): void {
  if (!listRuleConfigs().some((r) => r.name === name)) {
    throw new HTTPException(404, { message: `规则 ${name} 不存在` });
  }
}

/** 手动封禁：封禁期内该身份在此规则下的请求一律 429（无视限额与观察模式） */
export async function banRateLimit(name: string, key: string, durationSeconds: number, reason = '管理员临时封禁') {
  ensureRuleExists(name);
  await banRateLimitKey(name, key, durationSeconds, { reason, createdBy: currentUser().userId });
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
    reason: b.reason,
    createdBy: b.createdBy,
    expiresAt: formatDateTime(new Date(now + b.ttlMs)),
    remainingSeconds: Math.max(1, Math.ceil(b.ttlMs / 1000)),
  }));
}

export function getRateLimitOperations() {
  return getApiCatalog()
    .items.map((item) => ({
      method: item.method.toUpperCase(),
      path: item.fullPath,
      summary: item.summary,
      security: item.security,
    }))
    .concat([{ method: 'GET', path: '/s/{code}', summary: '公开短链跳转', security: 'none' }]);
}
export function diagnoseRateLimit(input: z.output<typeof rateLimitDiagnoseSchema>) {
  const path = input.path.split('?')[0];
  const rules = listRuleConfigs();
  const ipRule = selectRateLimitRule(rules, input.method, path, false);
  const identityRule =
    input.principal === 'anonymous' ? undefined : selectRateLimitRule(rules, input.method, path, true);
  const selected = [ipRule?.name, identityRule?.name].filter((name): name is string => Boolean(name));
  const template =
    getRateLimitOperations().find((op) => op.method === input.method && rateLimitPathMatches(op.path, path))?.path ??
    '/[unmatched]';
  return {
    path: template,
    method: input.method,
    selected,
    matches: rules
      .filter((rule) => rateLimitMatches(rule, input.method, path))
      .map((rule) => ({
        name: rule.name,
        selected: selected.includes(rule.name),
        stage: rule.keyType === 'user' ? '认证后' : '认证前',
        reason: !rule.enabled
          ? '规则已停用'
          : rule.keyType === 'user' && input.principal === 'anonymous'
            ? '无已认证身份，不执行身份规则'
            : selected.includes(rule.name)
              ? '路径和方法匹配，按优先级选中'
              : '被同阶段更高优先级规则覆盖',
      })),
    note: '仅诊断配置匹配，不消耗额度；当前并发额度、具名业务保护和认证结果仍以真实请求为准。',
  };
}
