import { describe, expect, it } from 'vitest';
import { collectCmsSelectedResourceIds } from './resource-selection';

describe('explicit CMS resource selections', () => {
  it('collects explicit nested handles but does not mistake frozen versions or similar numbers for selection intent', () => {
    expect(collectCmsSelectedResourceIds({ coverImage: 'cms-res://41', mediaData: { mediaUrl: 'cms-res://8', images: [{ url: 'cms-res://41' }] },
      body: '<img src="cms-res://7">', assetVersions: { 90: 120 }, unregistered: 'cms-res://1invalid', other: '/api/files/id/content' })).toEqual([41, 8, 7]);
  });
});
