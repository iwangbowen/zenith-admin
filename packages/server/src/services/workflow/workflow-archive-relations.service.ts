import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { WORKFLOW_BUSINESS_ENTITY_TYPES, type CanonicalEntityType, type EntityRelationItem } from '@zenith/shared/platform';
import { managedFiles, workflowInstances, workflowTasks } from '../../db/schema';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { workflowVisibility } from '../platform/relations/providers/workflow-file.provider';
import { decodeRelationCursor } from '../platform/relations/cursor';
import { assertRelationBudget } from '../platform/relations/runtime';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../platform/relations/types';
import { workflowArchiveNeedsRedaction } from './workflow-print-access';

const permissions = ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] as const;
const capabilities = { view: true, open: true };
const empty = () => ({ items: [], hasMore: false, nextCursor: null });
const columns = { id: workflowInstances.id, title: workflowInstances.title, tenantId: workflowInstances.tenantId,
  initiatorId: workflowInstances.initiatorId, archivedAt: workflowInstances.archivedAt,
  definitionSnapshot: workflowInstances.definitionSnapshot, formSnapshot: workflowInstances.formSnapshot };
const fileJoin = and(eq(workflowInstances.archiveFileId, managedFiles.id),
  sql`${managedFiles.tenantId} is not distinct from ${workflowInstances.tenantId}`,
  eq(managedFiles.visibility, 'restricted'), eq(managedFiles.gcState, 'live'),
  isNotNull(workflowInstances.archiveSha256));
function idOf(key: string) {
  const id = Number(key);
  return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : undefined;
}
async function archiveReadable(row: typeof workflowInstances.$inferSelect | {
  id: number; initiatorId: number; definitionSnapshot: typeof workflowInstances.$inferSelect['definitionSnapshot']; formSnapshot: unknown;
}, access: RelationAccessContext) {
  const tasks = await access.db.select({ nodeKey: workflowTasks.nodeKey, assigneeId: workflowTasks.assigneeId })
    .from(workflowTasks).where(and(eq(workflowTasks.instanceId, row.id), eq(workflowTasks.assigneeId, access.user.userId)));
  return !(await workflowArchiveNeedsRedaction({ ...row, tasks }, access.db));
}

/** The instance owns one immutable archive; its key never exposes a generic storage URL. */
export const workflowArchiveAnchorResolvers: readonly EntityAnchorResolver[] = [{ type: 'workflow.archive',
  resolve: (ref, access) => runWithCurrentUser(access.user, async () => {
    const id = idOf(ref.key);
    if (ref.type !== 'workflow.archive' || id === undefined || !(await hasPermission(...permissions))) return null;
    const [row] = await access.db.select(columns).from(workflowInstances).innerJoin(managedFiles, fileJoin)
      .where(buildWhere(eq(workflowInstances.id, id), tenantCondition(workflowInstances, access.user),
        isNotNull(workflowInstances.archivedAt), await workflowVisibility(access))).limit(1);
    if (!row || !(await archiveReadable(row, access))) return null;
    return { ref: { type: 'workflow.archive', key: String(row.id) }, title: `${row.title} · 审批归档件`, tenantId: row.tenantId };
  }),
}];

function archiveProvider(sourceType: CanonicalEntityType): RelationProvider {
  const key = `${sourceType}.archives`;
  return { sourceType, key, permissions,
    descriptor: { key, labelKey: 'relation.workflow.archives', targetTypes: ['workflow.archive'], kind: 'derived', cardinality: sourceType === 'workflow.instance' ? 'one' : 'many', capabilities },
    list: (anchor, { cursor, limit, access }) => runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission(...permissions))) return empty();
      const id = idOf(anchor.ref.key);
      const business = WORKFLOW_BUSINESS_ENTITY_TYPES.find((item) => item.entityType === sourceType);
      if (id === undefined || (sourceType !== 'workflow.instance' && !business)) return empty();
      let before = decodeRelationCursor(cursor);
      const visible: EntityRelationItem[] = [];
      let scanned = 0;
      while (visible.length <= limit) {
        assertRelationBudget(access);
        if (scanned >= 256) throw new HTTPException(503, { message: '归档关联查询超出预算，请稍后重试' });
        const rows = await access.db.select(columns).from(workflowInstances).innerJoin(managedFiles, fileJoin)
          .where(buildWhere(sourceType === 'workflow.instance' ? eq(workflowInstances.id, id)
            : and(eq(workflowInstances.bizType, business!.bizType), eq(workflowInstances.bizId, anchor.ref.key)),
          exactTenantCondition(workflowInstances.tenantId, anchor.tenantId), tenantCondition(workflowInstances, access.user),
          await workflowVisibility(access), isNotNull(workflowInstances.archivedAt), before ? lt(workflowInstances.id, before) : undefined))
          .orderBy(desc(workflowInstances.id)).limit(32);
        for (const row of rows) {
          before = row.id; scanned++; assertRelationBudget(access);
          if (!(await archiveReadable(row, access))) continue;
          visible.push({ ref: { type: 'workflow.archive', key: String(row.id) }, title: `${row.title} · 审批归档件`,
            relationKey: key, occurredAt: row.archivedAt?.toISOString(), capabilities });
          if (visible.length > limit) break;
        }
        if (rows.length < 32) break;
      }
      const items = visible.slice(0, limit), hasMore = visible.length > limit;
      return { items, hasMore, nextCursor: hasMore ? items[items.length - 1].ref.key : null };
    }),
  };
}
export const workflowArchiveRelationProviders: readonly RelationProvider[] = [
  archiveProvider('workflow.instance'), ...WORKFLOW_BUSINESS_ENTITY_TYPES.map(({ entityType }) => archiveProvider(entityType)),
  { sourceType: 'workflow.archive', key: 'workflow.archive.instance', permissions,
    descriptor: { key: 'workflow.archive.instance', labelKey: 'relation.workflow.archive.instance', targetTypes: ['workflow.instance'], kind: 'direct', cardinality: 'one', capabilities },
    list: (anchor: VisibleEntityAnchor, { access }) => runWithCurrentUser(access.user, async () => {
      const row = await workflowArchiveAnchorResolvers[0].resolve(anchor.ref, access);
      if (!row || row.tenantId !== anchor.tenantId) return empty();
      return { items: [{ ref: { type: 'workflow.instance' as const, key: row.ref.key }, relationKey: 'workflow.archive.instance', title: row.title.replace(/ · 审批归档件$/, ''), capabilities }], hasMore: false, nextCursor: null };
    }),
  },
];
