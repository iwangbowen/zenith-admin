import { createHash } from 'node:crypto';
import type { CmsReleaseRow } from '../../db/schema';
import { canonicalCmsJson } from './cms-content-revisions.service';

export function cmsReleaseInputFingerprint(release: Pick<CmsReleaseRow, 'items' | 'configurationSnapshot' | 'baseGenerationId'>) {
  return createHash('sha256').update(canonicalCmsJson({ items: release.items, configuration: release.configurationSnapshot, base: release.baseGenerationId })).digest('hex');
}
