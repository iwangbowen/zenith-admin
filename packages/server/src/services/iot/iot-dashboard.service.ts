/**
 * IoT 总览仪表盘：统计卡 + 趋势 + 分布 + 最近告警/事件。
 *
 * 在线趋势读 iot_online_snapshots（10 分钟桶平均），告警趋势按天分级聚合，
 * 遥测今日量读 Redis 日计数器（ingest 累加，O(1)；明细表按时间列无单列索引，不可 count）。
 */
import { percentOf } from '@zenith/shared/core';
import { count, desc, eq, gte, sql } from 'drizzle-orm';
import type { IotDashboard } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotAlarms, iotDeviceEvents, iotDevices, iotDeviceState, iotOnlineSnapshots, iotProducts,
} from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { mapIotAlarm } from './iot-alarms.service';
import { mapIotDeviceEvent } from './iot-events.service';
import { getIotTelemetryTodayCount } from './iot-telemetry-counter';

export async function getIotDashboard(): Promise<IotDashboard> {
  const user = currentUser();
  const deviceWhere = tenantCondition(iotDevices, user);
  const now = Date.now();
  const trendSince = new Date(now - 24 * 3600_000);
  const alarmSince = new Date(now - 7 * 86_400_000);

  const [
    deviceCounts, telemetryToday, firingCounts, pendingDesired, productTotal,
    onlineTrendRows, alarmTrendRows, distribution, recentAlarmRows, recentEventRows,
  ] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      online: sql<number>`count(*) FILTER (WHERE ${iotDeviceState.online})::int`,
    })
      .from(iotDevices)
      .leftJoin(iotDeviceState, eq(iotDevices.id, iotDeviceState.deviceId))
      .where(deviceWhere)
      .then((rows) => rows[0]),
    getIotTelemetryTodayCount(),
    db.select({ level: iotAlarms.level, cnt: count() })
      .from(iotAlarms)
      .where(eq(iotAlarms.status, 'firing'))
      .groupBy(iotAlarms.level),
    db.select({ cnt: count() })
      .from(iotDeviceState)
      .where(sql`${iotDeviceState.desired} <> '{}'::jsonb`)
      .then((rows) => Number(rows[0]?.cnt ?? 0)),
    db.$count(iotProducts, tenantCondition(iotProducts, user)),
    // 在线趋势：近 24h 按 10 分钟桶取平均
    db.select({
      bucket: sql<string>`to_char(to_timestamp(floor(extract(epoch FROM ${iotOnlineSnapshots.sampledAt}) / 600) * 600), 'YYYY-MM-DD HH24:MI:SS')`,
      total: sql<number>`round(avg(${iotOnlineSnapshots.totalCount}))::int`,
      online: sql<number>`round(avg(${iotOnlineSnapshots.onlineCount}))::int`,
    })
      .from(iotOnlineSnapshots)
      .where(gte(iotOnlineSnapshots.sampledAt, trendSince))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    // 告警趋势：近 7 天按日分级
    db.select({
      date: sql<string>`to_char(${iotAlarms.firedAt}, 'YYYY-MM-DD')`,
      level: iotAlarms.level,
      cnt: count(),
    })
      .from(iotAlarms)
      .where(gte(iotAlarms.firedAt, alarmSince))
      .groupBy(sql`1`, iotAlarms.level)
      .orderBy(sql`1`),
    db.select({ name: iotProducts.name, value: count() })
      .from(iotDevices)
      .innerJoin(iotProducts, eq(iotDevices.productId, iotProducts.id))
      .where(deviceWhere)
      .groupBy(iotProducts.name),
    db.select({ alarm: iotAlarms, deviceName: iotDevices.name, deviceSn: iotDevices.sn })
      .from(iotAlarms)
      .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
      .orderBy(desc(iotAlarms.firedAt), desc(iotAlarms.id))
      .limit(5),
    db.select({ event: iotDeviceEvents, deviceName: iotDevices.name })
      .from(iotDeviceEvents)
      .innerJoin(iotDevices, eq(iotDeviceEvents.deviceId, iotDevices.id))
      .orderBy(desc(iotDeviceEvents.reportedAt), desc(iotDeviceEvents.id))
      .limit(8),
  ]);

  const firingMap = new Map(firingCounts.map((r) => [r.level, Number(r.cnt)]));
  const alarmByDate = new Map<string, { warning: number; critical: number }>();
  for (const row of alarmTrendRows) {
    const entry = alarmByDate.get(row.date) ?? { warning: 0, critical: 0 };
    entry[row.level] = Number(row.cnt);
    alarmByDate.set(row.date, entry);
  }
  // 补齐无告警的日期，趋势图连续
  const alarmTrend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * 86_400_000);
    const date = formatDateTime(d).slice(0, 10);
    const entry = alarmByDate.get(date) ?? { warning: 0, critical: 0 };
    return { date, warning: entry.warning, critical: entry.critical };
  });

  const total = deviceCounts?.total ?? 0;
  const online = deviceCounts?.online ?? 0;
  return {
    stats: {
      deviceTotal: total,
      onlineCount: online,
      onlineRate: percentOf(online, total) ?? 0,
      telemetryToday: telemetryToday,
      firingWarning: firingMap.get('warning') ?? 0,
      firingCritical: firingMap.get('critical') ?? 0,
      pendingDesiredDevices: pendingDesired,
      productTotal,
    },
    onlineTrend: onlineTrendRows.map((r) => ({ time: r.bucket, total: Number(r.total), online: Number(r.online) })),
    alarmTrend,
    productDistribution: distribution.map((r) => ({ name: r.name, value: Number(r.value) })),
    recentAlarms: recentAlarmRows.map((r) => mapIotAlarm(r.alarm, { deviceName: r.deviceName, deviceSn: r.deviceSn })),
    recentEvents: recentEventRows.map((r) => ({ ...mapIotDeviceEvent(r.event), deviceName: r.deviceName })),
  };
}
