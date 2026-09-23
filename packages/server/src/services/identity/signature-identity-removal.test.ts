import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ rows: [] as unknown[][], events: [] as string[], release: vi.fn() }));
vi.mock('../../db', async () => {
  const { getTableName } = await import('drizzle-orm');
  const select = () => {
    const result = state.rows.shift() ?? [];
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain,
      for: () => { state.events.push('lock'); return chain; }, limit: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
    return chain;
  };
  const db = { select, $count: async () => 2,
    delete: (table: Parameters<typeof getTableName>[0]) => {
      state.events.push('delete:' + getTableName(table));
      const chain = { where: () => chain, returning: async () => [{ id: 7 }, { id: 8 }],
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve) };
      return chain;
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.events.push('begin');
      try { const result = await fn(db); state.events.push('commit'); return result; }
      catch (error) { state.events.push('rollback'); throw error; }
    },
  };
  return { db };
});
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, username: 'admin', tenantId: null, roles: ['super_admin'] }) }));
vi.mock('../../lib/data-scope', () => ({ getDataScopeCondition: async () => undefined }));
vi.mock('../../lib/session-manager', () => ({ forceLogoutAllByUsers: async () => [], unlockUser: vi.fn(), batchLoginChallengeRequired: vi.fn(async () => new Set()), getOnlineSessions: vi.fn() }));
vi.mock('../../lib/data-mask/reveal', () => ({ registerRevealSource: vi.fn() }));
vi.mock('../../lib/identity-lifecycle', () => ({ emitIdentityRemoval: vi.fn() }));
vi.mock('./user-signature-lifecycle', () => ({ releaseIdentitySignatures: state.release }));

import { deleteUser, batchDeleteUsers } from './users.service';
import { deleteTenant } from './tenants.service';

beforeEach(() => {
  vi.clearAllMocks(); state.rows = []; state.events = [];
  state.release.mockImplementation(async () => { state.events.push('release'); });
});
describe('identity deletion includes signature cleanup', () => {
  it('single user deletion releases signatures before the user cascade', async () => {
    state.rows = [[{ id: 7, tenantId: null }], [{ id: 7, username: 'member' }], [{ id: 7 }]];
    await deleteUser(7);
    expect(state.events).toEqual(['begin', 'lock', 'release', 'delete:users', 'commit']);
    expect(new PgDialect().sqlToQuery(state.release.mock.calls[0][1]).params).toEqual([7]);
  });
  it('batch user deletion releases exactly the locked user identities', async () => {
    state.rows = [[{ id: 7, username: 'member' }, { id: 8, username: 'member2' }], [{ id: 7 }, { id: 8 }]];
    expect(await batchDeleteUsers([7, 8])).toBe(2);
    expect(state.events).toEqual(['begin', 'lock', 'release', 'delete:users', 'commit']);
    expect(new PgDialect().sqlToQuery(state.release.mock.calls[0][1]).params).toEqual([7, 8]);
  });
  it('tenant deletion covers both tenant-owned templates and cascading user templates', async () => {
    state.rows = [[{ id: 3 }], [{ id: 7 }, { id: 8 }]];
    await deleteTenant(3);
    expect(state.events).toEqual(['begin', 'lock', 'lock', 'release', 'delete:tenants', 'commit']);
    expect(new PgDialect().sqlToQuery(state.release.mock.calls[0][1]).params).toEqual([3, 7, 8]);
    expect(state.release.mock.calls[0][2]).toBe(3);
  });
  it('does not delete the parent identity after a failed file reference release', async () => {
    state.rows = [[{ id: 3 }], [{ id: 7 }]];
    state.release.mockRejectedValueOnce(new Error('release failed'));
    await expect(deleteTenant(3)).rejects.toThrow('release failed');
    expect(state.events).not.toContain('delete:tenants');
    expect(state.events.at(-1)).toBe('rollback');
  });
});
