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
import { driveNodes, driveSpaces } from '../../db/schema';
import { loadDriveSubjects, visibleNodeCondition } from './drive-access.service';

type RelationInput = Parameters<RelationProvider['list']>[1];
const emptyPage = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });

async function resolveDriveFiles(ids: number[], access: RelationAccessContext): Promise<VisibleEntityAnchor[]> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('drive:node:list'))) return [];
    const subjects = await loadDriveSubjects();
    const rows = await access.db.select({ id: driveNodes.id, name: driveNodes.name, spaceId: driveNodes.spaceId, parentId: driveNodes.parentId, tenantId: driveNodes.tenantId })
      .from(driveNodes).innerJoin(driveSpaces, eq(driveNodes.spaceId, driveSpaces.id))
      .where(buildWhere(anchorIdsWhere(driveNodes.id, ids), isNull(driveNodes.deletedAt), tenantCondition(driveNodes, access.user),
        sql`${driveSpaces.tenantId} is not distinct from ${driveNodes.tenantId}`, visibleNodeCondition(subjects))).limit(ids.length);
    return rows.map((row): VisibleEntityAnchor => ({ ref: { type: 'drive.file', key: String(row.id) }, title: row.name.slice(0, 160), tenantId: row.tenantId, metadata: { spaceId: row.spaceId, parentId: row.parentId } }));
  });
}

async function listDriveNodes(anchor: VisibleEntityAnchor, { cursor, limit, access, filters }: RelationInput, direction: 'children' | 'parent'): Promise<EntityRelationPage> {
  return runWithCurrentUser(access.user, async () => {
    if (!(await hasPermission('drive:node:list'))) return emptyPage();
    const id = direction === 'children' ? parseNumericAnchorId(anchor.ref.key) : anchor.metadata?.parentId;
    const spaceId = anchor.metadata?.spaceId;
    if (typeof id !== 'number' || typeof spaceId !== 'number') return emptyPage();
    const subjects = await loadDriveSubjects();
    const beforeId = decodeRelationCursor(cursor);
    const rows = await access.db.select({ id: driveNodes.id, name: driveNodes.name, type: driveNodes.type, updatedAt: driveNodes.updatedAt })
      .from(driveNodes).innerJoin(driveSpaces, eq(driveNodes.spaceId, driveSpaces.id))
      .where(buildWhere(direction === 'children' ? eq(driveNodes.parentId, id) : eq(driveNodes.id, id),
        eq(driveNodes.spaceId, spaceId), isNull(driveNodes.deletedAt), exactTenantCondition(driveNodes.tenantId, anchor.tenantId),
        exactTenantCondition(driveSpaces.tenantId, anchor.tenantId), tenantCondition(driveNodes, access.user), visibleNodeCondition(subjects),
        relationFilterWhere(filters, { keyword: [driveNodes.name], occurredAt: driveNodes.updatedAt }), beforeId ? lt(driveNodes.id, beforeId) : undefined)).orderBy(desc(driveNodes.id)).limit(limit + 1);
    return page(rows, limit, (row) => ({ ref: { type: 'drive.file', key: String(row.id) }, relationKey: `drive.file.${direction}`, title: row.name.slice(0, 160), subtitle: row.type, occurredAt: formatDateTime(row.updatedAt), capabilities: { view: true, open: true } }));
  });
}

function driveProvider(direction: 'children' | 'parent'): RelationProvider {
  const key = `drive.file.${direction}`;
  return { sourceType: 'drive.file', key, permissions: ['drive:node:list'], descriptor: {
    key, labelKey: `relation.${key}`, targetTypes: ['drive.file'], filters: entityRelationRecordFilters('drive.file'), kind: 'direct', cardinality: direction === 'parent' ? 'one' : 'many', capabilities: { view: true, open: true },
  }, list: (anchor, input) => listDriveNodes(anchor, input, direction) };
}

export const driveAnchorResolvers: readonly EntityAnchorResolver[] = [numericAnchorResolver('drive.file', resolveDriveFiles)];
export const driveRelationProviders: readonly RelationProvider[] = [driveProvider('parent'), driveProvider('children')];
