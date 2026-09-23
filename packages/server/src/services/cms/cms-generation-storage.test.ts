import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn() }));
vi.mock('../../db', () => ({ db: { transaction: mocks.transaction, execute: mocks.execute }, withDbExecutor: (_tx: unknown, fn: () => unknown) => fn() }));
import { cmsGenerationContext } from './cms-generation-context';
import { cmsGenerationSchemaName, hashCmsDeploymentManifest, withCmsGenerationTransaction, withCmsPublicGeneration } from './cms-generation-storage.service';

describe('CMS publication isolation', () => {
  it('reads the active generation once and keeps it for every query in the request', async () => {
    const limit = vi.fn().mockResolvedValue([{ activeGenerationId: 17 }]);
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }), execute: vi.fn() } as unknown as DbTransaction;
    mocks.transaction.mockImplementationOnce((fn: (tx: DbTransaction) => unknown) => fn(tx));
    const values = await withCmsPublicGeneration(2, async () => {
      const before = cmsGenerationContext()?.generationId;
      await Promise.resolve();
      return [before, cmsGenerationContext()?.generationId];
    });
    expect(values).toEqual([17, 17]);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    expect(cmsGenerationContext()).toBeUndefined();
  });
  it('propagates candidate failure to transaction rollback without activating a pointer', async () => {
    const update = vi.fn();
    const tx = { execute: vi.fn(), update } as unknown as DbTransaction;
    mocks.transaction.mockImplementationOnce((fn: (tx: DbTransaction) => unknown) => fn(tx));
    await expect(withCmsGenerationTransaction(2, 18, true, async () => {
      expect(cmsGenerationContext()).toEqual({ siteId: 2, generationId: 18, candidate: true });
      throw new Error('candidate rendering failed');
    })).rejects.toThrow('candidate rendering failed');
    expect(update).not.toHaveBeenCalled();
    expect(cmsGenerationContext()).toBeUndefined();
  });
  it('rejects untrusted schema identifiers', () => {
    for (const id of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => cmsGenerationSchemaName(id)).toThrow();
    expect(cmsGenerationSchemaName(18)).toBe('cms_generation_18');
  });
  it('keeps the manifest digest stable after PostgreSQL JSONB reorders object keys', () => {
    const first = { tables: {}, revisions: [], sitePublicRevision: 1, createdAt: '2026-01-01T00:00:00Z', artifacts: [{ path: 'index.html', checksum: 'abc', size: 12 }] };
    const reloaded = { createdAt: first.createdAt, sitePublicRevision: 1, revisions: [], tables: {}, artifacts: [{ size: 12, checksum: 'abc', path: 'index.html' }] };
    expect(hashCmsDeploymentManifest(first)).toBe(hashCmsDeploymentManifest(reloaded));
  });
});
