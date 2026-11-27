import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { inAppMessages } from '../../db/schema';
import { notificationEventKeysInGroup } from '@zenith/shared/messaging';

const state = vi.hoisted(() => ({ tenant: undefined as SQL | undefined, predicates: [] as SQL[], limits: [] as number[], offsets: [] as number[], updates: [] as SQL[], pushed: vi.fn() }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 7, tenantId: 23 }) }));
vi.mock('../../lib/tenant', () => ({ tenantScope: () => state.tenant, currentCreateTenantId: () => 23 }));
vi.mock('../../lib/ws-manager', () => ({ scheduleSendToUsers: state.pushed, scheduleSendPerUser: vi.fn() }));
vi.mock('../../lib/sms-sender', () => ({ renderTemplate: vi.fn() }));
vi.mock('../../db', () => ({ db: {
  $count: (_table: unknown, where: SQL) => { state.predicates.push(where); return Promise.resolve(45); },
  select: () => {
    const query = { from: () => query, leftJoin: () => query, where: (where: SQL) => { state.predicates.push(where); return query; }, orderBy: () => query, $dynamic: () => query,
      limit: (limit: number) => { state.limits.push(limit); return query; }, offset: (offset: number) => { state.offsets.push(offset); return query; },
      then: (resolve: (rows: object[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    return query;
  },
  update: () => ({ set: () => ({ where: (where: SQL) => { state.updates.push(where); return { returning: async () => [{ id: 10, userId: 7 }, { id: 11, userId: 7 }] }; } }) }),
} }));
import { listMyInAppMessages, markAllAsRead, unreadCount } from './in-app-messages.service';

const dialect = new PgDialect({ casing: 'snake_case' });
beforeEach(() => {
  state.tenant = eq(inAppMessages.tenantId, 23);
  state.predicates.length = 0; state.updates.length = 0; state.limits.length = 0; state.offsets.length = 0; vi.clearAllMocks();
});

function assertWorkflowScope(where: SQL) {
  const rendered = dialect.sqlToQuery(where);
  expect(rendered.sql).toContain('user_id');
  expect(rendered.sql).toContain('tenant_id');
  expect(rendered.sql).toContain('event_key');
  expect(rendered.params).toEqual(expect.arrayContaining([7, 23, ...notificationEventKeysInGroup('workflow')]));
  expect(rendered.params).not.toContain('ops.monitor.alert');
  expect(rendered.sql).not.toMatch(/title|link/);
}

describe('recipient notification event scope', () => {
  it('applies the same recipient, tenant and event predicate before both count and page selection', async () => {
    const result = await listMyInAppMessages({ page: 2, pageSize: 20, eventGroup: 'workflow' });
    expect(result).toMatchObject({ total: 45, page: 2, pageSize: 20 });
    expect(state.predicates).toHaveLength(2);
    expect(dialect.sqlToQuery(state.predicates[0])).toEqual(dialect.sqlToQuery(state.predicates[1]));
    state.predicates.forEach(assertWorkflowScope);
    expect(state.limits).toEqual([20]); expect(state.offsets).toEqual([20]);
  });
  it('shares the workflow scope with unread count and scoped mark-all and preserves the scope in the websocket receipt', async () => {
    expect(await unreadCount({ eventGroup: 'workflow' })).toEqual({ count: 45 });
    expect(await markAllAsRead({ eventGroup: 'workflow' })).toEqual({ count: 2 });
    assertWorkflowScope(state.predicates[0]); assertWorkflowScope(state.updates[0]);
    expect(dialect.sqlToQuery(state.updates[0]).params).toContain(false);
    expect(state.pushed).toHaveBeenCalledWith([{ userId: 7 }], { type: 'in-app-message:read-all', payload: { eventGroup: 'workflow' } });
  });
  it('keeps the unscoped desktop inbox across event groups while retaining user and tenant restrictions', async () => {
    await unreadCount();
    const rendered = dialect.sqlToQuery(state.predicates[0]);
    expect(rendered.params).toEqual(expect.arrayContaining([7, 23, false]));
    expect(rendered.sql).not.toContain('event_key');
    await markAllAsRead({});
    expect(state.pushed).toHaveBeenCalledWith([{ userId: 7 }], { type: 'in-app-message:read-all', payload: {} });
  });
});
