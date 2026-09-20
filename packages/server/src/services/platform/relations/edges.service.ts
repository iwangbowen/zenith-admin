import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CanonicalEntityRef, CanonicalEntityType, EntityRelationItem } from '@zenith/shared/platform';
import { entityRelationEdges } from '../../../db/schema';
import { db } from '../../../db';
import { currentUser, hasPermission, runWithCurrentUser, setAuditSubjects } from '../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';
import { canonicalEntityTypeSchema } from '@zenith/shared/platform';
import { decodeRelationCursor, encodeRelationCursor } from './cursor';
import { resolveVisibleEntityAnchor } from './registry';
import type { RelationProvider, VisibleEntityAnchor } from './types';

const MANUAL_RELATION = 'platform.related';
function edgeEnds(a: CanonicalEntityRef, b: CanonicalEntityRef): [CanonicalEntityRef, CanonicalEntityRef] {
  const aKey = JSON.stringify([a.type, a.key]);
  const bKey = JSON.stringify([b.type, b.key]);
  if (aKey === bKey) throw new HTTPException(400, { message: '不能关联对象自身' });
  return aKey < bKey ? [a, b] : [b, a];
}
export async function changeEntityLink(source: CanonicalEntityRef, target: CanonicalEntityRef, remove: boolean): Promise<void> {
  const user = currentUser();
  if (!(await hasPermission('system:relation:manage'))) throw new HTTPException(403, { message: '无权维护对象关联' });
  await runWithCurrentUser(user, () => db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', '1500', true), set_config('lock_timeout', '750', true)`);
    const access = { user, db: tx };
    const anchor = await resolveVisibleEntityAnchor(source.type, source.key, access);
    let other: VisibleEntityAnchor | undefined;
    try { other = await resolveVisibleEntityAnchor(target.type, target.key, access); }
    catch (error) {
      if (!remove || !(error instanceof HTTPException) || error.status !== 404) throw error;
    }
    if (other && other.tenantId !== anchor.tenantId) throw new HTTPException(400, { message: '对象必须属于同一租户' });
    const [left, right] = edgeEnds(anchor.ref, other?.ref ?? target);
    if (remove) {
      await tx.delete(entityRelationEdges).where(and(exactTenantCondition(entityRelationEdges.tenantId, anchor.tenantId),
        eq(entityRelationEdges.sourceType, left.type), eq(entityRelationEdges.sourceKey, left.key), eq(entityRelationEdges.targetType, right.type),
        eq(entityRelationEdges.targetKey, right.key), eq(entityRelationEdges.relationKey, MANUAL_RELATION)));
    } else {
      await tx.insert(entityRelationEdges).values({ tenantId: anchor.tenantId, sourceType: left.type, sourceKey: left.key,
        targetType: right.type, targetKey: right.key, relationKey: MANUAL_RELATION, createdBy: user.userId }).onConflictDoNothing();
    }
    setAuditSubjects([{ ...anchor.ref, role: 'primary' }, ...(other ? [{ ...other.ref, role: 'related' as const }] : [])], anchor.tenantId);
  }));
}
export function manualLinksProvider(type: CanonicalEntityType, targetTypes: readonly CanonicalEntityType[]): RelationProvider {
  return { sourceType: type, key: `${type}.links`, permissions: 'authenticated',
    descriptor: { key: `${type}.links`, labelKey: 'relation.common.related', targetTypes: [...targetTypes], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
    async list(anchor, { cursor, limit, access }) {
      let before = decodeRelationCursor(cursor);
      const visible: Array<{ id: number; item: EntityRelationItem }> = [];
      for (let scanned = 0; scanned < 512 && visible.length <= limit; scanned += limit + 1) {
        const rows = await access.db.select({ id: entityRelationEdges.id, sourceType: entityRelationEdges.sourceType, sourceKey: entityRelationEdges.sourceKey,
          targetType: entityRelationEdges.targetType, targetKey: entityRelationEdges.targetKey }).from(entityRelationEdges).where(buildWhere(
          exactTenantCondition(entityRelationEdges.tenantId, anchor.tenantId), tenantCondition(entityRelationEdges, access.user), eq(entityRelationEdges.relationKey, MANUAL_RELATION),
          or(and(eq(entityRelationEdges.sourceType, type), eq(entityRelationEdges.sourceKey, anchor.ref.key)), and(eq(entityRelationEdges.targetType, type), eq(entityRelationEdges.targetKey, anchor.ref.key))),
          before ? lt(entityRelationEdges.id, before) : undefined)).orderBy(desc(entityRelationEdges.id)).limit(limit + 1);
        if (!rows.length) break;
        for (const row of rows) {
          before = row.id;
          const forward = row.sourceType === type && row.sourceKey === anchor.ref.key;
          const parsedType = canonicalEntityTypeSchema.safeParse(forward ? row.targetType : row.sourceType);
          if (!parsedType.success) continue;
          try {
            const target = await resolveVisibleEntityAnchor(parsedType.data, forward ? row.targetKey : row.sourceKey, access);
            if (target.tenantId !== anchor.tenantId) continue;
            visible.push({ id: row.id, item: { ref: target.ref, title: target.title, relationKey: `${type}.links`, capabilities: { view: true, open: true } } });
          } catch (error) {
            if (!(error instanceof HTTPException) || error.status !== 404) throw error;
          }
          if (visible.length > limit) break;
        }
        if (rows.length < limit + 1) break;
        if (scanned + limit + 1 >= 512 && visible.length <= limit) throw new HTTPException(503, { message: '关联查询超出预算，请稍后重试' });
      }
      const shown = visible.slice(0, limit);
      return { items: shown.map(({ item }) => item), hasMore: visible.length > limit,
        nextCursor: visible.length > limit ? encodeRelationCursor(shown[shown.length - 1].id) : null };
    },
  };
}
