/**
 * IoT 设备事件流：生命周期事件（系统打点）+ 物模型事件（设备上报）。
 *
 * 追加型日志；物模型事件入库时按产品事件定义解析级别与展示名，
 * 并触发事件类告警规则判定。
 */
import { and, desc, eq } from 'drizzle-orm';
import type { IotEventIngestInput } from '@zenith/shared/iot';
import { IOT_LIFECYCLE_EVENTS, type IotDeviceEventKind, type IotEventLevel, type IotLifecycleEventId } from '@zenith/shared/iot';
import { db } from '../../db';
import { iotDeviceEvents, iotDevices, type IotDeviceEventRow, type IotDeviceRow } from '../../db/schema';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { loadThingModel } from './iot-model.service';
import { evaluateIotEventRules } from './iot-alarms.service';
import { evaluateIotAutomationsOnEvent, evaluateIotAutomationsOnLifecycle } from './iot-automations.service';
import { dispatchIotForward } from './iot-forward.service';
import { pushIotRealtime } from './iot-realtime';

export function mapIotDeviceEvent(row: IotDeviceEventRow) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    kind: row.kind,
    identifier: row.identifier,
    name: row.name,
    level: row.level,
    payload: row.payload ?? null,
    reportedAt: formatDateTime(row.reportedAt),
  };
}

/** 系统生命周期打点（上线/离线/激活/密钥重置）；失败仅记日志，不阻断主流程 */
export async function recordIotLifecycleEvent(
  deviceId: number,
  identifier: IotLifecycleEventId,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(iotDeviceEvents).values({
      deviceId,
      kind: 'lifecycle',
      identifier,
      name: IOT_LIFECYCLE_EVENTS[identifier],
      level: identifier === 'offline' ? 'warn' : 'info',
      payload: payload ?? null,
    });
    pushIotRealtime({
      type: 'iot:device-event',
      payload: {
        deviceId, kind: 'lifecycle', identifier, name: IOT_LIFECYCLE_EVENTS[identifier],
        level: identifier === 'offline' ? 'warn' : 'info', reportedAt: formatDateTime(new Date()),
      },
    });
  } catch (err) {
    logger.warn(`[iot] 生命周期事件写入失败 deviceId=${deviceId} event=${identifier}: ${(err as Error).message}`);
  }
  // 数据流转：生命周期源（fire-and-forget，取设备行做过滤匹配）
  const [deviceRow] = await db.select({ id: iotDevices.id, sn: iotDevices.sn, name: iotDevices.name, productId: iotDevices.productId, tenantId: iotDevices.tenantId })
    .from(iotDevices).where(eq(iotDevices.id, deviceId)).limit(1);
  if (deviceRow) {
    dispatchIotForward('lifecycle', deviceRow, {
      deviceId, sn: deviceRow.sn, name: deviceRow.name, event: identifier,
      label: IOT_LIFECYCLE_EVENTS[identifier], reportedAt: formatDateTime(new Date()),
    });
  }
  // 上线/离线：场景联动 + 开放平台 Webhook（失败不阻断打点方）
  if (identifier === 'online' || identifier === 'offline') {
    if (deviceRow) {
      openEventBus.emit({
        type: `iot.device.${identifier}`,
        tenantId: deviceRow.tenantId ?? null,
        data: { deviceId, sn: deviceRow.sn, name: deviceRow.name },
      });
    }
    await evaluateIotAutomationsOnLifecycle(deviceId, identifier).catch((err) => {
      logger.warn(`[iot] 生命周期联动判定失败 deviceId=${deviceId}: ${(err as Error).message}`);
    });
  }
}

/** 设备上报物模型事件（ingest / WS 帧共用）：解析定义 → 入库 → 告警判定 */
export async function ingestIotDeviceEvents(device: IotDeviceRow, input: IotEventIngestInput): Promise<number> {
  const model = await loadThingModel(device.productId);
  const defs = new Map(model.events.map((e) => [e.identifier, e]));
  const rows = input.items.map((item) => {
    const def = defs.get(item.identifier);
    return {
      deviceId: device.id,
      kind: 'model' as const,
      identifier: item.identifier,
      name: def?.name ?? item.identifier,
      level: def?.level ?? 'info',
      payload: item.payload ?? null,
      reportedAt: (item.reportedAt ? parseDateTimeInput(item.reportedAt) : null) ?? new Date(),
    };
  });
  await db.insert(iotDeviceEvents).values(rows);
  for (const row of rows) {
    pushIotRealtime({
      type: 'iot:device-event',
      payload: {
        deviceId: device.id, kind: 'model', identifier: row.identifier, name: row.name,
        level: row.level, reportedAt: formatDateTime(row.reportedAt),
      },
    });
    // 数据流转（fire-and-forget）
    dispatchIotForward('event', device, {
      deviceId: device.id, sn: device.sn, kind: 'model', identifier: row.identifier,
      name: row.name, level: row.level, payload: row.payload, reportedAt: formatDateTime(row.reportedAt),
    });
  }
  // 事件类告警与场景联动：仅对模型内已声明的事件判定
  for (const item of input.items) {
    if (!defs.has(item.identifier)) continue;
    await evaluateIotEventRules(device, item.identifier, item.payload ?? null).catch((err) => {
      logger.warn(`[iot] 事件告警判定失败 deviceId=${device.id} event=${item.identifier}: ${(err as Error).message}`);
    });
    await evaluateIotAutomationsOnEvent(device, item.identifier, item.payload ?? null).catch((err) => {
      logger.warn(`[iot] 事件联动判定失败 deviceId=${device.id} event=${item.identifier}: ${(err as Error).message}`);
    });
  }
  return rows.length;
}

export interface ListDeviceEventsQuery {
  page?: number;
  pageSize?: number;
  kind?: IotDeviceEventKind;
  level?: IotEventLevel;
}

export async function listIotDeviceEvents(deviceId: number, q: ListDeviceEventsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildWhere(
    eq(iotDeviceEvents.deviceId, deviceId),
    q.kind ? eq(iotDeviceEvents.kind, q.kind) : undefined,
    q.level ? eq(iotDeviceEvents.level, q.level) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotDeviceEvents, where),
    rows: () => withPagination(
      db.select().from(iotDeviceEvents).where(where)
        .orderBy(desc(iotDeviceEvents.reportedAt), desc(iotDeviceEvents.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapIotDeviceEvent,
  });
}

/** 保留最近事件的辅助查询（设备详情时间线首屏） */
export async function listRecentIotDeviceEvents(deviceId: number, limit = 20) {
  const rows = await db.select().from(iotDeviceEvents)
    .where(and(eq(iotDeviceEvents.deviceId, deviceId)))
    .orderBy(desc(iotDeviceEvents.reportedAt), desc(iotDeviceEvents.id))
    .limit(limit);
  return rows.map(mapIotDeviceEvent);
}
