import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../../middleware/auth';

const state = vi.hoisted(() => ({
  user: { userId: 9, username: 'operator', roles: ['operator'], tenantId: 7 } as JwtPayload,
  emitted: vi.fn(), forwarded: vi.fn(),
}));
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>();
  return { ...actual, config: { ...actual.config, multiTenantMode: true } };
});
vi.mock('../../db', async () => ({ db: (await import('drizzle-orm/postgres-js')).drizzle.mock({ casing: 'snake_case' }) }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user, currentUserId: () => state.user.userId }));
vi.mock('../../lib/redis', () => ({ default: {} }));
vi.mock('../../lib/open-event-bus', () => ({ openEventBus: { emit: state.emitted } }));
vi.mock('./iot-forward.service', () => ({ dispatchIotForward: state.forwarded }));
vi.mock('./iot-rule-refs', () => ({ ensureIotRuleReferencesValid: vi.fn() }));
vi.mock('./iot-maintenance.service', () => ({ isDeviceInMaintenance: vi.fn() }));
vi.mock('../messaging/notification-outbox.service', () => ({ notify: vi.fn() }));

import { db } from '../../db';
import { acknowledgeIotAlarm, getIotAlarm, resolveIotAlarm } from './iot-alarms.service';

type Statement = { sql: string; params: unknown[] };
type Executable = { execute: () => Promise<unknown[]>; toSQL: () => Statement };

beforeEach(() => {
  vi.restoreAllMocks(); state.emitted.mockClear(); state.forwarded.mockClear();
  state.user = { userId: 9, username: 'operator', roles: ['operator'], tenantId: 7 };
});

function captureQueries() {
  const statements: Statement[] = [];
  const intercept = (query: Executable) => {
    query.execute = async () => { statements.push(query.toSQL()); return []; };
    return query;
  };
  const select = db.select.bind(db);
  vi.spyOn(db, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, db, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => intercept(Reflect.apply(from, builder, fromArgs));
    return builder;
  });
  const update = db.update.bind(db);
  vi.spyOn(db, 'update').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(update, db, args);
    const set = builder.set;
    builder.set = (...setArgs: unknown[]) => intercept(Reflect.apply(set, builder, setArgs));
    return builder;
  });
  return statements;
}

function expectTenant(statement: Statement, tenantId: number) {
  const match = /"iot_devices"\."tenant_id" = \$(\d+)/.exec(statement.sql);
  expect(match).not.toBeNull();
  expect(statement.params[Number(match![1]) - 1]).toBe(tenantId);
}

describe('alarm details and mutations retain the owning device tenant boundary', () => {
  it.each(['acknowledge', 'resolve'] as const)('%s authorizes in the UPDATE and has no side effects for an invisible alarm', async (action) => {
    const statements = captureQueries();
    await expect(action === 'acknowledge' ? acknowledgeIotAlarm(88) : resolveIotAlarm(88, 'done')).rejects.toMatchObject({ status: 404 });
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain('exists (select');
    expect(statements[0].sql).toContain('"iot_devices"."id" = "iot_alarms"."device_id"');
    expectTenant(statements[0], 7);
    expect(state.emitted).not.toHaveBeenCalled();
    expect(state.forwarded).not.toHaveBeenCalled();
  });

  it('uses the selected tenant for platform-admin detail reads and updates', async () => {
    state.user = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null, viewingTenantId: 23 };
    const statements = captureQueries();
    await expect(getIotAlarm(88)).rejects.toMatchObject({ status: 404 });
    await expect(acknowledgeIotAlarm(88)).rejects.toMatchObject({ status: 404 });
    expect(statements).toHaveLength(2);
    for (const statement of statements) expectTenant(statement, 23);
  });
});
