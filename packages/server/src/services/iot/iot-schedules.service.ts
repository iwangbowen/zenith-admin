import { iotScheduleContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 设备计划任务：时间驱动的自动化（与场景联动的事件驱动互补）。
 *
 * 调度模型：nextRunAt 游标 + 每分钟系统任务扫描到期计划。
 * - cron 型：执行后用 cron-parser 推进 nextRunAt 到下一次
 * - once 型：执行后置空 nextRunAt 并停用（一次性语义）
 * 执行：按 product/group/device 圈定目标（上限 IOT_SCHEDULE_TARGET_MAX），
 * 逐台走 runtime-safe 的指令/期望属性下发，汇总留痕 iot_schedule_runs。
 */
import { HTTPException } from 'hono/http-exception';
import { CronExpressionParser } from 'cron-parser';
import { and, count, desc, eq, gte, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import type { CreateIotScheduleInput, UpdateIotScheduleInput } from '@zenith/shared/iot';
import { IOT_SCHEDULE_TARGET_MAX } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotDeviceGroupMembers, iotDeviceGroups, iotDevices, iotProducts, iotScheduleRuns, iotSchedules,
  type IotDeviceRow, type IotScheduleRow, type IotScheduleRunRow,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import logger from '../../lib/logger';

// ─── 映射与 CRUD ──────────────────────────────────────────────────────────────
export function mapIotSchedule(
  row: IotScheduleRow,
  extra?: { productName?: string | null; groupName?: string | null; deviceName?: string | null; recentRunCount?: number },
) {
  return {
    id: row.id,
    name: row.name,
    scheduleType: row.scheduleType,
    cronExpression: row.cronExpression ?? null,
    runAt: formatNullableDateTime(row.runAt),
    productId: row.productId,
    productName: extra?.productName ?? null,
    groupId: row.groupId ?? null,
    groupName: extra?.groupName ?? null,
    deviceId: row.deviceId ?? null,
    deviceName: extra?.deviceName ?? null,
    actionType: row.actionType,
    service: row.service ?? null,
    params: row.params ?? null,
    desired: row.desired ?? null,
    status: row.status,
    nextRunAt: formatNullableDateTime(row.nextRunAt),
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    recentRunCount: extra?.recentRunCount ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapIotScheduleRun(row: IotScheduleRunRow) {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    scheduleName: row.scheduleName,
    deviceCount: row.deviceCount,
    successCount: row.successCount,
    failedCount: row.failedCount,
    errors: row.errors ?? [],
    createdAt: formatDateTime(row.createdAt),
  };
}

/** 计算下一次执行时刻（cron 精确解析；once 取 runAt 且仅未来时刻有效） */
function computeNextRunAt(
  scheduleType: 'cron' | 'once',
  cronExpression: string | null | undefined,
  runAt: Date | null | undefined,
): Date | null {
  if (scheduleType === 'once') {
    return runAt && runAt.getTime() > Date.now() ? runAt : null;
  }
  if (!cronExpression) return null;
  try {
    return CronExpressionParser.parse(cronExpression).next().toDate();
  } catch {
    throw new HTTPException(400, { message: 'cron 表达式不合法' });
  }
}

export type ListIotSchedulesFilter = Omit<QueryOutputOf<typeof iotScheduleContract.list>, 'page' | 'pageSize'>;
export type ListIotSchedulesQuery = QueryOutputOf<typeof iotScheduleContract.list>;

function buildScheduleWhere(q: ListIotSchedulesFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotSchedules.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotSchedules.name]),
    q.productId ? eq(iotSchedules.productId, q.productId) : undefined,
    q.status ? eq(iotSchedules.status, q.status) : undefined,
    tenantCondition(iotSchedules, currentUser()),
  );
}

export async function listIotSchedules(q: ListIotSchedulesQuery) {
  const { page, pageSize } = q;
  const where = buildScheduleWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotSchedules, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ schedule: iotSchedules, productName: iotProducts.name, groupName: iotDeviceGroups.name, deviceName: iotDevices.name })
          .from(iotSchedules)
          .leftJoin(iotProducts, eq(iotSchedules.productId, iotProducts.id))
          .leftJoin(iotDeviceGroups, eq(iotSchedules.groupId, iotDeviceGroups.id))
          .leftJoin(iotDevices, eq(iotSchedules.deviceId, iotDevices.id))
          .where(where)
          .orderBy(desc(iotSchedules.id))
          .$dynamic(),
        page,
        pageSize,
      );
      const ids = rows.map((r) => r.schedule.id);
      const since = new Date(Date.now() - 24 * 3600_000);
      const runCounts = ids.length > 0
        ? await db.select({ scheduleId: iotScheduleRuns.scheduleId, cnt: count() })
          .from(iotScheduleRuns)
          .where(and(inArray(iotScheduleRuns.scheduleId, ids), gte(iotScheduleRuns.createdAt, since)))
          .groupBy(iotScheduleRuns.scheduleId)
        : [];
      const countMap = new Map(runCounts.map((r) => [r.scheduleId, Number(r.cnt)]));
      return rows.map((r) => mapIotSchedule(r.schedule, {
        productName: r.productName,
        groupName: r.groupName,
        deviceName: r.deviceName,
        recentRunCount: countMap.get(r.schedule.id) ?? 0,
      }));
    },
  });
}

export async function ensureIotScheduleExists(id: number): Promise<IotScheduleRow> {
  const [row] = await db.select().from(iotSchedules).where(buildScheduleWhere({ id })).limit(1);
  return requireRow(row, '计划任务不存在');
}

/** 目标与动作引用校验：设备/分组归属、服务在物模型中声明 */
async function ensureScheduleReferencesValid(
  productId: number,
  data: { deviceId?: number | null; actionType: string; service?: string | null },
): Promise<void> {
  if (data.deviceId) {
    const [maybeDevice] = await db.select({ productId: iotDevices.productId })
      .from(iotDevices).where(eq(iotDevices.id, data.deviceId)).limit(1);
    const device = requireRow(maybeDevice, '指定的设备不存在', 400);
    if (device.productId !== productId) throw new HTTPException(400, { message: '设备不属于该产品' });
  }
  if (data.actionType === 'command' && data.service) {
    const { loadThingModel } = await import('./iot-model.service');
    const model = await loadThingModel(productId);
    if (!model.services.some((s) => s.identifier === data.service)) {
      throw new HTTPException(400, { message: `服务 "${data.service}" 未在物模型中声明` });
    }
  }
}

export async function createIotSchedule(data: CreateIotScheduleInput) {
  await ensureScheduleReferencesValid(data.productId, data);
  const runAt = data.runAt ? parseDateTimeInput(data.runAt) : null;
  if (data.scheduleType === 'once' && runAt && runAt.getTime() <= Date.now()) {
    throw new HTTPException(400, { message: '执行时刻需晚于当前时间' });
  }
  const nextRunAt = computeNextRunAt(data.scheduleType, data.cronExpression, runAt);
  const [row] = await db.insert(iotSchedules).values({
    name: data.name,
    scheduleType: data.scheduleType,
    cronExpression: data.scheduleType === 'cron' ? (data.cronExpression ?? null) : null,
    runAt: data.scheduleType === 'once' ? runAt : null,
    productId: data.productId,
    groupId: data.groupId ?? null,
    deviceId: data.deviceId ?? null,
    actionType: data.actionType,
    service: data.actionType === 'command' ? (data.service ?? null) : null,
    params: data.actionType === 'command' ? (data.params ?? null) : null,
    desired: data.actionType === 'desired' ? (data.desired ?? null) : null,
    status: data.status,
    nextRunAt: data.status === 'enabled' ? nextRunAt : null,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  return mapIotSchedule(row);
}

export async function updateIotSchedule(id: number, data: UpdateIotScheduleInput) {
  const before = await ensureIotScheduleExists(id);
  await ensureScheduleReferencesValid(before.productId, {
    deviceId: data.deviceId !== undefined ? data.deviceId : before.deviceId,
    actionType: before.actionType,
    service: data.service !== undefined ? data.service : before.service,
  });
  const runAt = data.runAt !== undefined ? (data.runAt ? parseDateTimeInput(data.runAt) : null) : before.runAt;
  const cronExpression = data.cronExpression !== undefined ? data.cronExpression : before.cronExpression;
  const status = data.status ?? before.status;
  const nextRunAt = status === 'enabled'
    ? computeNextRunAt(before.scheduleType, cronExpression, runAt)
    : null;
  const [row] = await db.update(iotSchedules).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.cronExpression !== undefined ? { cronExpression: data.cronExpression } : {}),
    ...(data.runAt !== undefined ? { runAt } : {}),
    ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
    ...(data.deviceId !== undefined ? { deviceId: data.deviceId } : {}),
    ...(data.service !== undefined ? { service: data.service } : {}),
    ...(data.params !== undefined ? { params: data.params } : {}),
    ...(data.desired !== undefined ? { desired: data.desired } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    nextRunAt,
  }).where(buildScheduleWhere({ id })).returning();
  return mapIotSchedule(requireRow(row, '计划任务不存在'));
}

export async function deleteIotSchedule(id: number): Promise<void> {
  await ensureIotScheduleExists(id);
  await db.delete(iotSchedules).where(buildScheduleWhere({ id }));
}

export type ListScheduleRunsFilter = Omit<QueryOutputOf<typeof iotScheduleContract.runs>, 'page' | 'pageSize'>;
export type ListScheduleRunsQuery = QueryOutputOf<typeof iotScheduleContract.runs>;

export async function listIotScheduleRuns(q: ListScheduleRunsQuery) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.scheduleId ? eq(iotScheduleRuns.scheduleId, q.scheduleId) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotScheduleRuns, where),
    rows: () => withPagination(
      db.select().from(iotScheduleRuns).where(where).orderBy(desc(iotScheduleRuns.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapIotScheduleRun,
  });
}

// ─── 调度执行 ─────────────────────────────────────────────────────────────────
/** 圈定计划目标设备（启用态；上限截断） */
async function resolveScheduleTargets(schedule: IotScheduleRow): Promise<IotDeviceRow[]> {
  if (schedule.deviceId) {
    const rows = await db.select().from(iotDevices)
      .where(and(eq(iotDevices.id, schedule.deviceId), eq(iotDevices.status, 'enabled')));
    return rows;
  }
  if (schedule.groupId) {
    const rows = await db.select({ device: iotDevices })
      .from(iotDeviceGroupMembers)
      .innerJoin(iotDevices, eq(iotDeviceGroupMembers.deviceId, iotDevices.id))
      .where(and(
        eq(iotDeviceGroupMembers.groupId, schedule.groupId),
        eq(iotDevices.productId, schedule.productId),
        eq(iotDevices.status, 'enabled'),
      ))
      .limit(IOT_SCHEDULE_TARGET_MAX);
    return rows.map((r) => r.device);
  }
  return db.select().from(iotDevices)
    .where(and(eq(iotDevices.productId, schedule.productId), eq(iotDevices.status, 'enabled')))
    .limit(IOT_SCHEDULE_TARGET_MAX);
}

/** 系统周期任务（每分钟）：执行全部到期计划 */
export async function dispatchDueIotSchedules(): Promise<string> {
  const now = new Date();
  // 自愈：enabled 但游标为空的 cron 计划（seed / 手工导入）补算 nextRunAt
  const orphans = await db.select().from(iotSchedules)
    .where(and(
      eq(iotSchedules.status, 'enabled'),
      eq(iotSchedules.scheduleType, 'cron'),
      isNull(iotSchedules.nextRunAt),
    ));
  for (const orphan of orphans) {
    const next = computeNextRunAt('cron', orphan.cronExpression, null);
    if (next) await db.update(iotSchedules).set({ nextRunAt: next }).where(eq(iotSchedules.id, orphan.id));
  }

  const due = await db.select().from(iotSchedules)
    .where(and(
      eq(iotSchedules.status, 'enabled'),
      lte(iotSchedules.nextRunAt, now),
    ));
  if (due.length === 0) return '无到期计划';

  let executed = 0;
  for (const schedule of due) {
    // 先推进游标（并发扫描/执行报错都不会重复触发本轮）
    const nextRunAt = schedule.scheduleType === 'cron'
      ? computeNextRunAt('cron', schedule.cronExpression, null)
      : null;
    const [claimed] = await db.update(iotSchedules)
      .set({
        nextRunAt,
        lastRunAt: now,
        ...(schedule.scheduleType === 'once' ? { status: 'disabled' as const } : {}),
      })
      .where(and(eq(iotSchedules.id, schedule.id), lte(iotSchedules.nextRunAt, now)))
      .returning({ id: iotSchedules.id });
    if (!claimed) continue;

    const targets = await resolveScheduleTargets(schedule);
    let success = 0;
    const errors: Array<{ deviceId: number; sn: string; error: string }> = [];
    const { sendIotCommandToDevice } = await import('./iot-telemetry.service');
    const { setIotDesiredForDevice } = await import('./iot-shadow.service');
    for (const device of targets) {
      try {
        if (schedule.actionType === 'command' && schedule.service) {
          await sendIotCommandToDevice(device, {
            service: schedule.service,
            params: schedule.params ?? null,
          });
        } else if (schedule.actionType === 'desired' && schedule.desired) {
          await setIotDesiredForDevice(device, { desired: schedule.desired });
        }
        success += 1;
      } catch (err) {
        if (errors.length < 20) {
          errors.push({ deviceId: device.id, sn: device.sn, error: (err as Error).message.slice(0, 200) });
        }
      }
    }
    await db.insert(iotScheduleRuns).values({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      deviceCount: targets.length,
      successCount: success,
      failedCount: targets.length - success,
      errors,
    }).catch((err) => {
      logger.warn(`[iot-schedule] 执行留痕失败 scheduleId=${schedule.id}: ${(err as Error).message}`);
    });
    executed += 1;
    logger.info(`[iot-schedule] 计划「${schedule.name}」执行完成：目标 ${targets.length} 台，成功 ${success}`);
  }
  return `执行 ${executed} 个到期计划`;
}
