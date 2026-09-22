import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CanonicalEntityRef, CanonicalEntityType, EntityRelationItem } from '@zenith/shared/platform';
import { entityRelationEdges, users } from '../../../db/schema';
import { db } from '../../../db';
import { currentUser, hasPermission, runWithCurrentUser, setAuditSubjects } from '../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';
import { canonicalEntityTypeSchema, MANUAL_RELATION_CATALOG, MANUAL_RELATION_TYPES, type ManualRelationType } from '@zenith/shared/platform';
import { decodeRelationCursor, encodeRelationCursor } from './cursor';
import { resolveVisibleEntityAnchor } from './registry';
import type { RelationProvider, VisibleEntityAnchor } from './types';
import { matchesRelationKeyword } from './filters';
import { formatDateTime } from '../../../lib/datetime';

const manualKeys = MANUAL_RELATION_TYPES.map((type) => MANUAL_RELATION_CATALOG[type].key);
type LinkOptions = { relationType?: ManualRelationType; direction?: 'outgoing' | 'incoming' | 'symmetric'; note?: string };
function edgeEnds(a: CanonicalEntityRef, b: CanonicalEntityRef): [CanonicalEntityRef, CanonicalEntityRef] {
  const aKey = JSON.stringify([a.type, a.key]);
  const bKey = JSON.stringify([b.type, b.key]);
  if (aKey === bKey) throw new HTTPException(400, { message: '不能关联对象自身' });
  return aKey < bKey ? [a, b] : [b, a];
}
export async function changeEntityLink(source: CanonicalEntityRef, target: CanonicalEntityRef, remove: boolean, options: LinkOptions = {}): Promise<void> {
  const user = currentUser();
  const relationType = options.relationType ?? 'related';
  const definition = MANUAL_RELATION_CATALOG[relationType];
  if (!definition || (options.note?.length ?? 0) > 500) throw new HTTPException(400, { message: '关联类型或说明无效' });
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
    const sorted = edgeEnds(anchor.ref, other?.ref ?? target);
    const [left, right] = definition.symmetric ? sorted : options.direction === 'incoming' ? [other?.ref ?? target, anchor.ref] : [anchor.ref, other?.ref ?? target];
    if (remove) {
      await tx.delete(entityRelationEdges).where(and(exactTenantCondition(entityRelationEdges.tenantId, anchor.tenantId),
        eq(entityRelationEdges.sourceType, left.type), eq(entityRelationEdges.sourceKey, left.key), eq(entityRelationEdges.targetType, right.type),
        eq(entityRelationEdges.targetKey, right.key), eq(entityRelationEdges.relationKey, definition.key)));
    } else {
      await tx.insert(entityRelationEdges).values({ tenantId: anchor.tenantId, sourceType: left.type, sourceKey: left.key,
        targetType: right.type, targetKey: right.key, relationKey: definition.key, metadata: { note: options.note?.trim() || null }, createdBy: user.userId }).onConflictDoNothing();
    }
    setAuditSubjects([{ ...anchor.ref, role: 'primary' }, ...(other ? [{ ...other.ref, role: 'related' as const }] : [])], anchor.tenantId);
  }));
}
export function manualLinksProvider(type: CanonicalEntityType, targetTypes: readonly CanonicalEntityType[]): RelationProvider {
  return { sourceType: type, key: `${type}.links`, permissions: 'authenticated',
    descriptor: { key: `${type}.links`, labelKey: 'relation.common.related', targetTypes: [...targetTypes], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, filters: { keyword: true } },
    async list(anchor, { cursor, limit, access, filters }) {
      let before = decodeRelationCursor(cursor);
      const visible: Array<{ id: number; item: EntityRelationItem }> = [];
      let scanned = 0;
      let exhausted = false;
      while (scanned < 256 && visible.length <= limit) {
        if (scanned > 0 && access.deadlineAt && access.deadlineAt - performance.now() < 150) break;
        const batchSize = Math.min(32, 256 - scanned);
        const rows = await access.db.select({ id: entityRelationEdges.id, sourceType: entityRelationEdges.sourceType, sourceKey: entityRelationEdges.sourceKey,
          targetType: entityRelationEdges.targetType, targetKey: entityRelationEdges.targetKey, createdAt: entityRelationEdges.createdAt, relationKey: entityRelationEdges.relationKey, metadata: entityRelationEdges.metadata, createdByName: users.nickname }).from(entityRelationEdges).leftJoin(users, eq(entityRelationEdges.createdBy, users.id)).where(buildWhere(
          exactTenantCondition(entityRelationEdges.tenantId, anchor.tenantId), tenantCondition(entityRelationEdges, access.user), inArray(entityRelationEdges.relationKey, manualKeys),
          or(and(eq(entityRelationEdges.sourceType, type), eq(entityRelationEdges.sourceKey, anchor.ref.key)), and(eq(entityRelationEdges.targetType, type), eq(entityRelationEdges.targetKey, anchor.ref.key))),
          before ? lt(entityRelationEdges.id, before) : undefined)).orderBy(desc(entityRelationEdges.id)).limit(batchSize);
        if (!rows.length) { exhausted = true; break; }
        for (const row of rows) {
          before = row.id;
          scanned++;
          const forward = row.sourceType === type && row.sourceKey === anchor.ref.key;
          const parsedType = canonicalEntityTypeSchema.safeParse(forward ? row.targetType : row.sourceType);
          if (!parsedType.success) continue;
          try {
            const target = await resolveVisibleEntityAnchor(parsedType.data, forward ? row.targetKey : row.sourceKey, access);
            if (target.tenantId !== anchor.tenantId) continue;
            const relationType = MANUAL_RELATION_TYPES.find((type) => MANUAL_RELATION_CATALOG[type].key === row.relationKey);
            if (!relationType) continue;
            const definition = MANUAL_RELATION_CATALOG[relationType];
            const note = typeof row.metadata?.note === 'string' ? row.metadata.note.slice(0, 500) : null;
            if (!matchesRelationKeyword(filters?.keyword, target.title, target.ref.key, note)) continue;
            visible.push({ id: row.id, item: { ref: target.ref, title: target.title, relationKey: `${type}.links`,
              subtitle: forward ? definition.label : definition.reverseLabel, description: note,
              manual: { type: relationType, direction: definition.symmetric ? 'symmetric' : forward ? 'outgoing' : 'incoming', note, createdByName: row.createdByName },
              origin: { kind: 'direct', relatedAt: row.createdAt ? formatDateTime(row.createdAt) : undefined }, capabilities: { view: true, open: true } } });
          } catch (error) {
            if (!(error instanceof HTTPException) || error.status !== 404) throw error;
          }
          if (visible.length > limit) break;
        }
        if (rows.length < batchSize && visible.length <= limit) { exhausted = true; break; }
      }
      const shown = visible.slice(0, limit);
      const hasMore = visible.length > limit || !exhausted;
      const next = visible.length > limit ? shown[shown.length - 1].id : before;
      return { items: shown.map(({ item }) => item), hasMore,
        nextCursor: hasMore && next ? encodeRelationCursor(next) : null };
    },
  };
}
