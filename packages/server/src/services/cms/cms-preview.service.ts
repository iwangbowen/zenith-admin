import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { CMS_PREVIEW_PREFIX } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsContentPreviewGrants } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { constantTimeEqual, hmacSha256 } from '../../lib/signed-token';
import { requireCmsContentAccess } from './cms-content-access.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { freezeCmsContentRevision, loadCmsRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { lockCmsSiteForMutation } from './cms-site-publish-lock.service';

const PREVIEW_TTL_SECONDS = 2 * 60 * 60;
const sign = (contentId: number, revisionId: number, token: string, exp: number) => hmacSha256(`cms-preview:${contentId}:${revisionId}:${token}:${exp}`, 'hex');

export async function createContentPreviewLink(contentId: number) {
  const identity = await requireCmsContentAccess(contentId);
  const site = await ensureCmsSiteExists(identity.siteId);
  const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS;
  const token = randomUUID();
  const revision = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, identity.siteId);
    const working = await requireCmsWorkingCopy(tx, contentId, true);
    const frozen = await freezeCmsContentRevision(tx, identity, working, 'preview', '固定版本预览');
    await tx.insert(cmsContentPreviewGrants).values({ token, contentId, revisionId: frozen.id, expiresAt: new Date(exp * 1000) });
    return frozen;
  });
  return {
    url: `${CMS_PREVIEW_PREFIX}/${site.code}/preview/${contentId}?rid=${revision.id}&gid=${token}&exp=${exp}&sig=${sign(contentId, revision.id, token, exp)}`,
    expiresAt: formatDateTime(new Date(exp * 1000)), revisionId: revision.id, grantId: token,
  };
}

export async function verifyContentPreviewToken(contentId: number, exp: number, sig: string, revisionId?: number, grantId?: string): Promise<boolean> {
  if (!revisionId || !grantId || !Number.isInteger(exp) || exp * 1000 < Date.now() || !sig) return false;
  if (!constantTimeEqual(sig, sign(contentId, revisionId, grantId, exp))) return false;
  const [grant] = await db.select().from(cmsContentPreviewGrants).where(and(eq(cmsContentPreviewGrants.token, grantId), eq(cmsContentPreviewGrants.contentId, contentId), eq(cmsContentPreviewGrants.revisionId, revisionId), isNull(cmsContentPreviewGrants.revokedAt))).limit(1);
  return Boolean(grant && grant.expiresAt.getTime() === exp * 1000 && grant.expiresAt > new Date());
}

export async function resolveCmsPreviewRevision(contentId: number, exp: number, sig: string, revisionId: number, grantId: string) {
  if (!await verifyContentPreviewToken(contentId, exp, sig, revisionId, grantId)) return null;
  const revision = await loadCmsRevision(db, revisionId);
  return revision.contentId === contentId && !revision.payload.deletedAt ? revision : null;
}

export async function revokeCmsContentPreview(contentId: number, grantId: string): Promise<void> {
  await requireCmsContentAccess(contentId);
  await db.update(cmsContentPreviewGrants).set({ revokedAt: new Date() }).where(and(eq(cmsContentPreviewGrants.contentId, contentId), eq(cmsContentPreviewGrants.token, grantId), isNull(cmsContentPreviewGrants.revokedAt)));
}
