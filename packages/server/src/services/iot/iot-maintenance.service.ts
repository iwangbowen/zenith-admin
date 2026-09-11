import { iotMaintenanceWindowContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 维护窗口：计划性维护期间的告警静默。
 *
 * 语义：窗口内命中设备的告警仍正常记录（事实不丢），但跳过通知派发与升级计时；
 * 命中 = 设备直接指定 / 所属产品指定 / 所属分组指定 任一匹配，且当前时刻在窗口内。
 * 热路径（告警触发）使用 60s 生效窗口缓存判定。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import type { CreateIotMaintenanceWindowInput } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotDeviceGroupMembers, iotDeviceGroups, iotDevices, iotMaintenanceWindows, iotProducts,
  type IotMaintenanceWindowRow,
} from '../../db/schema';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';

export function mapIotMaintenanceWindow(
  row: IotMaintenanceWindowRow,
  extra?: { productName?: string | null; groupName?: string | null; deviceName?: string | null },
) {
  const now = new Date();
  return {
    id: row.id,
    name: row.name,
    productId: row.productId ?? null,
    productName: extra?.productName ?? null,
    groupId: row.groupId ?? null,
    groupName: extra?.groupName ?? null,
    deviceId: row.deviceId ?? null,
    deviceName: extra?.deviceName ?? null,
    startAt: formatDateTime(row.startAt),
    endAt: formatDateTime(row.endAt),
    reason: row.reason ?? null,
    active: row.startAt <= now && now <= row.endAt,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export type ListMaintenanceWindowsFilter = Omit<QueryOutputOf<typeof iotMaintenanceWindowContract.list>, 'page' | 'pageSize'>;
export type ListMaintenanceWindowsQuery = QueryOutputOf<typeof iotMaintenanceWindowContract.list>;

function buildWindowWhere(q: ListMaintenanceWindowsFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotMaintenanceWindows.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotMaintenanceWindows.name]),
    tenantCondition(iotMaintenanceWindows, currentUser()),
  );
}

export async function listIotMaintenanceWindows(q: ListMaintenanceWindowsQuery) {
  const { page, pageSize } = q;
  const where = buildWindowWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotMaintenanceWindows, where),
    rows: () => withPagination(
      db.select({
        window: iotMaintenanceWindows,
        productName: iotProducts.name,
        groupName: iotDeviceGroups.name,
        deviceName: iotDevices.name,
      })
        .from(iotMaintenanceWindows)
        .leftJoin(iotProducts, eq(iotMaintenanceWindows.productId, iotProducts.id))
        .leftJoin(iotDeviceGroups, eq(iotMaintenanceWindows.groupId, iotDeviceGroups.id))
        .leftJoin(iotDevices, eq(iotMaintenanceWindows.deviceId, iotDevices.id))
        .where(where)
        .orderBy(desc(iotMaintenanceWindows.endAt))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapIotMaintenanceWindow(r.window, {
      productName: r.productName, groupName: r.groupName, deviceName: r.deviceName,
    }),
  });
}

export async function ensureIotMaintenanceWindowExists(id: number): Promise<IotMaintenanceWindowRow> {
  const [row] = await db.select().from(iotMaintenanceWindows).where(buildWindowWhere({ id })).limit(1);
  return requireRow(row, '维护窗口不存在');
}

export async function createIotMaintenanceWindow(data: CreateIotMaintenanceWindowInput) {
  const startAt = parseDateTimeInput(data.startAt);
  const endAt = parseDateTimeInput(data.endAt);
  if (!startAt || !endAt) throw new HTTPException(400, { message: '时间格式不合法' });
  const [row] = await db.insert(iotMaintenanceWindows).values({
    name: data.name,
    productId: data.productId ?? null,
    groupId: data.groupId ?? null,
    deviceId: data.deviceId ?? null,
    startAt,
    endAt,
    reason: data.reason ?? null,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  invalidateMaintenanceCache();
  return mapIotMaintenanceWindow(row);
}

export async function updateIotMaintenanceWindow(id: number, data: Partial<CreateIotMaintenanceWindowInput>) {
  await ensureIotMaintenanceWindowExists(id);
  const startAt = data.startAt !== undefined ? parseDateTimeInput(data.startAt) : undefined;
  const endAt = data.endAt !== undefined ? parseDateTimeInput(data.endAt) : undefined;
  const [row] = await db.update(iotMaintenanceWindows).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.productId !== undefined ? { productId: data.productId } : {}),
    ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
    ...(data.deviceId !== undefined ? { deviceId: data.deviceId } : {}),
    ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}),
    ...(data.reason !== undefined ? { reason: data.reason } : {}),
  }).where(buildWindowWhere({ id })).returning();
  const updated = requireRow(row, '维护窗口不存在');
  invalidateMaintenanceCache();
  return mapIotMaintenanceWindow(updated);
}

export async function deleteIotMaintenanceWindow(id: number): Promise<void> {
  await ensureIotMaintenanceWindowExists(id);
  await db.delete(iotMaintenanceWindows).where(buildWindowWhere({ id }));
  invalidateMaintenanceCache();
}

// ─── 热路径命中判定 ───────────────────────────────────────────────────────────
const MAINTENANCE_CACHE_TTL_MS = 60_000;

interface ActiveWindowsCache {
  deviceIds: Set<number>;
  productIds: Set<number>;
  groupMembers: Set<number>;
  expiresAt: number;
}

let activeCache: ActiveWindowsCache | null = null;

function invalidateMaintenanceCache(): void {
  activeCache = null;
}

async function loadActiveWindows(): Promise<ActiveWindowsCache> {
  const now = Date.now();
  if (activeCache && activeCache.expiresAt > now) return activeCache;
  const nowDate = new Date();
  const rows = await db.select({
    productId: iotMaintenanceWindows.productId,
    groupId: iotMaintenanceWindows.groupId,
    deviceId: iotMaintenanceWindows.deviceId,
  }).from(iotMaintenanceWindows)
    .where(and(lte(iotMaintenanceWindows.startAt, nowDate), gte(iotMaintenanceWindows.endAt, nowDate)));

  const deviceIds = new Set<number>();
  const productIds = new Set<number>();
  const groupIds = new Set<number>();
  for (const r of rows) {
    if (r.deviceId) deviceIds.add(r.deviceId);
    if (r.productId) productIds.add(r.productId);
    if (r.groupId) groupIds.add(r.groupId);
  }
  const groupMembers = new Set<number>();
  if (groupIds.size > 0) {
    const members = await db.select({ deviceId: iotDeviceGroupMembers.deviceId })
      .from(iotDeviceGroupMembers)
      .where(inArray(iotDeviceGroupMembers.groupId, [...groupIds]));
    for (const m of members) groupMembers.add(m.deviceId);
  }
  activeCache = { deviceIds, productIds, groupMembers, expiresAt: now + MAINTENANCE_CACHE_TTL_MS };
  return activeCache;
}

/** 告警触发热路径：设备当前是否处于维护窗口（命中则跳过通知/升级） */
export async function isDeviceInMaintenance(deviceId: number, productId: number): Promise<boolean> {
  try {
    const cache = await loadActiveWindows();
    if (cache.deviceIds.size === 0 && cache.productIds.size === 0 && cache.groupMembers.size === 0) return false;
    return cache.deviceIds.has(deviceId) || cache.productIds.has(productId) || cache.groupMembers.has(deviceId);
  } catch {
    return false;
  }
}
