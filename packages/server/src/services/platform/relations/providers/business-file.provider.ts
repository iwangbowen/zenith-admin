import { desc, eq, isNull, lt, ne } from 'drizzle-orm';
import * as z from 'zod';
import { announcements, businessFiles, managedFiles, wikiDocs, wikiSpaces } from '../../../../db/schema';
import { hasPermission } from '../../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { visibleBusinessFileCondition, visibleManagedBusinessFileCondition, visibleWikiAttachmentOwner } from '../../../files/business-file-access.service';
import { relationPage } from '../page';
import { decodeRelationCursor } from '../cursor';
import { relationFilterWhere } from '../filters';
import { relationSummaryQuery } from '../summary-query';
import type { EntityAnchorResolver, RelationProvider } from '../types';

export const businessFileAnchors: readonly EntityAnchorResolver[] = [
  { type: 'platform.managed-file', async resolve(ref, access) {
    if (!z.uuid().safeParse(ref.key).success) return null;
    const [row] = await access.db.select({ id: managedFiles.id, name: managedFiles.originalName, tenantId: managedFiles.tenantId })
      .from(managedFiles).where(buildWhere(eq(managedFiles.id, ref.key), await visibleManagedBusinessFileCondition(access.db))).limit(1);
    return row ? { ref: { type: 'platform.managed-file', key: row.id }, title: row.name.slice(0, 160), tenantId: row.tenantId } : null;
  } },
  { type: 'messaging.announcement', async resolve(ref, access) {
    if (!/^[1-9]\d*$/.test(ref.key) || !Number.isSafeInteger(Number(ref.key)) || Number(ref.key) > 2_147_483_647 || !await hasPermission('system:announcement:list')) return null;
    const [row] = await access.db.select({ id: announcements.id, title: announcements.title, tenantId: announcements.tenantId })
      .from(announcements).where(buildWhere(eq(announcements.id, Number(ref.key)), tenantCondition(announcements, access.user))).limit(1);
    return row ? { ref: { type: 'messaging.announcement', key: String(row.id) }, title: row.title.slice(0, 160), tenantId: row.tenantId } : null;
  } },
];

function attachments(sourceType: 'wiki.document' | 'messaging.announcement'): RelationProvider {
  const key = `${sourceType}.business-attachments`;
  const where = async (anchor: Parameters<RelationProvider['list']>[0], access: Parameters<RelationProvider['list']>[1]['access']) => buildWhere(
    eq(businessFiles.businessType, sourceType === 'wiki.document' ? 'wiki_doc' : 'announcement'), eq(businessFiles.businessId, Number(anchor.ref.key)),
    exactTenantCondition(businessFiles.tenantId, anchor.tenantId), exactTenantCondition(managedFiles.tenantId, anchor.tenantId),
    tenantCondition(managedFiles, access.user), ne(managedFiles.gcState, 'deleting'), await visibleBusinessFileCondition(access.db));
  return { sourceType, key, permissions: 'authenticated', descriptor: { key, labelKey: `relation.${key}`, targetTypes: ['platform.managed-file'], kind: 'direct', cardinality: 'many',
    capabilities: { view: true, open: true }, filters: { keyword: true, dateRange: true } },
    async prepareSummaryQuery(anchor, { access }) {
      return relationSummaryQuery(access.db.select({ id: businessFiles.id }).from(businessFiles)
        .innerJoin(managedFiles, eq(businessFiles.fileId, managedFiles.id)).where(await where(anchor, access)));
    },
    async list(anchor, { access, cursor, limit, filters }) {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: businessFiles.id, fileId: managedFiles.id, title: managedFiles.originalName, alias: businessFiles.name,
        mimeType: managedFiles.mimeType, createdAt: businessFiles.createdAt })
        .from(businessFiles).innerJoin(managedFiles, eq(businessFiles.fileId, managedFiles.id))
        .where(buildWhere(await where(anchor, access), relationFilterWhere(filters, { keyword: [businessFiles.name, managedFiles.originalName], occurredAt: businessFiles.createdAt }),
          before ? lt(businessFiles.id, before) : undefined)).orderBy(desc(businessFiles.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'platform.managed-file', key: row.fileId }, relationKey: key,
        title: (row.alias || row.title).slice(0, 160), subtitle: row.mimeType, occurredAt: row.createdAt.toISOString(),
        origin: { kind: 'direct', relatedAt: row.createdAt.toISOString(), explanation: '业务附件表保存的受控文件引用' }, capabilities: { view: true, open: true } }));
    },
  };
}

function usages(targetType: 'wiki.document' | 'messaging.announcement'): RelationProvider {
  const wiki = targetType === 'wiki.document';
  const key = `platform.managed-file.${wiki ? 'wiki-usages' : 'announcement-usages'}`;
  return { sourceType: 'platform.managed-file', key, permissions: [wiki ? 'wiki:doc:list' : 'system:announcement:list'],
    descriptor: { key, labelKey: `relation.${key}`, targetTypes: [targetType], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true }, filters: { keyword: true, dateRange: true } },
    async list(anchor, { access, cursor, limit, filters }) {
      const before = decodeRelationCursor(cursor);
      const base = buildWhere(eq(businessFiles.fileId, anchor.ref.key), eq(businessFiles.businessType, wiki ? 'wiki_doc' : 'announcement'),
        exactTenantCondition(businessFiles.tenantId, anchor.tenantId), await visibleBusinessFileCondition(access.db), before ? lt(businessFiles.id, before) : undefined);
      if (wiki) {
        const rows = await access.db.select({ id: businessFiles.id, targetId: wikiDocs.id, title: wikiDocs.title, status: wikiDocs.status, createdAt: businessFiles.createdAt })
          .from(businessFiles).innerJoin(wikiDocs, eq(businessFiles.businessId, wikiDocs.id)).innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id))
          .where(buildWhere(base, visibleWikiAttachmentOwner(), isNull(wikiDocs.deletedAt), exactTenantCondition(wikiDocs.tenantId, anchor.tenantId),
            relationFilterWhere(filters, { keyword: [wikiDocs.title], occurredAt: businessFiles.createdAt })))
          .orderBy(desc(businessFiles.id)).limit(limit + 1);
        return relationPage(rows, limit, (row) => ({ ref: { type: targetType, key: String(row.targetId) }, relationKey: key,
          title: row.title.slice(0, 160), status: row.status, occurredAt: row.createdAt.toISOString(), origin: { kind: 'direct', relatedAt: row.createdAt.toISOString() }, capabilities: { view: true, open: true } }));
      }
      const rows = await access.db.select({ id: businessFiles.id, targetId: announcements.id, title: announcements.title, status: announcements.publishStatus, createdAt: businessFiles.createdAt })
        .from(businessFiles).innerJoin(announcements, eq(businessFiles.businessId, announcements.id))
        .where(buildWhere(base, tenantCondition(announcements, access.user), exactTenantCondition(announcements.tenantId, anchor.tenantId),
          relationFilterWhere(filters, { keyword: [announcements.title], occurredAt: businessFiles.createdAt })))
        .orderBy(desc(businessFiles.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: targetType, key: String(row.targetId) }, relationKey: key,
        title: row.title.slice(0, 160), status: row.status, occurredAt: row.createdAt.toISOString(), origin: { kind: 'direct', relatedAt: row.createdAt.toISOString() }, capabilities: { view: true, open: true } }));
    },
  };
}
export const businessFileProviders: readonly RelationProvider[] = [attachments('wiki.document'), attachments('messaging.announcement'), usages('wiki.document'), usages('messaging.announcement')];
