import { anchorIdsWhere, numericAnchorResolver, parseNumericAnchorId } from '../platform/relations/anchor-batch';
import { entityRelationRecordFilters, type EntityRelationPage } from '@zenith/shared/platform';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../platform/relations/types';
import { decodeRelationCursor } from '../platform/relations/cursor';
import { relationPage as page } from '../platform/relations/page';
import { relationFilterWhere } from '../platform/relations/filters';
import { formatDateTime } from '../../lib/datetime';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { workflowInstances, workflowTasks } from '../../db/schema';
import { relationSummaryQuery } from '../platform/relations/summary-query';
import { workflowInstanceAttention, workflowVisibility } from './workflow-visibility';

type RelationInput = Parameters<RelationProvider['list']>[1];
const emptyPage = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });
const WORKFLOW_PERMISSIONS = ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] as const;

async function workflowTasksWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  const id = parseNumericAnchorId(anchor.ref.key);
  return buildWhere(id == null ? sql`false` : eq(workflowInstances.id, id), exactTenantCondition(workflowInstances.tenantId, anchor.tenantId),
    tenantCondition(workflowInstances, access.user), await workflowVisibility(access));
}

async function workflowInstancesWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext, relation: 'children' | 'instance') {
  const id = relation === 'children' ? parseNumericAnchorId(anchor.ref.key) : anchor.metadata?.instanceId;
  return buildWhere(typeof id !== 'number' ? sql`false` : relation === 'children' ? eq(workflowInstances.parentInstanceId, id) : eq(workflowInstances.id, id),
    exactTenantCondition(workflowInstances.tenantId, anchor.tenantId), tenantCondition(workflowInstances, access.user), await workflowVisibility(access));
}

async function workflowInstanceSummary(anchor: VisibleEntityAnchor, access: RelationAccessContext, relation: 'children' | 'instance') {
  const visible = await workflowInstancesWhere(anchor, access, relation);
  return relationSummaryQuery(access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(visible),
    access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(buildWhere(visible, workflowInstanceAttention(access))));
}

async function resolveWorkflowInstances(ids: number[], access: RelationAccessContext): Promise<VisibleEntityAnchor[]> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission(...WORKFLOW_PERMISSIONS))) return [];
    const rows = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, tenantId: workflowInstances.tenantId, bizType: workflowInstances.bizType, bizId: workflowInstances.bizId })
      .from(workflowInstances).where(buildWhere(anchorIdsWhere(workflowInstances.id, ids), tenantCondition(workflowInstances, access.user), await workflowVisibility(access))).limit(ids.length);
    return rows.map((row): VisibleEntityAnchor => ({ ref: { type: 'workflow.instance', key: String(row.id) }, title: row.title, tenantId: row.tenantId, metadata: { bizType: row.bizType, bizId: row.bizId } }));
  });
}

async function resolveWorkflowTasks(ids: number[], access: RelationAccessContext): Promise<VisibleEntityAnchor[]> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission(...WORKFLOW_PERMISSIONS))) return [];
    const rows = await access.db.select({ id: workflowTasks.id, name: workflowTasks.nodeName, instanceId: workflowInstances.id, tenantId: workflowInstances.tenantId })
      .from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .where(buildWhere(anchorIdsWhere(workflowTasks.id, ids), tenantCondition(workflowInstances, access.user), await workflowVisibility(access))).limit(ids.length);
    return rows.map((row): VisibleEntityAnchor => ({ ref: { type: 'workflow.task', key: String(row.id) }, title: row.name, tenantId: row.tenantId, metadata: { instanceId: row.instanceId } }));
  });
}

export const workflowInstanceTasksProvider: RelationProvider = {
  sourceType: 'workflow.instance', key: 'workflow.instance.approval-tasks', permissions: WORKFLOW_PERMISSIONS,
  descriptor: { key: 'workflow.instance.approval-tasks', labelKey: 'relation.workflow.instance.approval-tasks', targetTypes: ['workflow.task'], filters: entityRelationRecordFilters('workflow.task', true), kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
  async list(anchor, { cursor, limit, access, filters }) {
    return runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission(...WORKFLOW_PERMISSIONS))) return emptyPage();
      const id = parseNumericAnchorId(anchor.ref.key);
      if (id == null) return emptyPage();
      const beforeId = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: workflowTasks.id, name: workflowTasks.nodeName, status: workflowTasks.status, attention: sql<boolean>`coalesce(${and(eq(workflowTasks.status, 'pending'), eq(workflowInstances.status, 'running'))}, false)`, createdAt: workflowTasks.createdAt })
        .from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(await workflowTasksWhere(anchor, access), relationFilterWhere(filters, { keyword: [workflowTasks.nodeName], status: workflowTasks.status, occurredAt: workflowTasks.createdAt, attention: and(eq(workflowTasks.status, 'pending'), eq(workflowInstances.status, 'running')) }), beforeId ? lt(workflowTasks.id, beforeId) : undefined)).orderBy(desc(workflowTasks.id)).limit(limit + 1);
      return page(rows, limit, (row) => ({ ref: { type: 'workflow.task', key: String(row.id) }, relationKey: 'workflow.instance.approval-tasks', title: row.name, status: row.status, attention: row.attention, occurredAt: formatDateTime(row.createdAt), capabilities: { view: true, open: true } }));
    });
  },
  async prepareSummaryQuery(anchor, { access }) {
    const visible = await workflowTasksWhere(anchor, access);
    return relationSummaryQuery(access.db.select({ id: workflowTasks.id }).from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id)).where(visible),
      access.db.select({ id: workflowTasks.id }).from(workflowTasks).innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
        .where(buildWhere(visible, eq(workflowTasks.status, 'pending'), eq(workflowInstances.status, 'running'))));
  },
};

async function listWorkflowInstances(anchor: VisibleEntityAnchor, { cursor, limit, access, filters }: RelationInput, relation: 'children' | 'instance'): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission(...WORKFLOW_PERMISSIONS))) return emptyPage();
    const id = relation === 'children' ? parseNumericAnchorId(anchor.ref.key) : anchor.metadata?.instanceId;
    if (typeof id !== 'number') return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, serialNo: workflowInstances.serialNo, status: workflowInstances.status, attention: sql<boolean>`coalesce(${workflowInstanceAttention(access)}, false)`, createdAt: workflowInstances.createdAt })
      .from(workflowInstances).where(buildWhere(await workflowInstancesWhere(anchor, access, relation),
        relationFilterWhere(filters, { keyword: [workflowInstances.title, workflowInstances.serialNo], status: workflowInstances.status, occurredAt: workflowInstances.createdAt, attention: workflowInstanceAttention(access) }),
        beforeId ? lt(workflowInstances.id, beforeId) : undefined,
      )).orderBy(desc(workflowInstances.id)).limit(limit + 1);
    return page(rows, limit, (row) => ({ ref: { type: 'workflow.instance', key: String(row.id) }, relationKey: `${anchor.ref.type}.${relation}`, title: row.title, subtitle: row.serialNo, status: row.status, attention: row.attention, occurredAt: formatDateTime(row.createdAt), capabilities: { view: true, open: true } }));
  });
}

export const workflowInstanceChildrenProvider: RelationProvider = {
  sourceType: 'workflow.instance', key: 'workflow.instance.children', permissions: WORKFLOW_PERMISSIONS,
  descriptor: { key: 'workflow.instance.children', labelKey: 'relation.workflow.instance.children', targetTypes: ['workflow.instance'], filters: entityRelationRecordFilters('workflow.instance', true), kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
  list: (anchor, input) => listWorkflowInstances(anchor, input, 'children'),
  prepareSummaryQuery: (anchor, { access }) => workflowInstanceSummary(anchor, access, 'children'),
};
export const workflowTaskInstanceProvider: RelationProvider = {
  sourceType: 'workflow.task', key: 'workflow.task.instance', permissions: WORKFLOW_PERMISSIONS,
  descriptor: { key: 'workflow.task.instance', labelKey: 'relation.workflow.task.instance', targetTypes: ['workflow.instance'], filters: entityRelationRecordFilters('workflow.instance', true), kind: 'direct', cardinality: 'one', capabilities: { view: true, open: true } },
  list: (anchor, input) => listWorkflowInstances(anchor, input, 'instance'),
  prepareSummaryQuery: (anchor, { access }) => workflowInstanceSummary(anchor, access, 'instance'),
};

export const workflowAnchorResolvers: readonly EntityAnchorResolver[] = [
  numericAnchorResolver('workflow.instance', resolveWorkflowInstances),
  numericAnchorResolver('workflow.task', resolveWorkflowTasks),
];
export const workflowRelationProviders: readonly RelationProvider[] = [
  workflowInstanceTasksProvider, workflowInstanceChildrenProvider, workflowTaskInstanceProvider,
];
