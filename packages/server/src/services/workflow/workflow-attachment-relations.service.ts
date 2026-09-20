import { desc, eq, lt, lte } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { WORKFLOW_BUSINESS_ENTITY_TYPES, type CanonicalEntityType, type EntityRelationItem } from '@zenith/shared/platform';
import { workflowInstances } from '../../db/schema';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { workflowVisibility } from '../platform/relations/providers/workflow-file.provider';
import { decodeRelationCursor } from '../platform/relations/cursor';
import { relationPage } from '../platform/relations/page';
import { assertRelationBudget } from '../platform/relations/runtime';
import type { EntityAnchorResolver, RelationProvider } from '../platform/relations/types';
import { getWorkflowAttachmentSummary, listWorkflowAttachmentSummaries } from './workflow-attachments.service';

const permissions = ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] as const;
const capabilities = { view: true, open: true };
const empty = () => ({ items: [], hasMore: false, nextCursor: null });
type AttachmentSummary = Awaited<ReturnType<typeof getWorkflowAttachmentSummary>>;
function idOf(key: string) { const id = Number(key); return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : undefined; }
function item(row: AttachmentSummary, key: string): EntityRelationItem {
  return { ref: { type: 'workflow.attachment', key: String(row.id) }, title: row.name, relationKey: key,
    subtitle: ({ form: '申请表单附件', task: '审批节点附件', comment: '流程沟通附件' })[row.source],
    occurredAt: row.createdAt.toISOString(), capabilities };
}
export const workflowAttachmentAnchorResolvers: readonly EntityAnchorResolver[] = [{ type: 'workflow.attachment',
  resolve: (ref, access) => runWithCurrentUser(access.user, async () => {
    const id = idOf(ref.key);
    if (ref.type !== 'workflow.attachment' || id === undefined || !(await hasPermission(...permissions))) return null;
    try {
      const row = await getWorkflowAttachmentSummary(id, access.db);
      return { ref: { type: 'workflow.attachment', key: String(row.id) }, title: row.name, tenantId: row.tenantId,
        metadata: { instanceId: row.instanceId, taskId: row.taskId } };
    } catch (error) { if (error instanceof HTTPException && error.status === 404) return null; throw error; }
  }),
}];

function instanceAttachments(sourceType: 'workflow.instance' | 'workflow.task'): RelationProvider {
  const key = `${sourceType}.attachments`;
  return { sourceType, key, permissions,
    descriptor: { key, labelKey: 'relation.workflow.attachments', targetTypes: ['workflow.attachment'], kind: 'direct', cardinality: 'many', capabilities },
    list: (anchor, { cursor, limit, access }) => runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission(...permissions))) return empty();
      const instanceId = sourceType === 'workflow.instance' ? idOf(anchor.ref.key) : anchor.metadata?.instanceId;
      if (typeof instanceId !== 'number') return empty();
      const rows = await listWorkflowAttachmentSummaries(instanceId, { limit: limit + 1, beforeId: decodeRelationCursor(cursor),
        ...(sourceType === 'workflow.task' ? { taskId: idOf(anchor.ref.key) } : {}) }, access.db);
      return relationPage(rows.filter((row) => row.tenantId === anchor.tenantId), limit, (row) => item(row, key));
    }),
  };
}

/** Lexicographic descending round/file cursor keeps all rounds reachable without loading their files at once. */
function readBusinessCursor(value?: string): [number, number] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every((part) => typeof part === 'number' && idOf(String(part)) !== undefined)) throw new Error();
    return [parsed[0], parsed[1]];
  } catch { throw new HTTPException(400, { message: '附件分页游标无效' }); }
}
function businessAttachments(business: (typeof WORKFLOW_BUSINESS_ENTITY_TYPES)[number]): RelationProvider {
  const sourceType = business.entityType, key = `${sourceType}.attachments`;
  return { sourceType, key, permissions,
    descriptor: { key, labelKey: 'relation.workflow.attachments', targetTypes: ['workflow.attachment'], kind: 'derived', cardinality: 'many', capabilities },
    list: (anchor, { cursor, limit, access }) => runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission(...permissions))) return empty();
      const position = readBusinessCursor(cursor);
      let beforeInstance: number | undefined;
      const visible: Array<{ item: EntityRelationItem; cursor: [number, number] }> = [];
      let scanned = 0;
      while (visible.length <= limit) {
        assertRelationBudget(access);
        if (scanned >= 128) throw new HTTPException(503, { message: '附件关联查询超出预算，请稍后重试' });
        const rounds = await access.db.select({ id: workflowInstances.id }).from(workflowInstances).where(buildWhere(
          eq(workflowInstances.bizType, business.bizType), eq(workflowInstances.bizId, anchor.ref.key),
          exactTenantCondition(workflowInstances.tenantId, anchor.tenantId), tenantCondition(workflowInstances, access.user),
          await workflowVisibility(access), beforeInstance ? lt(workflowInstances.id, beforeInstance)
            : position ? lte(workflowInstances.id, position[0]) : undefined,
        )).orderBy(desc(workflowInstances.id)).limit(16);
        for (const round of rounds) {
          assertRelationBudget(access); scanned++; beforeInstance = round.id;
          const files = await listWorkflowAttachmentSummaries(round.id, { limit: limit + 1 - visible.length,
            beforeId: position?.[0] === round.id ? position[1] : undefined }, access.db);
          for (const file of files) visible.push({ item: item(file, key), cursor: [round.id, file.id] });
          if (visible.length > limit) break;
        }
        if (rounds.length < 16) break;
      }
      const shown = visible.slice(0, limit), hasMore = visible.length > limit;
      return { items: shown.map((entry) => entry.item), hasMore, nextCursor: hasMore ? JSON.stringify(shown[shown.length - 1].cursor) : null };
    }),
  };
}
function sourceProvider(target: 'workflow.instance' | 'workflow.task'): RelationProvider {
  const suffix = target === 'workflow.instance' ? 'instance' : 'approval-tasks', key = `workflow.attachment.${suffix}`;
  return { sourceType: 'workflow.attachment', key, permissions,
    descriptor: { key, labelKey: `relation.${key}`, targetTypes: [target], kind: 'direct', cardinality: 'one', capabilities },
    list: (anchor, { access }) => runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission(...permissions))) return empty();
      const id = idOf(anchor.ref.key); if (id === undefined) return empty();
      const row = await getWorkflowAttachmentSummary(id, access.db);
      if (row.tenantId !== anchor.tenantId) return empty();
      const sourceId = target === 'workflow.instance' ? row.instanceId : row.taskId;
      return sourceId == null ? empty() : { items: [{ ref: { type: target as CanonicalEntityType, key: String(sourceId) }, relationKey: key,
        title: target === 'workflow.instance' ? `所属审批 #${sourceId}` : `所属审批任务 #${sourceId}`, capabilities }], hasMore: false, nextCursor: null };
    }),
  };
}
export const workflowAttachmentRelationProviders: readonly RelationProvider[] = [instanceAttachments('workflow.instance'), instanceAttachments('workflow.task'),
  ...WORKFLOW_BUSINESS_ENTITY_TYPES.map(businessAttachments), sourceProvider('workflow.instance'), sourceProvider('workflow.task')];
