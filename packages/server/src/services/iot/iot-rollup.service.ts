/**
 * IoT 遥测降采样与在线率采样。
 *
 * - 小时聚合：系统周期任务每 10 分钟重算最近两个小时桶（LATERAL jsonb_each 展开数值属性，
 *   upsert 幂等），长窗口图表与仪表盘查聚合而非扫明细；明细保留期据此可独立缩短。
 *   明细表按 reported_at 日分区且带 BRIN，两小时窗口的扫描只触及当天分区的尾部
 * - 在线率采样：离线扫描任务每分钟顺带落一条快照（以持久化 online 标记为准）
 */
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db';
import { iotDeviceState, iotDevices, iotOnlineSnapshots, iotTelemetryHourly } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { clampDays } from '../../lib/analytics-helpers';
import { ensureIotDeviceExists } from './iot-devices.service';

/**
 * 增量聚合：重算 [now - 2h 的小时桶起点, now) 覆盖窗口。
 * 跨小时边界的晚到数据会被下一轮重算收敛；服务重启漏跑由下次调度补齐近窗。
 * 小时桶与窗口下界按 UTC 整点（三参数 date_trunc），不受会话时区影响。
 */
export async function rollupIotTelemetryHourly(): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO iot_telemetry_hourly (device_id, property, bucket, min_value, max_value, avg_value, last_value, count)
    SELECT
      t.device_id,
      m.key AS property,
      date_trunc('hour', t.reported_at, 'UTC') AS bucket,
      min((m.value)::text::double precision),
      max((m.value)::text::double precision),
      avg((m.value)::text::double precision),
      (array_agg((m.value)::text::double precision ORDER BY t.reported_at DESC))[1],
      count(*)::int
    FROM iot_telemetry t
    CROSS JOIN LATERAL jsonb_each(t.metrics) AS m(key, value)
    WHERE t.reported_at >= date_trunc('hour', now() - interval '2 hours', 'UTC')
      AND jsonb_typeof(m.value) = 'number'
    GROUP BY t.device_id, m.key, date_trunc('hour', t.reported_at, 'UTC')
    ON CONFLICT (device_id, property, bucket) DO UPDATE SET
      min_value = EXCLUDED.min_value,
      max_value = EXCLUDED.max_value,
      avg_value = EXCLUDED.avg_value,
      last_value = EXCLUDED.last_value,
      count = EXCLUDED.count
  `);
  const rows = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  return `聚合 ${rows} 个 (设备, 属性, 小时) 桶`;
}

/** 长窗口聚合点列（升序，供图表带 min/max 区间展示） */
export async function listIotTelemetryAgg(deviceId: number, property: string, daysInput?: number) {
  await ensureIotDeviceExists(deviceId);
  const days = clampDays(daysInput, 7, 90);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select().from(iotTelemetryHourly)
    .where(and(
      eq(iotTelemetryHourly.deviceId, deviceId),
      eq(iotTelemetryHourly.property, property),
      gte(iotTelemetryHourly.bucket, since),
    ))
    .orderBy(asc(iotTelemetryHourly.bucket));
  return rows.map((r) => ({
    bucket: formatDateTime(r.bucket),
    minValue: r.minValue,
    maxValue: r.maxValue,
    avgValue: Math.round(r.avgValue * 100) / 100,
    count: r.count,
  }));
}

/** 在线率采样（离线扫描任务每分钟调用，以持久化 online 标记为准） */
export async function sampleIotOnlineSnapshot(): Promise<void> {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    online: sql<number>`count(*) FILTER (WHERE ${iotDeviceState.online})::int`,
  })
    .from(iotDevices)
    .leftJoin(iotDeviceState, eq(iotDevices.id, iotDeviceState.deviceId))
    .where(eq(iotDevices.status, 'enabled'));
  await db.insert(iotOnlineSnapshots).values({
    totalCount: row?.total ?? 0,
    onlineCount: row?.online ?? 0,
  });
}
