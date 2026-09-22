import { and, eq, exists, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { announcements, businessFiles, managedFiles, wikiDocs, wikiSpaces } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { wikiDocStatusVisibilityCondition, wikiSpaceAccessCondition } from '../wiki/access';
import { isFeatureEnabled } from '../../lib/licensing';

/** Business attachments inherit their owning record's visibility, including unpublished wiki documents. */
export function visibleWikiAttachmentOwner() {
  return buildWhere(isNull(wikiDocs.deletedAt), tenantCondition(wikiDocs, currentUser()),
    sql`${wikiSpaces.tenantId} is not distinct from ${wikiDocs.tenantId}`, wikiSpaceAccessCondition(), wikiDocStatusVisibilityCondition());
}

export async function visibleBusinessFileCondition(executor: DbExecutor = db) {
  const user = currentUser();
  const wiki = await hasPermission('wiki:doc:list') && await isFeatureEnabled('wiki');
  const announcement = await hasPermission('system:announcement:list');
  return buildWhere(tenantCondition(businessFiles, user), or(
    wiki ? and(eq(businessFiles.businessType, 'wiki_doc'), exists(executor.select({ id: wikiDocs.id }).from(wikiDocs)
      .innerJoin(wikiSpaces, eq(wikiDocs.spaceId, wikiSpaces.id)).where(buildWhere(eq(wikiDocs.id, businessFiles.businessId),
        sql`${wikiDocs.tenantId} is not distinct from ${businessFiles.tenantId}`, visibleWikiAttachmentOwner())))) : sql`false`,
    announcement ? and(eq(businessFiles.businessType, 'announcement'), exists(executor.select({ id: announcements.id }).from(announcements)
      .where(buildWhere(eq(announcements.id, businessFiles.businessId), tenantCondition(announcements, user),
        sql`${announcements.tenantId} is not distinct from ${businessFiles.tenantId}`)))) : sql`false`,
  ));
}

export async function visibleManagedBusinessFileCondition(executor: DbExecutor = db) {
  return buildWhere(tenantCondition(managedFiles, currentUser()), ne(managedFiles.gcState, 'deleting'),
    exists(executor.select({ id: businessFiles.id }).from(businessFiles).where(buildWhere(eq(businessFiles.fileId, managedFiles.id),
      sql`${businessFiles.tenantId} is not distinct from ${managedFiles.tenantId}`, await visibleBusinessFileCondition(executor)))));
}

export async function requireVisibleManagedBusinessFile(fileId: string, executor: DbExecutor = db) {
  const [file] = await executor.select({ id: managedFiles.id, originalName: managedFiles.originalName, size: managedFiles.size,
    mimeType: managedFiles.mimeType, extension: managedFiles.extension, tenantId: managedFiles.tenantId, createdAt: managedFiles.createdAt })
    .from(managedFiles).where(buildWhere(eq(managedFiles.id, fileId), await visibleManagedBusinessFileCondition(executor))).limit(1);
  return requireRow(file, '附件不存在或无权查看');
}
