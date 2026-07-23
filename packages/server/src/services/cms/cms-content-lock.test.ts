import { describe, expect, it } from 'vitest';
import { assertCmsContentUnlocked } from './cms-content-lock.service';
import { canAutoOfflineCmsContent } from './cms-contents.service';

describe('CMS persistent content lock', () => {
  it('allows unlocked content and rejects a locked row with HTTP 423', () => {
    expect(() => assertCmsContentUnlocked({ id: 1, lockedAt: null, lockReason: null })).not.toThrow();
    expect(() => assertCmsContentUnlocked({
      id: 2,
      lockedAt: new Date(),
      lockReason: '法律保全',
    })).toThrow(expect.objectContaining({ status: 423 }));
  });

  it('preserves expireAt and excludes locked content from automatic offline policy', () => {
    const expireAt = new Date('2026-07-22T01:00:00Z');
    const now = new Date('2026-07-22T02:00:00Z');
    expect(canAutoOfflineCmsContent({
      status: 'published', expireAt, deletedAt: null, lockedAt: new Date(),
    }, now)).toBe(false);
    expect(canAutoOfflineCmsContent({
      status: 'published', expireAt, deletedAt: null, lockedAt: null,
    }, now)).toBe(true);
    expect(expireAt).toEqual(new Date('2026-07-22T01:00:00Z'));

  });
});
