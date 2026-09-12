import { and, eq, gte, lt, desc, isNull, or } from 'drizzle-orm';
import { buildListResult } from '../../lib/list-query';
import { requireFirstRow } from '../../lib/db-assert';
import { db } from '../../db';
import { errorAlertRules, errorAlertLogs, errorEvents, errorGroups } from '../../db/schema';
import type { ErrorAlertRuleRow, ErrorAlertLogRow } from '../../db/schema';
import { frontendErrorContract } from '@zenith/shared/analytics';
import type { CreateErrorAlertRuleInput, UpdateErrorAlertRuleInput, FrontendErrorType, ErrorLevel } from '@zenith/shared/analytics';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { buildWhere, nullableEq } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { validateAlertDelivery } from '../../lib/alert-validation';
import { dispatchAlertChannels } from '../../lib/alert-dispatch';
import type { PaginationQuery, QueryOutputOf } from '@zenith/shared/core';

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
    ...formatTimestamps(row),
  };
}

export type AlertRuleListQuery = PaginationQuery;
export async function listAlertRules(q: AlertRuleListQuery) {
  const { page, pageSize } = q;
  const where = tenantScope(errorAlertRules);
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(errorAlertRules, where),
    rows: () => db.select().from(errorAlertRules).where(where).orderBy(desc(errorAlertRules.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapRule,
  });
}

export async function ensureRuleExists(id: number) {
  return requireFirstRow(db.select().from(errorAlertRules).where(buildWhere(eq(errorAlertRules.id, id), tenantScope(errorAlertRules))).limit(1), '告警规则不存在');
}

export async function createAlertRule(input: CreateErrorAlertRuleInput) {
  validateAlertDelivery({
    enabled: input.enabled ?? true,
    channels: input.channels ?? [],
    webhookUrl: input.webhookUrl ?? null,
    recipients: input.recipients ?? [],
  });
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
  const current = await ensureRuleExists(id);
  validateAlertDelivery({
    enabled: input.enabled ?? current.enabled,
    channels: input.channels ?? current.channels ?? [],
    webhookUrl: input.webhookUrl === undefined ? current.webhookUrl : input.webhookUrl,
    recipients: input.recipients ?? current.recipients ?? [],
  });
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
/** 规则作用域（错误类型 / 级别 / 租户归属：null → IS NULL），事件表与分组表共用同一组列名 */
function ruleScopeConditions(rule: ErrorAlertRuleRow, table: typeof errorEvents | typeof errorGroups) {
  return [
    rule.errorType ? eq(table.errorType, rule.errorType) : undefined,
    rule.level ? eq(table.level, rule.level) : undefined,
    nullableEq(table.tenantId, rule.tenantId),
  ];
}

async function dispatchAlert(rule: ErrorAlertRuleRow, detail: string): Promise<void> {
  await dispatchAlertChannels(
    {
      channels: rule.channels ?? [],
      webhookUrl: rule.webhookUrl,
      recipients: rule.recipients ?? [],
      tenantId: rule.tenantId,
    },
    {
      eventKey: 'ops.error.alert',
      vars: { ruleName: rule.name, detail },
      html: `<h3>错误监控告警</h3><p><b>规则：</b>${rule.name}</p><p><b>详情：</b>${detail}</p><p>请前往后台「错误监控」查看处理。</p>`,
      inAppType: 'error',
      webhookBody: { type: 'error_alert', rule: rule.name, detail, condition: rule.condition, timestamp: formatDateTime(new Date()) },
      logTag: 'ErrorAlert',
    },
  );
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
  const evWhere = buildWhere(gte(errorEvents.createdAt, windowStart), ...ruleScopeConditions(rule, errorEvents));

  if (rule.condition === 'threshold') {
    const c = await db.$count(errorEvents, evWhere);
    if (c >= rule.thresholdCount) return { hit: true, detail: `${rule.windowMinutes} 分钟内发生 ${c} 次错误，已达阈值 ${rule.thresholdCount}` };
  } else if (rule.condition === 'new_error') {
    const c = await db.$count(errorGroups, buildWhere(gte(errorGroups.firstSeenAt, windowStart), ...ruleScopeConditions(rule, errorGroups)));
    if (c > 0) return { hit: true, detail: `${rule.windowMinutes} 分钟内新增 ${c} 类新错误` };
  } else if (rule.condition === 'spike') {
    const prevStart = new Date(now - rule.windowMinutes * 2 * 60_000);
    const prevWhere = buildWhere(
      gte(errorEvents.createdAt, prevStart),
      lt(errorEvents.createdAt, windowStart),
      ...ruleScopeConditions(rule, errorEvents),
    );
    const [cur, prev] = await Promise.all([
      db.$count(errorEvents, evWhere),
      db.$count(errorEvents, prevWhere),
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

export async function listAlertLogs(q: QueryOutputOf<typeof frontendErrorContract.alertLogs>) {
  const { page, pageSize } = q;
  const where = buildWhere(q.ruleId != null ? eq(errorAlertLogs.ruleId, q.ruleId) : undefined, tenantScope(errorAlertLogs));
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(errorAlertLogs, where),
    rows: () => db.select().from(errorAlertLogs).where(where).orderBy(desc(errorAlertLogs.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapAlertLog,
  });
}
