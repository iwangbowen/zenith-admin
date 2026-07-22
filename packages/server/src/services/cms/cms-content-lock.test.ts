import { readFile } from 'node:fs/promises';
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

  it('atomically cancels scheduling and logs lock/unlock operations', async () => {
    const source = await readFile(new URL('./cms-content-lock.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('scheduledAt: null');
    expect(source).toContain("logContentOp(tx, id, 'locked'");
    expect(source).toContain("logContentOp(tx, id, 'unlocked'");
  });

  it('keeps scheduler, workflow, channel and member mutation paths lock-aware', async () => {
    const names = [
      'cms-contents.service.ts',
      'cms-scheduled.service.ts',
      'cms-workflow.service.ts',
      'cms-channels.service.ts',
      'cms-contribution.service.ts',
    ];
    const sources = await Promise.all(names.map((name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')));
    expect(sources[0]).toContain('assertCmsContentUnlocked');
    expect(sources[0]).toContain('assertCmsContentsUnlocked');
    expect(sources[1]).toContain('isNull(cmsContents.lockedAt)');
    expect(sources[2]).toContain('isNull(cmsContents.lockedAt)');
    expect(sources[3]).toContain('assertCmsContentsUnlocked');
    expect(sources[4]).toContain('assertCmsContentUnlocked');
  });

  it('preserves expireAt and atomically excludes locked content from automatic offline', async () => {
    const expireAt = new Date('2026-07-22T01:00:00Z');
    const now = new Date('2026-07-22T02:00:00Z');
    expect(canAutoOfflineCmsContent({
      status: 'published', expireAt, deletedAt: null, lockedAt: new Date(),
    }, now)).toBe(false);
    expect(canAutoOfflineCmsContent({
      status: 'published', expireAt, deletedAt: null, lockedAt: null,
    }, now)).toBe(true);
    expect(expireAt).toEqual(new Date('2026-07-22T01:00:00Z'));

    const source = await readFile(new URL('./cms-contents.service.ts', import.meta.url), 'utf8');
    const block = source.match(/export async function offlineExpiredCmsContents[\s\S]*?return rows\.map\(\(r\) => r\.id\);\n}/)?.[0] ?? '';
    expect(block).toContain("set({ status: 'offline' })");
    expect(block).toContain('isNull(cmsContents.lockedAt)');
    expect(block).not.toContain('expireAt: null');
  });
});
