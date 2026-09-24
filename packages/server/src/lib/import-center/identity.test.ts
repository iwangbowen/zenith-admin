import { describe, expect, it } from 'vitest';
import { importJobIdempotencyKey } from './identity';

describe('import identity', () => {
  it('deduplicates reordered context but separates the same file imported into distinct targets', () => {
    const first = importJobIdempotencyKey('cms.contents', 'file', { siteId: 1, channelId: 2 });
    expect(first).toBe(importJobIdempotencyKey('cms.contents', 'file', { channelId: 2, siteId: 1 }));
    expect(first).not.toBe(importJobIdempotencyKey('cms.contents', 'file', { channelId: 3, siteId: 1 }));
    expect(first).not.toBe(importJobIdempotencyKey('cms.contents', 'other-file', { channelId: 2, siteId: 1 }));
  });
});
