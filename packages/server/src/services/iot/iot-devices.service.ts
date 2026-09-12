import { iotProductContract, iotDeviceContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 产品 / 设备管理 CRUD。
 *
 * 设备列表的属性快照读自 iot_device_state.reported（O(1)），不再扫遥测表。
 */
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import { alias as aliasedTable } from 'drizzle-orm/pg-core';
import type { CreateIotDeviceInput, CreateIotProductInput, UpdateIotDeviceInput, UpdateIotProductInput } from '@zenith/shared/iot';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  iotDeviceGroupMembers, iotDeviceGroups, iotDevices, iotDeviceState, iotProductEvents,
  iotProductProperties, iotProducts, iotProductServices,
  type IotDeviceRow, type IotDeviceStateRow, type IotProductRow,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { clearOnlineKeys, generateDeviceSecret, generateDeviceSn, getOnlineMap, invalidateIotDeviceAuthCache } from './iot-access.service';
import { recordIotLifecycleEvent } from './iot-events.service';
import { invalidateThingModelCache } from './iot-model.service';
import { ensureIotTopologyValid } from './iot-topology.service';

/** 批量读取影子（设备列表快照列） */
async function loadIotStates(deviceIds: number[]): Promise<Map<number, IotDeviceStateRow>> {
  if (deviceIds.length === 0) return new Map();
  const rows = await db.select().from(iotDeviceState)
    .where(inArray(iotDeviceState.deviceId, deviceIds));
  return new Map(rows.map((r) => [r.deviceId, r]));
}

// ─── 产品 ─────────────────────────────────────────────────────────────────────
export function mapIotProduct(
  row: IotProductRow,
  extra?: { deviceCount?: number; propertyCount?: number; serviceCount?: number; eventCount?: number },
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    validationMode: row.validationMode,
    status: row.status,
    registrationEnabled: Boolean(row.registrationSecret),
    deviceCount: extra?.deviceCount ?? 0,
    propertyCount: extra?.propertyCount ?? 0,
    serviceCount: extra?.serviceCount ?? 0,
    eventCount: extra?.eventCount ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export type ListIotProductsFilter = Omit<QueryOutputOf<typeof iotProductContract.list>, 'page' | 'pageSize'>;
export type ListIotProductsQuery = QueryOutputOf<typeof iotProductContract.list>;

function buildProductWhere(q: ListIotProductsFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotProducts.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotProducts.name, iotProducts.description]),
    q.status ? eq(iotProducts.status, q.status) : undefined,
    tenantCondition(iotProducts, currentUser()),
  );
}

async function loadCountMap(table: typeof iotDevices | typeof iotProductProperties | typeof iotProductServices | typeof iotProductEvents, productIds: number[]): Promise<Map<number, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: table.productId, cnt: count() })
    .from(table)
    .where(inArray(table.productId, productIds))
    .groupBy(table.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.cnt)]));
}

export async function listIotProducts(q: ListIotProductsQuery) {
  const { page, pageSize } = q;
  const where = buildProductWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotProducts, where),
    rows: async () => {
      const rows = await withPagination(
        db.select().from(iotProducts).where(where).orderBy(desc(iotProducts.id)).$dynamic(),
        page,
        pageSize,
      );
      const ids = rows.map((r) => r.id);
      const [deviceCounts, propCounts, svcCounts, evtCounts] = await Promise.all([
        loadCountMap(iotDevices, ids),
        loadCountMap(iotProductProperties, ids),
        loadCountMap(iotProductServices, ids),
        loadCountMap(iotProductEvents, ids),
      ]);
      return rows.map((r) => mapIotProduct(r, {
        deviceCount: deviceCounts.get(r.id) ?? 0,
        propertyCount: propCounts.get(r.id) ?? 0,
        serviceCount: svcCounts.get(r.id) ?? 0,
        eventCount: evtCounts.get(r.id) ?? 0,
      }));
    },
  });
}

/** 下拉源：与列表共用访问边界（仅启用产品） */
export async function listAllIotProducts() {
  const rows = await db.select().from(iotProducts)
    .where(buildProductWhere({ status: 'enabled' }))
    .orderBy(desc(iotProducts.id));
  return rows.map((r) => mapIotProduct(r));
}

export async function ensureIotProductExists(id: number): Promise<IotProductRow> {
  const [row] = await db.select().from(iotProducts).where(buildProductWhere({ id })).limit(1);
  return requireRow(row, '产品不存在');
}

export async function getIotProduct(id: number) {
  const row = await ensureIotProductExists(id);
  const [deviceCounts, propCounts, svcCounts, evtCounts] = await Promise.all([
    loadCountMap(iotDevices, [id]),
    loadCountMap(iotProductProperties, [id]),
    loadCountMap(iotProductServices, [id]),
    loadCountMap(iotProductEvents, [id]),
  ]);
  return mapIotProduct(row, {
    deviceCount: deviceCounts.get(id) ?? 0,
    propertyCount: propCounts.get(id) ?? 0,
    serviceCount: svcCounts.get(id) ?? 0,
    eventCount: evtCounts.get(id) ?? 0,
  });
}

export async function createIotProduct(data: CreateIotProductInput) {
  const [row] = await db.insert(iotProducts).values({
    name: data.name,
    description: data.description ?? null,
    validationMode: data.validationMode,
    status: data.status,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  return mapIotProduct(row);
}

export async function updateIotProduct(id: number, data: UpdateIotProductInput) {
  const [row] = await db.update(iotProducts).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.validationMode !== undefined ? { validationMode: data.validationMode } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  }).where(buildProductWhere({ id })).returning();
  const updated = requireRow(row, '产品不存在');
  // 校验模式随物模型缓存，改动后立即对接入热路径生效
  if (data.validationMode !== undefined) invalidateThingModelCache(id);
  return mapIotProduct(updated);
}

export async function deleteIotProduct(id: number): Promise<void> {
  await ensureIotProductExists(id);
  const deviceCount = await db.$count(iotDevices, eq(iotDevices.productId, id));
  if (deviceCount > 0) throw new HTTPException(400, { message: `产品下还有 ${deviceCount} 台设备，不可删除` });
  await db.delete(iotProducts).where(buildProductWhere({ id }));
}

// ─── 设备 ─────────────────────────────────────────────────────────────────────
export function mapIotDevice(
  row: IotDeviceRow,
  extra?: {
    productName?: string | null;
    gatewayName?: string | null;
    subDeviceCount?: number;
    online?: boolean;
    state?: IotDeviceStateRow | null;
    groupIds?: number[];
    groupNames?: string[];
  },
) {
  return {
    id: row.id,
    sn: row.sn,
    secret: row.secret,
    productId: row.productId,
    productName: extra?.productName ?? null,
    name: row.name,
    status: row.status,
    nodeType: row.nodeType,
    gatewayId: row.gatewayId ?? null,
    gatewayName: extra?.gatewayName ?? null,
    subDeviceCount: extra?.subDeviceCount ?? 0,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    address: row.address ?? null,
    online: extra?.online ?? false,
    firmwareVersion: row.firmwareVersion ?? null,
    activatedAt: formatNullableDateTime(row.activatedAt),
    lastSeenAt: formatNullableDateTime(row.lastSeenAt),
    reported: extra?.state?.reported ?? null,
    desired: extra?.state?.desired ?? null,
    groupIds: extra?.groupIds ?? [],
    groupNames: extra?.groupNames ?? [],
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export type ListIotDevicesFilter = Omit<QueryOutputOf<typeof iotDeviceContract.list>, 'page' | 'pageSize'>;
export type ListIotDevicesQuery = QueryOutputOf<typeof iotDeviceContract.list>;

function buildDeviceWhere(q: ListIotDevicesFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotDevices.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotDevices.sn, iotDevices.name]),
    q.status ? eq(iotDevices.status, q.status) : undefined,
    q.productId ? eq(iotDevices.productId, q.productId) : undefined,
    q.nodeType ? eq(iotDevices.nodeType, q.nodeType) : undefined,
    q.gatewayId ? eq(iotDevices.gatewayId, q.gatewayId) : undefined,
    q.groupId
      ? exists(db.select({ one: iotDeviceGroupMembers.deviceId }).from(iotDeviceGroupMembers)
        .where(and(eq(iotDeviceGroupMembers.deviceId, iotDevices.id), eq(iotDeviceGroupMembers.groupId, q.groupId))))
      : undefined,
    ...dateRangeConditions(iotDevices.createdAt, q.startTime, q.endTime),
    tenantCondition(iotDevices, currentUser()),
  );
}

/** 导出中心复用：与列表同一访问边界与筛选语义 */
export function buildIotDeviceExportWhere(q: ListIotDevicesFilter): SQL | undefined {
  return buildDeviceWhere(q);
}

/** 设备 → 所属分组（id/名称）批量映射 */
async function loadGroupMap(deviceIds: number[]): Promise<Map<number, { ids: number[]; names: string[] }>> {
  const map = new Map<number, { ids: number[]; names: string[] }>();
  if (deviceIds.length === 0) return map;
  const rows = await db.select({
    deviceId: iotDeviceGroupMembers.deviceId,
    groupId: iotDeviceGroupMembers.groupId,
    groupName: iotDeviceGroups.name,
  })
    .from(iotDeviceGroupMembers)
    .innerJoin(iotDeviceGroups, eq(iotDeviceGroupMembers.groupId, iotDeviceGroups.id))
    .where(inArray(iotDeviceGroupMembers.deviceId, deviceIds));
  for (const r of rows) {
    const entry = map.get(r.deviceId) ?? { ids: [], names: [] };
    entry.ids.push(r.groupId);
    entry.names.push(r.groupName);
    map.set(r.deviceId, entry);
  }
  return map;
}

export async function listIotDevices(q: ListIotDevicesQuery) {
  const { page, pageSize } = q;
  const where = buildDeviceWhere(q);
  const gatewayAlias = aliasedTable(iotDevices, 'gateway_device');
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotDevices, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ device: iotDevices, productName: iotProducts.name, gatewayName: gatewayAlias.name })
          .from(iotDevices)
          .leftJoin(iotProducts, eq(iotDevices.productId, iotProducts.id))
          .leftJoin(gatewayAlias, eq(iotDevices.gatewayId, gatewayAlias.id))
          .where(where)
          .orderBy(desc(iotDevices.id))
          .$dynamic(),
        page,
        pageSize,
      );
      const ids = rows.map((r) => r.device.id);
      const gatewayIds = rows.filter((r) => r.device.nodeType === 'gateway').map((r) => r.device.id);
      const [onlineMap, stateMap, groupMap, subCountRows] = await Promise.all([
        getOnlineMap(ids),
        loadIotStates(ids),
        loadGroupMap(ids),
        gatewayIds.length > 0
          ? db.select({ gatewayId: iotDevices.gatewayId, cnt: count() }).from(iotDevices)
            .where(inArray(iotDevices.gatewayId, gatewayIds)).groupBy(iotDevices.gatewayId)
          : Promise.resolve([]),
      ]);
      const subCountMap = new Map(subCountRows.map((r) => [r.gatewayId, Number(r.cnt)]));
      return rows.map((r) => mapIotDevice(r.device, {
        productName: r.productName,
        gatewayName: r.gatewayName,
        subDeviceCount: subCountMap.get(r.device.id) ?? 0,
        online: onlineMap.get(r.device.id) ?? false,
        state: stateMap.get(r.device.id) ?? null,
        groupIds: groupMap.get(r.device.id)?.ids ?? [],
        groupNames: groupMap.get(r.device.id)?.names ?? [],
      }));
    },
  });
}

export async function ensureIotDeviceExists(id: number): Promise<IotDeviceRow> {
  const [row] = await db.select().from(iotDevices).where(buildDeviceWhere({ id })).limit(1);
  return requireRow(row, '设备不存在');
}

export async function getIotDevice(id: number) {
  const device = await ensureIotDeviceExists(id);
  const [product] = await db.select({ name: iotProducts.name })
    .from(iotProducts).where(eq(iotProducts.id, device.productId)).limit(1);
  const [onlineMap, stateMap, groupMap, gatewayRow, subDeviceCount] = await Promise.all([
    getOnlineMap([device.id]),
    loadIotStates([device.id]),
    loadGroupMap([device.id]),
    device.gatewayId
      ? db.select({ name: iotDevices.name }).from(iotDevices).where(eq(iotDevices.id, device.gatewayId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
    device.nodeType === 'gateway' ? db.$count(iotDevices, eq(iotDevices.gatewayId, device.id)) : Promise.resolve(0),
  ]);
  return mapIotDevice(device, {
    productName: product?.name ?? null,
    gatewayName: gatewayRow?.name ?? null,
    subDeviceCount,
    online: onlineMap.get(device.id) ?? false,
    state: stateMap.get(device.id) ?? null,
    groupIds: groupMap.get(device.id)?.ids ?? [],
    groupNames: groupMap.get(device.id)?.names ?? [],
  });
}

/** 先删后插，原子性更新设备的分组关联 */
async function setDeviceGroups(executor: DbExecutor, deviceId: number, groupIds: number[]): Promise<void> {
  await executor.delete(iotDeviceGroupMembers).where(eq(iotDeviceGroupMembers.deviceId, deviceId));
  if (groupIds.length > 0) {
    await executor.insert(iotDeviceGroupMembers).values(groupIds.map((groupId) => ({ groupId, deviceId })));
  }
}

async function ensureGroupsExist(groupIds: number[] | undefined): Promise<void> {
  if (!groupIds || groupIds.length === 0) return;
  const rows = await db.select({ id: iotDeviceGroups.id }).from(iotDeviceGroups)
    .where(inArray(iotDeviceGroups.id, groupIds));
  if (rows.length !== new Set(groupIds).size) throw new HTTPException(400, { message: '存在无效的设备分组' });
}

export async function createIotDevice(data: CreateIotDeviceInput) {
  await ensureIotProductExists(data.productId);
  await ensureGroupsExist(data.groupIds);
  await ensureIotTopologyValid(data);
  const sn = data.sn ?? generateDeviceSn();
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(iotDevices).values({
        sn,
        secret: generateDeviceSecret(),
        productId: data.productId,
        name: data.name,
        status: data.status,
        nodeType: data.nodeType,
        gatewayId: data.nodeType === 'sub' ? (data.gatewayId ?? null) : null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        address: data.address ?? null,
        firmwareVersion: data.firmwareVersion ?? null,
        remark: data.remark ?? null,
        tenantId: getCreateTenantId(currentUser()),
      }).returning();
      await tx.insert(iotDeviceState).values({ deviceId: created.id });
      if (data.groupIds?.length) await setDeviceGroups(tx, created.id, data.groupIds);
      return created;
    });
    return mapIotDevice(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `设备 SN "${sn}" 已存在，请更换`);
    throw err;
  }
}

export async function updateIotDevice(id: number, data: UpdateIotDeviceInput) {
  if (data.productId !== undefined) await ensureIotProductExists(data.productId);
  await ensureGroupsExist(data.groupIds);
  if (data.nodeType !== undefined || data.gatewayId !== undefined) {
    const before = await ensureIotDeviceExists(id);
    await ensureIotTopologyValid({
      nodeType: data.nodeType ?? before.nodeType,
      gatewayId: data.gatewayId !== undefined ? data.gatewayId : before.gatewayId,
    }, id);
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(iotDevices).set({
      ...(data.productId !== undefined ? { productId: data.productId } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.nodeType !== undefined ? {
        nodeType: data.nodeType,
        gatewayId: data.nodeType === 'sub' ? (data.gatewayId ?? null) : null,
      } : (data.gatewayId !== undefined ? { gatewayId: data.gatewayId } : {})),
      ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
      ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.firmwareVersion !== undefined ? { firmwareVersion: data.firmwareVersion } : {}),
      ...(data.remark !== undefined ? { remark: data.remark } : {}),
    }).where(buildDeviceWhere({ id })).returning();
    const existing = requireRow(updated, '设备不存在');
    if (data.groupIds !== undefined) await setDeviceGroups(tx, id, data.groupIds);
    return existing;
  });
  invalidateIotDeviceAuthCache([row.sn]);
  return getIotDevice(row.id);
}

export async function deleteIotDevices(ids: number[]): Promise<number> {
  // 网关下存在子设备时禁止删除（FK restrict 兜底，这里给出可读错误）
  const blocked = await db.$count(iotDevices, inArray(iotDevices.gatewayId, ids));
  if (blocked > 0) {
    throw new HTTPException(400, { message: '选中设备包含仍有子设备的网关，请先迁移或删除其子设备' });
  }
  const where = and(inArray(iotDevices.id, ids), buildDeviceWhere({}));
  const deleted = await db.delete(iotDevices).where(where).returning({ id: iotDevices.id, sn: iotDevices.sn });
  invalidateIotDeviceAuthCache(deleted.map((d) => d.sn));
  await clearOnlineKeys(deleted.map((d) => d.id));
  return deleted.length;
}

/** 重置接入密钥：设备需用新 secret 重新签名，旧连接自然失效 */
export async function resetIotDeviceSecret(id: number) {
  await ensureIotDeviceExists(id);
  const [row] = await db.update(iotDevices)
    .set({ secret: generateDeviceSecret() })
    .where(buildDeviceWhere({ id }))
    .returning();
  invalidateIotDeviceAuthCache([row.sn]);
  await recordIotLifecycleEvent(id, 'secret_reset');
  return mapIotDevice(row);
}

/** 清空设备遥测（重新调试场景）：同步重置影子 reported 快照 */
export async function clearIotDeviceTelemetry(id: number): Promise<number> {
  await ensureIotDeviceExists(id);
  return db.transaction(async (tx) => {
    // 分区表按 device_id 删除会命中每个分区的 (device_id, reported_at) 索引；不用 RETURNING 避免整段历史回传
    const res = await tx.execute(sql`DELETE FROM iot_telemetry WHERE device_id = ${id}`);
    await tx.update(iotDeviceState).set({ reported: {}, reportedAt: null }).where(eq(iotDeviceState.deviceId, id));
    return (res as unknown as { rowCount?: number }).rowCount ?? 0;
  });
}
