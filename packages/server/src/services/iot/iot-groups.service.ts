import { iotDeviceGroupContract, iotDeviceGroupSchema } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 设备分组：静态分组 CRUD 与成员维护（批量操作的圈选目标）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { CreateIotDeviceGroupInput, UpdateIotDeviceGroupInput } from '@zenith/shared/iot';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { iotDeviceGroupMembers, iotDeviceGroups, iotDevices, type IotDeviceGroupRow } from '../../db/schema';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { pickEntity } from '../../lib/entity-map';

export function mapIotDeviceGroup(row: IotDeviceGroupRow, extra?: { deviceCount?: number; deviceIds?: number[] }) {
  return pickEntity(iotDeviceGroupSchema, row, {
    deviceCount: extra?.deviceCount ?? 0,
    deviceIds: extra?.deviceIds ?? [],
  });
}

export type ListIotDeviceGroupsFilter = Omit<QueryOutputOf<typeof iotDeviceGroupContract.list>, 'page' | 'pageSize'>;

function buildGroupWhere(q: ListIotDeviceGroupsFilter & { id?: number }): SQL | undefined {
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

export async function listIotDeviceGroups(q: QueryOutputOf<typeof iotDeviceGroupContract.list>) {
  const { page, pageSize } = q;
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
  return requireFirstRow(db.select().from(iotDeviceGroups).where(buildGroupWhere({ id })).limit(1), '设备分组不存在');
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

async function ensureDevicesExist(executor: DbExecutor, deviceIds: number[], tenantId: number | null): Promise<void> {
  if (deviceIds.length === 0) return;
  const rows = await executor.select({ id: iotDevices.id }).from(iotDevices)
    .where(and(inArray(iotDevices.id, deviceIds), exactTenantCondition(iotDevices.tenantId, tenantId)));
  if (rows.length !== deviceIds.length) throw new HTTPException(400, { message: '存在无效或不属于分组租户的设备' });
}

/** 在同一事务内校验设备归属并替换组成员。 */
async function setGroupMembers(executor: DbExecutor, group: Pick<IotDeviceGroupRow, 'id' | 'tenantId'>, deviceIds: number[]): Promise<void> {
  const ids = [...new Set(deviceIds)];
  await ensureDevicesExist(executor, ids, group.tenantId);
  const groupId = group.id;
  await executor.delete(iotDeviceGroupMembers).where(eq(iotDeviceGroupMembers.groupId, groupId));
  if (ids.length > 0) {
    await executor.insert(iotDeviceGroupMembers).values(ids.map((deviceId) => ({ groupId, deviceId })));
  }
}

export async function createIotDeviceGroup(data: CreateIotDeviceGroupInput) {
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(iotDeviceGroups).values({
      name: data.name,
      description: data.description ?? null,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    await setGroupMembers(tx, created, data.deviceIds);
    return created;
  });
  return getIotDeviceGroup(row.id);
}

export async function updateIotDeviceGroup(id: number, data: UpdateIotDeviceGroupInput) {
  const where = buildGroupWhere({ id });
  const patch = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
  };
  await db.transaction(async (tx) => {
    const [updated] = Object.keys(patch).length > 0
      ? await tx.update(iotDeviceGroups).set(patch).where(where).returning()
      : await tx.select().from(iotDeviceGroups).where(where).limit(1).for('update');
    const group = requireRow(updated, '设备分组不存在');
    if (data.deviceIds !== undefined) await setGroupMembers(tx, group, data.deviceIds);
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
