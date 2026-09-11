import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { DriveActivityAction, DriveNodeProfile, UpdateDriveNodeProfileInput } from '@zenith/shared/drive';
import { driveCollaborationContract, driveRoleAtLeast } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveActivities, driveNodeProfiles, driveNodes, driveNodeSubscriptions, users, type DriveNodeRow } from '../../db/schema';
import { currentUserId } from '../../lib/context';
import { buildListResult } from '../../lib/list-query';
import { exactTenantCondition } from '../../lib/tenant';
import { mapWithConcurrency } from '../../lib/concurrency';
import { registerSystemRecurringJob } from '../../lib/pg-boss-scheduler';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { ensureNodeRole, ensureSpaceRole, loadDriveSubjects, loadDriveSubjectsForUser, resolveNodeRoles, visibleNodeCondition } from './drive-access.service';
import { ensureDriveNodeExists } from './drive-nodes.service';
import { logDriveActivity, mapDriveActivity } from './drive-activity.service';
import { resolveUserNames } from './drive-common';
import { ensureDriveSpaceExists } from './drive-spaces.service';
import { reportOrphanDriveSpaces } from './drive-handoff.service';

export async function getDriveNodeProfile(nodeId: number): Promise<DriveNodeProfile> {
  const node = await ensureDriveNodeExists(nodeId, { allowDeleted: true });
  await ensureNodeRole(node, 'viewer');
  const [profile] = await db.select().from(driveNodeProfiles).where(eq(driveNodeProfiles.nodeId, nodeId));
  return { nodeId, description: profile?.description ?? null, metadata: profile?.metadata ?? {} };
}

export async function saveDriveNodeProfile(nodeId: number, data: UpdateDriveNodeProfileInput): Promise<DriveNodeProfile> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'editor');
  return db.transaction(async (tx) => {
    const [profile] = await tx.insert(driveNodeProfiles).values({
      nodeId, description: data.description ?? null, metadata: data.metadata ?? {},
    }).onConflictDoUpdate({ target: driveNodeProfiles.nodeId, set: data }).returning();
    await logDriveActivity({
      spaceId: node.spaceId, nodeId, nodeName: node.name, nodeType: node.type,
      action: 'metadata_change', detail: { changed: 'profile' },
    }, tx);
    return { nodeId, description: profile.description, metadata: profile.metadata };
  });
}

export async function getDriveSubscription(nodeId: number): Promise<boolean> {
  await ensureNodeRole(await ensureDriveNodeExists(nodeId), 'viewer');
  return await db.$count(driveNodeSubscriptions, and(eq(driveNodeSubscriptions.nodeId, nodeId), eq(driveNodeSubscriptions.userId, currentUserId()))) > 0;
}

async function latestActivityId(): Promise<number> {
  const [row] = await db.select({ id: sql<number>`coalesce(max(${driveActivities.id}), 0)::integer` }).from(driveActivities);
  return row.id;
}

export async function setDriveSubscription(nodeId: number, subscribed: boolean): Promise<boolean> {
  await ensureNodeRole(await ensureDriveNodeExists(nodeId), 'viewer');
  const userId = currentUserId();
  if (subscribed) {
    await db.insert(driveNodeSubscriptions).values({ nodeId, userId, lastActivityId: await latestActivityId() }).onConflictDoNothing();
  } else {
    await db.delete(driveNodeSubscriptions).where(and(eq(driveNodeSubscriptions.nodeId, nodeId), eq(driveNodeSubscriptions.userId, userId)));
  }
  return subscribed;
}

export async function listDriveSpaceActivities(spaceId: number, query: QueryOutputOf<typeof driveCollaborationContract.spaceActivities>) {
  const space = await ensureDriveSpaceExists(spaceId);
  const role = await ensureSpaceRole(space, 'viewer');
  const subjects = await loadDriveSubjects();
  const visibleIds = db.select({ id: driveNodes.id }).from(driveNodes).where(visibleNodeCondition(subjects));
  const where = buildWhere(
    eq(driveActivities.spaceId, spaceId),
    role === 'manager' ? undefined : inArray(driveActivities.nodeId, visibleIds),
    query.action ? eq(driveActivities.action, query.action) : undefined,
    keywordCondition(query.keyword, [driveActivities.nodeName], 'ilike'),
    ...dateRangeConditions(driveActivities.createdAt, query.startTime, query.endTime),
  );
  const { page, pageSize } = query;
  return buildListResult({
    page, pageSize, count: () => db.$count(driveActivities, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveActivities).where(where).orderBy(desc(driveActivities.createdAt), desc(driveActivities.id)).$dynamic(), page, pageSize);
      const names = await resolveUserNames(rows.map((row) => row.actorId));
      return rows.map((row) => mapDriveActivity(row, names, new Map([[spaceId, space.name]])));
    },
  });
}

const WATCHED_ACTIONS: DriveActivityAction[] = ['upload', 'new_version', 'rename', 'move', 'copy', 'delete', 'restore', 'version_restore', 'comment', 'tag', 'metadata_change'];

/** Subscription bookmark and notification outbox advance atomically, including on multi-instance retries. */
export async function dispatchDriveSubscriptionChanges(): Promise<number> {
  const head = await latestActivityId();
  const subscriptions = await db.select().from(driveNodeSubscriptions).where(lt(driveNodeSubscriptions.lastActivityId, head))
    .orderBy(asc(driveNodeSubscriptions.lastActivityId)).limit(100);
  const userSubjects = new Map<number, ReturnType<typeof loadDriveSubjectsForUser>>();
  let delivered = 0;
  await mapWithConcurrency(subscriptions, 5, async (subscription) => {
    const [root] = await db.select().from(driveNodes).where(eq(driveNodes.id, subscription.nodeId));
    if (!root) return;
    let loading = userSubjects.get(subscription.userId);
    if (!loading) { loading = loadDriveSubjectsForUser(subscription.userId); userSubjects.set(subscription.userId, loading); }
    const subjects = await loading;
    const rootRole = (await resolveNodeRoles([root], subjects)).get(root.id)?.role;
    const nodesInScope = db.select({ id: driveNodes.id }).from(driveNodes).where(and(
      eq(driveNodes.spaceId, root.spaceId),
      root.type === 'folder' ? or(eq(driveNodes.id, root.id), sql`${driveNodes.ancestorIds} @> ARRAY[${root.id}]::integer[]`) : eq(driveNodes.id, root.id),
      visibleNodeCondition(subjects),
    ));
    const changes = driveRoleAtLeast(rootRole, 'viewer')
      ? await db.select({ id: driveActivities.id }).from(driveActivities).where(and(
        gt(driveActivities.id, subscription.lastActivityId), lte(driveActivities.id, head),
        inArray(driveActivities.nodeId, nodesInScope), inArray(driveActivities.action, WATCHED_ACTIONS),
        or(isNull(driveActivities.actorId), ne(driveActivities.actorId, subscription.userId)),
      )).orderBy(asc(driveActivities.id)).limit(50)
      : [];
    const next = changes.length === 50 ? changes.at(-1)!.id : head;
    await db.transaction(async (tx) => {
      const claimed = await tx.update(driveNodeSubscriptions).set({ lastActivityId: next }).where(and(
        eq(driveNodeSubscriptions.userId, subscription.userId), eq(driveNodeSubscriptions.nodeId, root.id),
        eq(driveNodeSubscriptions.lastActivityId, subscription.lastActivityId),
      )).returning({ nodeId: driveNodeSubscriptions.nodeId });
      if (!claimed.length || !changes.length) return;
      await notifyWithin(tx, 'drive.node.changed', {
        recipients: [{ type: 'user', id: subscription.userId }],
        vars: { nodeId: root.id, nodeName: root.name, changes: changes.length },
        tenantId: root.tenantId, link: `/drive?space=${root.spaceId}&node=${root.id}`,
        dedupeKey: `drive-watch:${subscription.userId}:${root.id}:${next}`,
      });
      delivered++;
    });
  });
  return delivered;
}

export async function registerDriveCollaborationJob(): Promise<void> {
  await registerSystemRecurringJob({
    name: 'drive-subscription-changes', title: '网盘关注变更通知', module: '企业网盘',
    cronExpression: '* * * * *', allowManualRun: true,
    run: async () => {
      const count = await dispatchDriveSubscriptionChanges();
      await reportOrphanDriveSpaces();
      return `已派发 ${count} 条变更摘要`;
    },
  });
}

export async function readableDriveCommentRecipients(node: DriveNodeRow, ids: number[]): Promise<number[]> {
  const recipients: number[] = [];
  const candidates = [...new Set(ids.filter((id) => id !== currentUserId()))];
  if (!candidates.length) return recipients;
  const eligible = await db.select({ id: users.id }).from(users).where(and(
    inArray(users.id, candidates), eq(users.status, 'enabled'), exactTenantCondition(users.tenantId, node.tenantId),
  ));
  for (const { id } of eligible) {
    const subjects = await loadDriveSubjectsForUser(id);
    const role = (await resolveNodeRoles([node], subjects)).get(node.id)?.role;
    if (driveRoleAtLeast(role, 'viewer')) recipients.push(id);
  }
  return recipients;
}
