import { iotAlarmRuleContract, iotAlarmContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 告警：规则 CRUD、告警记录与运行时判定。
 *
 * 判定路径：
 * - threshold：遥测 ingest 逐点判定，Redis 连续计数抖动抑制，恢复自动 resolve
 * - event    ：设备事件 ingest 按 identifier 匹配触发（活跃告警去重，手动 resolve）
 * - offline  ：系统周期任务扫描（先收敛在线标记 → 再按 lastSeenAt 判离线时长），上线自动 resolve
 *
 * 去重：`uq_iot_alarms_active`（同规则同设备仅一条 firing）+ insert onConflictDoNothing。
 * 通知：唯一入口 notify()，接收人来自规则 notifyUserIds，为空则只留告警记录。
 */
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { alias as aliasedTable } from 'drizzle-orm/pg-core';
import type { CreateIotAlarmRuleInput, IotAlarmRuleType, UpdateIotAlarmRuleInput } from '@zenith/shared/iot';
import { IOT_ALARM_LEVEL_LABELS, IOT_COMPARE_OP_LABELS, IOT_ONLINE_TTL_SECONDS } from '@zenith/shared/iot';
import type { IotMetricValue } from '@zenith/shared/iot';
import { compareNumber } from '@zenith/shared/core';
import { db } from '../../db';
import {
  iotAlarmRules, iotAlarms, iotDevices, iotDeviceState, iotProducts,
  type IotAlarmRow, type IotAlarmRuleRow, type IotDeviceRow,
} from '../../db/schema';
import { users } from '../../db/schema/core';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser, currentUserId } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { TtlCache } from '../../lib/ttl-cache';
import { notify } from '../messaging/notification-outbox.service';
import { dispatchIotForward } from './iot-forward.service';
import { ensureIotRuleReferencesValid } from './iot-rule-refs';
import { isDeviceInMaintenance } from './iot-maintenance.service';

// ─── 规则映射与 CRUD ─────────────────────────────────────────────────────────
export function mapIotAlarmRule(
  row: IotAlarmRuleRow,
  extra?: { productName?: string | null; deviceName?: string | null },
) {
  return {
    id: row.id,
    name: row.name,
    productId: row.productId,
    productName: extra?.productName ?? null,
    deviceId: row.deviceId ?? null,
    deviceName: extra?.deviceName ?? null,
    ruleType: row.ruleType,
    propertyIdentifier: row.propertyIdentifier ?? null,
    operator: row.operator ?? null,
    threshold: row.threshold ?? null,
    consecutiveCount: row.consecutiveCount,
    offlineMinutes: row.offlineMinutes ?? null,
    eventIdentifier: row.eventIdentifier ?? null,
    level: row.level,
    notifyUserIds: row.notifyUserIds ?? [],
    escalateAfterMinutes: row.escalateAfterMinutes ?? null,
    escalateUserIds: row.escalateUserIds ?? [],
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export type ListIotAlarmRulesFilter = Omit<QueryOutputOf<typeof iotAlarmRuleContract.list>, 'page' | 'pageSize'>;

function buildRuleWhere(q: ListIotAlarmRulesFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotAlarmRules.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotAlarmRules.name]),
    q.productId ? eq(iotAlarmRules.productId, q.productId) : undefined,
    q.ruleType ? eq(iotAlarmRules.ruleType, q.ruleType) : undefined,
    q.status ? eq(iotAlarmRules.status, q.status) : undefined,
    tenantCondition(iotAlarmRules, currentUser()),
  );
}

export async function listIotAlarmRules(q: QueryOutputOf<typeof iotAlarmRuleContract.list>) {
  const { page, pageSize } = q;
  const where = buildRuleWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotAlarmRules, where),
    rows: () => withPagination(
      db.select({ rule: iotAlarmRules, productName: iotProducts.name, deviceName: iotDevices.name })
        .from(iotAlarmRules)
        .leftJoin(iotProducts, eq(iotAlarmRules.productId, iotProducts.id))
        .leftJoin(iotDevices, eq(iotAlarmRules.deviceId, iotDevices.id))
        .where(where)
        .orderBy(desc(iotAlarmRules.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapIotAlarmRule(r.rule, { productName: r.productName, deviceName: r.deviceName }),
  });
}

export async function ensureIotAlarmRuleExists(id: number): Promise<IotAlarmRuleRow> {
  return requireFirstRow(db.select().from(iotAlarmRules).where(buildRuleWhere({ id })).limit(1), '告警规则不存在');
}

/** threshold/event 规则的标识符必须在产品物模型中已声明 */
async function ensureRuleReferencesValid(
  productId: number,
  data: { ruleType: IotAlarmRuleType; propertyIdentifier?: string | null; eventIdentifier?: string | null; deviceId?: number | null },
): Promise<void> {
  await ensureIotRuleReferencesValid(productId, {
    refKind: data.ruleType === 'threshold' ? 'property' : data.ruleType === 'event' ? 'event' : null,
    propertyIdentifier: data.propertyIdentifier,
    eventIdentifier: data.eventIdentifier,
    deviceId: data.deviceId,
  }, { numericOnly: '阈值规则仅支持数值型属性' });
}

export async function createIotAlarmRule(data: CreateIotAlarmRuleInput) {
  await ensureRuleReferencesValid(data.productId, data);
  const [row] = await db.insert(iotAlarmRules).values({
    name: data.name,
    productId: data.productId,
    deviceId: data.deviceId ?? null,
    ruleType: data.ruleType,
    propertyIdentifier: data.ruleType === 'threshold' ? data.propertyIdentifier : null,
    operator: data.ruleType === 'threshold' ? data.operator : null,
    threshold: data.ruleType === 'threshold' ? data.threshold : null,
    consecutiveCount: data.consecutiveCount,
    offlineMinutes: data.ruleType === 'offline' ? data.offlineMinutes : null,
    eventIdentifier: data.ruleType === 'event' ? data.eventIdentifier : null,
    level: data.level,
    notifyUserIds: data.notifyUserIds,
    escalateAfterMinutes: data.escalateAfterMinutes ?? null,
    escalateUserIds: data.escalateUserIds,
    status: data.status,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  invalidateRuleCache();
  return mapIotAlarmRule(row);
}

export async function updateIotAlarmRule(id: number, data: UpdateIotAlarmRuleInput) {
  const before = await ensureIotAlarmRuleExists(id);
  await ensureRuleReferencesValid(before.productId, {
    ruleType: before.ruleType,
    propertyIdentifier: data.propertyIdentifier !== undefined ? data.propertyIdentifier : before.propertyIdentifier,
    eventIdentifier: data.eventIdentifier !== undefined ? data.eventIdentifier : before.eventIdentifier,
    deviceId: data.deviceId !== undefined ? data.deviceId : before.deviceId,
  });
  const [row] = await db.update(iotAlarmRules).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.deviceId !== undefined ? { deviceId: data.deviceId } : {}),
    ...(data.propertyIdentifier !== undefined ? { propertyIdentifier: data.propertyIdentifier } : {}),
    ...(data.operator !== undefined ? { operator: data.operator } : {}),
    ...(data.threshold !== undefined ? { threshold: data.threshold } : {}),
    ...(data.consecutiveCount !== undefined ? { consecutiveCount: data.consecutiveCount } : {}),
    ...(data.offlineMinutes !== undefined ? { offlineMinutes: data.offlineMinutes } : {}),
    ...(data.eventIdentifier !== undefined ? { eventIdentifier: data.eventIdentifier } : {}),
    ...(data.level !== undefined ? { level: data.level } : {}),
    ...(data.notifyUserIds !== undefined ? { notifyUserIds: data.notifyUserIds } : {}),
    ...(data.escalateAfterMinutes !== undefined ? { escalateAfterMinutes: data.escalateAfterMinutes } : {}),
    ...(data.escalateUserIds !== undefined ? { escalateUserIds: data.escalateUserIds } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  }).where(buildRuleWhere({ id })).returning();
  const updated = requireRow(row, '告警规则不存在');
  invalidateRuleCache();
  return mapIotAlarmRule(updated);
}

export async function deleteIotAlarmRule(id: number): Promise<void> {
  await ensureIotAlarmRuleExists(id);
  await db.delete(iotAlarmRules).where(buildRuleWhere({ id }));
  invalidateRuleCache();
}

// ─── 告警记录 ─────────────────────────────────────────────────────────────────
export function mapIotAlarm(
  row: IotAlarmRow,
  extra?: { deviceName?: string | null; deviceSn?: string | null; acknowledgedByName?: string | null; resolvedByName?: string | null },
) {
  return {
    id: row.id,
    ruleId: row.ruleId ?? null,
    ruleName: row.ruleName,
    deviceId: row.deviceId,
    deviceName: extra?.deviceName ?? null,
    deviceSn: extra?.deviceSn ?? null,
    ruleType: row.ruleType,
    level: row.level,
    status: row.status,
    message: row.message,
    context: row.context ?? null,
    firedAt: formatDateTime(row.firedAt),
    acknowledgedAt: formatNullableDateTime(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedBy ?? null,
    acknowledgedByName: extra?.acknowledgedByName ?? null,
    escalatedAt: formatNullableDateTime(row.escalatedAt),
    resolvedAt: formatNullableDateTime(row.resolvedAt),
    resolvedBy: row.resolvedBy ?? null,
    resolvedByName: extra?.resolvedByName ?? null,
    resolveNote: row.resolveNote ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listIotAlarms(q: QueryOutputOf<typeof iotAlarmContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    buildWhere(
      keywordCondition(q.keyword, [iotAlarms.ruleName, iotAlarms.message, iotDevices.name, iotDevices.sn]),
      q.status ? eq(iotAlarms.status, q.status) : undefined,
      q.level ? eq(iotAlarms.level, q.level) : undefined,
      q.ruleType ? eq(iotAlarms.ruleType, q.ruleType) : undefined,
      q.deviceId ? eq(iotAlarms.deviceId, q.deviceId) : undefined,
      ...dateRangeConditions(iotAlarms.firedAt, q.startTime, q.endTime),
    ),
    tenantCondition(iotDevices, currentUser()),
  );
  // 认领人 / 处理人分别关联用户表（同一告警可能由不同人认领与处理）
  const resolvers = aliasedTable(users, 'resolvers');
  const base = db.select({
    alarm: iotAlarms, deviceName: iotDevices.name, deviceSn: iotDevices.sn,
    acknowledgedByName: users.username, resolvedByName: resolvers.username,
  })
    .from(iotAlarms)
    .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
    .leftJoin(users, eq(iotAlarms.acknowledgedBy, users.id))
    .leftJoin(resolvers, eq(iotAlarms.resolvedBy, resolvers.id));
  return buildListResult({
    page,
    pageSize,
    count: async () => {
      const [row] = await db.select({ value: count() }).from(iotAlarms)
        .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
        .where(where);
      return Number(row?.value ?? 0);
    },
    rows: () => withPagination(
      base.where(where).orderBy(desc(iotAlarms.firedAt), desc(iotAlarms.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapIotAlarm(r.alarm, {
      deviceName: r.deviceName, deviceSn: r.deviceSn, acknowledgedByName: r.acknowledgedByName, resolvedByName: r.resolvedByName,
    }),
  });
}

/** 认领告警：接手处理，升级计时停止（幂等拒绝重复认领） */
export async function acknowledgeIotAlarm(id: number) {
  const [row] = await db.update(iotAlarms)
    .set({ status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: currentUserId() })
    .where(and(eq(iotAlarms.id, id), eq(iotAlarms.status, 'firing')))
    .returning();
  return mapIotAlarm(requireRow(row, '告警不存在或已被认领/恢复'));
}

/** 管理员手动处理（恢复）告警：firing/acknowledged 均可直接处理，可附处理备注 */
export async function resolveIotAlarm(id: number, note?: string | null) {
  const [row] = await db.update(iotAlarms)
    .set({ status: 'resolved', resolvedAt: new Date(), resolvedBy: currentUserId(), resolveNote: note ?? null })
    .where(and(eq(iotAlarms.id, id), inArray(iotAlarms.status, ['firing', 'acknowledged'])))
    .returning();
  const resolved = requireRow(row, '告警不存在或已恢复');
  const [device] = await db.select({ sn: iotDevices.sn, name: iotDevices.name, productId: iotDevices.productId, tenantId: iotDevices.tenantId })
    .from(iotDevices).where(eq(iotDevices.id, resolved.deviceId)).limit(1);
  openEventBus.emit({
    type: 'iot.alarm.resolved',
    tenantId: device?.tenantId ?? null,
    data: { alarmId: resolved.id, ruleName: resolved.ruleName, deviceId: resolved.deviceId, sn: device?.sn ?? null, deviceName: device?.name ?? null, message: '管理员手动处理', resolvedBy: 'manual' },
  });
  if (device) {
    dispatchIotForward('alarm', { id: resolved.deviceId, sn: device.sn, productId: device.productId }, {
      alarmId: resolved.id, action: 'resolved', ruleName: resolved.ruleName, deviceId: resolved.deviceId,
      sn: device.sn, deviceName: device.name, message: '管理员手动处理', resolvedBy: 'manual',
    });
  }
  return mapIotAlarm(resolved);
}

// ─── 运行时判定 ───────────────────────────────────────────────────────────────
/** 规则运行时缓存（threshold + event，按产品聚合；30s TTL，规则写操作即失效；单飞防击穿） */
const RULE_CACHE_TTL_MS = 30_000;

const ruleCache = new TtlCache<number, IotAlarmRuleRow[]>(RULE_CACHE_TTL_MS);

function invalidateRuleCache(): void {
  ruleCache.clear();
}

function loadActiveRules(productId: number): Promise<IotAlarmRuleRow[]> {
  return ruleCache.get(productId, () => db.select().from(iotAlarmRules)
    .where(and(
      eq(iotAlarmRules.productId, productId),
      eq(iotAlarmRules.status, 'enabled'),
      inArray(iotAlarmRules.ruleType, ['threshold', 'event']),
    )));
}

/** 触发告警：活跃唯一索引去重，仅真正新建时通知 */
async function fireIotAlarm(
  rule: IotAlarmRuleRow,
  device: Pick<IotDeviceRow, 'id' | 'name' | 'sn' | 'tenantId' | 'productId'>,
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  const [inserted] = await db.insert(iotAlarms).values({
    ruleId: rule.id,
    ruleName: rule.name,
    deviceId: device.id,
    ruleType: rule.ruleType,
    level: rule.level,
    status: 'firing',
    message,
    context,
  }).onConflictDoNothing().returning({ id: iotAlarms.id });
  if (!inserted) return;
  openEventBus.emit({
    type: 'iot.alarm.triggered',
    tenantId: device.tenantId ?? null,
    data: { alarmId: inserted.id, ruleName: rule.name, ruleType: rule.ruleType, level: rule.level, deviceId: device.id, sn: device.sn, deviceName: device.name, message },
  });
  dispatchIotForward('alarm', device, {
    alarmId: inserted.id, action: 'triggered', ruleName: rule.name, ruleType: rule.ruleType,
    level: rule.level, deviceId: device.id, sn: device.sn, deviceName: device.name, message,
  });
  await notifyAlarm('iot.alarm.triggered', rule, device, message, inserted.id);
}

/** 自动恢复（阈值回落 / 设备上线）：存在活跃告警才动作 */
async function autoResolveIotAlarm(
  rule: IotAlarmRuleRow,
  device: Pick<IotDeviceRow, 'id' | 'name' | 'sn' | 'tenantId' | 'productId'>,
  message: string,
): Promise<void> {
  const [resolved] = await db.update(iotAlarms)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(and(
      eq(iotAlarms.ruleId, rule.id),
      eq(iotAlarms.deviceId, device.id),
      inArray(iotAlarms.status, ['firing', 'acknowledged']),
    ))
    .returning({ id: iotAlarms.id });
  if (!resolved) return;
  openEventBus.emit({
    type: 'iot.alarm.resolved',
    tenantId: device.tenantId ?? null,
    data: { alarmId: resolved.id, ruleName: rule.name, deviceId: device.id, sn: device.sn, deviceName: device.name, message, resolvedBy: 'auto' },
  });
  dispatchIotForward('alarm', device, {
    alarmId: resolved.id, action: 'resolved', ruleName: rule.name, deviceId: device.id,
    sn: device.sn, deviceName: device.name, message, resolvedBy: 'auto',
  });
  await notifyAlarm('iot.alarm.resolved', rule, device, message, resolved.id);
}

async function notifyAlarm(
  event: 'iot.alarm.triggered' | 'iot.alarm.resolved',
  rule: IotAlarmRuleRow,
  device: Pick<IotDeviceRow, 'id' | 'name' | 'sn' | 'tenantId' | 'productId'>,
  message: string,
  alarmId: number,
): Promise<void> {
  const userIds = rule.notifyUserIds ?? [];
  if (userIds.length === 0) return;
  // 维护窗口静默：窗口内告警仍记录（事实不丢），但不派发通知
  if (event === 'iot.alarm.triggered' && await isDeviceInMaintenance(device.id, device.productId)) {
    logger.info(`[iot] 告警 #${alarmId} 处于维护窗口，通知已静默（sn=${device.sn}）`);
    return;
  }
  try {
    await notify(event, {
      recipients: userIds.map((id) => ({ type: 'user' as const, id })),
      vars: event === 'iot.alarm.triggered'
        ? { ruleName: rule.name, deviceName: device.name, sn: device.sn, levelText: IOT_ALARM_LEVEL_LABELS[rule.level], message }
        : { ruleName: rule.name, deviceName: device.name, sn: device.sn, message },
      tenantId: device.tenantId ?? null,
      link: '/iot/alarms',
      dedupeKey: `${event}:${alarmId}`,
    });
  } catch (err) {
    logger.warn(`[iot] 告警通知发送失败 alarmId=${alarmId}: ${(err as Error).message}`);
  }
}

/**
 * 升级扫描（系统周期任务，每分钟）：firing 且超过规则升级时长仍未认领/未恢复的告警，
 * 升级通知升级接收人（每条告警至多一次）；维护窗口内跳过升级。
 */
export async function sweepIotAlarmEscalations(): Promise<string> {
  const candidates = await db.select({ alarm: iotAlarms, rule: iotAlarmRules, device: iotDevices })
    .from(iotAlarms)
    .innerJoin(iotAlarmRules, eq(iotAlarms.ruleId, iotAlarmRules.id))
    .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
    .where(and(
      eq(iotAlarms.status, 'firing'),
      isNull(iotAlarms.escalatedAt),
      isNotNull(iotAlarmRules.escalateAfterMinutes),
    ));
  let escalated = 0;
  const now = Date.now();
  for (const { alarm, rule, device } of candidates) {
    const dueAt = alarm.firedAt.getTime() + (rule.escalateAfterMinutes ?? 0) * 60_000;
    if (now < dueAt) continue;
    const escalateUserIds = rule.escalateUserIds ?? [];
    if (escalateUserIds.length === 0) continue;
    if (await isDeviceInMaintenance(device.id, device.productId)) continue;
    // 先置位再通知（并发扫描下防重复升级）
    const [claimed] = await db.update(iotAlarms)
      .set({ escalatedAt: new Date() })
      .where(and(eq(iotAlarms.id, alarm.id), isNull(iotAlarms.escalatedAt)))
      .returning({ id: iotAlarms.id });
    if (!claimed) continue;
    try {
      await notify('iot.alarm.escalated', {
        recipients: escalateUserIds.map((id) => ({ type: 'user' as const, id })),
        vars: {
          ruleName: rule.name,
          deviceName: device.name,
          sn: device.sn,
          minutes: String(rule.escalateAfterMinutes),
          message: alarm.message,
        },
        tenantId: device.tenantId ?? null,
        link: '/iot/alarms',
        dedupeKey: `iot.alarm.escalated:${alarm.id}`,
      });
      escalated += 1;
    } catch (err) {
      logger.warn(`[iot] 告警升级通知失败 alarmId=${alarm.id}: ${(err as Error).message}`);
    }
  }
  return `升级 ${escalated} 条超时未认领告警`;
}

const STREAK_PREFIX = 'iot:alarm:streak:';

/** 遥测 ingest 逐点判定阈值规则（连续 N 点抑制抖动；恢复自动 resolve） */
export async function evaluateIotThresholdRules(device: IotDeviceRow, metrics: Record<string, IotMetricValue>): Promise<void> {
  const rules = (await loadActiveRules(device.productId))
    .filter((r) => r.ruleType === 'threshold' && (r.deviceId == null || r.deviceId === device.id));
  for (const rule of rules) {
    const raw = rule.propertyIdentifier ? metrics[rule.propertyIdentifier] : undefined;
    if (typeof raw !== 'number' || rule.operator == null || rule.threshold == null) continue;
    const breached = compareNumber(raw, rule.operator, rule.threshold);
    const streakKey = `${STREAK_PREFIX}${rule.id}:${device.id}`;
    if (breached) {
      let streak = rule.consecutiveCount;
      try {
        streak = await redis.incr(streakKey);
        await redis.expire(streakKey, 3600);
      } catch {
        // Redis 不可用时按已达连续次数处理，宁可多报不可漏报
      }
      if (streak >= rule.consecutiveCount) {
        const opText = IOT_COMPARE_OP_LABELS[rule.operator];
        await fireIotAlarm(rule, device,
          `${rule.propertyIdentifier} 当前值 ${raw} ${opText} ${rule.threshold}（连续 ${rule.consecutiveCount} 次）`,
          { value: raw, operator: rule.operator, threshold: rule.threshold, property: rule.propertyIdentifier });
      }
    } else {
      try {
        await redis.del(streakKey);
      } catch { /* 计数键 TTL 自然过期 */ }
      await autoResolveIotAlarm(rule, device, `${rule.propertyIdentifier} 当前值 ${raw} 已恢复正常`);
    }
  }
}

/** 设备事件 ingest 判定事件规则（活跃去重，手动恢复） */
export async function evaluateIotEventRules(
  device: IotDeviceRow,
  eventIdentifier: string,
  payload: Record<string, unknown> | null,
): Promise<void> {
  const rules = (await loadActiveRules(device.productId))
    .filter((r) => r.ruleType === 'event' && r.eventIdentifier === eventIdentifier
      && (r.deviceId == null || r.deviceId === device.id));
  for (const rule of rules) {
    await fireIotAlarm(rule, device, `设备上报事件 ${eventIdentifier}`, { event: eventIdentifier, payload });
  }
}

/** 设备上线：自动恢复其离线类告警（由 access 在离线→在线转变时调用） */
export async function resolveIotOfflineAlarms(deviceId: number): Promise<void> {
  const firing = await db.select({ alarm: iotAlarms, rule: iotAlarmRules, device: iotDevices })
    .from(iotAlarms)
    .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
    .leftJoin(iotAlarmRules, eq(iotAlarms.ruleId, iotAlarmRules.id))
    .where(and(
      eq(iotAlarms.deviceId, deviceId),
      eq(iotAlarms.ruleType, 'offline'),
      inArray(iotAlarms.status, ['firing', 'acknowledged']),
    ));
  for (const row of firing) {
    if (row.rule) {
      await autoResolveIotAlarm(row.rule, row.device, '设备已重新上线');
    } else {
      await db.update(iotAlarms)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(iotAlarms.id, row.alarm.id));
    }
  }
}

/**
 * 离线扫描（系统周期任务，每分钟）：
 * 1. 收敛持久化在线标记：state.online=true 但 Redis TTL 键已消失 → 转离线（记生命周期事件）
 * 2. 对启用的 offline 规则触发告警：设备已持久化离线且 lastSeenAt 超过规则时长
 */
export async function sweepIotOfflineAlarms(): Promise<string> {
  // 第 1 步：找出持久化仍在线的设备，与 Redis 实时态对账
  const flagged = await db.select({ deviceId: iotDeviceState.deviceId })
    .from(iotDeviceState).where(eq(iotDeviceState.online, true));
  let wentOffline = 0;
  if (flagged.length > 0) {
    const pipeline = redis.pipeline();
    for (const row of flagged) pipeline.exists(`iot:online:${row.deviceId}`);
    const results = await pipeline.exec();
    const offlineIds = flagged.filter((_, i) => results?.[i]?.[1] !== 1).map((r) => r.deviceId);
    if (offlineIds.length > 0) {
      await db.update(iotDeviceState).set({ online: false }).where(inArray(iotDeviceState.deviceId, offlineIds));
      const { recordIotLifecycleEvent } = await import('./iot-events.service');
      for (const deviceId of offlineIds) await recordIotLifecycleEvent(deviceId, 'offline');
      wentOffline = offlineIds.length;
    }
  }

  // 第 2 步：离线规则判定
  const rules = await db.select().from(iotAlarmRules)
    .where(and(eq(iotAlarmRules.ruleType, 'offline'), eq(iotAlarmRules.status, 'enabled')));
  let fired = 0;
  for (const rule of rules) {
    if (!rule.offlineMinutes) continue;
    const cutoff = new Date(Date.now() - rule.offlineMinutes * 60_000 - IOT_ONLINE_TTL_SECONDS * 1000);
    const candidates = await db.select({ device: iotDevices })
      .from(iotDevices)
      .leftJoin(iotDeviceState, eq(iotDevices.id, iotDeviceState.deviceId))
      .where(and(
        eq(iotDevices.productId, rule.productId),
        rule.deviceId != null ? eq(iotDevices.id, rule.deviceId) : undefined,
        eq(iotDevices.status, 'enabled'),
        lt(iotDevices.lastSeenAt, cutoff),
        or(eq(iotDeviceState.online, false), isNull(iotDeviceState.deviceId)),
      ));
    for (const { device } of candidates) {
      await fireIotAlarm(rule, device,
        `设备离线超过 ${rule.offlineMinutes} 分钟（最后在线 ${formatNullableDateTime(device.lastSeenAt) ?? '未知'}）`,
        { offlineMinutes: rule.offlineMinutes, lastSeenAt: formatNullableDateTime(device.lastSeenAt) });
      fired += 1;
    }
  }
  return `离线转变 ${wentOffline} 台，触发离线告警 ${fired} 条`;
}
