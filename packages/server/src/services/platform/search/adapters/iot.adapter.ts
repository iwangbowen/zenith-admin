import { eq, ilike, or } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { iotAlarms, iotDevices, iotProducts } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { likePattern, result } from '../helpers';

export const iotDeviceSearchAdapter: GlobalSearchAdapter = {
  type: 'iot-device',
  permissions: ['iot:device:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('iot:device:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const rows = await db.select({
      id: iotDevices.id,
      sn: iotDevices.sn,
      name: iotDevices.name,
      productName: iotProducts.name,
      status: iotDevices.status,
    })
      .from(iotDevices)
      .leftJoin(iotProducts, eq(iotDevices.productId, iotProducts.id))
      .where(buildWhere(
        or(ilike(iotDevices.sn, pattern), ilike(iotDevices.name, pattern), ilike(iotProducts.name, pattern))!,
        tenantCondition(iotDevices, user),
      ))
      .orderBy(iotDevices.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'iot-device',
      id: String(row.id),
      title: row.name,
      subtitle: [row.sn, row.productName].filter(Boolean).join(' · '),
      description: row.status === 'enabled' ? '启用' : '停用',
      icon: 'HardDrive',
      route: `/iot/devices?keyword=${encodeURIComponent(row.name)}`,
      highlights: [{ field: 'title', text: row.name }],
    }));
  },
};

export const iotAlarmSearchAdapter: GlobalSearchAdapter = {
  type: 'iot-alarm',
  permissions: ['iot:alarm:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('iot:alarm:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const rows = await db.select({
      id: iotAlarms.id,
      ruleName: iotAlarms.ruleName,
      message: iotAlarms.message,
      level: iotAlarms.level,
      status: iotAlarms.status,
      deviceName: iotDevices.name,
      deviceSn: iotDevices.sn,
    })
      .from(iotAlarms)
      .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
      .where(buildWhere(
        or(ilike(iotAlarms.ruleName, pattern), ilike(iotAlarms.message, pattern), ilike(iotDevices.name, pattern), ilike(iotDevices.sn, pattern))!,
        tenantCondition(iotDevices, user),
      ))
      .orderBy(iotAlarms.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'iot-alarm',
      id: String(row.id),
      title: row.ruleName,
      subtitle: [row.deviceName, row.deviceSn].filter(Boolean).join(' · '),
      description: `${row.level} · ${row.status}`,
      icon: 'BellRing',
      route: `/alerts/events?keyword=${encodeURIComponent(row.ruleName)}`,
      highlights: [{ field: 'title', text: row.ruleName }],
    }));
  },
};
