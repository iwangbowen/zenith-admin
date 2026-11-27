import { describe, expect, it } from 'vitest';
import type { CmsPublishSubmitInput } from '@zenith/shared/cms';
import {
  buildCmsPublishDedupeFingerprint,
  cmsPublishingTaskSiteIds,
  isReusableCmsPublishTaskStatus,
  remainingCmsContentTargets,
  stableCmsContentTargets,
} from './cms-publishing-policy';

describe('CMS publishing idempotency policy', () => {
  it('builds a stable active-task fingerprint without making terminal tasks permanently idempotent', () => {
    const input: CmsPublishSubmitInput = {
      siteId: 1,
      targetType: 'contents',
      contentIds: [3, 1, 2],
      reason: 'test',
    };
    const fingerprint = buildCmsPublishDedupeFingerprint(input, 7);
    expect(buildCmsPublishDedupeFingerprint({ ...input, contentIds: [1, 2, 3] }, 7)).toBe(fingerprint);
    expect(buildCmsPublishDedupeFingerprint({ ...input, contentIds: [1, 2, 2, 3] }, 7)).toBe(fingerprint);
    expect(buildCmsPublishDedupeFingerprint(input, 8)).not.toBe(fingerprint);
    expect(buildCmsPublishDedupeFingerprint({ ...input, siteId: 2 }, 7)).not.toBe(fingerprint);
    expect(isReusableCmsPublishTaskStatus('pending')).toBe(true);
    expect(isReusableCmsPublishTaskStatus('running')).toBe(true);
    expect(isReusableCmsPublishTaskStatus('success')).toBe(false);
    expect(isReusableCmsPublishTaskStatus('failed')).toBe(false);
    expect(isReusableCmsPublishTaskStatus('cancelled')).toBe(false);
  });

  it('uses a fixed sorted target snapshot and resumes by last unique id without omission', () => {
    expect(stableCmsContentTargets([9, 2, 5, 2, 1])).toEqual([1, 2, 5, 9]);
    expect(remainingCmsContentTargets([9, 2, 5, 2, 1], 2)).toEqual([5, 9]);
    expect(remainingCmsContentTargets([9, 5, 1], 2)).toEqual([5, 9]);
  });

  it('projects the single site scope used by every unified publish task', () => {
    expect(cmsPublishingTaskSiteIds({
      taskType: 'cms-publish-build',
      payload: { siteId: '3' },
    })).toEqual([3]);
    expect(cmsPublishingTaskSiteIds({
      taskType: 'cms-publish-build',
      payload: { siteId: 0 },
    })).toEqual([]);
  });
});
