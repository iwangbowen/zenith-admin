import { and, desc, eq } from 'drizzle-orm';
import { mergeCmsConfigurationSnapshots } from '@zenith/shared/cms';
import type { CmsRelease } from '@zenith/shared/cms';
import { cmsReleases } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { currentUserOrNull } from '../../lib/context';
import { nullableEq } from '../../lib/where-helpers';
import { APP_TIME_ZONE } from '../../lib/datetime';
import { acquireCmsSitePublishLock } from './cms-site-publish-lock.service';
import { syncCmsResourceRefs } from './cms-resource-refs.service';
import type { CmsCapturedConfiguration } from './cms-configuration-snapshot.service';

/** Called inside the already-authorized business mutation. Saving configuration
 * updates one reviewable draft; only an explicit build freezes that draft. */
export async function stageCmsConfigurationDraft(tx: DbTransaction, siteId: number, capture: CmsCapturedConfiguration) {
  await acquireCmsSitePublishLock(tx, siteId);
  const [existing] = await tx.select().from(cmsReleases).where(and(eq(cmsReleases.siteId, siteId), eq(cmsReleases.source, 'configuration'),
    eq(cmsReleases.status, 'draft'), nullableEq(cmsReleases.createdBy, currentUserOrNull()?.userId ?? null))).orderBy(desc(cmsReleases.id)).for('update').limit(1);
  const snapshot = existing ? mergeCmsConfigurationSnapshots(existing.configurationSnapshot, capture.snapshot) : capture.snapshot;
  const items = new Map<string, CmsRelease['configurationItems'][number]>();
  for (const item of existing?.configurationItems ?? []) {
    if ((item.kind === 'page' && capture.snapshot.replaceAll.includes('cms_pages')) || (item.kind === 'widget' && capture.snapshot.replaceAll.includes('cms_widgets'))) continue;
    items.set(`${item.kind}:${item.id}`, item);
  }
  for (const item of capture.items) items.set(`${item.kind}:${item.id}`, item);
  const values = { configurationItems: [...items.values()], configurationSnapshot: snapshot, baseGenerationId: capture.baseGenerationId, error: null };
  const [row] = existing
    ? await tx.update(cmsReleases).set(values).where(eq(cmsReleases.id, existing.id)).returning()
    : await tx.insert(cmsReleases).values({ ...values, siteId, source: 'configuration', name: '站点配置变更', autoActivate: false, timeZone: APP_TIME_ZONE }).returning();
  await syncCmsResourceRefs(tx, 'release', row.id, siteId, row);
  return row;
}
