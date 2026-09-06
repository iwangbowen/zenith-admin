/**
 * IoT 网关与子设备拓扑。
 *
 * 形态规则（服务端兜底，schema 只做形状校验）：
 * - sub 必须挂在 gateway 型设备下，且只允许一层（gateway 不能是 sub）
 * - 网关存在子设备时不可降级/删除（FK restrict 兜底）
 * - 子设备免密接入：不建立自己的连接，由网关经 gateway:batch / gateway:event 帧代理
 *
 * 在线态：网关心跳/上报续期自身 TTL 的同时批量续期在线子设备；
 * 子设备被代理上报时单独续期。网关断开后子设备 TTL 自然过期，
 * 由既有离线扫描逐台触发 offline 生命周期（无级联下线逻辑）。
 */
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { IotGatewayBatchInput, IotGatewayEventInput } from '@zenith/shared/iot';
import { db } from '../../db';
import { iotAlarms, iotDevices, type IotDeviceRow } from '../../db/schema';
import { formatNullableDateTime } from '../../lib/datetime';
import { getOnlineMap, isDeviceOnline, touchDevice } from './iot-access.service';
import { ingestTelemetry } from './iot-telemetry.service';
import { ingestIotDeviceEvents } from './iot-events.service';

/** 创建/更新设备时的拓扑归属校验（gatewayId 指向真实网关；防自挂/环） */
export async function ensureIotTopologyValid(
  data: { nodeType?: string; gatewayId?: number | null },
  selfId?: number,
): Promise<void> {
  if (data.nodeType === 'sub') {
    if (!data.gatewayId) throw new HTTPException(400, { message: '子设备必须指定所属网关' });
    if (selfId && data.gatewayId === selfId) throw new HTTPException(400, { message: '子设备不能挂在自身之下' });
    const [maybeGateway] = await db.select({ id: iotDevices.id, nodeType: iotDevices.nodeType })
      .from(iotDevices).where(eq(iotDevices.id, data.gatewayId)).limit(1);
    const gateway = requireRow(maybeGateway, '指定的网关不存在', 400);
    if (gateway.nodeType !== 'gateway') throw new HTTPException(400, { message: '所属设备不是网关（仅支持一层拓扑）' });
  }
  if (data.nodeType && data.nodeType !== 'gateway' && selfId) {
    // 降级校验：从 gateway 改为其他形态时不得存在子设备
    const [row] = await db.select({ cnt: count() }).from(iotDevices)
      .where(eq(iotDevices.gatewayId, selfId));
    if (Number(row?.cnt ?? 0) > 0) {
      throw new HTTPException(400, { message: '该网关下存在子设备，请先迁移或删除子设备' });
    }
  }
}

/** 网关拓扑视图：网关节点 + 全部子设备（在线态 + 活跃告警数） */
export async function getIotDeviceTopology(gateway: IotDeviceRow) {
  if (gateway.nodeType !== 'gateway') {
    throw new HTTPException(400, { message: '该设备不是网关，无拓扑视图' });
  }
  const children = await db.select().from(iotDevices)
    .where(eq(iotDevices.gatewayId, gateway.id))
    .orderBy(iotDevices.id);
  const childIds = children.map((c) => c.id);
  const [onlineMap, gatewayOnline, alarmRows] = await Promise.all([
    getOnlineMap(childIds),
    isDeviceOnline(gateway.id),
    childIds.length > 0
      ? db.select({ deviceId: iotAlarms.deviceId, cnt: count() }).from(iotAlarms)
        .where(and(inArray(iotAlarms.deviceId, childIds), eq(iotAlarms.status, 'firing')))
        .groupBy(iotAlarms.deviceId)
      : Promise.resolve([]),
  ]);
  const alarmMap = new Map(alarmRows.map((r) => [r.deviceId, Number(r.cnt)]));
  return {
    gateway: { id: gateway.id, sn: gateway.sn, name: gateway.name, online: gatewayOnline },
    children: children.map((c) => ({
      id: c.id,
      sn: c.sn,
      name: c.name,
      status: c.status,
      online: onlineMap.get(c.id) ?? false,
      firingAlarmCount: alarmMap.get(c.id) ?? 0,
      lastSeenAt: formatNullableDateTime(c.lastSeenAt),
    })),
  };
}

/**
 * 代理接入解析：按 subSn 批量取子设备行，仅返回归属于该网关且启用的子设备。
 * 未知 SN / 非本网关子设备 / 已禁用的条目静默丢弃（计入 rejected 计数）。
 */
export async function resolveGatewaySubDevices(
  gateway: IotDeviceRow,
  subSns: string[],
): Promise<Map<string, IotDeviceRow>> {
  if (gateway.nodeType !== 'gateway' || subSns.length === 0) return new Map();
  const rows = await db.select().from(iotDevices)
    .where(and(
      inArray(iotDevices.sn, [...new Set(subSns)]),
      eq(iotDevices.gatewayId, gateway.id),
      eq(iotDevices.status, 'enabled'),
    ));
  return new Map(rows.map((r) => [r.sn, r]));
}

/** 网关下全部启用子设备 id（心跳批量续期用） */
export async function listGatewaySubDeviceIds(gatewayId: number): Promise<number[]> {
  const rows = await db.select({ id: iotDevices.id }).from(iotDevices)
    .where(and(eq(iotDevices.gatewayId, gatewayId), eq(iotDevices.status, 'enabled')));
  return rows.map((r) => r.id);
}

// ─── 代理 ingest 编排 ─────────────────────────────────────────────────────────
/**
 * 网关批量代理子设备遥测：按 subSn 归组后逐台复用直连遥测链路
 * （校验/影子/告警/联动/异常/流转/实时推送全部自动生效），子设备独立续期在线态。
 * 归属校验失败的条目静默丢弃并计入 rejected。
 */
export async function ingestGatewayBatch(
  gateway: IotDeviceRow,
  input: IotGatewayBatchInput,
): Promise<{ accepted: number; rejected: number }> {
  if (gateway.nodeType !== 'gateway') {
    throw new HTTPException(400, { message: '该设备不是网关，不能代理上报' });
  }
  const subMap = await resolveGatewaySubDevices(gateway, input.items.map((i) => i.subSn));
  const bySn = new Map<string, { metrics: IotGatewayBatchInput['items'][number]['metrics']; reportedAt?: string }[]>();
  let rejected = 0;
  for (const item of input.items) {
    if (!subMap.has(item.subSn)) {
      rejected += 1;
      continue;
    }
    const list = bySn.get(item.subSn) ?? [];
    list.push({ metrics: item.metrics, reportedAt: item.reportedAt });
    bySn.set(item.subSn, list);
  }
  let accepted = 0;
  for (const [sn, items] of bySn) {
    const sub = subMap.get(sn)!;
    accepted += await ingestTelemetry(sub, { items });
    await touchDevice(sub);
  }
  return { accepted, rejected };
}

/** 网关代理子设备事件（归属校验失败返回 false，不抛错） */
export async function ingestGatewayEvent(gateway: IotDeviceRow, input: IotGatewayEventInput): Promise<boolean> {
  if (gateway.nodeType !== 'gateway') {
    throw new HTTPException(400, { message: '该设备不是网关，不能代理上报' });
  }
  const subMap = await resolveGatewaySubDevices(gateway, [input.subSn]);
  const sub = subMap.get(input.subSn);
  if (!sub) return false;
  await ingestIotDeviceEvents(sub, {
    items: [{ identifier: input.identifier, payload: input.payload ?? null, reportedAt: input.reportedAt }],
  });
  await touchDevice(sub);
  return true;
}
