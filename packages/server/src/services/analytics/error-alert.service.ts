import { and, eq, gte, lt, desc, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { errorAlertRules, errorEvents, errorGroups } from '../../db/schema';
import type { ErrorAlertRuleRow } from '../../db/schema';
import type { CreateErrorAlertRuleInput, UpdateErrorAlertRuleInput } from '@zenith/shared';
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

// ─── 告警评估（cron）─────────────────────────────────────────────────────────
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

export async function evaluateAlerts(): Promise<{ evaluated: number; triggered: number }> {
  const rules = await db.select().from(errorAlertRules).where(eq(errorAlertRules.enabled, true));
  const now = Date.now();

  // 规则间相互独立：并行评估，避免串行累积多次 COUNT 往返
  const results = await Promise.all(rules.map(async (rule) => {
    // 去抖：上次触发距今不足一个窗口则跳过
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt.getTime() < rule.windowMinutes * 60_000) return false;

    const windowStart = new Date(now - rule.windowMinutes * 60_000);
    const tId = tenantFilter(rule.tenantId);

    const evConds = [gte(errorEvents.createdAt, windowStart)];
    if (rule.errorType) evConds.push(eq(errorEvents.errorType, rule.errorType));
    if (rule.level) evConds.push(eq(errorEvents.level, rule.level));
    if (tId != null) evConds.push(eq(errorEvents.tenantId, tId));
    else evConds.push(isNull(errorEvents.tenantId));
    const evWhere = and(...evConds);

    let hit = false;
    let detail = '';

    if (rule.condition === 'threshold') {
      const c = await db.$count(errorEvents, evWhere);
      if (c >= rule.thresholdCount) { hit = true; detail = `${rule.windowMinutes} 分钟内发生 ${c} 次错误，已达阈值 ${rule.thresholdCount}`; }
    } else if (rule.condition === 'new_error') {
      const gConds = [gte(errorGroups.firstSeenAt, windowStart)];
      if (rule.errorType) gConds.push(eq(errorGroups.errorType, rule.errorType));
      if (rule.level) gConds.push(eq(errorGroups.level, rule.level));
      if (tId != null) gConds.push(eq(errorGroups.tenantId, tId)); else gConds.push(isNull(errorGroups.tenantId));
      const c = await db.$count(errorGroups, and(...gConds));
      if (c > 0) { hit = true; detail = `${rule.windowMinutes} 分钟内新增 ${c} 类新错误`; }
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
      if (cur >= rule.thresholdCount && cur > prev * 2) { hit = true; detail = `错误激增：当前周期 ${cur} 次，上一周期 ${prev} 次`; }
    }

    if (hit) {
      await dispatchAlert(rule, detail);
      await db.update(errorAlertRules).set({ lastTriggeredAt: new Date() }).where(eq(errorAlertRules.id, rule.id));
    }
    return hit;
  }));

  return { evaluated: rules.length, triggered: results.filter(Boolean).length };
}
