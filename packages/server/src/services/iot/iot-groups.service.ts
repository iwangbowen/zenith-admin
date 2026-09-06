/**
 * IoT 设备分组：静态分组 CRUD 与成员维护（批量操作的圈选目标）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { CreateIotDeviceGroupInput, UpdateIotDeviceGroupInput } from '@zenith/shared/iot';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { iotDeviceGroupMembers, iotDeviceGroups, iotDevices, type IotDeviceGroupRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';

export function mapIotDeviceGroup(row: IotDeviceGroupRow, extra?: { deviceCount?: number; deviceIds?: number[] }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    deviceCount: extra?.deviceCount ?? 0,
    deviceIds: extra?.deviceIds ?? [],
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListIotDeviceGroupsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

function buildGroupWhere(q: ListIotDeviceGroupsQuery & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotDeviceGroups.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotDeviceGroups.name, iotDeviceGroups.description]),
    tenantCondition(iotDeviceGroups, currentUser()),
  );
}

async function loadMemberCounts(groupIds: number[]): Promise<Map<number, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db.select({ groupId: iotDeviceGroupMembers.groupId, cnt: count() })
    .from(iotDeviceGroupMembers)
    .where(inArray(iotDeviceGroupMembers.groupId, groupIds))
    .groupBy(iotDeviceGroupMembers.groupId);
  return new Map(rows.map((r) => [r.groupId, Number(r.cnt)]));
}

export async function listIotDeviceGroups(q: ListIotDeviceGroupsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildGroupWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotDeviceGroups, where),
    rows: async () => {
      const rows = await withPagination(
        db.select().from(iotDeviceGroups).where(where).orderBy(desc(iotDeviceGroups.id)).$dynamic(),
        page,
        pageSize,
      );
      const countMap = await loadMemberCounts(rows.map((r) => r.id));
      return rows.map((r) => mapIotDeviceGroup(r, { deviceCount: countMap.get(r.id) ?? 0 }));
    },
  });
}

/** 下拉源：全部分组（含设备数） */
export async function listAllIotDeviceGroups() {
  const rows = await db.select().from(iotDeviceGroups)
    .where(buildGroupWhere({}))
    .orderBy(desc(iotDeviceGroups.id));
  const countMap = await loadMemberCounts(rows.map((r) => r.id));
  return rows.map((r) => mapIotDeviceGroup(r, { deviceCount: countMap.get(r.id) ?? 0 }));
}

export async function ensureIotDeviceGroupExists(id: number): Promise<IotDeviceGroupRow> {
  const [row] = await db.select().from(iotDeviceGroups).where(buildGroupWhere({ id })).limit(1);
  return requireRow(row, '设备分组不存在');
}

export async function getIotDeviceGroup(id: number) {
  const row = await ensureIotDeviceGroupExists(id);
  const members = await db.select({ deviceId: iotDeviceGroupMembers.deviceId })
    .from(iotDeviceGroupMembers).where(eq(iotDeviceGroupMembers.groupId, id));
  return mapIotDeviceGroup(row, {
    deviceCount: members.length,
    deviceIds: members.map((m) => m.deviceId),
  });
}

async function ensureDevicesExist(deviceIds: number[]): Promise<void> {
  if (deviceIds.length === 0) return;
  const rows = await db.select({ id: iotDevices.id }).from(iotDevices)
    .where(and(inArray(iotDevices.id, deviceIds), tenantCondition(iotDevices, currentUser())));
  if (rows.length !== new Set(deviceIds).size) throw new HTTPException(400, { message: '存在无效的设备' });
}

/** 先删后插，原子性替换组成员 */
async function setGroupMembers(executor: DbExecutor, groupId: number, deviceIds: number[]): Promise<void> {
  await executor.delete(iotDeviceGroupMembers).where(eq(iotDeviceGroupMembers.groupId, groupId));
  if (deviceIds.length > 0) {
    await executor.insert(iotDeviceGroupMembers).values(deviceIds.map((deviceId) => ({ groupId, deviceId })));
  }
}

export async function createIotDeviceGroup(data: CreateIotDeviceGroupInput) {
  await ensureDevicesExist(data.deviceIds);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(iotDeviceGroups).values({
      name: data.name,
      description: data.description ?? null,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    await setGroupMembers(tx, created.id, data.deviceIds);
    return created;
  });
  return getIotDeviceGroup(row.id);
}

export async function updateIotDeviceGroup(id: number, data: UpdateIotDeviceGroupInput) {
  await ensureIotDeviceGroupExists(id);
  if (data.deviceIds !== undefined) await ensureDevicesExist(data.deviceIds);
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(iotDeviceGroups).set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    }).where(eq(iotDeviceGroups.id, id)).returning();
    requireRow(updated, '设备分组不存在');
    if (data.deviceIds !== undefined) await setGroupMembers(tx, id, data.deviceIds);
  });
  return getIotDeviceGroup(id);
}

export async function deleteIotDeviceGroup(id: number): Promise<void> {
  await ensureIotDeviceGroupExists(id);
  await db.delete(iotDeviceGroups).where(buildGroupWhere({ id }));
}

/** 解析分组成员（批量操作提交时展开为具体设备 id） */
export async function resolveGroupDeviceIds(groupId: number): Promise<number[]> {
  await ensureIotDeviceGroupExists(groupId);
  const rows = await db.select({ deviceId: iotDeviceGroupMembers.deviceId })
    .from(iotDeviceGroupMembers).where(eq(iotDeviceGroupMembers.groupId, groupId));
  return rows.map((r) => r.deviceId);
}

/** 批量操作目标集：显式 deviceIds ∪ groupId 成员，按租户边界过滤并快照设备名 */
export async function resolveIotBatchTargets(
  deviceIds: number[] | undefined,
  groupId: number | undefined,
  maxDevices: number,
): Promise<{ deviceIds: number[]; deviceNames: Record<number, string> }> {
  const idSet = new Set<number>(deviceIds ?? []);
  if (groupId !== undefined) {
    for (const id of await resolveGroupDeviceIds(groupId)) idSet.add(id);
  }
  if (idSet.size === 0) throw new HTTPException(400, { message: '目标设备为空' });
  if (idSet.size > maxDevices) throw new HTTPException(400, { message: `单次批量最多 ${maxDevices} 台设备` });
  const rows = await db.select({ id: iotDevices.id, name: iotDevices.name })
    .from(iotDevices)
    .where(and(inArray(iotDevices.id, [...idSet]), tenantCondition(iotDevices, currentUser())));
  if (rows.length === 0) throw new HTTPException(400, { message: '目标设备为空或无权限' });
  return {
    deviceIds: rows.map((r) => r.id),
    deviceNames: Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<number, string>,
  };
}
