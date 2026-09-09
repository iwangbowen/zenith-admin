import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { formatBytes } from '@zenith/shared/core';
import type {
  CreateDriveLegalHoldInput,
  CreateDriveQuotaRequestInput,
  DecideDriveQuotaRequestInput,
  DriveLegalHold,
  DriveQuotaRequest,
  DriveQuotaRequestStatus,
  DriveSpace,
  ReleaseDriveLegalHoldInput,
} from '@zenith/shared/drive';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  driveLegalHolds, driveNodes, driveQuotaRequests, driveSpaces, menus, roleMenus, roles, userRoles, users,
  type DriveLegalHoldRow, type DriveNodeRow, type DriveQuotaRequestRow, type DriveSpaceRow,
} from '../../db/schema';
import { currentUser, currentUserId, currentUserOrNull, isSuperAdmin } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { buildListResult } from '../../lib/list-query';
import logger from '../../lib/logger';
import { getCreateTenantId, inheritedTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { notify } from '../messaging/notification-outbox.service';
import { DRIVE_ADMIN_PERMISSION, ensureSpaceRole, resolveSpaceRole } from './drive-access.service';
import { driveRoleAtLeast } from './drive-acl';
import { resolveNodeManagerUserIds } from './drive-access-requests.service';
import { logDriveActivity } from './drive-activity.service';
import { resolveUserNames } from './drive-common';
import { ensureDriveNodeExists } from './drive-nodes.service';
import { GB_BYTES, effectiveQuotaBytes, getDriveSettings } from './drive-settings.service';
import { decorateSpaceRows, ensureDriveSpaceExists } from './drive-spaces.service';

/**
 * 网盘治理（阶段 4）：法律保留 / 空间归档 / 扩容申请 / 管理员收件人。
 * 全部为内置能力，不依赖外部服务；通知统一经 notify() 进通知中心。
 */

// ─── 管理员收件人 ─────────────────────────────────────────────────────────────

/** 网盘管理员用户：持有 drive:admin:space:edit 的启用用户 ∪ 平台超管；按租户收窄（平台用户对所有租户可见） */
export async function resolveDriveAdminUserIds(tenantId: number | null): Promise<number[]> {
  const tenantScope = inheritedTenantCondition(users.tenantId, tenantId);
  const [byPermission, superAdmins] = await Promise.all([
    db.selectDistinct({ id: users.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(roleMenus, eq(roleMenus.roleId, userRoles.roleId))
      .innerJoin(menus, eq(menus.id, roleMenus.menuId))
      .where(and(eq(menus.permission, DRIVE_ADMIN_PERMISSION), eq(users.status, 'enabled'), eq(roles.status, 'enabled'), tenantScope)),
    db.selectDistinct({ id: users.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.code, 'super_admin'), eq(roles.status, 'enabled'), eq(users.status, 'enabled'), tenantScope)),
  ]);
  return [...new Set([...byPermission, ...superAdmins].map((r) => r.id))];
}

// ─── 法律保留 ─────────────────────────────────────────────────────────────────

type HoldNode = Pick<DriveNodeRow, 'id' | 'name' | 'ancestorIds'>;

/**
 * 与给定根节点集合有交集的生效保留节点：保留节点是根自身、根的祖先，或位于根的子树内。
 * 返回命中的保留节点（含名称），供报错与过滤使用。
 */
async function intersectingHoldNodes(executor: DbExecutor, roots: HoldNode[]): Promise<HoldNode[]> {
  if (roots.length === 0) return [];
  const rootIds = roots.map((r) => r.id);
  const upwardIds = [...new Set(roots.flatMap((r) => [r.id, ...r.ancestorIds]))];
  const rootArray = sql`ARRAY[${sql.join(rootIds.map((id) => sql`${id}`), sql`, `)}]::integer[]`;
  return executor.select({ id: driveNodes.id, name: driveNodes.name, ancestorIds: driveNodes.ancestorIds })
    .from(driveLegalHolds)
    .innerJoin(driveNodes, eq(driveNodes.id, driveLegalHolds.nodeId))
    .where(and(
      eq(driveLegalHolds.active, true),
      or(inArray(driveNodes.id, upwardIds), sql`${driveNodes.ancestorIds} && ${rootArray}`),
    ));
}

function holdCovers(hold: HoldNode, root: HoldNode): boolean {
  return hold.id === root.id || root.ancestorIds.includes(hold.id) || hold.ancestorIds.includes(root.id);
}

/** 根集合中被法律保留覆盖的根 id（自身 / 祖先 / 子树内任一节点处于保留） */
export async function heldRootIds(executor: DbExecutor, roots: HoldNode[]): Promise<Set<number>> {
  const holds = await intersectingHoldNodes(executor, roots);
  if (holds.length === 0) return new Set();
  return new Set(roots.filter((root) => holds.some((hold) => holdCovers(hold, root))).map((r) => r.id));
}

/** 任一根被法律保留覆盖即 423，消息附保留节点名 */
export async function assertNoLegalHold(executor: DbExecutor, roots: HoldNode[], action: string): Promise<void> {
  const holds = await intersectingHoldNodes(executor, roots);
  for (const root of roots) {
    const hit = holds.find((hold) => holdCovers(hold, root));
    if (hit) {
      const where = hit.id === root.id ? `「${root.name}」` : `「${root.name}」涉及的「${hit.name}」`;
      throw new HTTPException(423, { message: `${where}处于法律保留，${action}被拒绝` });
    }
  }
}

/** 节点自身或祖先处于法律保留（详情展示用；不含子树） */
export async function isNodeOnLegalHold(node: Pick<DriveNodeRow, 'id' | 'ancestorIds'>, executor: DbExecutor = db): Promise<boolean> {
  const [row] = await executor.select({ id: driveLegalHolds.id }).from(driveLegalHolds)
    .where(and(eq(driveLegalHolds.active, true), inArray(driveLegalHolds.nodeId, [node.id, ...node.ancestorIds]))).limit(1);
  return !!row;
}

/** 批量：自身或祖先处于法律保留的节点 id 集合 */
export async function legalHoldNodeIds(nodes: Array<Pick<DriveNodeRow, 'id' | 'ancestorIds'>>, executor: DbExecutor = db): Promise<Set<number>> {
  if (nodes.length === 0) return new Set();
  const candidateIds = [...new Set(nodes.flatMap((n) => [n.id, ...n.ancestorIds]))];
  const rows = await executor.select({ nodeId: driveLegalHolds.nodeId }).from(driveLegalHolds)
    .where(and(eq(driveLegalHolds.active, true), inArray(driveLegalHolds.nodeId, candidateIds)));
  if (rows.length === 0) return new Set();
  const held = new Set(rows.map((r) => r.nodeId));
  return new Set(nodes.filter((n) => held.has(n.id) || n.ancestorIds.some((id) => held.has(id))).map((n) => n.id));
}

async function mapLegalHolds(rows: DriveLegalHoldRow[]): Promise<DriveLegalHold[]> {
  if (rows.length === 0) return [];
  const [nodes, spaces, names] = await Promise.all([
    db.select({ id: driveNodes.id, name: driveNodes.name, type: driveNodes.type }).from(driveNodes).where(inArray(driveNodes.id, [...new Set(rows.map((r) => r.nodeId))])),
    db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(inArray(driveSpaces.id, [...new Set(rows.map((r) => r.spaceId))])),
    resolveUserNames(rows.flatMap((r) => [r.createdBy, r.releasedBy])),
  ]);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const spaceMap = new Map(spaces.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    nodeName: nodeMap.get(r.nodeId)?.name ?? '',
    nodeType: nodeMap.get(r.nodeId)?.type ?? 'file',
    spaceId: r.spaceId,
    spaceName: spaceMap.get(r.spaceId) ?? '',
    reason: r.reason,
    active: r.active,
    createdBy: r.createdBy ?? null,
    createdByName: r.createdBy ? names.get(r.createdBy) ?? null : null,
    createdAt: formatDateTime(r.createdAt),
    releasedBy: r.releasedBy ?? null,
    releasedByName: r.releasedBy ? names.get(r.releasedBy) ?? null : null,
    releasedAt: formatNullableDateTime(r.releasedAt),
    releaseNote: r.releaseNote ?? null,
  }));
}

export interface ListLegalHoldsQuery {
  page?: number;
  pageSize?: number;
  spaceId?: number;
  nodeId?: number;
  active?: boolean;
}

export async function listLegalHolds(q: ListLegalHoldsQuery) {
  const { page = 1, pageSize = 20 } = q;
  const where = buildWhere(
    q.spaceId !== undefined ? eq(driveLegalHolds.spaceId, q.spaceId) : undefined,
    q.nodeId !== undefined ? eq(driveLegalHolds.nodeId, q.nodeId) : undefined,
    q.active !== undefined ? eq(driveLegalHolds.active, q.active) : undefined,
    tenantCondition(driveLegalHolds, currentUser()),
    await adminSpaceScope(driveLegalHolds.spaceId),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveLegalHolds, where),
    rows: async () => mapLegalHolds(await withPagination(
      db.select().from(driveLegalHolds).where(where).orderBy(desc(driveLegalHolds.active), desc(driveLegalHolds.id)).$dynamic(), page, pageSize,
    )),
  });
}

async function notifyLegalHoldChanged(node: DriveNodeRow, actionText: string, reason: string, tenantId: number | null) {
  try {
    const me = currentUserOrNull();
    const managerIds = (await resolveNodeManagerUserIds(node)).filter((id) => id !== me?.userId);
    if (managerIds.length === 0) return;
    const names = await resolveUserNames([me?.userId]);
    await notify('drive.legal_hold.changed', {
      recipients: managerIds.map((id) => ({ type: 'user' as const, id })),
      vars: { nodeId: node.id, nodeName: node.name, actionText, operatorName: me ? names.get(me.userId) ?? me.username : '系统', reason: reason ? `（${reason}）` : '' },
      tenantId,
      link: node.type === 'folder' ? `/drive?space=${node.spaceId}&folder=${node.id}` : `/drive?space=${node.spaceId}&node=${node.id}`,
    });
  } catch (err) {
    logger.warn({ err, nodeId: node.id }, 'drive: 法律保留变更通知失败');
  }
}

export async function createLegalHold(data: CreateDriveLegalHoldInput): Promise<DriveLegalHold> {
  const node = await ensureDriveNodeExists(data.nodeId, { allowDeleted: true });
  const user = currentUser();
  let row: DriveLegalHoldRow;
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(driveLegalHolds).values({
        nodeId: node.id, spaceId: node.spaceId, reason: data.reason, tenantId: getCreateTenantId(user),
      }).returning();
      await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'legal_hold', detail: { holdId: created.id, reason: data.reason } }, tx);
      return created;
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(409, { message: '该节点已处于法律保留' });
    throw err;
  }
  void notifyLegalHoldChanged(node, '已被设置法律保留', data.reason, row.tenantId ?? null);
  const [dto] = await mapLegalHolds([row]);
  return dto;
}

export async function releaseLegalHold(id: number, data: ReleaseDriveLegalHoldInput): Promise<DriveLegalHold> {
  const [hold] = await db.select().from(driveLegalHolds).where(buildWhere(eq(driveLegalHolds.id, id), tenantCondition(driveLegalHolds, currentUser()))).limit(1);
  const existing = requireRow(hold, '法律保留记录不存在');
  if (!existing.active) throw new HTTPException(400, { message: '该保留已解除' });
  const node = await ensureDriveNodeExists(existing.nodeId, { allowDeleted: true });
  const note = data.note?.trim() || null;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(driveLegalHolds)
      .set({ active: false, releasedBy: currentUserId(), releasedAt: new Date(), releaseNote: note })
      .where(and(eq(driveLegalHolds.id, id), eq(driveLegalHolds.active, true))).returning();
    if (!updated) throw new HTTPException(409, { message: '该保留已被其他管理员解除' });
    await logDriveActivity({ spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'legal_release', detail: { holdId: id, note } }, tx);
    return updated;
  });
  void notifyLegalHoldChanged(node, '的法律保留已解除', note ?? '', row.tenantId ?? null);
  const [dto] = await mapLegalHolds([row]);
  return dto;
}

// ─── 空间归档 ─────────────────────────────────────────────────────────────────

async function setSpaceArchived(id: number, archived: boolean): Promise<DriveSpace> {
  const space = await ensureDriveSpaceExists(id);
  await ensureSpaceRole(space, 'manager', { allowArchived: true });
  if (space.type === 'personal') throw new HTTPException(400, { message: '个人空间不支持归档' });
  if (archived && space.archivedAt) throw new HTTPException(400, { message: '空间已处于归档状态' });
  if (!archived && !space.archivedAt) throw new HTTPException(400, { message: '空间未归档' });
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(driveSpaces).set({ archivedAt: archived ? new Date() : null }).where(eq(driveSpaces.id, id)).returning();
    await logDriveActivity({ spaceId: id, nodeId: null, nodeName: space.name, nodeType: 'folder', action: archived ? 'archive' : 'unarchive' }, tx);
    return updated;
  });
  const [dto] = await decorateSpaceRows([row], { withRole: true, withCounts: true });
  return dto;
}

export const archiveDriveSpace = (id: number) => setSpaceArchived(id, true);
export const unarchiveDriveSpace = (id: number) => setSpaceArchived(id, false);

// ─── 扩容申请 ─────────────────────────────────────────────────────────────────

async function mapQuotaRequests(rows: DriveQuotaRequestRow[]): Promise<DriveQuotaRequest[]> {
  if (rows.length === 0) return [];
  const [spaces, names] = await Promise.all([
    db.select({ id: driveSpaces.id, name: driveSpaces.name, type: driveSpaces.type }).from(driveSpaces).where(inArray(driveSpaces.id, [...new Set(rows.map((r) => r.spaceId))])),
    resolveUserNames(rows.flatMap((r) => [r.requesterId, r.decidedBy])),
  ]);
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));
  return rows.map((r) => ({
    id: r.id,
    spaceId: r.spaceId,
    spaceName: spaceMap.get(r.spaceId)?.name ?? '',
    spaceType: spaceMap.get(r.spaceId)?.type ?? 'team',
    currentQuotaBytes: r.currentQuotaBytes,
    usedBytes: r.usedBytes,
    requestedGb: r.requestedGb,
    reason: r.reason ?? null,
    status: r.status,
    requesterId: r.requesterId,
    requesterName: names.get(r.requesterId) ?? null,
    approvedGb: r.approvedGb ?? null,
    decidedBy: r.decidedBy ?? null,
    decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? null : null,
    decidedAt: formatNullableDateTime(r.decidedAt),
    decisionNote: r.decisionNote ?? null,
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  }));
}

export async function createQuotaRequest(spaceId: number, data: CreateDriveQuotaRequestInput): Promise<DriveQuotaRequest> {
  const space = await ensureDriveSpaceExists(spaceId);
  await ensureSpaceRole(space, 'manager', { allowArchived: true });
  const settings = await getDriveSettings();
  const currentQuota = effectiveQuotaBytes(settings, space);
  if (currentQuota === 0) throw new HTTPException(400, { message: '该空间当前不限配额，无需扩容' });
  if (data.requestedGb * GB_BYTES <= currentQuota) throw new HTTPException(400, { message: `申请配额需大于当前配额 ${formatBytes(currentQuota)}` });
  const user = currentUser();
  let row: DriveQuotaRequestRow;
  try {
    [row] = await db.insert(driveQuotaRequests).values({
      spaceId: space.id, requesterId: user.userId, currentQuotaBytes: currentQuota, usedBytes: space.usedBytes,
      requestedGb: data.requestedGb, reason: data.reason?.trim() || null, tenantId: getCreateTenantId(user),
    }).returning();
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(409, { message: '该空间已有待审批的扩容申请' });
    throw err;
  }
  void notifyQuotaRequested(row, space);
  const [dto] = await mapQuotaRequests([row]);
  return dto;
}

async function notifyQuotaRequested(request: DriveQuotaRequestRow, space: DriveSpaceRow) {
  try {
    const adminIds = (await resolveDriveAdminUserIds(space.tenantId ?? null)).filter((id) => id !== request.requesterId);
    if (adminIds.length === 0) return;
    const names = await resolveUserNames([request.requesterId]);
    await notify('drive.quota.requested', {
      recipients: adminIds.map((id) => ({ type: 'user' as const, id })),
      vars: {
        requestId: request.id, spaceId: space.id, spaceName: space.name, requesterName: names.get(request.requesterId) ?? '',
        requestedGb: request.requestedGb, reason: request.reason ? `（理由：${request.reason}）` : '',
      },
      tenantId: space.tenantId ?? null,
      link: '/drive/admin/governance?tab=quota',
    });
  } catch (err) {
    logger.warn({ err, requestId: request.id }, 'drive: 扩容申请通知失败');
  }
}

/** 空间视角：该空间全部申请（需空间 viewer） */
export async function listSpaceQuotaRequests(spaceId: number): Promise<DriveQuotaRequest[]> {
  const space = await ensureDriveSpaceExists(spaceId);
  const role = await resolveSpaceRole(space);
  if (!driveRoleAtLeast(role, 'viewer')) throw new HTTPException(403, { message: '没有该空间的操作权限' });
  const rows = await db.select().from(driveQuotaRequests).where(eq(driveQuotaRequests.spaceId, spaceId)).orderBy(desc(driveQuotaRequests.id)).limit(50);
  return mapQuotaRequests(rows);
}

export interface ListQuotaRequestsQuery {
  page?: number;
  pageSize?: number;
  status?: DriveQuotaRequestStatus;
  spaceId?: number;
}

/** 管理端数据权限：非超管按空间归属部门 / 所有者收窄 */
async function adminSpaceScope(column: typeof driveLegalHolds.spaceId | typeof driveQuotaRequests.spaceId): Promise<SQL | undefined> {
  if (isSuperAdmin()) return undefined;
  const cond = await getDataScopeCondition({ currentUserId: currentUserId(), deptColumn: driveSpaces.departmentId, ownerColumn: driveSpaces.ownerId });
  return cond ? inArray(column, db.select({ id: driveSpaces.id }).from(driveSpaces).where(cond)) : undefined;
}

export async function listQuotaRequestsForAdmin(q: ListQuotaRequestsQuery) {
  const { page = 1, pageSize = 20 } = q;
  const where = buildWhere(
    q.status ? eq(driveQuotaRequests.status, q.status) : undefined,
    q.spaceId !== undefined ? eq(driveQuotaRequests.spaceId, q.spaceId) : undefined,
    tenantCondition(driveQuotaRequests, currentUser()),
    await adminSpaceScope(driveQuotaRequests.spaceId),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveQuotaRequests, where),
    rows: async () => mapQuotaRequests(await withPagination(
      db.select().from(driveQuotaRequests).where(where)
        .orderBy(sql`case when ${driveQuotaRequests.status} = 'pending' then 0 else 1 end`, desc(driveQuotaRequests.id)).$dynamic(),
      page, pageSize,
    )),
  });
}

export async function countPendingQuotaRequests(): Promise<number> {
  return db.$count(driveQuotaRequests, buildWhere(eq(driveQuotaRequests.status, 'pending'), tenantCondition(driveQuotaRequests, currentUser()), await adminSpaceScope(driveQuotaRequests.spaceId)));
}

export async function decideQuotaRequest(id: number, data: DecideDriveQuotaRequestInput): Promise<DriveQuotaRequest> {
  const [request] = await db.select().from(driveQuotaRequests).where(buildWhere(eq(driveQuotaRequests.id, id), tenantCondition(driveQuotaRequests, currentUser()))).limit(1);
  const existing = requireRow(request, '扩容申请不存在');
  if (existing.status !== 'pending') throw new HTTPException(400, { message: '该申请已处理' });
  const space = await ensureDriveSpaceExists(existing.spaceId);
  const approvedGb = data.approve ? (data.quotaGb ?? existing.requestedGb) : null;
  const user = currentUser();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(driveQuotaRequests).set({
      status: data.approve ? 'approved' : 'rejected', approvedGb,
      decidedBy: user.userId, decidedAt: new Date(), decisionNote: data.note?.trim() || null,
    }).where(and(eq(driveQuotaRequests.id, id), eq(driveQuotaRequests.status, 'pending'))).returning();
    if (!row) throw new HTTPException(409, { message: '该申请已被其他管理员处理' });
    if (approvedGb !== null) {
      await tx.update(driveSpaces).set({ quotaBytes: approvedGb * GB_BYTES }).where(eq(driveSpaces.id, space.id));
    }
    return row;
  });
  void notifyQuotaDecided(updated, space);
  const [dto] = await mapQuotaRequests([updated]);
  return dto;
}

async function notifyQuotaDecided(request: DriveQuotaRequestRow, space: DriveSpaceRow) {
  try {
    const me = currentUserOrNull();
    const names = await resolveUserNames([me?.userId]);
    const approved = request.status === 'approved';
    await notify('drive.quota.decided', {
      recipients: [{ type: 'user', id: request.requesterId }],
      vars: {
        requestId: request.id, spaceId: space.id, spaceName: space.name,
        resultText: approved ? `已通过（${request.approvedGb} GB）` : '被拒绝',
        deciderName: me ? names.get(me.userId) ?? me.username : '系统', note: request.decisionNote ? `（${request.decisionNote}）` : '',
      },
      tenantId: space.tenantId ?? null,
      link: `/drive/spaces?space=${space.id}`,
    });
  } catch (err) {
    logger.warn({ err, requestId: request.id }, 'drive: 扩容申请结果通知失败');
  }
}
