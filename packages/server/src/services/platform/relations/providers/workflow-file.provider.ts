import type { DbExecutor } from '../../../../db/types';
import { and, desc, eq, exists, isNull, lt, or, sql } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { EntityRelationPage } from '@zenith/shared/platform';
import { asyncTasks, driveNodes, driveSpaces, wikiDocs, wikiSpaces, workflowInstances, workflowTasks } from '../../../../db/schema';
import { hasPermission, runWithCurrentUser } from '../../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { loadDriveSubjects, visibleNodeCondition } from '../../../drive/drive-access.service';
import { wikiDocStatusVisibilityCondition, wikiSpaceAccessCondition } from '../../../wiki/access';
import { resolveAsyncTaskAccessScope } from '../../../tasks/async-tasks.service';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor } from '../cursor';
import { relationPage as page } from '../page';
import { relationSummaryQuery } from '../summary-query';

const WORKFLOW_PERMISSIONS = ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] as const;
type RelationInput = Parameters<RelationProvider['list']>[1];
const emptyPage = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });

function parseId(key: string): number | null {
  const id = Number(key);
  return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

/** Match instance-detail participant rules without fetching form snapshots; ancestors remain tenant-bound. */
export async function workflowVisibility(access: { user: RelationAccessContext['user']; db: DbExecutor }) {
  if (await hasPermission('workflow:instance:monitor')) return undefined;
  return or(
    eq(workflowInstances.initiatorId, access.user.userId),
    exists(access.db.select({ id: workflowTasks.id }).from(workflowTasks).where(and(
      eq(workflowTasks.instanceId, workflowInstances.id), eq(workflowTasks.assigneeId, access.user.userId),
    )).limit(1)),
    sql`exists (
      with recursive ancestors as (
        select parent.id, parent.initiator_id, parent.parent_instance_id, 1 as depth
        from workflow_instances parent
        where parent.id = ${workflowInstances.parentInstanceId}
          and parent.tenant_id is not distinct from ${workflowInstances.tenantId}
        union all
        select parent.id, parent.initiator_id, parent.parent_instance_id, ancestors.depth + 1
        from workflow_instances parent join ancestors on parent.id = ancestors.parent_instance_id
        where ancestors.depth < 10
          and parent.tenant_id is not distinct from ${workflowInstances.tenantId}
      ) select 1 from ancestors where initiator_id = ${access.user.userId}
    )`,
  );
}

/** Running instances need attention only when a real pending approval task exists. */
export function workflowInstanceAttention(access: RelationAccessContext) {
  return and(eq(workflowInstances.status, 'running'), exists(access.db.select({ id: workflowTasks.id }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, workflowInstances.id), eq(workflowTasks.status, 'pending')))));
}

async function workflowTasksWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  const id = parseId(anchor.ref.key);
  return buildWhere(id == null ? sql`false` : eq(workflowInstances.id, id), exactTenantCondition(workflowInstances.tenantId, anchor.tenantId),
    tenantCondition(workflowInstances, access.user), await workflowVisibility(access));
}

async function workflowInstancesWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext, relation: 'children' | 'instance') {
  const id = relation === 'children' ? parseId(anchor.ref.key) : anchor.metadata?.instanceId;
  return buildWhere(typeof id !== 'number' ? sql`false` : relation === 'children' ? eq(workflowInstances.parentInstanceId, id) : eq(workflowInstances.id, id),
    exactTenantCondition(workflowInstances.tenantId, anchor.tenantId), tenantCondition(workflowInstances, access.user), await workflowVisibility(access));
}

async function workflowInstanceSummary(anchor: VisibleEntityAnchor, access: RelationAccessContext, relation: 'children' | 'instance') {
  const visible = await workflowInstancesWhere(anchor, access, relation);
  return relationSummaryQuery(access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(visible),
    access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(buildWhere(visible, workflowInstanceAttention(access))));
}

async function resolveWorkflowInstance(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'workflow.instance' || !(await hasPermission(...WORKFLOW_PERMISSIONS))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const [row] = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, tenantId: workflowInstances.tenantId, bizType: workflowInstances.bizType, bizId: workflowInstances.bizId })
      .from(workflowInstances).where(buildWhere(eq(workflowInstances.id, id), tenantCondition(workflowInstances, access.user), await workflowVisibility(access))).limit(1);
    return row ? { ref: { type: 'workflow.instance', key: String(row.id) }, title: row.title, tenantId: row.tenantId, metadata: { bizType: row.bizType, bizId: row.bizId } } : null;
  });
}

async function resolveWorkflowTask(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'workflow.task' || !(await hasPermission(...WORKFLOW_PERMISSIONS))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const [row] = await access.db.select({ id: workflowTasks.id, name: workflowTasks.nodeName, instanceId: workflowInstances.id, tenantId: workflowInstances.tenantId })
      .from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(buildWhere(eq(workflowTasks.id, id), tenantCondition(workflowInstances, access.user), await workflowVisibility(access))).limit(1);
    return row ? { ref: { type: 'workflow.task', key: String(row.id) }, title: row.name, tenantId: row.tenantId, metadata: { instanceId: row.instanceId } } : null;
  });
}

async function resolveDriveFile(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'drive.file' || !(await hasPermission('drive:node:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const subjects = await loadDriveSubjects();
    const [row] = await access.db.select({ id: driveNodes.id, name: driveNodes.name, spaceId: driveNodes.spaceId, parentId: driveNodes.parentId, tenantId: driveNodes.tenantId })
      .from(driveNodes).innerJoin(driveSpaces, eq(driveNodes.spaceId, driveSpaces.id))
      .where(buildWhere(eq(driveNodes.id, id), isNull(driveNodes.deletedAt), tenantCondition(driveNodes, access.user),
        sql`${driveSpaces.tenantId} is not distinct from ${driveNodes.tenantId}`, visibleNodeCondition(subjects))).limit(1);
    return row ? { ref: { type: 'drive.file', key: String(row.id) }, title: row.name.slice(0, 160), tenantId: row.tenantId, metadata: { spaceId: row.spaceId, parentId: row.parentId } } : null;
  });
}

async function resolveWikiDocument(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'wiki.document' || !(await hasPermission('wiki:doc:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const [row] = await access.db.select({ id: wikiDocs.id, title: wikiDocs.title, spaceId: wikiDocs.spaceId, parentId: wikiDocs.parentId, tenantId: wikiDocs.tenantId })
      .from(wikiDocs).innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
      .where(buildWhere(eq(wikiDocs.id, id), isNull(wikiDocs.deletedAt), tenantCondition(wikiDocs, access.user),
        sql`${wikiSpaces.tenantId} is not distinct from ${wikiDocs.tenantId}`, wikiSpaceAccessCondition(), wikiDocStatusVisibilityCondition())).limit(1);
    return row ? { ref: { type: 'wiki.document', key: String(row.id) }, title: row.title.slice(0, 160), tenantId: row.tenantId, metadata: { spaceId: row.spaceId, parentId: row.parentId } } : null;
  });
}

async function resolveAsyncTask(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'tasks.async') return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const scope = await resolveAsyncTaskAccessScope();
    const [row] = await access.db.select({ id: asyncTasks.id, title: asyncTasks.title, tenantId: asyncTasks.tenantId })
      .from(asyncTasks).where(buildWhere(eq(asyncTasks.id, id), tenantCondition(asyncTasks, access.user),
        scope.global ? undefined : eq(asyncTasks.createdBy, scope.userId))).limit(1);
    return row ? { ref: { type: 'tasks.async', key: String(row.id) }, title: row.title, tenantId: row.tenantId } : null;
  });
}

export const workflowInstanceTasksProvider: RelationProvider = {
  sourceType: 'workflow.instance', key: 'workflow.instance.approval-tasks', permissions: WORKFLOW_PERMISSIONS,
  descriptor: { key: 'workflow.instance.approval-tasks', labelKey: 'relation.workflow.instance.approval-tasks', targetTypes: ['workflow.task'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
  async list(anchor, { cursor, limit, access }) {
    return runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission(...WORKFLOW_PERMISSIONS))) return emptyPage();
      const id = parseId(anchor.ref.key);
      if (id == null) return emptyPage();
      const beforeId = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: workflowTasks.id, name: workflowTasks.nodeName, status: workflowTasks.status, createdAt: workflowTasks.createdAt })
        .from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(await workflowTasksWhere(anchor, access), beforeId ? lt(workflowTasks.id, beforeId) : undefined)).orderBy(desc(workflowTasks.id)).limit(limit + 1);
      return page(rows, limit, (row) => ({ ref: { type: 'workflow.task', key: String(row.id) }, relationKey: 'workflow.instance.approval-tasks', title: row.name, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities: { view: true, open: true } }));
    });
  },
  async prepareSummaryQuery(anchor, { access }) {
    const visible = await workflowTasksWhere(anchor, access);
    return relationSummaryQuery(access.db.select({ id: workflowTasks.id }).from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id)).where(visible),
      access.db.select({ id: workflowTasks.id }).from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(visible, eq(workflowTasks.status, 'pending'), eq(workflowInstances.status, 'running'))));
  },
};

async function listWorkflowInstances(anchor: VisibleEntityAnchor, { cursor, limit, access }: RelationInput, relation: 'children' | 'instance'): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission(...WORKFLOW_PERMISSIONS))) return emptyPage();
    const id = relation === 'children' ? parseId(anchor.ref.key) : anchor.metadata?.instanceId;
    if (typeof id !== 'number') return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, serialNo: workflowInstances.serialNo, status: workflowInstances.status, createdAt: workflowInstances.createdAt })
      .from(workflowInstances).where(buildWhere(await workflowInstancesWhere(anchor, access, relation),
        beforeId ? lt(workflowInstances.id, beforeId) : undefined,
      )).orderBy(desc(workflowInstances.id)).limit(limit + 1);
    return page(rows, limit, (row) => ({ ref: { type: 'workflow.instance', key: String(row.id) }, relationKey: `${anchor.ref.type}.${relation}`, title: row.title, subtitle: row.serialNo, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities: { view: true, open: true } }));
  });
}

export const workflowInstanceChildrenProvider: RelationProvider = {
  sourceType: 'workflow.instance', key: 'workflow.instance.children', permissions: WORKFLOW_PERMISSIONS,
  descriptor: { key: 'workflow.instance.children', labelKey: 'relation.workflow.instance.children', targetTypes: ['workflow.instance'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
  list: (anchor, input) => listWorkflowInstances(anchor, input, 'children'),
  prepareSummaryQuery: (anchor, { access }) => workflowInstanceSummary(anchor, access, 'children'),
};
export const workflowTaskInstanceProvider: RelationProvider = {
  sourceType: 'workflow.task', key: 'workflow.task.instance', permissions: WORKFLOW_PERMISSIONS,
  descriptor: { key: 'workflow.task.instance', labelKey: 'relation.workflow.task.instance', targetTypes: ['workflow.instance'], kind: 'direct', cardinality: 'one', capabilities: { view: true, open: true } },
  list: (anchor, input) => listWorkflowInstances(anchor, input, 'instance'),
  prepareSummaryQuery: (anchor, { access }) => workflowInstanceSummary(anchor, access, 'instance'),
};

async function listDriveNodes(anchor: VisibleEntityAnchor, { cursor, limit, access }: RelationInput, direction: 'children' | 'parent'): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('drive:node:list'))) return emptyPage();
    const id = direction === 'children' ? parseId(anchor.ref.key) : anchor.metadata?.parentId;
    const spaceId = anchor.metadata?.spaceId;
    if (typeof id !== 'number' || typeof spaceId !== 'number') return emptyPage();
    const subjects = await loadDriveSubjects();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: driveNodes.id, name: driveNodes.name, type: driveNodes.type, updatedAt: driveNodes.updatedAt })
      .from(driveNodes).innerJoin(driveSpaces, eq(driveNodes.spaceId, driveSpaces.id))
      .where(buildWhere(direction === 'children' ? eq(driveNodes.parentId, id) : eq(driveNodes.id, id),
        eq(driveNodes.spaceId, spaceId), isNull(driveNodes.deletedAt), exactTenantCondition(driveNodes.tenantId, anchor.tenantId),
        exactTenantCondition(driveSpaces.tenantId, anchor.tenantId), tenantCondition(driveNodes, access.user), visibleNodeCondition(subjects),
        beforeId ? lt(driveNodes.id, beforeId) : undefined)).orderBy(desc(driveNodes.id)).limit(limit + 1);
    return page(rows, limit, (row) => ({ ref: { type: 'drive.file', key: String(row.id) }, relationKey: `drive.file.${direction}`, title: row.name.slice(0, 160), subtitle: row.type, occurredAt: row.updatedAt.toISOString(), capabilities: { view: true, open: true } }));
  });
}

function driveProvider(direction: 'children' | 'parent'): RelationProvider {
  const key = `drive.file.${direction}`;
  return { sourceType: 'drive.file', key, permissions: ['drive:node:list'], descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: ['drive.file'], kind: 'direct', cardinality: direction === 'parent' ? 'one' : 'many', capabilities: { view: true, open: true },
  }, list: (anchor, input) => listDriveNodes(anchor, input, direction) };
}

async function listWikiDocuments(anchor: VisibleEntityAnchor, { cursor, limit, access }: RelationInput, direction: 'children' | 'parent'): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('wiki:doc:list'))) return emptyPage();
    const id = direction === 'children' ? parseId(anchor.ref.key) : anchor.metadata?.parentId;
    const spaceId = anchor.metadata?.spaceId;
    if (typeof id !== 'number' || typeof spaceId !== 'number') return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: wikiDocs.id, title: wikiDocs.title, status: wikiDocs.status, updatedAt: wikiDocs.updatedAt })
      .from(wikiDocs).innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
      .where(buildWhere(direction === 'children' ? eq(wikiDocs.parentId, id) : eq(wikiDocs.id, id),
        eq(wikiDocs.spaceId, spaceId), isNull(wikiDocs.deletedAt), eq(wikiDocs.isArchived, false),
        exactTenantCondition(wikiDocs.tenantId, anchor.tenantId), exactTenantCondition(wikiSpaces.tenantId, anchor.tenantId), tenantCondition(wikiDocs, access.user),
        wikiSpaceAccessCondition(), wikiDocStatusVisibilityCondition(), beforeId ? lt(wikiDocs.id, beforeId) : undefined)).orderBy(desc(wikiDocs.id)).limit(limit + 1);
    return page(rows, limit, (row) => ({ ref: { type: 'wiki.document', key: String(row.id) }, relationKey: `wiki.document.${direction}`, title: row.title.slice(0, 160), status: row.status, occurredAt: row.updatedAt.toISOString(), capabilities: { view: true, open: true } }));
  });
}

function wikiProvider(direction: 'children' | 'parent'): RelationProvider {
  const key = `wiki.document.${direction}`;
  return { sourceType: 'wiki.document', key, permissions: ['wiki:doc:list'], descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: ['wiki.document'], kind: 'direct', cardinality: direction === 'parent' ? 'one' : 'many', capabilities: { view: true, open: true },
  }, list: (anchor, input) => listWikiDocuments(anchor, input, direction) };
}

export const workflowFileAnchorResolvers: readonly EntityAnchorResolver[] = [
  { type: 'workflow.instance', resolve: resolveWorkflowInstance }, { type: 'workflow.task', resolve: resolveWorkflowTask },
  { type: 'drive.file', resolve: resolveDriveFile }, { type: 'wiki.document', resolve: resolveWikiDocument }, { type: 'tasks.async', resolve: resolveAsyncTask },
];
export const workflowFileRelationProviders: readonly RelationProvider[] = [
  workflowInstanceTasksProvider, workflowInstanceChildrenProvider, workflowTaskInstanceProvider,
  driveProvider('parent'), driveProvider('children'), wikiProvider('parent'), wikiProvider('children'),
];
