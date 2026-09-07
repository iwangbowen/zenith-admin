import { and, asc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { isOrphanedDriveSpace, type HandoffDriveSpaceInput } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodes, driveSpaces, roles, userRoles, users } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { exactTenantCondition } from '../../lib/tenant';
import { onIdentityRemoval } from '../../lib/identity-lifecycle';
import { notify } from '../messaging/notification-outbox.service';
import { getDriveSettings } from './drive-settings.service';
import { ensureDriveSpaceExists, getDriveSpace, orphanDriveSpaceCondition } from './drive-spaces.service';
import { assertSubtreeNotLockedByOthers, existingNamesIn, pickFreeName, transferDriveSubtree } from './drive-nodes.service';
import { logDriveActivity } from './drive-activity.service';
import { loadDriveSubjects } from './drive-access.service';

export async function handoffDriveSpace(id: number, input: HandoffDriveSpaceInput) {
  const source = await ensureDriveSpaceExists(id);
  if (!(await loadDriveSubjects()).isAdmin) throw new HTTPException(403, { message: '只有网盘管理员可以交接空间' });
  if (source.type !== 'personal' && !isOrphanedDriveSpace(source)) throw new HTTPException(400, { message: '有归属的协作或部门空间请使用原有成员与转让功能' });
  const [candidate] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.id, input.recipientId), eq(users.status, 'enabled'), exactTenantCondition(users.tenantId, source.tenantId),
  ));
  const recipient = requireRow(candidate, '接收人不存在、已停用或不属于同一租户', 400);
  if (input.mode === 'merge' && source.ownerId === recipient.id) throw new HTTPException(400, { message: '不能合并到原所有者自己' });
  const roots = await db.select().from(driveNodes).where(and(eq(driveNodes.spaceId, id), isNull(driveNodes.parentId))).orderBy(asc(driveNodes.id));
  await assertSubtreeNotLockedByOthers(roots);
  const settings = await getDriveSettings();
  const targetId = await db.transaction(async (tx) => {
    const [lockedSource] = await tx.select({ id: driveSpaces.id }).from(driveSpaces).where(eq(driveSpaces.id, source.id)).for('update');
    requireRow(lockedSource, '源空间已发生变化，请刷新后重试');
    const currentRoots = await tx.select().from(driveNodes).where(and(eq(driveNodes.spaceId, id), isNull(driveNodes.parentId))).orderBy(asc(driveNodes.id));
    let [target] = input.mode === 'merge'
      ? await tx.select().from(driveSpaces).where(and(eq(driveSpaces.type, 'personal'), eq(driveSpaces.ownerId, recipient.id), exactTenantCondition(driveSpaces.tenantId, source.tenantId)))
      : [];
    if (!target) {
      [target] = await tx.insert(driveSpaces).values({
        type: input.mode === 'merge' ? 'personal' : 'team',
        name: input.name ?? (input.mode === 'merge' ? '我的网盘' : `${source.name}（已交接）`.slice(0, 100)),
        ownerId: recipient.id, tenantId: source.tenantId, defaultMemberRole: null,
        maxVersions: source.maxVersions, allowExternalShare: source.allowExternalShare,
      }).onConflictDoNothing().returning();
      if (!target) [target] = await tx.select().from(driveSpaces).where(and(eq(driveSpaces.type, 'personal'), eq(driveSpaces.ownerId, recipient.id), exactTenantCondition(driveSpaces.tenantId, source.tenantId)));
    }
    if (!target || target.id === source.id || target.status !== 'enabled') throw new HTTPException(400, { message: '目标空间不可用' });
    const taken = await existingNamesIn(tx, target.id, null);
    for (const root of currentRoots) {
      const name = pickFreeName(root.name, taken);
      taken.add(name.toLowerCase());
      if (name !== root.name) await tx.update(driveNodes).set({ name }).where(eq(driveNodes.id, root.id));
      await transferDriveSubtree(tx, root, target, null, settings);
      await logDriveActivity({ spaceId: target.id, nodeId: root.id, nodeName: name, nodeType: root.type, action: 'move', detail: { handoff: true, fromSpaceId: source.id, recipientId: recipient.id } }, tx);
    }
    if (await tx.$count(driveNodes, eq(driveNodes.spaceId, source.id))) throw new HTTPException(409, { message: '源空间仍有未交接的节点，请检查目录结构' });
    await tx.delete(driveSpaces).where(eq(driveSpaces.id, source.id));
    return target.id;
  });
  return getDriveSpace(targetId);
}

export async function reportOrphanDriveSpaces(): Promise<void> {
  const spaces = await db.select({ id: driveSpaces.id, name: driveSpaces.name, tenantId: driveSpaces.tenantId }).from(driveSpaces).where(orphanDriveSpaceCondition());
  if (!spaces.length) return;
  const admins = await db.select({ id: users.id }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.code, 'super_admin'), eq(roles.status, 'enabled'), eq(users.status, 'enabled'), isNull(users.tenantId)));
  if (!admins.length) return;
  for (const space of spaces) {
    await notify('drive.space.orphaned', {
      recipients: admins.map((admin) => ({ type: 'user', id: admin.id })),
      vars: { spaceId: space.id, spaceName: space.name }, tenantId: space.tenantId,
      link: '/drive/admin/spaces', dedupeKey: `drive-orphan:${space.id}`,
    });
  }
}

let subscribed = false;
export function registerDriveOwnershipSubscriber(): void {
  if (subscribed) return;
  subscribed = true;
  onIdentityRemoval(reportOrphanDriveSpaces);
}
