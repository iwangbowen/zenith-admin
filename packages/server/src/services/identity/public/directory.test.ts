import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { loadUserDisplays, listSelectableUsers } from './directory';
const state = vi.hoisted(() => ({ select: vi.fn(), findMany: vi.fn() }));
vi.mock('../../../db', () => ({ db: { select: state.select, query: { users: { findMany: state.findMany } } } }));
vi.mock('../../../lib/context', () => ({ currentUser: () => ({ userId: 9, tenantId: 3, roles: [] }) }));
beforeEach(() => vi.clearAllMocks());
describe('identity collaboration read capabilities', () => {
  it('batches known actor IDs once and exposes only display data', async () => {
    const where = vi.fn().mockResolvedValue([{ id: 7, username: 'reader', nickname: null, avatar: null }]);
    state.select.mockReturnValue({ from: () => ({ where }) });
    await expect(loadUserDisplays([7, 7, 0])).resolves.toEqual(new Map([[7, { name: 'reader', avatar: null }]]));
    expect(state.select).toHaveBeenCalledOnce();
    expect(Object.keys(state.select.mock.calls[0][0])).toEqual(['id', 'nickname', 'username', 'avatar']);
    expect(new PgDialect({ casing: 'snake_case' }).sqlToQuery(where.mock.calls[0][0]).params).toEqual([7]);
    await expect(loadUserDisplays([])).resolves.toEqual(new Map());
    expect(state.select).toHaveBeenCalledOnce();
  });
  it('provides the minimum collaboration directory projection without management secrets', async () => {
    state.findMany.mockResolvedValue([{ id: 7, username: 'reader', nickname: 'Reader', avatar: null, department: { name: 'Operations' } }]);
    await expect(listSelectableUsers()).resolves.toEqual([{ id: 7, username: 'reader', nickname: 'Reader', avatar: null, departmentName: 'Operations' }]);
    expect(state.findMany.mock.calls[0][0].columns).toEqual({ id: true, username: true, nickname: true, avatar: true });
    expect(state.findMany.mock.calls[0][0].with).toEqual({ department: { columns: { name: true } } });
  });
});
