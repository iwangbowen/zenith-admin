import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  AdminUpdateDriveSpaceInput,
  CreateDepartmentDriveSpaceInput,
  CreateDriveSpaceInput,
  DriveRole,
  DriveSpace,
  DriveSpaceMember,
  DriveSpaceType,
  SaveDriveSpaceMembersInput,
  UpdateDriveSpaceInput,
} from '@zenith/shared/drive';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { departments, driveFileVersions, driveNodes, driveSpaceMembers, driveSpaces, users, type DriveSpaceRow } from '../../db/schema';
import { currentUser, currentUserId, isSuperAdmin } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { accessibleSpaceIdsSubquery, ensureSpaceRole, loadDriveSubjects, resolveSpaceRoles } from './drive-access.service';
import { mapDriveSpace, resolveSubjectNames, resolveUserNames, subjectKey } from './drive-common';
import { maybeNotifyQuotaWarning, notifySpaceMembersAdded } from './drive-notify.service';
import { defaultQuotaBytes, effectiveQuotaBytes, getDriveSettings, type DriveSettings } from './drive-settings.service';

const GB = 1024 * 1024 * 1024;

function gbToBytes(gb: number | null | undefined): number | null {
  if (gb === null || gb === undefined) return null;
  return Math.round(gb * GB);
}

// ─── 查询边界 ─────────────────────────────────────────────────────────────────

export interface ListDriveSpacesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: DriveSpaceType;
  status?: 'enabled' | 'disabled';
  departmentId?: number;
  ownerId?: number;
}

interface SpaceWhereInput extends ListDriveSpacesQuery {
  id?: number;
}

function buildSpaceWhere(q: SpaceWhereInput, extra?: SQL): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(driveSpaces.id, q.id) : undefined,
    keywordCondition(q.keyword, [driveSpaces.name, driveSpaces.description], 'ilike'),
    q.type ? eq(driveSpaces.type, q.type) : undefined,
    q.status ? eq(driveSpaces.status, q.status) : undefined,
    q.departmentId !== undefined ? eq(driveSpaces.departmentId, q.departmentId) : undefined,
    q.ownerId !== undefined ? eq(driveSpaces.ownerId, q.ownerId) : undefined,
    tenantCondition(driveSpaces, currentUser()),
    extra,
  );
}

export async function ensureDriveSpaceExists(id: number): Promise<DriveSpaceRow> {
  const [row] = await db.select().from(driveSpaces).where(buildSpaceWhere({ id })).limit(1);
  if (!row) throw new HTTPException(404, { message: '空间不存在' });
  return row;
}

// ─── 行 → DTO（含名称与计数）─────────────────────────────────────────────────

async function decorateSpaces(rows: DriveSpaceRow[], opts: { withRole?: boolean; withCounts?: boolean } = {}): Promise<DriveSpace[]> {
  if (rows.length === 0) return [];
  const settings = await getDriveSettings();
  const ids = rows.map((r) => r.id);
  const [ownerNames, deptRows, roleMap, memberCounts, nodeCounts] = await Promise.all([
    resolveUserNames(rows.map((r) => r.ownerId)),
    db.select({ id: departments.id, name: departments.name }).from(departments)
      .where(inArray(departments.id, rows.map((r) => r.departmentId).filter((id): id is number => id != null).concat([-1]))),
    opts.withRole ? resolveSpaceRoles(rows) : Promise.resolve(new Map<number, DriveRole | null>()),
    opts.withCounts
      ? db.select({ spaceId: driveSpaceMembers.spaceId, count: sql<number>`count(*)::int` }).from(driveSpaceMembers)
        .where(inArray(driveSpaceMembers.spaceId, ids)).groupBy(driveSpaceMembers.spaceId)
      : Promise.resolve([]),
    opts.withCounts
      ? db.select({ spaceId: driveNodes.spaceId, count: sql<number>`count(*)::int` }).from(driveNodes)
        .where(and(inArray(driveNodes.spaceId, ids), isNull(driveNodes.deletedAt))).groupBy(driveNodes.spaceId)
      : Promise.resolve([]),
  ]);
  const deptNames = new Map(deptRows.map((d) => [d.id, d.name]));
  const memberMap = new Map(memberCounts.map((r) => [r.spaceId, r.count]));
  const nodeMap = new Map(nodeCounts.map((r) => [r.spaceId, r.count]));
  return rows.map((row) => mapDriveSpace(row, {
    quotaBytes: effectiveQuotaBytes(settings, row),
    ownerName: row.ownerId ? ownerNames.get(row.ownerId) ?? null : null,
    departmentName: row.departmentId ? deptNames.get(row.departmentId) ?? null : null,
    myRole: opts.withRole ? roleMap.get(row.id) ?? null : undefined,
    memberCount: opts.withCounts ? memberMap.get(row.id) ?? 0 : undefined,
    nodeCount: opts.withCounts ? nodeMap.get(row.id) ?? 0 : undefined,
  }));
}

// ─── 个人 / 部门空间的懒创建 ───────────────────────────────────────────────────

export async function getOrCreatePersonalSpace(): Promise<DriveSpaceRow> {
  const user = currentUser();
  const [existing] = await db.select().from(driveSpaces)
    .where(and(eq(driveSpaces.type, 'personal'), eq(driveSpaces.ownerId, user.userId)))
    .limit(1);
  if (existing) return existing;
  const [userRow] = await db.select({ nickname: users.nickname, username: users.username }).from(users).where(eq(users.id, user.userId)).limit(1);
  try {
    const [created] = await db.insert(driveSpaces).values({
      type: 'personal',
      name: `${userRow?.nickname || userRow?.username || user.username} 的网盘`,
      ownerId: user.userId,
      icon: 'HardDrive',
      tenantId: getCreateTenantId(user),
    }).returning();
    return created;
  } catch (err) {
    // 并发首次访问：唤起者已创建，回读即可
    const [row] = await db.select().from(driveSpaces)
      .where(and(eq(driveSpaces.type, 'personal'), eq(driveSpaces.ownerId, user.userId))).limit(1);
    if (row) return row;
    throw err;
  }
}

/** 自动创建当前用户直属部门的部门空间（受设置开关控制） */
async function ensureOwnDepartmentSpace(): Promise<void> {
  const settings = await getDriveSettings();
  if (!settings.departmentSpaceAutoCreate) return;
  const subjects = await loadDriveSubjects();
  if (!subjects.departmentId) return;
  const [existing] = await db.select({ id: driveSpaces.id }).from(driveSpaces)
    .where(and(eq(driveSpaces.type, 'department'), eq(driveSpaces.departmentId, subjects.departmentId))).limit(1);
  if (existing) return;
  const [dept] = await db.select({ id: departments.id, name: departments.name, leaderId: departments.leaderId, tenantId: departments.tenantId })
    .from(departments).where(eq(departments.id, subjects.departmentId)).limit(1);
  if (!dept) return;
  await db.insert(driveSpaces).values({
    type: 'department',
    name: `${dept.name} 部门空间`,
    icon: 'Building2',
    departmentId: dept.id,
    ownerId: dept.leaderId ?? null,
    defaultMemberRole: 'editor',
    tenantId: dept.tenantId ?? getCreateTenantId(currentUser()),
  }).onConflictDoNothing();
}

// ─── 我可访问的空间 ───────────────────────────────────────────────────────────

export async function listMySpaces(): Promise<DriveSpace[]> {
  await Promise.all([getOrCreatePersonalSpace(), ensureOwnDepartmentSpace()]);
  const subjects = await loadDriveSubjects();
  const where = buildWhere(
    eq(driveSpaces.status, 'enabled'),
    tenantCondition(driveSpaces, currentUser()),
    subjects.isAdmin ? undefined : inArray(driveSpaces.id, accessibleSpaceIdsSubquery(subjects)),
  );
  const rows = await db.select().from(driveSpaces).where(where)
    .orderBy(asc(driveSpaces.type), asc(driveSpaces.sort), asc(driveSpaces.id));
  // 管理员：仅返回个人空间 + 全部部门 / 协作空间；他人的个人空间放在治理页而不进侧栏
  const visible = subjects.isAdmin ? rows.filter((r) => r.type !== 'personal' || r.ownerId === subjects.userId) : rows;
  const decorated = await decorateSpaces(visible, { withRole: true });
  return decorated.filter((s) => s.myRole !== null);
}

/** 共享空间页：当前用户可访问的部门 / 协作空间分页 */
export async function listDriveSpaces(q: ListDriveSpacesQuery) {
  const { page = 1, pageSize = 10 } = q;
  const subjects = await loadDriveSubjects();
  const where = buildSpaceWhere(
    { ...q, type: q.type },
    buildWhere(
      q.type ? undefined : inArray(driveSpaces.type, ['department', 'team']),
      subjects.isAdmin ? undefined : inArray(driveSpaces.id, accessibleSpaceIdsSubquery(subjects)),
    ),
  );
  const [total, rows] = await Promise.all([
    db.$count(driveSpaces, where),
    withPagination(db.select().from(driveSpaces).where(where).orderBy(asc(driveSpaces.sort), asc(driveSpaces.id)).$dynamic(), page, pageSize),
  ]);
  return { list: await decorateSpaces(rows, { withRole: true, withCounts: true }), total, page, pageSize };
}

/** 管理端：全部空间分页（租户 + 数据权限收窄） */
export async function listDriveSpacesForAdmin(q: ListDriveSpacesQuery) {
  const { page = 1, pageSize = 10 } = q;
  const scope = isSuperAdmin() ? undefined : await getDataScopeCondition({
    currentUserId: currentUserId(),
    deptColumn: driveSpaces.departmentId,
    ownerColumn: driveSpaces.ownerId,
  });
  const where = buildSpaceWhere(q, scope);
  const [total, rows] = await Promise.all([
    db.$count(driveSpaces, where),
    withPagination(db.select().from(driveSpaces).where(where).orderBy(asc(driveSpaces.type), asc(driveSpaces.sort), asc(driveSpaces.id)).$dynamic(), page, pageSize),
  ]);
  return { list: await decorateSpaces(rows, { withCounts: true }), total, page, pageSize };
}

export async function getDriveSpace(id: number): Promise<DriveSpace> {
  const row = await ensureDriveSpaceExists(id);
  await ensureSpaceRole(row, 'viewer');
  const [space] = await decorateSpaces([row], { withRole: true, withCounts: true });
  return space;
}

// ─── 创建 / 更新 / 删除 ───────────────────────────────────────────────────────

export async function createTeamSpace(data: CreateDriveSpaceInput): Promise<DriveSpace> {
  const user = currentUser();
  const { members, quotaGb, ...rest } = data;
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(driveSpaces).values({
      ...rest,
      type: 'team',
      icon: rest.icon ?? 'Users',
      quotaBytes: gbToBytes(quotaGb),
      ownerId: user.userId,
      tenantId: getCreateTenantId(user),
    }).returning();
    await setSpaceMembers(tx, created.id, members);
    return created;
  });
  if (members.length) await notifySpaceMembersAdded(row, members);
  const [space] = await decorateSpaces([row], { withRole: true, withCounts: true });
  return space;
}

export async function createDepartmentSpace(data: CreateDepartmentDriveSpaceInput): Promise<DriveSpace> {
  const user = currentUser();
  const [dept] = await db.select().from(departments)
    .where(buildWhere(eq(departments.id, data.departmentId), tenantCondition(departments, user))).limit(1);
  if (!dept) throw new HTTPException(400, { message: '指定的部门不存在' });
  try {
    const [created] = await db.insert(driveSpaces).values({
      type: 'department',
      name: data.name ?? `${dept.name} 部门空间`,
      icon: 'Building2',
      departmentId: dept.id,
      ownerId: dept.leaderId ?? null,
      defaultMemberRole: data.defaultMemberRole,
      quotaBytes: gbToBytes(data.quotaGb),
      tenantId: dept.tenantId ?? getCreateTenantId(user),
    }).returning();
    const [space] = await decorateSpaces([created], { withCounts: true });
    return space;
  } catch (err) {
    return rethrowPgUniqueViolation(err, '该部门已存在部门空间');
  }
}

export async function updateDriveSpace(id: number, data: UpdateDriveSpaceInput): Promise<DriveSpace> {
  const before = await ensureDriveSpaceExists(id);
  await ensureSpaceRole(before, 'manager');
  const { quotaGb, status, ...rest } = data;
  const patch: Partial<typeof driveSpaces.$inferInsert> = { ...rest };
  // 配额与状态属治理字段，只有网盘管理员可改；普通 manager 只能改名称 / 描述 / 图标 / 默认角色 / 外链开关 / 版本数
  const subjects = await loadDriveSubjects();
  if (subjects.isAdmin) {
    if (quotaGb !== undefined) patch.quotaBytes = gbToBytes(quotaGb);
    if (status !== undefined) patch.status = status;
  }
  // 个人空间不存在隐式成员，不允许设置默认角色
  if (before.type === 'personal') delete patch.defaultMemberRole;
  const [row] = await db.update(driveSpaces).set(patch).where(buildSpaceWhere({ id })).returning();
  if (!row) throw new HTTPException(404, { message: '空间不存在' });
  const [space] = await decorateSpaces([row], { withRole: true, withCounts: true });
  return space;
}

export async function deleteDriveSpace(id: number): Promise<void> {
  const row = await ensureDriveSpaceExists(id);
  await ensureSpaceRole(row, 'manager');
  if (row.type === 'personal') throw new HTTPException(400, { message: '个人空间不能删除' });
  const nodeCount = await db.$count(driveNodes, eq(driveNodes.spaceId, id));
  if (nodeCount > 0) throw new HTTPException(400, { message: `空间下仍有 ${nodeCount} 个文件或文件夹（含回收站），请先清空后再删除` });
  await db.delete(driveSpaces).where(buildSpaceWhere({ id }));
}

export async function transferDriveSpace(id: number, ownerId: number): Promise<DriveSpace> {
  const row = await ensureDriveSpaceExists(id);
  await ensureSpaceRole(row, 'manager');
  if (row.type !== 'team') throw new HTTPException(400, { message: '只有协作空间支持转让' });
  const [target] = await db.select({ id: users.id }).from(users)
    .where(buildWhere(eq(users.id, ownerId), eq(users.status, 'enabled'), tenantCondition(users, currentUser()))).limit(1);
  if (!target) throw new HTTPException(400, { message: '目标用户不存在或已禁用' });
  const [updated] = await db.update(driveSpaces).set({ ownerId }).where(eq(driveSpaces.id, id)).returning();
  const [space] = await decorateSpaces([updated], { withRole: true, withCounts: true });
  return space;
}

// ─── 成员 ─────────────────────────────────────────────────────────────────────

export async function listSpaceMembers(spaceId: number): Promise<DriveSpaceMember[]> {
  const row = await ensureDriveSpaceExists(spaceId);
  await ensureSpaceRole(row, 'viewer');
  const rows = await db.select().from(driveSpaceMembers).where(eq(driveSpaceMembers.spaceId, spaceId))
    .orderBy(asc(driveSpaceMembers.subjectType), asc(driveSpaceMembers.subjectId));
  const names = await resolveSubjectNames(rows);
  return rows.map((r) => ({
    spaceId: r.spaceId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    subjectName: names.get(subjectKey(r.subjectType, r.subjectId)) ?? null,
    role: r.role,
    createdAt: formatDateTime(r.createdAt),
  }));
}

async function setSpaceMembers(executor: DbExecutor, spaceId: number, members: SaveDriveSpaceMembersInput['members']) {
  await executor.delete(driveSpaceMembers).where(eq(driveSpaceMembers.spaceId, spaceId));
  const dedup = new Map(members.map((m) => [subjectKey(m.subjectType, m.subjectId), m]));
  if (dedup.size > 0) {
    await executor.insert(driveSpaceMembers).values([...dedup.values()].map((m) => ({
      spaceId, subjectType: m.subjectType, subjectId: m.subjectId, role: m.role,
    })));
  }
}

export async function saveSpaceMembers(spaceId: number, data: SaveDriveSpaceMembersInput): Promise<void> {
  const row = await ensureDriveSpaceExists(spaceId);
  await ensureSpaceRole(row, 'manager');
  if (row.type === 'personal') throw new HTTPException(400, { message: '个人空间不支持成员管理，请对具体文件夹授权' });
  const before = await db.select().from(driveSpaceMembers).where(eq(driveSpaceMembers.spaceId, spaceId));
  const beforeKeys = new Set(before.map((m) => subjectKey(m.subjectType, m.subjectId)));
  await db.transaction(async (tx) => {
    await setSpaceMembers(tx, spaceId, data.members);
  });
  const added = data.members.filter((m) => !beforeKeys.has(subjectKey(m.subjectType, m.subjectId)));
  if (added.length) await notifySpaceMembersAdded(row, added);
}

export async function getSpaceMembersBeforeAudit(spaceId: number) {
  const rows = await db.select().from(driveSpaceMembers).where(eq(driveSpaceMembers.spaceId, spaceId));
  return { spaceId, members: rows.map((m) => ({ subjectType: m.subjectType, subjectId: m.subjectId, role: m.role })) };
}

// ─── 管理端 ───────────────────────────────────────────────────────────────────

export async function adminUpdateDriveSpace(id: number, data: AdminUpdateDriveSpaceInput): Promise<DriveSpace> {
  await ensureDriveSpaceExists(id);
  const { quotaGb, ...rest } = data;
  const patch: Partial<typeof driveSpaces.$inferInsert> = { ...rest };
  if (quotaGb !== undefined) patch.quotaBytes = gbToBytes(quotaGb);
  const [row] = await db.update(driveSpaces).set(patch).where(buildSpaceWhere({ id })).returning();
  if (!row) throw new HTTPException(404, { message: '空间不存在' });
  const [space] = await decorateSpaces([row], { withCounts: true });
  return space;
}

/** 重算空间已用字节 = 全部版本大小之和（含回收站） */
export async function recalcSpaceUsage(spaceId: number, executor: DbExecutor = db): Promise<number> {
  const [{ total }] = await executor.select({ total: sql<number>`coalesce(sum(${driveFileVersions.size}), 0)::bigint` })
    .from(driveFileVersions)
    .innerJoin(driveNodes, eq(driveNodes.id, driveFileVersions.nodeId))
    .where(eq(driveNodes.spaceId, spaceId));
  const used = Number(total);
  await executor.update(driveSpaces).set({ usedBytes: used }).where(eq(driveSpaces.id, spaceId));
  return used;
}

// ─── 配额 ─────────────────────────────────────────────────────────────────────

/**
 * 空间配额状态。`settings` 可选：**事务内调用方必须传入**（在事务外读取），
 * 否则冷加载会经全局连接池取连接——连接池被并发事务占满时即死锁。
 */
export async function getSpaceQuotaState(spaceId: number, executor: DbExecutor = db, settings?: DriveSettings) {
  const [row] = await executor.select().from(driveSpaces).where(eq(driveSpaces.id, spaceId)).limit(1);
  if (!row) throw new HTTPException(404, { message: '空间不存在' });
  settings ??= await getDriveSettings();
  const quotaBytes = effectiveQuotaBytes(settings, row);
  return {
    space: row,
    quotaBytes,
    usedBytes: row.usedBytes,
    remaining: quotaBytes === 0 ? null : Math.max(0, quotaBytes - row.usedBytes),
    warningPercent: settings.quotaWarningPercent,
  };
}

/** 原子占用配额；超额抛 400；达到预警阈值时通知空间管理者（每日一次） */
export async function reserveSpaceQuota(executor: DbExecutor, spaceId: number, bytes: number, settings?: DriveSettings): Promise<void> {
  if (bytes <= 0) return;
  const { quotaBytes } = await getSpaceQuotaState(spaceId, executor, settings);
  const [ok] = await executor.update(driveSpaces)
    .set({ usedBytes: sql`${driveSpaces.usedBytes} + ${bytes}` })
    .where(and(
      eq(driveSpaces.id, spaceId),
      quotaBytes === 0 ? sql`true` : sql`${driveSpaces.usedBytes} + ${bytes} <= ${quotaBytes}`,
    ))
    .returning();
  if (!ok) throw new HTTPException(400, { message: '空间配额不足，请清理回收站或联系管理员扩容' });
  if (quotaBytes > 0) {
    void maybeNotifyQuotaWarning(ok).catch(() => { /* 已在内部记日志 */ });
  }
}

export async function releaseSpaceQuota(executor: DbExecutor, spaceId: number, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await executor.update(driveSpaces)
    .set({ usedBytes: sql`GREATEST(${driveSpaces.usedBytes} - ${bytes}, 0)` })
    .where(eq(driveSpaces.id, spaceId));
}

export { defaultQuotaBytes };
