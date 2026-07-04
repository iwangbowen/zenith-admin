import { and, eq, gte, lt, desc, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { errorAlertRules, errorAlertLogs, errorEvents, errorGroups } from '../../db/schema';
import type { ErrorAlertRuleRow, ErrorAlertLogRow } from '../../db/schema';
import type { CreateErrorAlertRuleInput, UpdateErrorAlertRuleInput, FrontendErrorType, ErrorLevel } from '@zenith/shared';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { mergeWhere } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { sendMail } from '../../lib/email';
import { httpPost } from '../../lib/http-client';
import logger from '../../lib/logger';

export function mapRule(row: ErrorAlertRuleRow) {
  return {
    id: row.id,
    name: row.name,
    errorType: row.errorType,
    level: row.level,
    condition: row.condition,
    thresholdCount: row.thresholdCount,
    windowMinutes: row.windowMinutes,
    channels: row.channels ?? [],
    webhookUrl: row.webhookUrl,
    recipients: row.recipients ?? [],
    enabled: row.enabled,
    lastTriggeredAt: formatNullableDateTime(row.lastTriggeredAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface AlertRuleListQuery { page?: number; pageSize?: number }
export async function listAlertRules(q: AlertRuleListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const where = tenantScope(errorAlertRules);
  const [list, total] = await Promise.all([
    db.select().from(errorAlertRules).where(where).orderBy(desc(errorAlertRules.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(errorAlertRules, where),
  ]);
  return { list: list.map(mapRule), total, page, pageSize };
}

export async function ensureRuleExists(id: number) {
  const [row] = await db.select().from(errorAlertRules).where(mergeWhere(eq(errorAlertRules.id, id), tenantScope(errorAlertRules))).limit(1);
  if (!row) throw new HTTPException(404, { message: '告警规则不存在' });
  return row;
}

export async function createAlertRule(input: CreateErrorAlertRuleInput) {
  const [row] = await db
    .insert(errorAlertRules)
    .values({
      tenantId: currentCreateTenantId(),
      name: input.name,
      errorType: input.errorType ?? null,
      level: input.level ?? null,
      condition: input.condition ?? 'threshold',
      thresholdCount: input.thresholdCount ?? 10,
      windowMinutes: input.windowMinutes ?? 60,
      channels: input.channels ?? [],
      webhookUrl: input.webhookUrl ?? null,
      recipients: input.recipients ?? [],
      enabled: input.enabled ?? true,
    })
    .returning();
  return mapRule(row);
}

export async function updateAlertRule(id: number, input: UpdateErrorAlertRuleInput) {
  await ensureRuleExists(id);
  const [row] = await db
    .update(errorAlertRules)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.errorType !== undefined ? { errorType: input.errorType } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.condition !== undefined ? { condition: input.condition } : {}),
      ...(input.thresholdCount !== undefined ? { thresholdCount: input.thresholdCount } : {}),
      ...(input.windowMinutes !== undefined ? { windowMinutes: input.windowMinutes } : {}),
      ...(input.channels !== undefined ? { channels: input.channels } : {}),
      ...(input.webhookUrl !== undefined ? { webhookUrl: input.webhookUrl } : {}),
      ...(input.recipients !== undefined ? { recipients: input.recipients } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    })
    .where(eq(errorAlertRules.id, id))
    .returning();
  return mapRule(row);
}

export async function deleteAlertRule(id: number) {
  await ensureRuleExists(id);
  await db.delete(errorAlertRules).where(eq(errorAlertRules.id, id));
}

// ─── 告警评估（cron 定时保底 + 错误上报实时联动）─────────────────────────────
function tenantFilter(tenantId: number | null) {
  return tenantId == null ? undefined : tenantId;
}

async function dispatchAlert(rule: ErrorAlertRuleRow, detail: string): Promise<void> {
  const subject = `[错误告警] ${rule.name}`;
  const html = `<h3>错误监控告警</h3><p><b>规则：</b>${rule.name}</p><p><b>详情：</b>${detail}</p><p>请前往后台「错误监控」查看处理。</p>`;
  const channels = rule.channels ?? [];
  await Promise.allSettled([
    ...(channels.includes('webhook') && rule.webhookUrl
      ? [httpPost(rule.webhookUrl, { type: 'error_alert', rule: rule.name, detail, condition: rule.condition, timestamp: formatDateTime(new Date()) }, { timeout: 8000 })]
      : []),
    ...(channels.includes('email')
      ? (rule.recipients ?? []).filter((r) => r.includes('@')).map((to) => sendMail(to, subject, html))
      : []),
  ]);
  if (channels.includes('inapp')) {
    logger.info(`[ErrorAlert] in-app notify (rule=${rule.name}): ${detail}`);
  }
}

/**
 * 命中后抢占触发权：条件 UPDATE 原子推进 lastTriggeredAt，
 * 并发评估（cron 与实时路径同时命中）时仅一方成功，杜绝重复告警。
 * 抢占成功后记录触发历史并分发通知。
 */
async function tryTriggerAlert(rule: ErrorAlertRuleRow, detail: string, source: 'cron' | 'realtime'): Promise<boolean> {
  const debounceBefore = new Date(Date.now() - rule.windowMinutes * 60_000);
  const claimed = await db
    .update(errorAlertRules)
    .set({ lastTriggeredAt: new Date() })
    .where(and(
      eq(errorAlertRules.id, rule.id),
      or(isNull(errorAlertRules.lastTriggeredAt), lt(errorAlertRules.lastTriggeredAt, debounceBefore)),
    ))
    .returning({ id: errorAlertRules.id });
  if (claimed.length === 0) return false;

  await db.insert(errorAlertLogs).values({
    tenantId: rule.tenantId,
    ruleId: rule.id,
    ruleName: rule.name,
    condition: rule.condition,
    detail,
    channels: rule.channels ?? [],
    source,
  });
  await dispatchAlert(rule, detail);
  return true;
}

/** 评估单条规则是否命中（不含去抖/分发）。 */
async function evaluateRule(rule: ErrorAlertRuleRow, now: number): Promise<{ hit: boolean; detail: string }> {
  const windowStart = new Date(now - rule.windowMinutes * 60_000);
  const tId = tenantFilter(rule.tenantId);

  const evConds = [gte(errorEvents.createdAt, windowStart)];
  if (rule.errorType) evConds.push(eq(errorEvents.errorType, rule.errorType));
  if (rule.level) evConds.push(eq(errorEvents.level, rule.level));
  if (tId != null) evConds.push(eq(errorEvents.tenantId, tId));
  else evConds.push(isNull(errorEvents.tenantId));
  const evWhere = and(...evConds);

  if (rule.condition === 'threshold') {
    const c = await db.$count(errorEvents, evWhere);
    if (c >= rule.thresholdCount) return { hit: true, detail: `${rule.windowMinutes} 分钟内发生 ${c} 次错误，已达阈值 ${rule.thresholdCount}` };
  } else if (rule.condition === 'new_error') {
    const gConds = [gte(errorGroups.firstSeenAt, windowStart)];
    if (rule.errorType) gConds.push(eq(errorGroups.errorType, rule.errorType));
    if (rule.level) gConds.push(eq(errorGroups.level, rule.level));
    if (tId != null) gConds.push(eq(errorGroups.tenantId, tId)); else gConds.push(isNull(errorGroups.tenantId));
    const c = await db.$count(errorGroups, and(...gConds));
    if (c > 0) return { hit: true, detail: `${rule.windowMinutes} 分钟内新增 ${c} 类新错误` };
  } else if (rule.condition === 'spike') {
    const prevStart = new Date(now - rule.windowMinutes * 2 * 60_000);
    const prevConds = [gte(errorEvents.createdAt, prevStart), lt(errorEvents.createdAt, windowStart)];
    if (rule.errorType) prevConds.push(eq(errorEvents.errorType, rule.errorType));
    if (rule.level) prevConds.push(eq(errorEvents.level, rule.level));
    if (tId != null) prevConds.push(eq(errorEvents.tenantId, tId)); else prevConds.push(isNull(errorEvents.tenantId));
    const [cur, prev] = await Promise.all([
      db.$count(errorEvents, evWhere),
      db.$count(errorEvents, and(...prevConds)),
    ]);
    if (cur >= rule.thresholdCount && cur > prev * 2) return { hit: true, detail: `错误激增：当前周期 ${cur} 次，上一周期 ${prev} 次` };
  }
  return { hit: false, detail: '' };
}

/** 上次触发距今不足一个窗口则无需评估（便宜的预筛，正式去抖在 tryTriggerAlert）。 */
function withinDebounce(rule: ErrorAlertRuleRow, now: number): boolean {
  return rule.lastTriggeredAt != null && now - rule.lastTriggeredAt.getTime() < rule.windowMinutes * 60_000;
}

export async function evaluateAlerts(): Promise<{ evaluated: number; triggered: number }> {
  const rules = await db.select().from(errorAlertRules).where(eq(errorAlertRules.enabled, true));
  const now = Date.now();

  // 规则间相互独立：并行评估，避免串行累积多次 COUNT 往返
  const results = await Promise.all(rules.map(async (rule) => {
    if (withinDebounce(rule, now)) return false;
    const { hit, detail } = await evaluateRule(rule, now);
    if (!hit) return false;
    return tryTriggerAlert(rule, detail, 'cron');
  }));

  return { evaluated: rules.length, triggered: results.filter(Boolean).length };
}

/**
 * 错误上报实时联动：仅评估与该错误（类型/等级/租户）匹配的启用规则，
 * new_error 条件直接由 isNewGroup 短路，threshold/spike 复用窗口计数。
 * 由 reportError 异步调用（best-effort），cron 仍作保底。
 */
export async function evaluateAlertsForError(input: {
  tenantId: number | null;
  errorType: FrontendErrorType;
  level: ErrorLevel;
  isNewGroup: boolean;
}): Promise<void> {
  const rules = await db.select().from(errorAlertRules).where(eq(errorAlertRules.enabled, true));
  const now = Date.now();
  const matched = rules.filter((rule) =>
    (rule.errorType == null || rule.errorType === input.errorType)
    && (rule.level == null || rule.level === input.level)
    && (rule.tenantId ?? null) === (input.tenantId ?? null));

  await Promise.all(matched.map(async (rule) => {
    if (withinDebounce(rule, now)) return;
    if (rule.condition === 'new_error') {
      if (!input.isNewGroup) return;
      await tryTriggerAlert(rule, '出现新类型错误（实时检测）', 'realtime');
      return;
    }
    const { hit, detail } = await evaluateRule(rule, now);
    if (hit) await tryTriggerAlert(rule, detail, 'realtime');
  }));
}

/**
 * 测试发送告警通知：验证渠道配置，不影响去抖状态（lastTriggeredAt），
 * 历史记录 source='test' 便于区分。
 */
export async function testAlertRule(id: number): Promise<void> {
  const rule = await ensureRuleExists(id);
  const detail = '这是一条测试告警消息，用于验证通知渠道配置是否可用';
  await db.insert(errorAlertLogs).values({
    tenantId: rule.tenantId,
    ruleId: rule.id,
    ruleName: rule.name,
    condition: rule.condition,
    detail,
    channels: rule.channels ?? [],
    source: 'test',
  });
  await dispatchAlert(rule, detail);
}

// ─── 告警触发历史 ─────────────────────────────────────────────────────────────
export function mapAlertLog(row: ErrorAlertLogRow) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    condition: row.condition,
    detail: row.detail,
    channels: row.channels ?? [],
    source: row.source,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface AlertLogListQuery { page?: number; pageSize?: number; ruleId?: number }
export async function listAlertLogs(q: AlertLogListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const where = mergeWhere(q.ruleId != null ? eq(errorAlertLogs.ruleId, q.ruleId) : undefined, tenantScope(errorAlertLogs));
  const [list, total] = await Promise.all([
    db.select().from(errorAlertLogs).where(where).orderBy(desc(errorAlertLogs.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(errorAlertLogs, where),
  ]);
  return { list: list.map(mapAlertLog), total, page, pageSize };
}
