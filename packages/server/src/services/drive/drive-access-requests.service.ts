import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import {
  driveAccessRequestContract,
  driveRoleAtLeast,
  type CreateDriveAccessRequestInput,
  type DecideDriveAccessRequestInput,
  type DriveAccessRequest,
  type DriveAccessTarget,
} from '@zenith/shared/drive';
import { db } from '../../db';
import {
  departments, driveAccessRequests, driveNodePermissions, driveNodes, driveSpaceMembers, driveSpaces,
  type DriveAccessRequestRow, type DriveNodeRow,
} from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { buildListResult } from '../../lib/list-query';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { ensureNodeRole, loadDriveSubjects, resolveNodeRole, visibleNodeCondition } from './drive-access.service';
import { effectiveGrantNodeIds } from './drive-acl';
import { logDriveActivity } from './drive-activity.service';
import { resolveNodeSpaceLabels, resolveUserNames } from './drive-common';
import { ensureDriveNodeExists } from './drive-nodes.service';
import { notifyAccessDecided, notifyAccessRequested, notifyNodeShared } from './drive-notify.service';

/**
 * 访问申请：无权限用户对节点发起 → 节点管理者审批 → 通过即写入用户直接授权。
 * 申请人只能看到节点名与所属空间名；审批人由 ACL 决定（节点 manager），不新增权限码。
 */

async function mapRequests(rows: DriveAccessRequestRow[]): Promise<DriveAccessRequest[]> {
  if (rows.length === 0) return [];
  const [labelsOf, names] = await Promise.all([
    resolveNodeSpaceLabels(rows),
    resolveUserNames(rows.flatMap((r) => [r.requesterId, r.decidedBy])),
  ]);
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    spaceId: r.spaceId,
    ...labelsOf(r),
    requesterId: r.requesterId,
    requesterName: names.get(r.requesterId) ?? null,
    role: r.role === 'manager' ? 'editor' : r.role,
    reason: r.reason ?? null,
    status: r.status,
    grantedRole: r.grantedRole ?? null,
    grantedExpireAt: formatNullableDateTime(r.grantedExpireAt),
    decidedBy: r.decidedBy ?? null,
    decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? null : null,
    decidedAt: formatNullableDateTime(r.decidedAt),
    decisionNote: r.decisionNote ?? null,
    ...formatTimestamps(r),
  }));
}

async function ensureRequestExists(id: number): Promise<DriveAccessRequestRow> {
  return requireFirstRow(
    db.select().from(driveAccessRequests)
      .where(buildWhere(eq(driveAccessRequests.id, id), tenantCondition(driveAccessRequests, currentUser()))).limit(1),
    '访问申请不存在',
  );
}

/** 节点在租户内存在但当前用户无权访问时，暴露申请所需的最小信息 */
export async function getDriveAccessTarget(nodeId: number): Promise<DriveAccessTarget> {
  const node = await ensureDriveNodeExists(nodeId);
  const [space] = await db.select({ name: driveSpaces.name }).from(driveSpaces).where(eq(driveSpaces.id, node.spaceId)).limit(1);
  const [pending] = await db.select({ id: driveAccessRequests.id }).from(driveAccessRequests).where(and(
    eq(driveAccessRequests.nodeId, node.id), eq(driveAccessRequests.requesterId, currentUserId()), eq(driveAccessRequests.status, 'pending'),
  )).limit(1);
  return { nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceName: space?.name ?? '', pendingRequestId: pending?.id ?? null };
}

/** 节点的管理者用户：空间所有者 / 部门负责人 / 显式 manager 成员 / 生效链上的 manager 用户授权 */
export async function resolveNodeManagerUserIds(node: DriveNodeRow): Promise<number[]> {
  const ids = new Set<number>();
  const [space] = await db.select().from(driveSpaces).where(eq(driveSpaces.id, node.spaceId)).limit(1);
  if (space?.ownerId) ids.add(space.ownerId);
  if (space?.departmentId) {
    const [dept] = await db.select({ leaderId: departments.leaderId }).from(departments).where(eq(departments.id, space.departmentId)).limit(1);
    if (dept?.leaderId) ids.add(dept.leaderId);
  }
  const members = await db.select({ subjectId: driveSpaceMembers.subjectId }).from(driveSpaceMembers)
    .where(and(eq(driveSpaceMembers.spaceId, node.spaceId), eq(driveSpaceMembers.subjectType, 'user'), eq(driveSpaceMembers.role, 'manager')));
  for (const m of members) ids.add(m.subjectId);
  const grants = await db.select({ subjectId: driveNodePermissions.subjectId }).from(driveNodePermissions).where(and(
    inArray(driveNodePermissions.nodeId, effectiveGrantNodeIds(node)), eq(driveNodePermissions.subjectType, 'user'), eq(driveNodePermissions.role, 'manager'),
  ));
  for (const g of grants) ids.add(g.subjectId);
  return [...ids];
}

export async function createDriveAccessRequest(data: CreateDriveAccessRequestInput): Promise<DriveAccessRequest> {
  const node = await ensureDriveNodeExists(data.nodeId);
  const role = await resolveNodeRole(node);
  if (driveRoleAtLeast(role, data.role)) throw new HTTPException(400, { message: '你已拥有该权限，无需申请' });
  const user = currentUser();
  let row: DriveAccessRequestRow;
  try {
    [row] = await db.insert(driveAccessRequests).values({
      nodeId: node.id, spaceId: node.spaceId, requesterId: user.userId, role: data.role, reason: data.reason?.trim() || null,
      tenantId: getCreateTenantId(user),
    }).returning();
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(409, { message: '你已提交过申请，请等待管理者处理' });
    throw err;
  }
  const managerIds = (await resolveNodeManagerUserIds(node)).filter((id) => id !== user.userId);
  void notifyAccessRequested(row, node, managerIds);
  const [dto] = await mapRequests([row]);
  return dto;
}

async function inboxCondition(): Promise<SQL> {
  const subjects = await loadDriveSubjects();
  // 待我审批 = 我对其节点具有 manager 角色的申请（含网盘管理员）
  return inArray(driveAccessRequests.nodeId, db.select({ id: driveNodes.id }).from(driveNodes).where(and(isNull(driveNodes.deletedAt), visibleNodeCondition(subjects, 'manager'))));
}

export async function listDriveAccessRequests(q: QueryOutputOf<typeof driveAccessRequestContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.box === 'outbox' ? eq(driveAccessRequests.requesterId, currentUserId()) : await inboxCondition(),
    q.status ? eq(driveAccessRequests.status, q.status) : undefined,
    tenantCondition(driveAccessRequests, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveAccessRequests, where),
    rows: async () => mapRequests(await withPagination(
      db.select().from(driveAccessRequests).where(where).orderBy(sql`case when ${driveAccessRequests.status} = 'pending' then 0 else 1 end`, desc(driveAccessRequests.id)).$dynamic(),
      page, pageSize,
    )),
  });
}

export async function countPendingDriveAccessRequests(): Promise<number> {
  return db.$count(driveAccessRequests, buildWhere(await inboxCondition(), eq(driveAccessRequests.status, 'pending'), tenantCondition(driveAccessRequests, currentUser())));
}

export async function decideDriveAccessRequest(id: number, data: DecideDriveAccessRequestInput): Promise<DriveAccessRequest> {
  const request = await ensureRequestExists(id);
  if (request.status !== 'pending') throw new HTTPException(400, { message: '该申请已处理' });
  const node = await ensureDriveNodeExists(request.nodeId);
  await ensureNodeRole(node, 'manager', '只有节点管理者可以审批访问申请');
  const user = currentUser();
  const grantedRole = data.approve ? (data.role ?? (request.role === 'manager' ? 'editor' : request.role)) : null;
  const expireAt = data.approve && data.expireAt ? parseDateTimeInput(data.expireAt) : null;
  if (expireAt && expireAt.getTime() <= Date.now()) throw new HTTPException(400, { message: '到期时间必须晚于当前时间' });
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(driveAccessRequests).set({
      status: data.approve ? 'approved' : 'rejected', grantedRole, grantedExpireAt: expireAt,
      decidedBy: user.userId, decidedAt: new Date(), decisionNote: data.note?.trim() || null,
    }).where(and(eq(driveAccessRequests.id, id), eq(driveAccessRequests.status, 'pending'))).returning();
    if (!row) throw new HTTPException(409, { message: '该申请已被其他管理者处理' });
    if (grantedRole) {
      await tx.insert(driveNodePermissions).values({
        nodeId: node.id, subjectType: 'user', subjectId: request.requesterId, role: grantedRole, expireAt, tenantId: getCreateTenantId(user),
      }).onConflictDoUpdate({
        target: [driveNodePermissions.nodeId, driveNodePermissions.subjectType, driveNodePermissions.subjectId],
        set: { role: grantedRole, expireAt },
      });
      await logDriveActivity({
        spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'permission_change',
        detail: { viaRequest: id, subjectId: request.requesterId, role: grantedRole },
      }, tx);
    }
    return row;
  });
  if (grantedRole) await notifyNodeShared(node, [{ subjectType: 'user', subjectId: request.requesterId, role: grantedRole }]);
  void notifyAccessDecided(updated, node);
  const [dto] = await mapRequests([updated]);
  return dto;
}

export async function cancelDriveAccessRequest(id: number): Promise<DriveAccessRequest> {
  const request = await ensureRequestExists(id);
  if (request.requesterId !== currentUserId()) throw new HTTPException(403, { message: '只能撤回自己的申请' });
  if (request.status !== 'pending') throw new HTTPException(400, { message: '该申请已处理，无法撤回' });
  const [row] = await db.update(driveAccessRequests).set({ status: 'cancelled' })
    .where(and(eq(driveAccessRequests.id, id), eq(driveAccessRequests.status, 'pending'))).returning();
  const [dto] = await mapRequests([requireRow(row, '该申请已被处理')]);
  return dto;
}
