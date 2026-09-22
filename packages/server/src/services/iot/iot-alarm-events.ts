import { eq, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { iotAlarms, iotDevices, type IotAlarmRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { recordDomainEvent } from '../platform/relations/events.service';

export async function recordIotAlarmEvent(tx: DbTransaction, alarm: IotAlarmRow) {
  const [device] = await tx.select({ tenantId: iotDevices.tenantId }).from(iotDevices).where(eq(iotDevices.id, alarm.deviceId)).limit(1);
  const owner = requireRow(device, '告警所属设备不存在');
  const type = alarm.status === 'firing' ? 'iot.alarm.triggered' : alarm.status === 'acknowledged' ? 'iot.alarm.acknowledged' : 'iot.alarm.resolved';
  await recordDomainEvent(tx, {
    eventType: type, tenantId: owner.tenantId,
    source: { type: 'iot.alarm', key: String(alarm.id) },
    subjects: [{ type: 'iot.alarm', key: String(alarm.id), role: 'primary' }, { type: 'iot.device', key: String(alarm.deviceId), role: 'related' }],
    payload: { status: alarm.status, level: alarm.level, ruleName: alarm.ruleName.slice(0, 128) },
    dedupeKey: `iot-alarm:${alarm.id}:${type}`,
  });
}

/** Runtime recovery and manual actions use the same transactional business-event boundary. */
export async function updateIotAlarmWithEvent(values: Partial<typeof iotAlarms.$inferInsert>, where: SQL | undefined) {
  if (!where) throw new Error('Alarm updates require an explicit condition');
  return db.transaction(async (tx) => {
    const rows = await tx.update(iotAlarms).set(values).where(where).returning();
    for (const row of rows) await recordIotAlarmEvent(tx, row);
    return rows;
  });
}
