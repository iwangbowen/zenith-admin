import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { JwtPayload } from '../../middleware/auth';
import type { SessionInfo } from '../../lib/session-manager';

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), count: vi.fn(), rows: vi.fn(), scope: vi.fn() }));

vi.mock('../../db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const queryBuilder = drizzle.mock({ casing: 'snake_case' });
  return { db: { select: queryBuilder.select.bind(queryBuilder), $count: mocks.count, query: { users: { findMany: mocks.rows } } } };
});
vi.mock('../../config', async (original) => {
  const actual = await original<typeof import('../../config')>();
  return { ...actual, config: { ...actual.config, multiTenantMode: true } };
});
vi.mock('../../lib/data-scope', () => ({ getDataScopeCondition: mocks.scope }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 11, username: 'operator', roles: ['admin'], tenantId: 3 }) }));
vi.mock('../../lib/session-manager', () => ({
  getOnlineSessions: mocks.sessions,
  batchLoginChallengeRequired: async () => new Set(),
  unlockUser: vi.fn(),
  forceLogoutAllByUsers: vi.fn(),
}));

import { users } from '../../db/schema';
import { buildUsersListWhere, listUsers, type UserWithRelations } from './users.service';
import { usersExportDefinition } from '../../lib/export-center/definitions/users';

const actor = { userId: 11, username: 'operator', roles: ['admin'], tenantId: 3 } as JwtPayload;
const dialect = new PgDialect({ casing: 'snake_case' });
const render = (where: SQL | undefined) => where ? dialect.sqlToQuery(where) : { sql: '', params: [] };
const session = (userId: number) => ({ userId, lastActiveAt: new Date('2026-11-04T10:00:00Z') } as SessionInfo);

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.sessions.mockResolvedValue([session(2), session(2), session(8)]);
  mocks.scope.mockResolvedValue(eq(users.departmentId, 7));
  mocks.count.mockResolvedValue(0);
  mocks.rows.mockResolvedValue([]);
});

describe('user list filtering', () => {
  it('intersects role membership and online IDs with tenant and data scopes', async () => {
    const query = render(await buildUsersListWhere({ roleId: 5, onlineStatus: 'online' }, actor));
    expect(query.sql).toContain('exists (select');
    expect(query.sql).toContain('"user_roles"."user_id" = "users"."id"');
    expect(query.sql).toContain('"user_roles"."role_id" =');
    expect(query.sql).toContain('"users"."id" in');
    expect(query.sql).toContain('"users"."department_id" =');
    expect(query.sql).toContain('"users"."tenant_id" =');
    expect(query.params).toEqual([5, 2, 8, 7, 3]);
  });

  it('excludes all active users when filtering offline and handles an empty online set', async () => {
    const offline = render(await buildUsersListWhere({ onlineStatus: 'offline' }, actor));
    expect(offline.sql).toContain('"users"."id" not in');
    expect(offline.params).toEqual([2, 8, 7, 3]);
    mocks.scope.mockResolvedValue(undefined);
    const platform = { ...actor, roles: ['super_admin'], tenantId: null };
    expect(render(await buildUsersListWhere({ onlineStatus: 'online' }, platform, [])).sql).toBe('false');
    expect(render(await buildUsersListWhere({ onlineStatus: 'offline' }, platform, [])).sql).toBe('true');
  });

  it('uses one session snapshot for the count, page and rendered online state', async () => {
    const stamp = new Date('2026-11-04T10:00:00Z');
    mocks.rows.mockResolvedValue([{
      id: 8, username: 'user8', nickname: '用户八', email: null, status: 'enabled', departmentId: 7,
      department: null, userRoles: [], userPositions: [], passwordUpdatedAt: stamp, createdAt: stamp, updatedAt: stamp,
    } as UserWithRelations]);
    mocks.count.mockResolvedValue(4);
    mocks.sessions.mockResolvedValueOnce([session(8)]).mockResolvedValueOnce([]);

    const result = await listUsers({ page: 2, pageSize: 1, onlineStatus: 'online' });
    expect(mocks.sessions).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ total: 4, page: 2, pageSize: 1, list: [{ id: 8, isOnline: true }] });
    const rowQuery = mocks.rows.mock.calls[0][0];
    expect(rowQuery).toMatchObject({ limit: 1, offset: 1 });
    expect(rowQuery.where).toBe(mocks.count.mock.calls[0][1]);
    expect(render(rowQuery.where).params).toEqual([8, 7, 3]);
  });

  it('keeps export counting and rows aligned with the same filters, including email and position', async () => {
    const query = { roleId: '5', onlineStatus: 'offline', positionId: '6', email: 'example.com' };
    await usersExportDefinition.countRows(query, actor);
    await usersExportDefinition.streamRows(query, actor);
    const countWhere = render(mocks.count.mock.calls[0][1]);
    const rowsWhere = render(mocks.rows.mock.calls[0][0].where);
    expect(rowsWhere).toEqual(countWhere);
    expect(countWhere.sql).toContain('"user_positions"."position_id" =');
    expect(countWhere.sql).toContain('"user_roles"."role_id" =');
    expect(countWhere.sql).toContain('"users"."id" not in');
    expect(countWhere.params).toEqual(['%example.com%', 6, 5, 2, 8, 7, 3]);
  });
});
