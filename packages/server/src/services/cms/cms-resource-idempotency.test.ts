import { describe, expect, it } from 'vitest';
import {
  buildCmsResourceTaskIdempotencyKey, CMS_RESOURCE_IDEMPOTENCY_WINDOW_MS, normalizeCmsResourceTaskPayload,
} from './cms-resource-task-submit.service';

describe('CMS resource task idempotency', () => {
  it('canonicalizes resource IDs while preserving the complete payload', () => {
    const first = { operation: 'move' as const, siteId: 1, resourceIds: [3, 1, 3, 2], folderId: 9 };
    const reordered = { operation: 'move' as const, siteId: 1, resourceIds: [2, 3, 1], folderId: 9 };
    expect(normalizeCmsResourceTaskPayload(first)).toEqual({
      operation: 'move', siteId: 1, resourceIds: [1, 2, 3], folderId: 9,
    });
    const now = 1_800_000;
    expect(buildCmsResourceTaskIdempotencyKey(7, first, now))
      .toBe(buildCmsResourceTaskIdempotencyKey(7, reordered, now + 10_000));
  });

  it('separates users, batches, folders, operations and dry-run modes', () => {
    const scan = { operation: 'scan' as const, siteId: 1, dryRun: true };
    const now = CMS_RESOURCE_IDEMPOTENCY_WINDOW_MS * 100;
    const keys = new Set([
      buildCmsResourceTaskIdempotencyKey(1, scan, now),
      buildCmsResourceTaskIdempotencyKey(2, scan, now),
      buildCmsResourceTaskIdempotencyKey(1, { ...scan, dryRun: false }, now),
      buildCmsResourceTaskIdempotencyKey(1, { operation: 'cleanup', siteId: 1, dryRun: true }, now),
      buildCmsResourceTaskIdempotencyKey(1, { operation: 'move', siteId: 1, resourceIds: [1], folderId: 2 }, now),
      buildCmsResourceTaskIdempotencyKey(1, { operation: 'move', siteId: 1, resourceIds: [2], folderId: 2 }, now),
      buildCmsResourceTaskIdempotencyKey(1, { operation: 'move', siteId: 1, resourceIds: [1], folderId: 3 }, now),
    ]);
    expect(keys).toHaveLength(7);
  });

  it('reuses clicks in one bucket but allows the same task in a later window', () => {
    const payload = { operation: 'scan' as const, siteId: 1, dryRun: true };
    const bucketStart = CMS_RESOURCE_IDEMPOTENCY_WINDOW_MS * 50;
    expect(buildCmsResourceTaskIdempotencyKey(9, payload, bucketStart + 1))
      .toBe(buildCmsResourceTaskIdempotencyKey(9, payload, bucketStart + 29_999));
    expect(buildCmsResourceTaskIdempotencyKey(9, payload, bucketStart + 1))
      .not.toBe(buildCmsResourceTaskIdempotencyKey(9, payload, bucketStart + CMS_RESOURCE_IDEMPOTENCY_WINDOW_MS));
  });
});
