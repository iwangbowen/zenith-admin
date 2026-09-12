import { iotAutomationContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 场景联动：触发评估 + 动作执行 + 冷却抑制 + 执行留痕。
 *
 * 触发链路（均在设备接入热路径上，失败不阻断 ingest）：
 * - property：遥测 ingest 逐点判定（与告警共用比较语义）
 * - event   ：物模型事件 ingest 按 identifier 匹配
 * - online/offline：生命周期事件打点处（events 服务）联动
 *
 * 动作执行为串行、彼此隔离；单动作失败计入 run 结果不中断整批。
 * 可选规则中心决策表二次判定（facts = 触发上下文，命中任意行才执行动作）。
 * 依赖注意：动作执行器（指令/期望值/工作流/通知）全部动态引入，
 * 保持本模块静态依赖只有 db/redis/model —— ingest 各服务可安全静态引用本模块。
 */
import { and, count, desc, eq, gte, inArray, type SQL } from 'drizzle-orm';
import type { CreateIotAutomationInput, IotMetricValue, UpdateIotAutomationInput } from '@zenith/shared/iot';
import { IOT_COMPARE_OP_LABELS, IOT_AUTOMATION_TRIGGER_LABELS } from '@zenith/shared/iot';
import { compareNumber } from '@zenith/shared/core';
import { db } from '../../db';
import {
  iotAutomationRuns, iotAutomations, iotDeviceGroupMembers, iotDevices, iotProducts,
  type IotAutomationActionDef, type IotAutomationRow, type IotAutomationRunRow, type IotDeviceRow,
} from '../../db/schema';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { TtlCache } from '../../lib/ttl-cache';
import { ensureIotRuleReferencesValid } from './iot-rule-refs';

// ─── 映射与 CRUD ──────────────────────────────────────────────────────────────
export function mapIotAutomation(
  row: IotAutomationRow,
  extra?: { productName?: string | null; deviceName?: string | null; recentRunCount?: number },
) {
  return {
    id: row.id,
    name: row.name,
    productId: row.productId,
    productName: extra?.productName ?? null,
    deviceId: row.deviceId ?? null,
    deviceName: extra?.deviceName ?? null,
    triggerType: row.triggerType,
    propertyIdentifier: row.propertyIdentifier ?? null,
    operator: row.operator ?? null,
    threshold: row.threshold ?? null,
    eventIdentifier: row.eventIdentifier ?? null,
    decisionRuleKey: row.decisionRuleKey ?? null,
    cooldownSeconds: row.cooldownSeconds,
    actions: row.actions ?? [],
    status: row.status,
    recentRunCount: extra?.recentRunCount ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export function mapIotAutomationRun(
  row: IotAutomationRunRow,
  extra?: { deviceName?: string | null; deviceSn?: string | null },
) {
  return {
    id: row.id,
    automationId: row.automationId,
    automationName: row.automationName,
    deviceId: row.deviceId,
    deviceName: extra?.deviceName ?? null,
    deviceSn: extra?.deviceSn ?? null,
    triggerContext: row.triggerContext ?? {},
    results: row.results ?? [],
    success: row.success,
    createdAt: formatDateTime(row.createdAt),
  };
}

export type ListIotAutomationsFilter = Omit<QueryOutputOf<typeof iotAutomationContract.list>, 'page' | 'pageSize'>;

function buildAutomationWhere(q: ListIotAutomationsFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotAutomations.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotAutomations.name]),
    q.productId ? eq(iotAutomations.productId, q.productId) : undefined,
    q.triggerType ? eq(iotAutomations.triggerType, q.triggerType) : undefined,
    q.status ? eq(iotAutomations.status, q.status) : undefined,
    tenantCondition(iotAutomations, currentUser()),
  );
}

export async function listIotAutomations(q: QueryOutputOf<typeof iotAutomationContract.list>) {
  const { page, pageSize } = q;
  const where = buildAutomationWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotAutomations, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ automation: iotAutomations, productName: iotProducts.name, deviceName: iotDevices.name })
          .from(iotAutomations)
          .leftJoin(iotProducts, eq(iotAutomations.productId, iotProducts.id))
          .leftJoin(iotDevices, eq(iotAutomations.deviceId, iotDevices.id))
          .where(where)
          .orderBy(desc(iotAutomations.id))
          .$dynamic(),
        page,
        pageSize,
      );
      const ids = rows.map((r) => r.automation.id);
      const since = new Date(Date.now() - 24 * 3600_000);
      const runCounts = ids.length > 0
        ? await db.select({ automationId: iotAutomationRuns.automationId, cnt: count() })
          .from(iotAutomationRuns)
          .where(and(inArray(iotAutomationRuns.automationId, ids), gte(iotAutomationRuns.createdAt, since)))
          .groupBy(iotAutomationRuns.automationId)
        : [];
      const countMap = new Map(runCounts.map((r) => [r.automationId, Number(r.cnt)]));
      return rows.map((r) => mapIotAutomation(r.automation, {
        productName: r.productName,
        deviceName: r.deviceName,
        recentRunCount: countMap.get(r.automation.id) ?? 0,
      }));
    },
  });
}

export async function ensureIotAutomationExists(id: number): Promise<IotAutomationRow> {
  const [row] = await db.select().from(iotAutomations).where(buildAutomationWhere({ id })).limit(1);
  return requireRow(row, '联动规则不存在');
}

/** 触发引用校验：属性/事件需在物模型中声明，限定设备需属于该产品 */
async function ensureAutomationReferencesValid(
  productId: number,
  data: { triggerType: string; propertyIdentifier?: string | null; eventIdentifier?: string | null; deviceId?: number | null },
): Promise<void> {
  await ensureIotRuleReferencesValid(productId, {
    refKind: data.triggerType === 'property' ? 'property' : data.triggerType === 'event' ? 'event' : null,
    propertyIdentifier: data.propertyIdentifier,
    eventIdentifier: data.eventIdentifier,
    deviceId: data.deviceId,
  }, { numericOnly: '属性触发仅支持数值型属性' });
}

export async function createIotAutomation(data: CreateIotAutomationInput) {
  await ensureAutomationReferencesValid(data.productId, data);
  const [row] = await db.insert(iotAutomations).values({
    name: data.name,
    productId: data.productId,
    deviceId: data.deviceId ?? null,
    triggerType: data.triggerType,
    propertyIdentifier: data.triggerType === 'property' ? data.propertyIdentifier : null,
    operator: data.triggerType === 'property' ? data.operator : null,
    threshold: data.triggerType === 'property' ? data.threshold : null,
    eventIdentifier: data.triggerType === 'event' ? data.eventIdentifier : null,
    decisionRuleKey: data.decisionRuleKey ?? null,
    cooldownSeconds: data.cooldownSeconds,
    actions: data.actions,
    status: data.status,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  invalidateAutomationCache();
  return mapIotAutomation(row);
}

export async function updateIotAutomation(id: number, data: UpdateIotAutomationInput) {
  const before = await ensureIotAutomationExists(id);
  await ensureAutomationReferencesValid(before.productId, {
    triggerType: before.triggerType,
    propertyIdentifier: data.propertyIdentifier !== undefined ? data.propertyIdentifier : before.propertyIdentifier,
    eventIdentifier: data.eventIdentifier !== undefined ? data.eventIdentifier : before.eventIdentifier,
    deviceId: data.deviceId !== undefined ? data.deviceId : before.deviceId,
  });
  const [row] = await db.update(iotAutomations).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.deviceId !== undefined ? { deviceId: data.deviceId } : {}),
    ...(data.propertyIdentifier !== undefined ? { propertyIdentifier: data.propertyIdentifier } : {}),
    ...(data.operator !== undefined ? { operator: data.operator } : {}),
    ...(data.threshold !== undefined ? { threshold: data.threshold } : {}),
    ...(data.eventIdentifier !== undefined ? { eventIdentifier: data.eventIdentifier } : {}),
    ...(data.decisionRuleKey !== undefined ? { decisionRuleKey: data.decisionRuleKey } : {}),
    ...(data.cooldownSeconds !== undefined ? { cooldownSeconds: data.cooldownSeconds } : {}),
    ...(data.actions !== undefined ? { actions: data.actions } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  }).where(buildAutomationWhere({ id })).returning();
  const updated = requireRow(row, '联动规则不存在');
  invalidateAutomationCache();
  return mapIotAutomation(updated);
}

export async function deleteIotAutomation(id: number): Promise<void> {
  await ensureIotAutomationExists(id);
  await db.delete(iotAutomations).where(buildAutomationWhere({ id }));
  invalidateAutomationCache();
}

export async function listIotAutomationRuns(q: QueryOutputOf<typeof iotAutomationContract.runs>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.automationId ? eq(iotAutomationRuns.automationId, q.automationId) : undefined,
    q.deviceId ? eq(iotAutomationRuns.deviceId, q.deviceId) : undefined,
    q.success !== undefined ? eq(iotAutomationRuns.success, q.success) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotAutomationRuns, where),
    rows: () => withPagination(
      db.select({ run: iotAutomationRuns, deviceName: iotDevices.name, deviceSn: iotDevices.sn })
        .from(iotAutomationRuns)
        .innerJoin(iotDevices, eq(iotAutomationRuns.deviceId, iotDevices.id))
        .where(where)
        .orderBy(desc(iotAutomationRuns.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapIotAutomationRun(r.run, { deviceName: r.deviceName, deviceSn: r.deviceSn }),
  });
}

// ─── 运行时评估 ───────────────────────────────────────────────────────────────
const AUTOMATION_CACHE_TTL_MS = 30_000;

/** 单飞防击穿；联动写操作即失效 */
const automationCache = new TtlCache<number, IotAutomationRow[]>(AUTOMATION_CACHE_TTL_MS);

function invalidateAutomationCache(): void {
  automationCache.clear();
}

function loadActiveAutomations(productId: number): Promise<IotAutomationRow[]> {
  return automationCache.get(productId, () => db.select().from(iotAutomations)
    .where(and(eq(iotAutomations.productId, productId), eq(iotAutomations.status, 'enabled'))));
}

/** 遥测 ingest 属性触发（逐点） */
export async function evaluateIotAutomationsOnTelemetry(device: IotDeviceRow, metrics: Record<string, IotMetricValue>): Promise<void> {
  const rows = (await loadActiveAutomations(device.productId))
    .filter((a) => a.triggerType === 'property' && (a.deviceId == null || a.deviceId === device.id));
  for (const automation of rows) {
    const raw = automation.propertyIdentifier ? metrics[automation.propertyIdentifier] : undefined;
    if (typeof raw !== 'number' || automation.operator == null || automation.threshold == null) continue;
    if (!compareNumber(raw, automation.operator, automation.threshold)) continue;
    await triggerAutomation(automation, device, {
      trigger: 'property',
      property: automation.propertyIdentifier,
      value: raw,
      operator: automation.operator,
      threshold: automation.threshold,
    });
  }
}

/** 物模型事件触发 */
export async function evaluateIotAutomationsOnEvent(
  device: IotDeviceRow,
  eventIdentifier: string,
  payload: Record<string, unknown> | null,
): Promise<void> {
  const rows = (await loadActiveAutomations(device.productId))
    .filter((a) => a.triggerType === 'event' && a.eventIdentifier === eventIdentifier
      && (a.deviceId == null || a.deviceId === device.id));
  for (const automation of rows) {
    await triggerAutomation(automation, device, { trigger: 'event', event: eventIdentifier, payload });
  }
}

/** 上线/离线触发（生命周期打点处调用） */
export async function evaluateIotAutomationsOnLifecycle(deviceId: number, kind: 'online' | 'offline'): Promise<void> {
  const [device] = await db.select().from(iotDevices).where(eq(iotDevices.id, deviceId)).limit(1);
  if (!device) return;
  const rows = (await loadActiveAutomations(device.productId))
    .filter((a) => a.triggerType === kind && (a.deviceId == null || a.deviceId === device.id));
  for (const automation of rows) {
    await triggerAutomation(automation, device, { trigger: kind });
  }
}

// ─── 执行 ─────────────────────────────────────────────────────────────────────
const COOLDOWN_PREFIX = 'iot:auto:cd:';

/** 冷却检查：SET NX EX，占位成功才执行 */
async function acquireCooldown(automation: IotAutomationRow, deviceId: number): Promise<boolean> {
  if (automation.cooldownSeconds <= 0) return true;
  try {
    const result = await redis.set(
      `${COOLDOWN_PREFIX}${automation.id}:${deviceId}`, '1', 'EX', automation.cooldownSeconds, 'NX',
    );
    return result === 'OK';
  } catch {
    // Redis 不可用时放行（联动动作幂等性由动作自身语义保证）
    return true;
  }
}

async function triggerAutomation(
  automation: IotAutomationRow,
  device: IotDeviceRow,
  triggerContext: Record<string, unknown>,
): Promise<void> {
  try {
    if (!(await acquireCooldown(automation, device.id))) return;

    // 可选规则中心决策表二次判定：facts = 触发上下文 + 设备信息
    if (automation.decisionRuleKey) {
      const { decide } = await import('../platform/rules-runtime.service');
      const decision = await decide(
        { kind: 'table', key: automation.decisionRuleKey },
        { ...triggerContext, deviceId: device.id, sn: device.sn, deviceName: device.name },
        { mode: 'optional', caller: `iot.automation.${automation.id}`, tenantId: automation.tenantId ?? null, bizRef: `iot:automation:${automation.id}` },
      );
      if (!decision.matched) {
        await insertRun(automation, device, triggerContext, [
          { type: 'decision', success: false, message: `决策表 ${automation.decisionRuleKey} 未命中，动作未执行` },
        ], true);
        return;
      }
    }

    const results: Array<{ type: string; target?: string; success: boolean; message?: string }> = [];
    for (const action of automation.actions ?? []) {
      results.push(await executeAction(automation, device, action, triggerContext));
    }
    await insertRun(automation, device, triggerContext, results, results.every((r) => r.success));
  } catch (err) {
    logger.warn(`[iot-automation] 联动执行异常 automationId=${automation.id} deviceId=${device.id}: ${(err as Error).message}`);
  }
}

async function insertRun(
  automation: IotAutomationRow,
  device: IotDeviceRow,
  triggerContext: Record<string, unknown>,
  results: Array<{ type: string; target?: string; success: boolean; message?: string }>,
  success: boolean,
): Promise<void> {
  await db.insert(iotAutomationRuns).values({
    automationId: automation.id,
    automationName: automation.name,
    deviceId: device.id,
    triggerContext,
    results,
    success,
  });
}

/** 解析动作目标设备（self / 指定设备 / 分组成员） */
async function resolveTargetDevices(device: IotDeviceRow, action: IotAutomationActionDef): Promise<IotDeviceRow[]> {
  const target = action.target ?? 'self';
  if (target === 'self') return [device];
  if (target === 'device' && action.targetDeviceId) {
    const rows = await db.select().from(iotDevices).where(eq(iotDevices.id, action.targetDeviceId)).limit(1);
    return rows;
  }
  if (target === 'group' && action.targetGroupId) {
    const members = await db.select({ deviceId: iotDeviceGroupMembers.deviceId })
      .from(iotDeviceGroupMembers).where(eq(iotDeviceGroupMembers.groupId, action.targetGroupId));
    if (members.length === 0) return [];
    return db.select().from(iotDevices).where(inArray(iotDevices.id, members.map((m) => m.deviceId)));
  }
  return [];
}

function describeTarget(action: IotAutomationActionDef): string {
  const target = action.target ?? 'self';
  if (target === 'device') return `设备#${action.targetDeviceId}`;
  if (target === 'group') return `分组#${action.targetGroupId}`;
  return '触发设备';
}

function describeTrigger(automation: IotAutomationRow, triggerContext: Record<string, unknown>): string {
  if (automation.triggerType === 'property') {
    const op = automation.operator ? IOT_COMPARE_OP_LABELS[automation.operator] : '';
    return `${automation.propertyIdentifier} 当前值 ${String(triggerContext.value)} ${op} ${automation.threshold}`;
  }
  if (automation.triggerType === 'event') return `上报事件 ${automation.eventIdentifier}`;
  return IOT_AUTOMATION_TRIGGER_LABELS[automation.triggerType];
}

async function executeAction(
  automation: IotAutomationRow,
  device: IotDeviceRow,
  action: IotAutomationActionDef,
  triggerContext: Record<string, unknown>,
): Promise<{ type: string; target?: string; success: boolean; message?: string }> {
  const target = describeTarget(action);
  try {
    switch (action.type) {
      case 'command': {
        const { sendIotCommandToDevice } = await import('./iot-telemetry.service');
        const targets = await resolveTargetDevices(device, action);
        if (targets.length === 0) return { type: action.type, target, success: false, message: '目标设备为空' };
        const outcomes: string[] = [];
        for (const t of targets) {
          const row = await sendIotCommandToDevice(t, { service: action.service!, params: action.params ?? null });
          outcomes.push(`${t.sn}:${row.status}`);
        }
        return { type: action.type, target, success: true, message: outcomes.join('、') };
      }
      case 'desired': {
        const { setIotDesiredForDevice } = await import('./iot-shadow.service');
        const targets = await resolveTargetDevices(device, action);
        if (targets.length === 0) return { type: action.type, target, success: false, message: '目标设备为空' };
        for (const t of targets) {
          await setIotDesiredForDevice(t, { desired: action.desired ?? {} });
        }
        return { type: action.type, target, success: true, message: `已下发 ${targets.length} 台` };
      }
      case 'notify': {
        const { notify } = await import('../messaging/notification-outbox.service');
        await notify('iot.automation.triggered', {
          recipients: (action.userIds ?? []).map((id) => ({ type: 'user' as const, id })),
          vars: {
            automationName: automation.name,
            deviceName: device.name,
            sn: device.sn,
            detail: describeTrigger(automation, triggerContext),
          },
          tenantId: device.tenantId ?? null,
          link: '/iot/automations',
        });
        return { type: action.type, success: true, message: `已通知 ${(action.userIds ?? []).length} 人` };
      }
      case 'workflow': {
        const { createInstance } = await import('../workflow/instances/lifecycle');
        const creatorId = automation.createdBy ?? 1;
        const { users } = await import('../../db/schema');
        const [creator] = await db.select({ username: users.username }).from(users)
          .where(eq(users.id, creatorId)).limit(1);
        const instance = await createInstance(
          {
            definitionId: action.workflowDefinitionId!,
            title: `IoT 联动 · ${automation.name}（${device.name}）`,
            formData: { ...(action.formData ?? {}), iotTrigger: { ...triggerContext, deviceId: device.id, sn: device.sn } },
            bizType: 'iot:automation',
            bizId: `${automation.id}:${device.id}:${Date.now()}`,
          },
          {
            userId: creatorId,
            username: creator?.username ?? 'system',
            tenantId: automation.tenantId ?? null,
          },
        );
        return { type: action.type, success: true, message: `实例 #${instance.id}` };
      }
      default:
        return { type: action.type, success: false, message: '未知动作类型' };
    }
  } catch (err) {
    return { type: action.type, target, success: false, message: (err as Error).message?.slice(0, 200) };
  }
}
