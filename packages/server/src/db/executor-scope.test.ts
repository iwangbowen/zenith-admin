import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from './types';
vi.mock('../config', () => ({ config: { databaseUrl: 'postgresql://unit:test@localhost:5432/unit_test_never_connects', database: { maxConnections: 1, idleTimeoutSeconds: 1, connectTimeoutSeconds: 1, ssl: false }, log: { level: 'silent', dir: 'logs', maxFiles: '30d' }, redis: { keyPrefix: 'test:' } } }));
vi.mock('../lib/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { db, withDbExecutor, withoutDbExecutor } = await import('./index');

describe('scoped CMS database executor', () => {
  it('isolates simultaneous generations and restores the parent after a failed candidate', async () => {
    const first = { select: () => 'generation-a' } as unknown as DbTransaction;
    const second = { select: () => 'generation-b' } as unknown as DbTransaction;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const a = withDbExecutor(first, async () => { await gate; return db.select(); });
    const b = withDbExecutor(second, async () => {
      expect(db.select()).toBe('generation-b');
      releaseFirst();
      await expect(withDbExecutor(first, async () => { throw new Error('render failed'); })).rejects.toThrow('render failed');
      expect(db.select()).toBe('generation-b');
      expect(withoutDbExecutor(() => db.select())).not.toBe('generation-b');
      return 'done';
    });
    expect(await Promise.all([a, b])).toEqual(['generation-a', 'done']);
    expect(db.select()).not.toBe('generation-a');
  });
});
