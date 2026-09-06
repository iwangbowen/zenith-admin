/**
 * 系统监控告警：规则 CRUD + 阈值评估器 + 多通道派发。
 * 评估器由 pg-boss 定时任务（默认每 30 秒）调用，针对指标即时值判定阈值，
 * 支持「持续 N 分钟超阈才触发」抑制毛刺，并在指标恢复后自动解除告警。
 *
 * 指标全集与标签/单位/租户口径由 `@zenith/shared/platform` 的 MONITOR_METRIC_META 单点定义，
 * 取值由 `monitor-history.service` 汇总各域的告警指标源；新增指标不需要改动本文件。
 */
import { and, eq, desc, gte, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { monitorAlertRules, monitorAlertEvents, users } from '../../db/schema';
import type { MonitorAlertRuleRow, MonitorAlertEventRow } from '../../db/schema';
import type { CreateMonitorAlertRuleInput, UpdateMonitorAlertRuleInput, MonitorAlertRuleQuery, MonitorAlertEventQuery, HandleMonitorAlertEventInput, MonitorAlertOverview, MonitorAlertOverviewRange, MonitorMetric, MonitorAlertOperator } from '@zenith/shared/platform';
import { MONITOR_ALERT_LEVELS, MONITOR_METRIC_META, formatMonitorMetricValue } from '@zenith/shared/platform';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { currentUserId, currentUsername } from '../../lib/context';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { getMetricSnapshotsByTenant } from './monitor-history.service';
import { validateAlertDelivery } from '../../lib/alert-validation';
import { dispatchAlertChannels, type AlertDispatchResult } from '../../lib/alert-dispatch';
import type { DbExecutor } from '../../db/types';

const OPERATOR_SYMBOL: Record<MonitorAlertOperator, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

function metricLabel(metric: MonitorMetric): string {
  return MONITOR_METRIC_META[metric]?.label ?? metric;
}

function compare(value: number, op: MonitorAlertOperator, threshold: number): boolean {
  switch (op) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    default: return false;
  }
}

function normalizeRecipientUserIds(userIds: readonly number[]): number[] {
  return [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
}

function normalizeRecipientEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

async function validateRecipientUsers(
  userIds: readonly number[],
  channels: readonly string[],
  recipientEmails: readonly string[],
  tenantId: number | null,
): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(buildWhere(
      inArray(users.id, userIds),
      eq(users.status, 'enabled'),
      tenantId == null ? undefined : eq(users.tenantId, tenantId),
    ));
  if (rows.length !== userIds.length) {
    throw new HTTPException(400, { message: '接收用户不存在、已停用或不属于当前租户' });
  }
  if (
    channels.includes('email')
    && recipientEmails.length === 0
    && !rows.some((user) => Boolean(user.email))
  ) {
    throw new HTTPException(400, { message: '所选用户均未配置邮箱，请选择有邮箱的用户或填写额外邮箱' });
  }
}

async function resolveActiveRuleEvents(executor: DbExecutor, ruleId: number, resolvedAt: Date): Promise<void> {
  await executor
    .update(monitorAlertEvents)
    .set({ status: 'resolved', resolvedAt })
    .where(and(eq(monitorAlertEvents.ruleId, ruleId), eq(monitorAlertEvents.status, 'firing')));
}

// ─── 映射 ────────────────────────────────────────────────────────────────
export function mapRule(row: MonitorAlertRuleRow) {
  return {
    id: row.id,
    name: row.name,
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    durationMinutes: row.durationMinutes,
    level: row.level,
    channels: row.channels ?? [],
    webhookUrl: row.webhookUrl,
    recipientUserIds: row.recipientUserIds ?? [],
    recipientEmails: row.recipientEmails ?? [],
    silenceMinutes: row.silenceMinutes,
    enabled: row.enabled,
    state: row.state,
    lastTriggeredAt: formatNullableDateTime(row.lastTriggeredAt),
    lastValue: row.lastValue,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapEvent(row: MonitorAlertEventRow, handledByName: string | null = null) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    metric: row.metric,
    level: row.level,
    operator: row.operator,
    threshold: row.threshold,
    value: row.value,
    status: row.status,
    message: row.message,
    notifyStatus: row.notifyStatus,
    notifyChannels: row.notifyChannels ?? [],
    notifyError: row.notifyError,
    notifiedAt: formatNullableDateTime(row.notifiedAt),
    handleStatus: row.handleStatus,
    acknowledgedAt: formatNullableDateTime(row.acknowledgedAt),
    handledBy: row.handledBy,
    handledByName,
    handledAt: formatNullableDateTime(row.handledAt),
    handleNote: row.handleNote,
    triggeredAt: formatDateTime(row.triggeredAt),
    resolvedAt: formatNullableDateTime(row.resolvedAt),
  };
}

// ─── 规则 CRUD ───────────────────────────────────────────────────────────
/**
 * 规则列表的 WHERE 构造。
 *
 * 抽成独立函数是因为筛选此前只在前端对「当前页」做过滤：搜第 2 页搜不到第 1 页的规则，
 * 且分页总数仍是未过滤的值，列表与页码对不上。条件必须下推到 SQL。
 */
export function buildRuleListWhere(q: MonitorAlertRuleQuery) {
  return buildWhere(
    tenantScope(monitorAlertRules),
    keywordCondition(q.keyword, [monitorAlertRules.name], 'ilike'),
    q.metric ? eq(monitorAlertRules.metric, q.metric) : undefined,
    q.level ? eq(monitorAlertRules.level, q.level) : undefined,
    q.enabled === undefined ? undefined : eq(monitorAlertRules.enabled, q.enabled),
    q.state ? eq(monitorAlertRules.state, q.state) : undefined,
  );
}

export async function listRules(q: MonitorAlertRuleQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const where = buildRuleListWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(monitorAlertRules, where),
    rows: () => db.select().from(monitorAlertRules).where(where).orderBy(desc(monitorAlertRules.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapRule,
  });
}

export async function ensureRuleExists(id: number) {
  return requireFirstRow(
    db.select().from(monitorAlertRules).where(buildWhere(eq(monitorAlertRules.id, id), tenantScope(monitorAlertRules))).limit(1),
    '告警规则不存在',
  );
}

export async function getMonitorAlertRuleBeforeAudit(id: number) {
  return mapRule(await ensureRuleExists(id));
}

export async function createRule(input: CreateMonitorAlertRuleInput) {
  const tenantId = currentCreateTenantId();
  const recipientUserIds = normalizeRecipientUserIds(input.recipientUserIds ?? []);
  const recipientEmails = normalizeRecipientEmails(input.recipientEmails ?? []);
  const enabled = input.enabled ?? true;
  validateAlertDelivery({
    enabled,
    channels: input.channels ?? [],
    webhookUrl: input.webhookUrl ?? null,
    recipientUserIds,
    recipientEmails,
  });
  if (enabled) await validateRecipientUsers(recipientUserIds, input.channels ?? [], recipientEmails, tenantId);
  const [row] = await db
    .insert(monitorAlertRules)
    .values({
      tenantId,
      name: input.name,
      metric: input.metric,
      operator: input.operator ?? 'gt',
      threshold: input.threshold,
      durationMinutes: input.durationMinutes ?? 0,
      level: input.level ?? 'warning',
      channels: input.channels ?? [],
      webhookUrl: input.webhookUrl ?? null,
      recipientUserIds,
      recipientEmails,
      silenceMinutes: input.silenceMinutes ?? 30,
      enabled,
    })
    .returning();
  return mapRule(row);
}

export async function updateRule(id: number, input: UpdateMonitorAlertRuleInput) {
  const current = await ensureRuleExists(id);
  const recipientUserIds = normalizeRecipientUserIds(input.recipientUserIds ?? current.recipientUserIds ?? []);
  const recipientEmails = normalizeRecipientEmails(input.recipientEmails ?? current.recipientEmails ?? []);
  const channels = input.channels ?? current.channels ?? [];
  const enabled = input.enabled ?? current.enabled;
  validateAlertDelivery({
    enabled,
    channels,
    webhookUrl: input.webhookUrl === undefined ? current.webhookUrl : input.webhookUrl,
    recipientUserIds,
    recipientEmails,
  });
  if (enabled) await validateRecipientUsers(recipientUserIds, channels, recipientEmails, current.tenantId);
  const resetLifecycle = input.enabled === false || (input.enabled === true && !current.enabled);
  const updateData: Partial<typeof monitorAlertRules.$inferInsert> = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.metric !== undefined ? { metric: input.metric } : {}),
    ...(input.operator !== undefined ? { operator: input.operator } : {}),
    ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.channels !== undefined ? { channels: input.channels } : {}),
    ...(input.webhookUrl !== undefined ? { webhookUrl: input.webhookUrl } : {}),
    ...(input.recipientUserIds !== undefined ? { recipientUserIds } : {}),
    ...(input.recipientEmails !== undefined ? { recipientEmails } : {}),
    ...(input.silenceMinutes !== undefined ? { silenceMinutes: input.silenceMinutes } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(resetLifecycle ? { state: 'ok', breachingSince: null } : {}),
  };
  const update = async (executor: DbExecutor) => {
    const [row] = await executor
      .update(monitorAlertRules)
      .set(updateData)
      .where(eq(monitorAlertRules.id, id))
      .returning();
    return row;
  };

  if (!resetLifecycle) return mapRule(await update(db));

  return db.transaction(async (tx) => {
    const row = await update(tx);
    await resolveActiveRuleEvents(tx, id, new Date());
    return mapRule(row);
  });
}

export async function deleteRule(id: number) {
  await ensureRuleExists(id);
  await db.delete(monitorAlertRules).where(eq(monitorAlertRules.id, id));
}

/** 批量删除：逐条走租户校验，避免跨租户 id 混入被一并删掉 */
export async function deleteRules(ids: number[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  for (const id of unique) await ensureRuleExists(id);
  await db.delete(monitorAlertRules).where(inArray(monitorAlertRules.id, unique));
}

export async function setRuleEnabled(id: number, enabled: boolean) {
  const current = await ensureRuleExists(id);
  validateAlertDelivery({
    enabled,
    channels: current.channels ?? [],
    webhookUrl: current.webhookUrl,
    recipientUserIds: current.recipientUserIds ?? [],
    recipientEmails: current.recipientEmails ?? [],
  });
  if (enabled) {
    await validateRecipientUsers(
      current.recipientUserIds ?? [],
      current.channels ?? [],
      current.recipientEmails ?? [],
      current.tenantId,
    );
  }
  if (enabled && current.enabled) return mapRule(current);

  return db.transaction(async (tx) => {
    const resolvedAt = new Date();
    const [row] = await tx
      .update(monitorAlertRules)
      .set({ enabled, state: 'ok', breachingSince: null })
      .where(eq(monitorAlertRules.id, id))
      .returning();
    await resolveActiveRuleEvents(tx, id, resolvedAt);
    return mapRule(row);
  });
}

/**
 * 批量启停。
 *
 * 启用前逐条校验投递配置：整批一起放行会让一条渠道配置不全的规则被静默启用，
 * 之后每轮评估都产生「触发了但没人收到」的告警。校验失败直接整批拒绝，不做部分成功。
 */
export async function setRulesEnabled(ids: number[], enabled: boolean): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const rules = await Promise.all(unique.map((id) => ensureRuleExists(id)));
  if (enabled) {
    for (const rule of rules) {
      validateAlertDelivery({
        enabled,
        channels: rule.channels ?? [],
        webhookUrl: rule.webhookUrl,
        recipientUserIds: rule.recipientUserIds ?? [],
        recipientEmails: rule.recipientEmails ?? [],
      });
      await validateRecipientUsers(
        rule.recipientUserIds ?? [],
        rule.channels ?? [],
        rule.recipientEmails ?? [],
        rule.tenantId,
      );
    }
  }

  return db.transaction(async (tx) => {
    const resolvedAt = new Date();
    const updated = await tx
      .update(monitorAlertRules)
      .set({ enabled, state: 'ok', breachingSince: null })
      .where(inArray(monitorAlertRules.id, unique))
      .returning({ id: monitorAlertRules.id });
    await tx
      .update(monitorAlertEvents)
      .set({ status: 'resolved', resolvedAt })
      .where(and(inArray(monitorAlertEvents.ruleId, unique), eq(monitorAlertEvents.status, 'firing')));
    return updated.length;
  });
}

// ─── 告警记录列表 ─────────────────────────────────────────────────────────
export function buildEventListWhere(q: MonitorAlertEventQuery) {
  return buildWhere(
    tenantScope(monitorAlertEvents),
    keywordCondition(q.keyword, [monitorAlertEvents.ruleName, monitorAlertEvents.message], 'ilike'),
    q.metric ? eq(monitorAlertEvents.metric, q.metric) : undefined,
    q.level ? eq(monitorAlertEvents.level, q.level) : undefined,
    q.status ? eq(monitorAlertEvents.status, q.status) : undefined,
    q.notifyStatus ? eq(monitorAlertEvents.notifyStatus, q.notifyStatus) : undefined,
    q.handleStatus ? eq(monitorAlertEvents.handleStatus, q.handleStatus) : undefined,
    q.ruleId ? eq(monitorAlertEvents.ruleId, q.ruleId) : undefined,
    ...dateRangeConditions(monitorAlertEvents.triggeredAt, q.startTime, q.endTime),
  );
}

export async function listEvents(q: MonitorAlertEventQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const where = buildEventListWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(monitorAlertEvents, where),
    rows: () => db
      .select({ row: monitorAlertEvents, handledByName: users.nickname })
      .from(monitorAlertEvents)
      .leftJoin(users, eq(users.id, monitorAlertEvents.handledBy))
      .where(where)
      .orderBy(desc(monitorAlertEvents.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (item) => mapEvent(item.row, item.handledByName),
  });
}

// ─── 人工处理 ─────────────────────────────────────────────────────────────
async function ensureEventExists(id: number): Promise<MonitorAlertEventRow> {
  return requireFirstRow(
    db
      .select()
      .from(monitorAlertEvents)
      .where(buildWhere(eq(monitorAlertEvents.id, id), tenantScope(monitorAlertEvents)))
      .limit(1),
    '告警事件不存在',
  );
}

/**
 * 计算一次人工处理产生的字段变更。
 *
 * `acknowledgedAt` 只在首次响应时写入并保持不变——它是 MTTA 的分子，
 * 被后续的「关闭」操作覆盖会让确认耗时统计失真。直接关闭同样算作一次响应。
 * 撤销认领（回到 pending）清空全部处理痕迹，让事件重新回到「没人管」的池子里。
 */
function buildHandlePatch(row: MonitorAlertEventRow, input: HandleMonitorAlertEventInput, at: Date) {
  if (input.handleStatus === 'pending') {
    return {
      handleStatus: 'pending' as const,
      acknowledgedAt: null,
      handledBy: null,
      handledAt: null,
      handleNote: null,
    };
  }
  const note = input.note?.trim();
  return {
    handleStatus: input.handleStatus,
    acknowledgedAt: row.acknowledgedAt ?? at,
    handledBy: currentUserId(),
    handledAt: at,
    handleNote: note ? note : row.handleNote,
  };
}

export async function getMonitorAlertEventBeforeAudit(id: number) {
  return mapEvent(await ensureEventExists(id));
}

export async function handleEvent(id: number, input: HandleMonitorAlertEventInput) {
  const current = await ensureEventExists(id);
  const [row] = await db
    .update(monitorAlertEvents)
    .set(buildHandlePatch(current, input, new Date()))
    .where(eq(monitorAlertEvents.id, id))
    .returning();
  return mapEvent(row, currentUsername());
}

/** 批量处理：逐条走租户校验，避免跨租户 id 混入被一并改写 */
export async function handleEvents(ids: number[], input: HandleMonitorAlertEventInput): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const rows = await Promise.all(unique.map((id) => ensureEventExists(id)));
  const at = new Date();
  return db.transaction(async (tx) => {
    let count = 0;
    for (const row of rows) {
      await tx
        .update(monitorAlertEvents)
        .set(buildHandlePatch(row, input, at))
        .where(eq(monitorAlertEvents.id, row.id));
      count += 1;
    }
    return count;
  });
}

// ─── 派发 ────────────────────────────────────────────────────────────────
async function dispatchAlert(
  rule: MonitorAlertRuleRow,
  message: string,
  recovered: boolean,
  triggeredAt: number,
): Promise<AlertDispatchResult> {
  const tag = recovered ? '已恢复' : '告警';
  return dispatchAlertChannels(
    {
      channels: rule.channels ?? [],
      webhookUrl: rule.webhookUrl,
      recipientUserIds: rule.recipientUserIds ?? [],
      recipientEmails: rule.recipientEmails ?? [],
      tenantId: rule.tenantId,
    },
    {
      eventKey: 'ops.monitor.alert',
      vars: { ruleName: rule.name, tag, message },
      html: `<h3>系统监控${tag}</h3><p><b>规则：</b>${rule.name}</p><p><b>详情：</b>${message}</p><p>请前往后台「监控告警 / 告警记录」查看处理。</p>`,
      inAppType: recovered ? 'success' : rule.level === 'critical' ? 'error' : rule.level === 'info' ? 'info' : 'warning',
      dedupeKey: `monitor-alert:${rule.id}:${recovered ? 'resolved' : 'firing'}:${triggeredAt}`,
      webhookBody: {
        type: recovered ? 'monitor_recovered' : 'monitor_alert',
        rule: rule.name,
        metric: rule.metric,
        level: rule.level,
        message,
        timestamp: formatDateTime(new Date(triggeredAt)),
      },
      logTag: 'MonitorAlert',
    },
  );
}

/** 把真实派发结果落到事件行上，供告警事件列表展示「有没有通知到人」 */
async function recordNotifyResult(eventId: number, result: AlertDispatchResult, at: Date): Promise<void> {
  await db
    .update(monitorAlertEvents)
    .set({
      notifyStatus: result.status,
      notifyChannels: result.channels,
      notifyError: result.error,
      notifiedAt: at,
    })
    .where(eq(monitorAlertEvents.id, eventId));
}

/**
 * 定位规则当前未恢复的事件。
 * 重复通知与恢复通知都不新建事件，其投递结果需要回写到这条正在告警的事件上。
 */
async function findFiringEventId(ruleId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: monitorAlertEvents.id })
    .from(monitorAlertEvents)
    .where(and(eq(monitorAlertEvents.ruleId, ruleId), eq(monitorAlertEvents.status, 'firing')))
    .orderBy(desc(monitorAlertEvents.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * 试发一条测试通知，用于在真实告警到来之前验证渠道与接收人配置。
 *
 * 不写事件表、不碰规则运行态与 `lastTriggeredAt`：一次配置验证不应该出现在告警历史里，
 * 更不能顶掉静默期让真实告警被抑制。直接返回派发结果，前端据此指出是哪个渠道配错了。
 */
export async function testRule(id: number): Promise<AlertDispatchResult> {
  const rule = await ensureRuleExists(id);
  const message = `这是一条测试通知，用于验证规则「${rule.name}」的通知渠道与接收人配置是否可用。`;
  return dispatchAlertChannels(
    {
      channels: rule.channels ?? [],
      webhookUrl: rule.webhookUrl,
      recipientUserIds: rule.recipientUserIds ?? [],
      recipientEmails: rule.recipientEmails ?? [],
      tenantId: rule.tenantId,
    },
    {
      eventKey: 'ops.monitor.alert_test',
      vars: { ruleName: rule.name, message },
      html: `<h3>系统监控告警测试</h3><p><b>规则：</b>${rule.name}</p><p>${message}</p><p>收到本消息说明该渠道配置正常，无需处理。</p>`,
      inAppType: 'info',
      // 带时间戳：连续试发两次应该都能收到，被幂等键吞掉会让人误判渠道不通
      dedupeKey: `monitor-alert-test:${rule.id}:${Date.now()}`,
      webhookBody: {
        type: 'monitor_alert_test',
        rule: rule.name,
        metric: rule.metric,
        level: rule.level,
        message,
        timestamp: formatDateTime(new Date()),
      },
      logTag: 'MonitorAlertTest',
    },
  );
}

// ─── 概览聚合 ─────────────────────────────────────────────────────────────
const OVERVIEW_RANGE_DAYS: Record<MonitorAlertOverviewRange, number> = { '24h': 1, '7d': 7, '30d': 30 };

/** 平均分钟数：PG 的 EXTRACT(EPOCH) 返回秒，除 60 后保留一位小数 */
function avgMinutes(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num / 60 * 10) / 10 : null;
}

export async function getAlertOverview(range: MonitorAlertOverviewRange): Promise<MonitorAlertOverview> {
  const scope = tenantScope(monitorAlertEvents);
  const since = new Date(Date.now() - OVERVIEW_RANGE_DAYS[range] * 24 * 60 * 60_000);
  const firingWhere = buildWhere(scope, eq(monitorAlertEvents.status, 'firing'));
  // 触发时间落在窗口内的事件；恢复数按同一批事件的恢复情况统计，
  // 避免「窗口内恢复但触发于窗口外」的事件让两条趋势线来自不同样本。
  // 必须用 gte() 而非 sql`${col} >= ${date}`：后者把裸 JS Date 插进模板时没有列的类型编码器，
  // 驱动序列化参数时直接抛 ERR_INVALID_ARG_TYPE
  const rangeWhere = buildWhere(scope, gte(monitorAlertEvents.triggeredAt, since));

  const [
    levelRows,
    pendingRows,
    rangeStatRows,
    trendRows,
    topRuleRows,
  ] = await Promise.all([
    db
      .select({ level: monitorAlertEvents.level, count: sql<number>`count(*)::int` })
      .from(monitorAlertEvents)
      .where(firingWhere)
      .groupBy(monitorAlertEvents.level),
    db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${monitorAlertEvents.triggeredAt})`,
      })
      .from(monitorAlertEvents)
      .where(buildWhere(firingWhere, eq(monitorAlertEvents.handleStatus, 'pending'))),
    db
      .select({
        fired: sql<number>`count(*)::int`,
        resolved: sql<number>`count(*) filter (where ${monitorAlertEvents.status} = 'resolved')::int`,
        notifyFailed: sql<number>`count(*) filter (where ${monitorAlertEvents.notifyStatus} in ('partial', 'failed'))::int`,
        mtta: sql<number | null>`avg(extract(epoch from (${monitorAlertEvents.acknowledgedAt} - ${monitorAlertEvents.triggeredAt})))`,
        mttr: sql<number | null>`avg(extract(epoch from (${monitorAlertEvents.resolvedAt} - ${monitorAlertEvents.triggeredAt})))`,
      })
      .from(monitorAlertEvents)
      .where(rangeWhere),
    db
      .select({
        date: sql<string>`to_char(${monitorAlertEvents.triggeredAt}, 'YYYY-MM-DD')`,
        fired: sql<number>`count(*)::int`,
        resolved: sql<number>`count(*) filter (where ${monitorAlertEvents.status} = 'resolved')::int`,
      })
      .from(monitorAlertEvents)
      .where(rangeWhere)
      .groupBy(sql`to_char(${monitorAlertEvents.triggeredAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${monitorAlertEvents.triggeredAt}, 'YYYY-MM-DD')`),
    db
      .select({
        ruleId: monitorAlertEvents.ruleId,
        ruleName: monitorAlertEvents.ruleName,
        count: sql<number>`count(*)::int`,
      })
      .from(monitorAlertEvents)
      .where(rangeWhere)
      .groupBy(monitorAlertEvents.ruleId, monitorAlertEvents.ruleName)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
  ]);

  const levelMap = new Map(levelRows.map((row) => [row.level, row.count]));
  const pending = pendingRows[0];
  const rangeStat = rangeStatRows[0];
  const oldestPendingAt = pending?.oldest ? new Date(pending.oldest) : null;

  return {
    range,
    firingTotal: levelRows.reduce((sum, row) => sum + row.count, 0),
    // 补齐没有告警的级别：缺项会让前端的三张统计卡时有时无
    firingByLevel: MONITOR_ALERT_LEVELS.map((level) => ({ level, count: levelMap.get(level) ?? 0 })),
    pendingTotal: pending?.count ?? 0,
    oldestPendingAt: formatNullableDateTime(oldestPendingAt),
    oldestPendingMinutes: oldestPendingAt
      ? Math.max(0, Math.round((Date.now() - oldestPendingAt.getTime()) / 60_000))
      : null,
    firedInRange: rangeStat?.fired ?? 0,
    resolvedInRange: rangeStat?.resolved ?? 0,
    notifyFailedInRange: rangeStat?.notifyFailed ?? 0,
    mttaMinutes: avgMinutes(rangeStat?.mtta),
    mttrMinutes: avgMinutes(rangeStat?.mttr),
    trend: trendRows.map((row) => ({ date: row.date, fired: row.fired, resolved: row.resolved })),
    topRules: topRuleRows.map((row) => ({ ruleId: row.ruleId, ruleName: row.ruleName, count: row.count })),
  };
}

// ─── 评估器（cron）─────────────────────────────────────────────────────────
export async function evaluateMonitorAlerts(): Promise<{ evaluated: number; fired: number; resolved: number }> {
  const rules = await db.select().from(monitorAlertRules).where(eq(monitorAlertRules.enabled, true));
  if (rules.length === 0) return { evaluated: 0, fired: 0, resolved: 0 };

  // 按规则所属租户取快照：业务指标按租户过滤，宿主机 / 平台级指标共享同一次取数
  const snapshots = await getMetricSnapshotsByTenant(rules.map((rule) => rule.tenantId));
  const now = Date.now();
  let evaluated = 0;
  let fired = 0;
  let resolved = 0;

  for (const rule of rules) {
    const snapshot = snapshots.get(rule.tenantId);
    // 该租户本轮取数失败：跳过而不是按 0 处理，避免把采集故障误判成「指标已恢复」
    if (!snapshot) continue;
    evaluated += 1;

    const metric = rule.metric as MonitorMetric;
    const value = snapshot[metric] ?? 0;
    const breaching = compare(value, rule.operator as MonitorAlertOperator, rule.threshold);
    const label = metricLabel(metric);
    const sym = OPERATOR_SYMBOL[rule.operator as MonitorAlertOperator];

    if (breaching) {
      const breachingSince = rule.breachingSince ?? new Date(now);
      const sustainedMs = now - breachingSince.getTime();
      const durationOk = rule.durationMinutes <= 0 || sustainedMs >= rule.durationMinutes * 60_000;

      if (rule.state !== 'firing' && durationOk) {
        // 触发新告警
        const message = `${label} 当前 ${formatMonitorMetricValue(metric, value)}，已满足条件 ${sym} ${formatMonitorMetricValue(metric, rule.threshold)}`
          + (rule.durationMinutes > 0 ? `（持续 ${rule.durationMinutes} 分钟）` : '');
        const [event] = await db.insert(monitorAlertEvents).values({
          tenantId: rule.tenantId,
          ruleId: rule.id,
          ruleName: rule.name,
          metric: rule.metric,
          level: rule.level,
          operator: rule.operator,
          threshold: rule.threshold,
          value,
          status: 'firing',
          message,
        }).returning({ id: monitorAlertEvents.id });
        await db.update(monitorAlertRules)
          .set({ state: 'firing', breachingSince, lastTriggeredAt: new Date(now), lastValue: value })
          .where(eq(monitorAlertRules.id, rule.id));
        // 先建事件再派发：拿到 id 才能把真实投递结果写回这一行
        await recordNotifyResult(event.id, await dispatchAlert(rule, message, false, now), new Date());
        fired += 1;
      } else if (rule.state === 'firing') {
        // 已在告警中：静默期后重复通知
        const silenceMs = rule.silenceMinutes * 60_000;
        const shouldRenotify = rule.silenceMinutes > 0 && rule.lastTriggeredAt && now - rule.lastTriggeredAt.getTime() >= silenceMs;
        if (shouldRenotify) {
          const message = `${label} 持续告警，当前 ${formatMonitorMetricValue(metric, value)}（阈值 ${sym} ${formatMonitorMetricValue(metric, rule.threshold)}）`;
          await db.update(monitorAlertRules).set({ lastTriggeredAt: new Date(now), lastValue: value }).where(eq(monitorAlertRules.id, rule.id));
          const eventId = await findFiringEventId(rule.id);
          const result = await dispatchAlert(rule, message, false, now);
          if (eventId !== null) await recordNotifyResult(eventId, result, new Date());
        } else {
          await db.update(monitorAlertRules).set({ lastValue: value }).where(eq(monitorAlertRules.id, rule.id));
        }
      } else {
        // 处于观察期（未达 duration）：仅记录起始时间与当前值
        await db.update(monitorAlertRules).set({ breachingSince, lastValue: value }).where(eq(monitorAlertRules.id, rule.id));
      }
    } else {
      // 未超阈
      if (rule.state === 'firing') {
        const message = `${label} 已恢复，当前 ${formatMonitorMetricValue(metric, value)}`;
        // 恢复通知的投递结果仍要落到这条事件上，因此先取 id 再关闭
        const eventId = await findFiringEventId(rule.id);
        await db.update(monitorAlertEvents)
          .set({ status: 'resolved', resolvedAt: new Date(now) })
          .where(and(eq(monitorAlertEvents.ruleId, rule.id), eq(monitorAlertEvents.status, 'firing')));
        await db.update(monitorAlertRules)
          .set({ state: 'ok', breachingSince: null, lastValue: value })
          .where(eq(monitorAlertRules.id, rule.id));
        const result = await dispatchAlert(rule, message, true, now);
        if (eventId !== null) await recordNotifyResult(eventId, result, new Date());
        resolved += 1;
      } else if (rule.breachingSince !== null) {
        await db.update(monitorAlertRules).set({ breachingSince: null, lastValue: value }).where(eq(monitorAlertRules.id, rule.id));
      } else {
        await db.update(monitorAlertRules).set({ lastValue: value }).where(eq(monitorAlertRules.id, rule.id));
      }
    }
  }

  return { evaluated, fired, resolved };
}
