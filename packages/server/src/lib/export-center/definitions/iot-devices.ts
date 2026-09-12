import { desc, eq } from 'drizzle-orm';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { IOT_NODE_TYPES } from '@zenith/shared/iot';
import { db } from '../../../db';
import { iotDevices, iotProducts } from '../../../db/schema';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS, STATUS_ENUM_MAP } from '../presets';
import { buildIotDeviceExportWhere, type ListIotDevicesFilter } from '../../../services/iot/iot-devices.service';
import type { ExportColumn } from '../types';
import { asPositiveInt, asString } from '../query-normalize';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'sn', header: 'SN', width: 24 },
  { key: 'name', header: '设备名称', width: 22 },
  { key: 'productName', header: '所属产品', width: 22 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_ENUM_MAP },
  { key: 'firmwareVersion', header: '固件版本', width: 12 },
  { key: 'activatedAt', header: '激活时间', width: 22, type: 'datetime' },
  { key: 'lastSeenAt', header: '最后在线', width: 22, type: 'datetime' },
  { key: 'remark', header: '备注', width: 28 },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

type Query = ListIotDevicesFilter & Record<string, unknown>;

function normalizeQuery(query: Record<string, unknown>): ListIotDevicesFilter {
  return {
    keyword: asString(query.keyword),
    status: enumValueOf(USER_STATUSES, query.status),
    productId: asPositiveInt(query.productId),
    groupId: asPositiveInt(query.groupId),
    nodeType: enumValueOf(IOT_NODE_TYPES, query.nodeType),
    gatewayId: asPositiveInt(query.gatewayId),
    startTime: asString(query.startTime),
    endTime: asString(query.endTime),
  };
}

export const iotDevicesExportDefinition = defineExport<Record<string, unknown>, Query>({
  entity: 'iot.devices',
  moduleName: 'IoT 设备',
  filenamePrefix: 'IoT设备列表',
  sourcePath: '/iot/devices',
  sheetName: '设备列表',
  permissions: { export: 'iot:device:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(iotDevices, buildIotDeviceExportWhere(normalizeQuery(query))),
  streamRows: async (query) => {
    const normalizedQuery = normalizeQuery(query);
    const rows = await db.select({
      id: iotDevices.id,
      sn: iotDevices.sn,
      name: iotDevices.name,
      productName: iotProducts.name,
      status: iotDevices.status,
      firmwareVersion: iotDevices.firmwareVersion,
      activatedAt: iotDevices.activatedAt,
      lastSeenAt: iotDevices.lastSeenAt,
      remark: iotDevices.remark,
      createdAt: iotDevices.createdAt,
    })
      .from(iotDevices)
      .leftJoin(iotProducts, eq(iotDevices.productId, iotProducts.id))
      .where(buildIotDeviceExportWhere(normalizedQuery))
      .orderBy(desc(iotDevices.id));
    return rows;
  },
});
