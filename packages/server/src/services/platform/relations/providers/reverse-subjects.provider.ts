import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { canonicalEntityRefSchema, type CanonicalEntityType, type EntityRelationItem } from '@zenith/shared/platform';
import { asyncTaskSubjects, notificationOutboxSubjects, operationLogSubjects } from '../../../../db/schema';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { assertRelationBudget } from '../runtime';
import type { RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { matchesRelationKeyword } from '../filters';

type SubjectCursor = readonly [type: string, key: string];
export type ReverseSubjectAnchorResolver = (
  type: CanonicalEntityType,
  key: string,
  access: RelationAccessContext,
) => Promise<VisibleEntityAnchor>;

const SUBJECT_SCAN_LIMIT = 512;
const SUBJECT_BATCH_SIZE = 32;
const capabilities = { view: true, open: true };
const sources = [
  { type: 'notification.outbox', table: notificationOutboxSubjects, parentId: notificationOutboxSubjects.outboxId, permission: 'system:notify-policy:list' },
  { type: 'tasks.async', table: asyncTaskSubjects, parentId: asyncTaskSubjects.taskId, permission: 'system:async-task:list' },
  { type: 'platform.operation-log', table: operationLogSubjects, parentId: operationLogSubjects.operationLogId, permission: 'system:log:operation' },
] as const;

/** The registry signs and binds this tuple to source, section, tenant and effective principal. */
function readSubjectCursor(value: string | undefined): SubjectCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const tuple: unknown = JSON.parse(value);
    if (!Array.isArray(tuple) || tuple.length !== 2) throw new Error('Invalid tuple');
    const ref = canonicalEntityRefSchema.parse({ type: tuple[0], key: tuple[1] });
    return [ref.type, ref.key];
  } catch {
    throw new HTTPException(400, { message: '来源对象分页游标无效' });
  }
}

/** Inject the resolver to avoid registry initialization cycles; subject roles never multiply objects. */
export function reverseSubjectProviders(
  targetTypes: readonly CanonicalEntityType[],
  resolveAnchor: ReverseSubjectAnchorResolver,
): readonly RelationProvider[] {
  const supported = new Set(targetTypes);
  return sources.map((source): RelationProvider => {
    const relationKey = `${source.type}.subjects`;
    return {
      sourceType: source.type,
      key: relationKey,
      permissions: [source.permission],
      descriptor: { key: relationKey, labelKey: 'relation.common.subjects', targetTypes: [...supported],
        kind: 'direct', cardinality: 'many', capabilities, filters: { keyword: true } },
      async list(anchor, { cursor, limit, access, filters }) {
        assertRelationBudget(access);
        if (anchor.ref.type !== source.type) throw new HTTPException(404, { message: '来源记录不存在或无权查看' });
        const authorized = await resolveAnchor(source.type, anchor.ref.key, access);
        if (authorized.tenantId !== anchor.tenantId || authorized.ref.type !== source.type || authorized.ref.key !== anchor.ref.key) {
          throw new HTTPException(404, { message: '来源记录不存在或无权查看' });
        }
        const parentId = Number(authorized.ref.key);
        if (!/^[1-9]\d*$/.test(authorized.ref.key) || !Number.isSafeInteger(parentId) || parentId > 2_147_483_647) {
          throw new HTTPException(404, { message: '来源记录不存在或无权查看' });
        }
        let after = readSubjectCursor(cursor);
        let scanned = 0;
        let exhausted = false;
        const visible: Array<{ cursor: SubjectCursor; item: EntityRelationItem }> = [];
        // C collation gives type/key the same deterministic order for DISTINCT, comparisons and pagination.
        const typeColumn = sql<string>`${source.table.entityType} collate "C"`;
        const keyColumn = sql<string>`${source.table.entityKey} collate "C"`;
        while (visible.length <= limit) {
          assertRelationBudget(access);
          if (scanned >= SUBJECT_SCAN_LIMIT || (scanned > 0 && access.deadlineAt && access.deadlineAt - performance.now() < 150)) break;
          const batchSize = Math.min(Math.max(SUBJECT_BATCH_SIZE, limit + 1), SUBJECT_SCAN_LIMIT - scanned);
          const rows = await access.db.selectDistinct({ type: typeColumn, key: keyColumn }).from(source.table).where(buildWhere(
            eq(source.parentId, parentId), exactTenantCondition(source.table.tenantId, authorized.tenantId), tenantCondition(source.table, access.user),
            after ? or(gt(typeColumn, after[0]), and(eq(typeColumn, after[0]), gt(keyColumn, after[1]))) : undefined,
          )).orderBy(asc(typeColumn), asc(keyColumn)).limit(batchSize);
          for (const row of rows) {
            assertRelationBudget(access);
            scanned++;
            after = [row.type, row.key];
            const parsed = canonicalEntityRefSchema.safeParse(row);
            if (!parsed.success || !supported.has(parsed.data.type)) continue;
            try {
              const target = await resolveAnchor(parsed.data.type, parsed.data.key, access);
              if (target.tenantId !== authorized.tenantId) continue;
              if (!matchesRelationKeyword(filters?.keyword, target.title, target.ref.key)) continue;
              visible.push({ cursor: after, item: { ref: target.ref, title: target.title.slice(0, 160), relationKey, capabilities } });
            } catch (error) {
              if (!(error instanceof HTTPException) || error.status !== 404) throw error;
            }
            if (visible.length > limit) break;
          }
          if (rows.length < batchSize && visible.length <= limit) { exhausted = true; break; }
        }
        assertRelationBudget(access);
        const shown = visible.slice(0, limit);
        const hasMore = visible.length > limit || !exhausted;
        return { items: shown.map(({ item }) => item), hasMore,
          nextCursor: hasMore ? JSON.stringify(visible.length > limit ? shown[shown.length - 1].cursor : after) : null };
      },
    };
  });
}
