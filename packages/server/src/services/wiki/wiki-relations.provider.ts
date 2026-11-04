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
import { desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { wikiDocs, wikiSpaces } from '../../db/schema';
import { wikiDocStatusVisibilityCondition, wikiSpaceAccessCondition } from './access';

type RelationInput = Parameters<RelationProvider['list']>[1];
const emptyPage = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });

async function resolveWikiDocuments(ids: number[], access: RelationAccessContext): Promise<VisibleEntityAnchor[]> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('wiki:doc:list'))) return [];
    const rows = await access.db.select({ id: wikiDocs.id, title: wikiDocs.title, spaceId: wikiDocs.spaceId, parentId: wikiDocs.parentId, tenantId: wikiDocs.tenantId })
      .from(wikiDocs).innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
      .where(buildWhere(anchorIdsWhere(wikiDocs.id, ids), isNull(wikiDocs.deletedAt), tenantCondition(wikiDocs, access.user),
        sql`${wikiSpaces.tenantId} is not distinct from ${wikiDocs.tenantId}`, wikiSpaceAccessCondition(), wikiDocStatusVisibilityCondition())).limit(ids.length);
    return rows.map((row): VisibleEntityAnchor => ({ ref: { type: 'wiki.document', key: String(row.id) }, title: row.title.slice(0, 160), tenantId: row.tenantId, metadata: { spaceId: row.spaceId, parentId: row.parentId } }));
  });
}

async function listWikiDocuments(anchor: VisibleEntityAnchor, { cursor, limit, access, filters }: RelationInput, direction: 'children' | 'parent'): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('wiki:doc:list'))) return emptyPage();
    const id = direction === 'children' ? parseNumericAnchorId(anchor.ref.key) : anchor.metadata?.parentId;
    const spaceId = anchor.metadata?.spaceId;
    if (typeof id !== 'number' || typeof spaceId !== 'number') return emptyPage();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: wikiDocs.id, title: wikiDocs.title, status: wikiDocs.status, updatedAt: wikiDocs.updatedAt })
      .from(wikiDocs).innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
      .where(buildWhere(direction === 'children' ? eq(wikiDocs.parentId, id) : eq(wikiDocs.id, id),
        eq(wikiDocs.spaceId, spaceId), isNull(wikiDocs.deletedAt), eq(wikiDocs.isArchived, false),
        exactTenantCondition(wikiDocs.tenantId, anchor.tenantId), exactTenantCondition(wikiSpaces.tenantId, anchor.tenantId), tenantCondition(wikiDocs, access.user),
        wikiSpaceAccessCondition(), wikiDocStatusVisibilityCondition(), relationFilterWhere(filters, { keyword: [wikiDocs.title], status: wikiDocs.status, occurredAt: wikiDocs.updatedAt }), beforeId ? lt(wikiDocs.id, beforeId) : undefined)).orderBy(desc(wikiDocs.id)).limit(limit + 1);
    return page(rows, limit, (row) => ({ ref: { type: 'wiki.document', key: String(row.id) }, relationKey: `wiki.document.${direction}`, title: row.title.slice(0, 160), status: row.status, occurredAt: formatDateTime(row.updatedAt), capabilities: { view: true, open: true } }));
  });
}

function wikiProvider(direction: 'children' | 'parent'): RelationProvider {
  const key = `wiki.document.${direction}`;
  return { sourceType: 'wiki.document', key, permissions: ['wiki:doc:list'], descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: ['wiki.document'], filters: entityRelationRecordFilters('wiki.document'), kind: 'direct', cardinality: direction === 'parent' ? 'one' : 'many', capabilities: { view: true, open: true },
  }, list: (anchor, input) => listWikiDocuments(anchor, input, direction) };
}

export const wikiAnchorResolvers: readonly EntityAnchorResolver[] = [numericAnchorResolver('wiki.document', resolveWikiDocuments)];
export const wikiRelationProviders: readonly RelationProvider[] = [wikiProvider('parent'), wikiProvider('children')];
