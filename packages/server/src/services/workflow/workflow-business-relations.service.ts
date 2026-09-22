import { desc, eq, lt, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { EntityRef } from '@zenith/shared/core';
import { entityRelationRecordFilters, WORKFLOW_BUSINESS_ENTITY_TYPES, type CanonicalEntityType, type EntityRelationPage, type WorkflowBusinessEntityType } from '@zenith/shared/platform';
import { bizLeaves, workflowInstances } from '../../db/schema';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { decodeRelationCursor } from '../platform/relations/cursor';
import { relationPage } from '../platform/relations/page';
import { workflowInstanceAttention, workflowVisibility } from '../platform/relations/providers/workflow-file.provider';
import { relationSummaryQuery } from '../platform/relations/summary-query';
import { relationFilterWhere, matchesRelationKeyword } from '../platform/relations/filters';
import { formatDateTime } from '../../lib/datetime';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../platform/relations/types';

const WORKFLOW_PERMISSIONS = ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] as const;
const capabilities = { view: true, open: true };
const businessTypes = WORKFLOW_BUSINESS_ENTITY_TYPES;
const businessPermissions = {
  'biz.leave': [], 'cms.content': ['cms:content:list'], 'payment.recon-adjustment': ['payment:recon:list'],
} as const satisfies Record<WorkflowBusinessEntityType, RelationProvider['allPermissions']>;

type BusinessType = (typeof businessTypes)[number];
type RelationInput = Parameters<RelationProvider['list']>[1];
export type WorkflowBusinessAnchorResolver = (
  type: CanonicalEntityType, key: string, access: RelationAccessContext,
) => Promise<VisibleEntityAnchor>;

const emptyPage = (): EntityRelationPage => ({ items: [], hasMore: false, nextCursor: null });

function parseId(key: string): number | null {
  const id = Number(key);
  return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

/** Business detail is owner-only; workflow monitor permission does not widen it. */
async function resolveBizLeave(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== 'biz.leave') return null;
  const id = parseId(ref.key);
  if (id == null) return null;
  const [row] = await access.db.select({ id: bizLeaves.id, tenantId: bizLeaves.tenantId })
    .from(bizLeaves).where(buildWhere(eq(bizLeaves.id, id), eq(bizLeaves.createdBy, access.user.userId),
      tenantCondition(bizLeaves, access.user))).limit(1);
  return row ? { ref: { type: 'biz.leave', key: String(row.id) }, title: `请假申请 #${row.id}`, tenantId: row.tenantId } : null;
}

export const workflowBusinessAnchorResolvers: readonly EntityAnchorResolver[] = [{ type: 'biz.leave', resolve: resolveBizLeave }];

async function requireMatchingAnchor(anchor: VisibleEntityAnchor, resolveAnchor: WorkflowBusinessAnchorResolver, access: RelationAccessContext) {
  const authorized = await resolveAnchor(anchor.ref.type, anchor.ref.key, access);
  if (authorized.tenantId !== anchor.tenantId || authorized.ref.type !== anchor.ref.type || authorized.ref.key !== anchor.ref.key) {
    throw new HTTPException(404, { message: '业务对象不存在或无权查看' });
  }
  return authorized;
}

/** Re-read the source identity inside the same bounded transaction, without form snapshots. */
async function readWorkflowBusiness(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  if (anchor.ref.type !== 'workflow.instance') return null;
  const id = parseId(anchor.ref.key);
  if (id == null || !(await hasPermission(...WORKFLOW_PERMISSIONS))) return null;
  const [row] = await access.db.select({ id: workflowInstances.id, bizType: workflowInstances.bizType,
    bizId: workflowInstances.bizId, tenantId: workflowInstances.tenantId }).from(workflowInstances)
    .where(buildWhere(eq(workflowInstances.id, id), exactTenantCondition(workflowInstances.tenantId, anchor.tenantId),
      tenantCondition(workflowInstances, access.user), await workflowVisibility(access))).limit(1);
  return row ?? null;
}

async function businessInstancesWhere(anchor: VisibleEntityAnchor, business: BusinessType, access: RelationAccessContext) {
  return buildWhere(eq(workflowInstances.bizType, business.bizType), eq(workflowInstances.bizId, anchor.ref.key),
    exactTenantCondition(workflowInstances.tenantId, anchor.tenantId), tenantCondition(workflowInstances, access.user), await workflowVisibility(access));
}

async function businessHistoryWhere(source: NonNullable<Awaited<ReturnType<typeof readWorkflowBusiness>>>, access: RelationAccessContext) {
  return buildWhere(eq(workflowInstances.bizType, source.bizType!), eq(workflowInstances.bizId, source.bizId!), ne(workflowInstances.id, source.id),
    exactTenantCondition(workflowInstances.tenantId, source.tenantId), tenantCondition(workflowInstances, access.user), await workflowVisibility(access));
}

async function listBusinessInstances(anchor: VisibleEntityAnchor, { cursor, limit, access, filters }: RelationInput,
  business: BusinessType, resolveAnchor: WorkflowBusinessAnchorResolver): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (anchor.ref.type !== business.entityType || !(await hasPermission(...WORKFLOW_PERMISSIONS))) return emptyPage();
    const authorized = await requireMatchingAnchor(anchor, resolveAnchor, access);
    if (parseId(authorized.ref.key) == null) return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    // A business pointer only identifies its current round. The canonical business key preserves every round.
    const rows = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, serialNo: workflowInstances.serialNo,
      status: workflowInstances.status, attention: sql<boolean>`coalesce(${workflowInstanceAttention(access)}, false)`, createdAt: workflowInstances.createdAt }).from(workflowInstances)
      .where(buildWhere(await businessInstancesWhere(authorized, business, access), relationFilterWhere(filters, { keyword: [workflowInstances.title, workflowInstances.serialNo], status: workflowInstances.status, occurredAt: workflowInstances.createdAt, attention: workflowInstanceAttention(access) }), beforeId ? lt(workflowInstances.id, beforeId) : undefined))
      .orderBy(desc(workflowInstances.id)).limit(limit + 1);
    return relationPage(rows, limit, (row) => ({ ref: { type: 'workflow.instance', key: String(row.id) },
      relationKey: `${business.entityType}.workflow-instances`, title: row.title, subtitle: row.serialNo,
      status: row.status, attention: row.attention, occurredAt: formatDateTime(row.createdAt), capabilities }));
  });
}

function businessProvider(business: BusinessType, resolveAnchor: WorkflowBusinessAnchorResolver): RelationProvider {
  const key = `${business.entityType}.workflow-instances`;
  return { sourceType: business.entityType, key, permissions: WORKFLOW_PERMISSIONS,
    descriptor: { key, labelKey: 'relation.business.workflow-instances', targetTypes: ['workflow.instance'], filters: entityRelationRecordFilters('workflow.instance', true), kind: 'direct', cardinality: 'many', capabilities },
    list: (anchor, input) => listBusinessInstances(anchor, input, business, resolveAnchor),
    async prepareSummaryQuery(anchor, { access }) {
      const authorized = await requireMatchingAnchor(anchor, resolveAnchor, access);
      if (parseId(authorized.ref.key) == null) return sql<'empty'>`'empty'`;
      const visible = await businessInstancesWhere(authorized, business, access);
      return relationSummaryQuery(access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(visible),
        access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(buildWhere(visible, workflowInstanceAttention(access))));
    } };
}

function originatingBusinessProvider(business: BusinessType, resolveAnchor: WorkflowBusinessAnchorResolver): RelationProvider {
  const key = `workflow.instance.${business.reverseRelation}`;
  return { sourceType: 'workflow.instance', key, permissions: WORKFLOW_PERMISSIONS, allPermissions: businessPermissions[business.entityType],
    appliesTo: (anchor) => anchor.metadata?.bizType === business.bizType && Boolean(anchor.metadata.bizId),
    descriptor: { key, labelKey: `relation.${key}`, targetTypes: [business.entityType], filters: { keyword: true }, kind: 'direct', cardinality: 'one', capabilities },
    async list(anchor, { cursor, access, filters }) {
      return runWithCurrentUser(access.user, async () => {
        const beforeId = decodeRelationCursor(cursor);
        const source = await readWorkflowBusiness(anchor, access);
        if (!source || source.bizType !== business.bizType || source.bizId == null) return emptyPage();
        const id = parseId(source.bizId);
        if (id == null || (beforeId !== undefined && id >= beforeId)) return emptyPage();
        try {
          const target = await resolveAnchor(business.entityType, source.bizId, access);
          if (target.tenantId !== source.tenantId || target.ref.type !== business.entityType || target.ref.key !== source.bizId) return emptyPage();
          if (!matchesRelationKeyword(filters?.keyword, target.title, target.ref.key)) return emptyPage();
          return { items: [{ ref: target.ref, relationKey: key, title: target.title, capabilities }], hasMore: false, nextCursor: null };
        } catch (error) {
          if (error instanceof HTTPException && error.status === 404) return emptyPage();
          throw error;
        }
      });
    } };
}

export const workflowBusinessHistoryProvider: RelationProvider = {
  sourceType: 'workflow.instance', key: 'workflow.instance.business-history', permissions: WORKFLOW_PERMISSIONS,
  appliesTo: (anchor) => Boolean(anchor.metadata?.bizId) && businessTypes.some((business) => business.bizType === anchor.metadata?.bizType),
  descriptor: { key: 'workflow.instance.business-history', labelKey: 'relation.workflow.instance.business-history',
    targetTypes: ['workflow.instance'], filters: entityRelationRecordFilters('workflow.instance', true), kind: 'derived', cardinality: 'many', capabilities },
  async list(anchor, { cursor, limit, access, filters }) {
    return runWithCurrentUser(access.user, async () => {
      const source = await readWorkflowBusiness(anchor, access);
      if (!source?.bizType || !source.bizId || !businessTypes.some((business) => business.bizType === source.bizType)) return emptyPage();
      const beforeId = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: workflowInstances.id, title: workflowInstances.title, serialNo: workflowInstances.serialNo,
        status: workflowInstances.status, attention: sql<boolean>`coalesce(${workflowInstanceAttention(access)}, false)`, createdAt: workflowInstances.createdAt }).from(workflowInstances)
        .where(buildWhere(await businessHistoryWhere(source, access), relationFilterWhere(filters, { keyword: [workflowInstances.title, workflowInstances.serialNo], status: workflowInstances.status, occurredAt: workflowInstances.createdAt, attention: workflowInstanceAttention(access) }), beforeId ? lt(workflowInstances.id, beforeId) : undefined))
        .orderBy(desc(workflowInstances.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'workflow.instance', key: String(row.id) }, relationKey: 'workflow.instance.business-history',
        title: row.title, subtitle: row.serialNo, status: row.status, attention: row.attention, occurredAt: formatDateTime(row.createdAt), capabilities }));
    });
  },
  async prepareSummaryQuery(anchor, { access }) {
    const source = await readWorkflowBusiness(anchor, access);
    if (!source?.bizType || !source.bizId || !businessTypes.some((business) => business.bizType === source.bizType)) return sql<'empty'>`'empty'`;
    const visible = await businessHistoryWhere(source, access);
    return relationSummaryQuery(access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(visible),
      access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(buildWhere(visible, workflowInstanceAttention(access))));
  },
};

/** The registry injects target authorization, keeping workflow independent of business service imports. */
export function createWorkflowBusinessRelationProviders(resolveAnchor: WorkflowBusinessAnchorResolver): readonly RelationProvider[] {
  return [...businessTypes.map((business) => businessProvider(business, resolveAnchor)),
    ...businessTypes.map((business) => originatingBusinessProvider(business, resolveAnchor)), workflowBusinessHistoryProvider];
}
