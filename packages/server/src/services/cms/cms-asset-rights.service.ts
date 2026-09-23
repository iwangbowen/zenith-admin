import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BodyOf } from '@zenith/shared/core';
import { cmsAssetRightsSchema, cmsAssetVersionSchema, cmsResourceContract } from '@zenith/shared/cms';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsAssetRights, cmsAssetVersions } from '../../db/schema/cms-design';
import { cmsContents, cmsResources } from '../../db/schema/cms';
import { cmsContentRevisions } from '../../db/schema/cms-revisions';
import type { DbExecutor } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { parseDateTimeInput } from '../../lib/datetime';
import { pickEntity } from '../../lib/entity-map';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsAssetVersion } from './cms-design-versions.service';
import { releaseManagedFiles } from '../files/file-gc.service';
import { randomUUID } from 'node:crypto';
import { insertCmsCdnPurgeOutbox } from './cms-cdn.service';
import { enqueueAsyncTask } from '../../lib/task-center';
import { invalidateCmsSiteCaches } from './cms-cache.service';

async function requireResource(id: number) {
  const [row] = await db.select().from(cmsResources).where(eq(cmsResources.id, id)).limit(1);
  requireRow(row, '素材不存在');
  await assertSiteAccess(row.siteId);
  return row;
}

export async function listCmsAssetVersions(id: number) {
  await requireResource(id);
  const rows = await db.select().from(cmsAssetVersions).where(eq(cmsAssetVersions.resourceId, id)).orderBy(desc(cmsAssetVersions.version));
  return rows.map((row) => pickEntity(cmsAssetVersionSchema, row));
}

export async function getCmsAssetRights(id: number) {
  await requireResource(id);
  const [row] = await db.select().from(cmsAssetRights).where(eq(cmsAssetRights.resourceId, id)).limit(1);
  return row ? pickEntity(cmsAssetRightsSchema, row) : { resourceId: id, source: null, license: null, expiresAt: null, revoked: false, tags: [], alt: null };
}

export async function updateCmsAssetRights(id: number, input: BodyOf<typeof cmsResourceContract.updateRights>) {
  const resource = await requireResource(id);
  const values = { ...input, ...(input.expiresAt !== undefined ? { expiresAt: parseDateTimeInput(input.expiresAt) } : {}) };
  const eventKey = `resource:${id}:rights:${randomUUID()}`;
  const task = await db.transaction(async (tx) => {
    await ensureCmsAssetVersion(tx, id, resource.siteId);
    const [existing] = await tx.select().from(cmsAssetRights).where(eq(cmsAssetRights.resourceId, id)).limit(1);
    if (existing) await tx.update(cmsAssetRights).set(values).where(eq(cmsAssetRights.resourceId, id));
    else await tx.insert(cmsAssetRights).values({ ...values, resourceId: id });
    await tx.update(cmsContents).set({ version: sql`${cmsContents.version}` }).where(sql`${cmsContents.id} IN (
      SELECT ${cmsContentRevisions.contentId} FROM ${cmsContentRevisions} WHERE ${cmsContentRevisions.snapshot}->'assetVersions' ? ${String(id)}
    )`);
    return insertCmsCdnPurgeOutbox(tx, resource.siteId, eventKey);
  });
  await invalidateCmsSiteCaches(resource.siteId);
  await enqueueAsyncTask(task.id).catch(() => undefined);
  return getCmsAssetRights(id);
}

export async function removeUnusedCmsAssetVersions(tx: DbExecutor, resourceId: number) {
  const [resource] = await tx.select({ id: cmsResources.id }).from(cmsResources).where(eq(cmsResources.id, resourceId)).for('update').limit(1);
  requireRow(resource, '素材不存在');
  const used = await tx.$count(cmsContentRevisions, sql`${cmsContentRevisions.snapshot}->'assetVersions' ? ${String(resourceId)}`);
  if (used) throw new HTTPException(409, { message: '素材仍被不可变内容修订引用，不能删除' });
  const versions = await tx.select({ id: cmsAssetVersions.id, fileId: cmsAssetVersions.fileId }).from(cmsAssetVersions).where(eq(cmsAssetVersions.resourceId, resourceId));
  await tx.delete(cmsAssetVersions).where(eq(cmsAssetVersions.resourceId, resourceId));
  await releaseManagedFiles(tx, versions.map((version) => version.fileId));
}

/** Rechecked at delivery time; an old deployment cannot undo a later rights revocation. */
export async function isCmsRevisionAssetVisible(snapshot: { assetVersions?: Record<string, number> }, executor: DbExecutor = db) {
  const ids = Object.keys(snapshot.assetVersions ?? {}).map(Number);
  if (!ids.length) return true;
  const [blocked] = await executor.select({ id: cmsAssetRights.id }).from(cmsAssetRights).where(and(
    inArray(cmsAssetRights.resourceId, ids),
    sql`(${cmsAssetRights.revoked} = true or ${cmsAssetRights.expiresAt} <= now())`,
  )).limit(1);
  return !blocked;
}
