import { describe, expect, it } from 'vitest';
import { buildCmsContentSnapshotTargets } from './cms-content-publish-snapshot.service';

const channels = [
  { id: 1, siteId: 1, name: 'PC', code: 'pc', domain: null, uaRegex: null, isDefault: true },
  { id: 2, siteId: 1, name: 'H5', code: 'h5', domain: null, uaRegex: null, isDefault: false },
];

describe('CMS immutable content path snapshots', () => {
  it('retains old slug, channel and all prior body pages for deletion', () => {
    const oldTargets = buildCmsContentSnapshotTargets({ id: 7, slug: 'old-slug' }, 'old-channel', 3, channels);
    const nextTargets = buildCmsContentSnapshotTargets({ id: 7, slug: 'new-slug' }, 'new-channel', 1, channels);
    expect(oldTargets.flatMap((target) => target.paths)).toEqual([
      'old-channel/old-slug.html',
      'old-channel/old-slug_2.html',
      'old-channel/old-slug_3.html',
      '__h5/old-channel/old-slug.html',
      '__h5/old-channel/old-slug_2.html',
      '__h5/old-channel/old-slug_3.html',
    ]);
    expect(nextTargets.flatMap((target) => target.paths)).toEqual([
      'new-channel/new-slug.html',
      '__h5/new-channel/new-slug.html',
    ]);
  });
});
