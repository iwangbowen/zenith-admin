/**
 * IoT 设备影子：reported（最新上报快照）与 desired（期望值增量）。
 *
 * - reported：遥测 ingest 时 jsonb 合并（`||`），设备列表/详情 O(1) 读快照
 * - desired ：管理端按物模型 rw 属性设置；版本号随变更 +1；
 *             WS 在线即时推送，HTTP 设备心跳响应捎带；设备回报一致后按键收敛
 */
import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { eq, sql } from 'drizzle-orm';
import type { IotDesiredPayload, IotMetricValue, SetIotDesiredInput } from '@zenith/shared/iot';
import { db } from '../../db';
import { iotDeviceState, type IotDeviceRow, type IotDeviceStateRow, type IotProductPropertyRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { ensureIotDeviceExists } from './iot-devices.service';
import { loadThingModel } from './iot-model.service';
import { pushDesiredToDevice } from './iot-gateway.service';
import { pushIotRealtime } from './iot-realtime';

export function mapIotShadow(row: IotDeviceStateRow) {
  return {
    deviceId: row.deviceId,
    reported: row.reported ?? {},
    reportedAt: formatNullableDateTime(row.reportedAt),
    desired: row.desired ?? {},
    desiredVersion: row.desiredVersion,
    desiredAt: formatNullableDateTime(row.desiredAt),
    online: row.online,
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function loadStateRow(deviceId: number): Promise<IotDeviceStateRow> {
  const [row] = await db.select().from(iotDeviceState).where(eq(iotDeviceState.deviceId, deviceId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(iotDeviceState).values({ deviceId })
    .onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(iotDeviceState).where(eq(iotDeviceState.deviceId, deviceId)).limit(1);
  return again;
}

export async function getIotDeviceShadow(deviceId: number) {
  await ensureIotDeviceExists(deviceId);
  return mapIotShadow(await loadStateRow(deviceId));
}

/** 校验期望值：仅 rw 属性可写，值需符合类型/量程/枚举声明 */
function validateDesiredValue(prop: IotProductPropertyRow, value: IotMetricValue): string | null {
  switch (prop.dataType) {
    case 'number': {
      if (typeof value !== 'number') return `属性 ${prop.identifier} 需要数值`;
      if (prop.minValue != null && value < prop.minValue) return `属性 ${prop.identifier} 低于量程下限 ${prop.minValue}`;
      if (prop.maxValue != null && value > prop.maxValue) return `属性 ${prop.identifier} 超出量程上限 ${prop.maxValue}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `属性 ${prop.identifier} 需要布尔值`;
    case 'enum': {
      if (typeof value !== 'string') return `属性 ${prop.identifier} 需要枚举值`;
      const options = prop.enumOptions ?? {};
      return value in options ? null : `属性 ${prop.identifier} 取值需为 ${Object.keys(options).join(' / ')}`;
    }
    case 'string':
      return typeof value === 'string' ? null : `属性 ${prop.identifier} 需要字符串`;
    default:
      return null;
  }
}

/** 管理端设置期望属性：合并 desired、版本 +1、WS 在线即时推送 */
export async function setIotDesired(deviceId: number, input: SetIotDesiredInput) {
  const device = await ensureIotDeviceExists(deviceId);
  return setIotDesiredForDevice(device, input);
}

/** 运行时变体（场景联动等无用户上下文场景）：调用方需自行完成目标校验 */
export async function setIotDesiredForDevice(device: IotDeviceRow, input: SetIotDesiredInput) {
  if (device.status !== 'enabled') throw new HTTPException(400, { message: '设备已禁用，无法下发期望属性' });
  const model = await loadThingModel(device.productId);
  const propMap = new Map(model.properties.map((p) => [p.identifier, p]));
  for (const [key, value] of Object.entries(input.desired)) {
    const maybeProp = propMap.get(key);
    const prop = requireRow(maybeProp, `属性 ${key} 未在物模型中声明`, 400);
    if (prop.accessMode !== 'rw') throw new HTTPException(400, { message: `属性 ${key} 为只读，不可下发` });
    const err = validateDesiredValue(prop, value);
    if (err) throw new HTTPException(400, { message: err });
  }

  await loadStateRow(device.id);
  const [row] = await db.update(iotDeviceState).set({
    desired: sql`${iotDeviceState.desired} || ${JSON.stringify(input.desired)}::jsonb`,
    desiredVersion: sql`${iotDeviceState.desiredVersion} + 1`,
    desiredAt: new Date(),
  }).where(eq(iotDeviceState.deviceId, device.id)).returning();

  pushDesiredToDevice(device.sn, { version: row.desiredVersion, desired: row.desired ?? {} });
  pushIotRealtime({
    type: 'iot:shadow',
    payload: { deviceId: device.id, reported: row.reported ?? {}, desired: row.desired ?? {}, desiredVersion: row.desiredVersion },
  });
  return mapIotShadow(row);
}

/** 清空期望值（放弃未确认的下发） */
export async function clearIotDesired(deviceId: number) {
  const device = await ensureIotDeviceExists(deviceId);
  await loadStateRow(deviceId);
  const [row] = await db.update(iotDeviceState).set({
    desired: {},
    desiredVersion: sql`${iotDeviceState.desiredVersion} + 1`,
    desiredAt: new Date(),
  }).where(eq(iotDeviceState.deviceId, deviceId)).returning();
  pushDesiredToDevice(device.sn, { version: row.desiredVersion, desired: {} });
  return mapIotShadow(row);
}

export interface IotReportedMergeResult {
  reported: Record<string, IotMetricValue>;
  desired: Record<string, IotMetricValue>;
  desiredVersion: number;
}

export interface IotReportedPatch {
  deviceId: number;
  metrics: Record<string, IotMetricValue>;
  reportedAt: Date;
}

/**
 * 批量合并 reported 并按键收敛 desired：一条多行 upsert，RETURNING 直供实时推送。
 * - 顺序上报：新值覆盖旧值；乱序晚到（reportedAt 早于影子当前时刻）只补缺失键，不回退更新的值
 * - 设备已回报与期望一致的键从 desired 中移除（无需版本 +1，不触发重推）
 * 调用方保证同一 deviceId 只出现一次（ON CONFLICT 不允许同语句内二次命中同一行）。
 */
export async function mergeIotReportedBatch(patches: IotReportedPatch[]): Promise<Map<number, IotReportedMergeResult>> {
  const results = new Map<number, IotReportedMergeResult>();
  const entries = patches.filter((p) => Object.keys(p.metrics).length > 0);
  if (entries.length === 0) return results;
  // 与 drizzle timestamp 列写入口径一致：ISO 串直接落 timestamp（不经 session 时区换算）
  const values = sql.join(
    entries.map((p) => sql`(${p.deviceId}, ${JSON.stringify(p.metrics)}::jsonb, ${p.reportedAt.toISOString()}::timestamp)`),
    sql`, `,
  );
  const merged = sql`CASE
    WHEN s.reported_at IS NULL OR EXCLUDED.reported_at >= s.reported_at THEN s.reported || EXCLUDED.reported
    ELSE EXCLUDED.reported || s.reported
  END`;
  const rows = await db.execute(sql`
    INSERT INTO iot_device_state AS s (device_id, reported, reported_at)
    VALUES ${values}
    ON CONFLICT (device_id) DO UPDATE SET
      reported = ${merged},
      reported_at = GREATEST(s.reported_at, EXCLUDED.reported_at),
      desired = CASE WHEN s.desired = '{}'::jsonb THEN s.desired ELSE COALESCE(
        (SELECT jsonb_object_agg(d.key, d.value) FROM jsonb_each(s.desired) AS d
         WHERE NOT ((${merged}) ? d.key AND (${merged}) -> d.key = d.value)),
        '{}'::jsonb) END,
      updated_at = now()
    RETURNING device_id, reported, desired, desired_version
  `);
  type Row = { device_id: number; reported: Record<string, IotMetricValue> | null; desired: Record<string, IotMetricValue> | null; desired_version: number };
  for (const row of rows as unknown as Row[]) {
    const deviceId = Number(row.device_id);
    const result: IotReportedMergeResult = {
      reported: row.reported ?? {},
      desired: row.desired ?? {},
      desiredVersion: Number(row.desired_version),
    };
    results.set(deviceId, result);
    pushIotRealtime({ type: 'iot:shadow', payload: { deviceId, ...result } });
  }
  return results;
}

/** 单设备合并（批量版的便捷入口） */
export async function mergeIotReported(
  deviceId: number,
  metrics: Record<string, IotMetricValue>,
  reportedAt: Date,
): Promise<IotReportedMergeResult | null> {
  const results = await mergeIotReportedBatch([{ deviceId, metrics, reportedAt }]);
  return results.get(deviceId) ?? null;
}

/** 设备侧待同步期望值（WS 上线补推 / 心跳响应捎带）；为空返回 null */
export async function getIotDesiredPayload(device: IotDeviceRow): Promise<IotDesiredPayload | null> {
  const [row] = await db.select({ desired: iotDeviceState.desired, version: iotDeviceState.desiredVersion })
    .from(iotDeviceState).where(eq(iotDeviceState.deviceId, device.id)).limit(1);
  if (!row || !row.desired || Object.keys(row.desired).length === 0) return null;
  return { version: row.version, desired: row.desired };
}
