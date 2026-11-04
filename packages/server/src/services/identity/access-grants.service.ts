import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { RevokeAccessGrantInput } from '@zenith/shared/identity';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { identityAccessGrantItems, identityAccessGrants, identityAccessRequests, identityAccessRequestItems } from '../../db/schema';
import { currentUser, setAuditBefore } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { notifyUserPermissionsChanged } from '../../lib/permissions';
import { taskTransaction, lockSystemTask, retrySystemTaskInTransaction } from '../../lib/task-center';
import { lockBusinessApproval } from '../workflow/public/access-approval';
import { assertAccessSnapshotDuration } from './access-policy.service';
import { assertNoOverlappingAccessRequest } from './access-reservations.service';
import { formatAccessGrant, formatAccessRequest } from './access-formatters';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { resolveUserNames } from '../../lib/user-nicknames';

export async function refreshAccessGrantHeader(executor: DbExecutor, grantId: number, tenantId: number | null, actorId?: number, reason?: string): Promise<void> {
  const where = and(eq(identityAccessGrants.id, grantId), exactTenantCondition(identityAccessGrants.tenantId, tenantId));
  const [grant] = await executor.select().from(identityAccessGrants).where(where).for('update').limit(1);
  if (!grant || grant.status === 'revoked') return;
  const items = await executor.query.identityAccessGrantItems.findMany({ where: eq(identityAccessGrantItems.grantId, grantId) });
  const remaining = items.filter(item => item.status !== 'revoked');
  if (!remaining.length) {
    await executor.update(identityAccessGrants).set({ status: 'revoked', revokedAt: new Date(), revokedBy: actorId ?? null, revokeReason: reason ?? '全部授权项已撤销' }).where(where);
    return;
  }
  const live = remaining.filter(item => item.expiresAt === null || item.expiresAt.getTime() > Date.now());
  const bounds = live.length ? live : remaining;
  const startsAt = new Date(Math.min(...bounds.map(item => item.startsAt.getTime())));
  const expiresAt = bounds.some(item => item.expiresAt === null) ? null : new Date(Math.max(...bounds.map(item => item.expiresAt!.getTime())));
  const status = live.length === 0 ? 'expired' : startsAt.getTime() > Date.now() ? 'scheduled' : 'active';
  await executor.update(identityAccessGrants).set({ status, startsAt, expiresAt, ...(expiresAt?.getTime() !== grant.expiresAt?.getTime() ? { expiringNotifiedAt: null } : {}) }).where(where);
}

export async function revokeAccessGrantItemInTransaction(executor: DbExecutor, itemId: number, tenantId: number | null, actorId: number, reason: string) {
  const item = requireRow(await executor.query.identityAccessGrantItems.findFirst({ where: eq(identityAccessGrantItems.id, itemId), with: { grant: true } }), '授权项不存在');
  if (item.grant.tenantId !== tenantId) throw new HTTPException(404, { message: '授权项不存在' });
  const where = and(eq(identityAccessGrants.id, item.grantId), exactTenantCondition(identityAccessGrants.tenantId, tenantId));
  const [grant] = await executor.select().from(identityAccessGrants).where(where).for('update').limit(1);
  requireRow(grant, '授权不存在');
  const currentItem = requireRow(await executor.query.identityAccessGrantItems.findFirst({ where: and(eq(identityAccessGrantItems.id, itemId), eq(identityAccessGrantItems.grantId, grant.id)) }), '授权项不存在');
  if (currentItem.status !== 'revoked') {
    await executor.update(identityAccessGrantItems).set({ status: 'revoked', revokedBy: actorId, revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(identityAccessGrantItems.id, itemId), eq(identityAccessGrantItems.grantId, grant.id)));
    await refreshAccessGrantHeader(executor, grant.id, tenantId, actorId, reason);
    const names = await resolveUserNames([grant.userId], executor);
    await notifyWithin(executor, 'identity.access.revoked', { recipients: [{ type: 'user', id: grant.userId }], vars: { grantId: grant.id, targetName: names.get(grant.userId) ?? `用户 ${grant.userId}`, reason: `${currentItem.permissionLabel ?? currentItem.permissionCode}（单项）：${reason}` }, tenantId, link: '/workflow/launchpad', dedupeKey: `identity-access-item-revoked:${itemId}` });
  }
  return { grantId: grant.id, userId: grant.userId };
}

async function readGrant(grantId: number) {
  return formatAccessGrant(requireRow(await db.query.identityAccessGrants.findFirst({ where: and(eq(identityAccessGrants.id, grantId), tenantCondition(identityAccessGrants, currentUser())), with: { user: true, approver: true, revoker: true, items: true } }), '临时授权不存在'));
}

export async function revokeAccessGrantItem(id: number, input: RevokeAccessGrantInput) {
  const actor = currentUser();
  const item = requireRow(await db.query.identityAccessGrantItems.findFirst({ where: eq(identityAccessGrantItems.id, id), with: { grant: true } }), '授权项不存在');
  const allowed = requireRow(await db.query.identityAccessGrants.findFirst({ where: and(eq(identityAccessGrants.id, item.grantId), tenantCondition(identityAccessGrants, actor)), columns: { id: true, tenantId: true } }), '授权项不存在');
  setAuditBefore(await readGrant(item.grantId));
  const changed = await db.transaction(tx => revokeAccessGrantItemInTransaction(tx, id, allowed.tenantId, actor.userId, input.reason));
  await notifyUserPermissionsChanged(changed.userId);
  return readGrant(changed.grantId);
}

export async function revokeAccessGrant(id: number, input: RevokeAccessGrantInput) {
  const actor = currentUser();
  setAuditBefore(await readGrant(id));
  const where = and(eq(identityAccessGrants.id, id), tenantCondition(identityAccessGrants, actor));
  const grant = await db.transaction(async tx => {
    const [row] = await tx.select().from(identityAccessGrants).where(where).for('update').limit(1);
    requireRow(row, '临时授权不存在');
    if (row.status !== 'revoked') {
      await tx.update(identityAccessGrantItems).set({ status: 'revoked', revokedBy: actor.userId, revokedAt: new Date(), revokeReason: input.reason }).where(and(eq(identityAccessGrantItems.grantId, id), inArray(identityAccessGrantItems.status, ['scheduled', 'active'])));
      await tx.update(identityAccessGrants).set({ status: 'revoked', revokedBy: actor.userId, revokedAt: new Date(), revokeReason: input.reason }).where(where);
      const names = await resolveUserNames([row.userId], tx);
      await notifyWithin(tx, 'identity.access.revoked', { recipients: [{ type: 'user', id: row.userId }], vars: { grantId: id, targetName: names.get(row.userId) ?? `用户 ${row.userId}`, reason: input.reason }, tenantId: row.tenantId, link: '/workflow/launchpad', dedupeKey: `identity-access-revoked:${id}` });
    }
    return row;
  });
  await notifyUserPermissionsChanged(grant.userId);
  return readGrant(id);
}

export async function retryAccessRequestProvision(id: number) {
  const caller = currentUser();
  const visible = requireRow(await db.query.identityAccessRequests.findFirst({ where: and(eq(identityAccessRequests.id, id), tenantCondition(identityAccessRequests, caller)), columns: { workflowInstanceId: true, tenantId: true } }), '权限申请不存在');
  if (!visible.workflowInstanceId) throw new HTTPException(409, { message: '权限申请缺少关联流程' });
  await taskTransaction(async tx => {
    const task = await lockSystemTask(tx, { taskType: 'identity-access-grant-apply', idempotencyKey: `identity-access-apply:${id}`, tenantId: visible.tenantId });
    await lockBusinessApproval(tx, visible.workflowInstanceId!, visible.tenantId);
    const where = and(eq(identityAccessRequests.id, id), exactTenantCondition(identityAccessRequests.tenantId, visible.tenantId));
    const [request] = await tx.select().from(identityAccessRequests).where(where).for('update').limit(1);
    if (!request || request.status !== 'approved' || request.provisionStatus !== 'failed') throw new HTTPException(409, { message: '仅已批准但发放失败的申请可以重试' });
    await assertAccessSnapshotDuration(request.policySnapshot, request.startsAt, request.expiresAt, request.tenantId, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-access:${request.tenantId ?? 'platform'}:${request.targetUserId}`}, 0))`);
    const items = await tx.query.identityAccessRequestItems.findMany({ where: eq(identityAccessRequestItems.requestId, id) });
    await assertNoOverlappingAccessRequest({ targetUserId: request.targetUserId, tenantId: request.tenantId, startsAt: request.startsAt, expiresAt: request.expiresAt, items, excludeRequestId: request.id }, tx);
    await retrySystemTaskInTransaction(tx, task);
    await tx.update(identityAccessRequests).set({ provisionStatus: 'pending', failureReason: null }).where(where);
  });
  return formatAccessRequest(requireRow(await db.query.identityAccessRequests.findFirst({ where: and(eq(identityAccessRequests.id, id), tenantCondition(identityAccessRequests, caller)), with: { applicant: true, target: true, items: true } }), '权限申请不存在'));
}

/** 实际鉴权依据时间窗口；该任务维护展示状态、通知和跨节点刷新。 */
export async function runAccessGrantLifecycle(): Promise<string> {
  const now = new Date();
  let changed = 0;
  const affectedUsers = new Set<number>();
  while (true) {
    const due = await db.select({ id: identityAccessGrantItems.id, grantId: identityAccessGrants.id, userId: identityAccessGrants.userId, tenantId: identityAccessGrants.tenantId }).from(identityAccessGrantItems)
      .innerJoin(identityAccessGrants, eq(identityAccessGrants.id, identityAccessGrantItems.grantId))
      .where(and(inArray(identityAccessGrants.status, ['scheduled', 'active']), inArray(identityAccessGrantItems.status, ['scheduled', 'active']), or(lte(identityAccessGrantItems.expiresAt, now), and(eq(identityAccessGrantItems.status, 'scheduled'), lte(identityAccessGrantItems.startsAt, now)))))
      .orderBy(asc(identityAccessGrantItems.id)).limit(200);
    if (!due.length) break;
    const grantIds = [...new Set(due.map(item => item.grantId))].sort((a, b) => a - b);
    const itemIds = due.map(item => item.id);
    await db.transaction(async tx => {
      await tx.select({ id: identityAccessGrants.id }).from(identityAccessGrants).where(inArray(identityAccessGrants.id, grantIds)).orderBy(asc(identityAccessGrants.id)).for('update');
      await tx.update(identityAccessGrantItems).set({ status: 'active' }).where(and(inArray(identityAccessGrantItems.id, itemIds), eq(identityAccessGrantItems.status, 'scheduled'), lte(identityAccessGrantItems.startsAt, now), or(isNull(identityAccessGrantItems.expiresAt), gt(identityAccessGrantItems.expiresAt, now))));
      await tx.update(identityAccessGrantItems).set({ status: 'expired' }).where(and(inArray(identityAccessGrantItems.id, itemIds), inArray(identityAccessGrantItems.status, ['scheduled', 'active']), lte(identityAccessGrantItems.expiresAt, now)));
      for (const grantId of grantIds) await refreshAccessGrantHeader(tx, grantId, due.find(item => item.grantId === grantId)!.tenantId);
    });
    for (const item of due) affectedUsers.add(item.userId);
    changed += due.length;
  }
  await Promise.all([...affectedUsers].map(userId => notifyUserPermissionsChanged(userId)));
  const expired = await db.query.identityAccessGrants.findMany({ where: and(eq(identityAccessGrants.status, 'expired'), isNull(identityAccessGrants.expiredNotifiedAt)), columns: { id: true, userId: true, tenantId: true }, limit: 200 });
  const expiring = await db.query.identityAccessGrants.findMany({ where: and(eq(identityAccessGrants.status, 'active'), isNull(identityAccessGrants.expiringNotifiedAt), gt(identityAccessGrants.expiresAt, now), lte(identityAccessGrants.expiresAt, new Date(now.getTime() + 15 * 60_000))), columns: { id: true, userId: true, tenantId: true, expiresAt: true }, limit: 200 });
  const names = await resolveUserNames([...expired, ...expiring].map(grant => grant.userId));
  for (const grant of expired) await db.transaction(async tx => {
    const where = and(eq(identityAccessGrants.id, grant.id), exactTenantCondition(identityAccessGrants.tenantId, grant.tenantId));
    const [current] = await tx.select().from(identityAccessGrants).where(where).for('update').limit(1);
    if (!current || current.status !== 'expired' || current.expiredNotifiedAt) return;
    await notifyWithin(tx, 'identity.access.expired', { recipients: [{ type: 'user', id: grant.userId }], vars: { grantId: grant.id, targetName: names.get(grant.userId) ?? `用户 ${grant.userId}` }, tenantId: grant.tenantId, link: '/workflow/launchpad', dedupeKey: `identity-access-expired:${grant.id}` });
    await tx.update(identityAccessGrants).set({ expiredNotifiedAt: now }).where(where);
  });
  for (const grant of expiring) await db.transaction(async tx => {
    const where = and(eq(identityAccessGrants.id, grant.id), exactTenantCondition(identityAccessGrants.tenantId, grant.tenantId));
    const [current] = await tx.select().from(identityAccessGrants).where(where).for('update').limit(1);
    if (!current || current.status !== 'active' || current.expiringNotifiedAt || !current.expiresAt || !grant.expiresAt || current.expiresAt.getTime() !== grant.expiresAt.getTime()) return;
    await notifyWithin(tx, 'identity.access.expiring', { recipients: [{ type: 'user', id: grant.userId }], vars: { grantId: grant.id, targetName: names.get(grant.userId) ?? `用户 ${grant.userId}`, expiresAt: formatDateTime(grant.expiresAt) }, tenantId: grant.tenantId, link: '/workflow/launchpad', dedupeKey: `identity-access-expiring:${grant.id}:${formatDateTime(grant.expiresAt)}` });
    await tx.update(identityAccessGrants).set({ expiringNotifiedAt: now }).where(where);
  });
  return `维护 ${changed} 个授权项，刷新 ${affectedUsers.size} 个用户`;
}
