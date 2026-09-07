import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { DriveNodePermission, DriveNodePermissionsResult, SaveDriveNodePermissionsInput, SetDriveNodeInheritInput } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodePermissions, driveNodes, type DriveNodePermissionRow, type DriveNodeRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { getCreateTenantId } from '../../lib/tenant';
import { ensureNodeRole, resolveNodeRoles } from './drive-access.service';
import { resolveSubjectNames, resolveUserNames, subjectKey } from './drive-common';
import { logDriveActivity } from './drive-activity.service';
import { ensureDriveNodeExists, rewriteAclAfterInheritChange } from './drive-nodes.service';
import { notifyNodeShared } from './drive-notify.service';

async function mapPermissions(
  rows: DriveNodePermissionRow[],
  inheritedFrom: Map<number, { id: number; name: string }>,
): Promise<DriveNodePermission[]> {
  const [names, userNames] = await Promise.all([
    resolveSubjectNames(rows),
    resolveUserNames(rows.map((r) => r.createdBy)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    subjectName: names.get(subjectKey(r.subjectType, r.subjectId)) ?? null,
    role: r.role,
    expireAt: formatNullableDateTime(r.expireAt),
    createdBy: r.createdBy ?? null,
    createdByName: r.createdBy ? userNames.get(r.createdBy) ?? null : null,
    createdAt: formatDateTime(r.createdAt),
    inheritedFrom: inheritedFrom.get(r.nodeId) ?? null,
  }));
}

/** 生效的祖先链：从最近一个断开继承的祖先（含）到父节点 */
async function effectiveAncestorChain(node: DriveNodeRow): Promise<Array<{ id: number; name: string }>> {
  if (node.aclChainIds.length === 0) return [];
  const rows = await db.select({ id: driveNodes.id, name: driveNodes.name })
    .from(driveNodes).where(inArray(driveNodes.id, node.aclChainIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return node.aclChainIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
}

export async function getDriveNodePermissions(nodeId: number): Promise<DriveNodePermissionsResult> {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  const resolution = (await resolveNodeRoles([node])).get(node.id);
  if (!resolution?.role) throw new HTTPException(403, { message: '没有该文件的访问权限' });
  const chain = await effectiveAncestorChain(node);
  const activeCondition = or(isNull(driveNodePermissions.expireAt), gt(driveNodePermissions.expireAt, new Date()));
  const [direct, inherited] = await Promise.all([
    db.select().from(driveNodePermissions).where(eq(driveNodePermissions.nodeId, nodeId)).orderBy(asc(driveNodePermissions.id)),
    chain.length
      ? db.select().from(driveNodePermissions)
        .where(and(inArray(driveNodePermissions.nodeId, chain.map((c) => c.id)), activeCondition))
        .orderBy(asc(driveNodePermissions.nodeId), asc(driveNodePermissions.id))
      : Promise.resolve([]),
  ]);
  const chainMap = new Map(chain.map((c) => [c.id, c]));
  const [directDto, inheritedDto] = await Promise.all([
    mapPermissions(direct, new Map()),
    mapPermissions(inherited, chainMap),
  ]);
  return {
    nodeId,
    inheritPermissions: node.inheritPermissions,
    spaceRole: resolution.spaceRole,
    effectiveRole: resolution.role,
    direct: directDto,
    inherited: inheritedDto,
  };
}

export async function getDriveNodePermissionsBeforeAudit(nodeId: number) {
  const rows = await db.select().from(driveNodePermissions).where(eq(driveNodePermissions.nodeId, nodeId));
  return { nodeId, permissions: rows.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, role: r.role, expireAt: formatNullableDateTime(r.expireAt) })) };
}

/** 全量替换节点直接授权；对新增的用户主体发送通知 */
export async function saveDriveNodePermissions(nodeId: number, data: SaveDriveNodePermissionsInput): Promise<DriveNodePermissionsResult> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'manager', '只有管理者可以修改授权');
  const before = await db.select().from(driveNodePermissions).where(eq(driveNodePermissions.nodeId, nodeId));
  const beforeKeys = new Set(before.map((r) => subjectKey(r.subjectType, r.subjectId)));
  const dedup = new Map(data.permissions.map((p) => [subjectKey(p.subjectType, p.subjectId), p]));
  const user = currentUser();
  await db.transaction(async (tx) => {
    await tx.delete(driveNodePermissions).where(eq(driveNodePermissions.nodeId, nodeId));
    if (dedup.size > 0) {
      await tx.insert(driveNodePermissions).values([...dedup.values()].map((p) => ({
        nodeId,
        subjectType: p.subjectType,
        subjectId: p.subjectId,
        role: p.role,
        expireAt: p.expireAt ? parseDateTimeInput(p.expireAt) : null,
        tenantId: getCreateTenantId(user),
      })));
    }
    await logDriveActivity({
      spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'permission_change',
      detail: { before: before.length, after: dedup.size },
    }, tx);
  });
  const added = [...dedup.values()].filter((p) => !beforeKeys.has(subjectKey(p.subjectType, p.subjectId)));
  if (added.length) await notifyNodeShared(node, added);
  return getDriveNodePermissions(nodeId);
}

export async function setDriveNodeInherit(nodeId: number, data: SetDriveNodeInheritInput): Promise<DriveNodePermissionsResult> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'manager', '只有管理者可以修改继承设置');
  if (node.inheritPermissions !== data.inherit) {
    await db.transaction(async (tx) => {
      await rewriteAclAfterInheritChange(tx, node, data.inherit);
      await logDriveActivity({
        spaceId: node.spaceId, nodeId: node.id, nodeName: node.name, nodeType: node.type, action: 'inherit_change',
        detail: { inherit: data.inherit },
      }, tx);
    });
  }
  return getDriveNodePermissions(nodeId);
}
