import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { HTTPException } from 'hono/http-exception';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import type { JwtPayload } from '../../../../middleware/auth';
import type { RelationAccessContext, VisibleEntityAnchor } from '../types';

const state = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('../../../../config', () => ({ config: { multiTenantMode: true, jwtSecret: 'test-reverse-subjects' } }));
vi.mock('../../../../db', async () => {
  const { drizzle: makeDb } = await import('drizzle-orm/postgres-js');
  return { db: makeDb.mock({ casing: 'snake_case' }) };
});
vi.mock('../../../../lib/context', () => ({ hasPermission: async (...codes: string[]) => codes.some((code) => state.permissions.has(code)) }));
vi.mock('../../../../lib/logger', () => ({ default: { error: vi.fn() } }));

import { reverseSubjectProviders, type ReverseSubjectAnchorResolver } from './reverse-subjects.provider';
import { subjectAnchorResolvers } from './subjects.provider';
import { readRelationCursor, signRelationCursor } from '../cursor';

type Statement = { sql: string; params: unknown[] };
type ExecutableQuery = { execute: () => Promise<unknown[]>; toSQL: () => Statement };
const user: JwtPayload = { userId: 9, username: 'reader', roles: [], tenantId: 7 };
const targetTypes = ['identity.user', 'payment.order', 'payment.refund'] as const;
const anchor = (type: CanonicalEntityType = 'notification.outbox', tenantId: number | null = 7): VisibleEntityAnchor => ({
  ref: { type, key: '41' }, tenantId, title: 'source',
});
const target = (key: string, type: CanonicalEntityType = 'payment.order', tenantId: number | null = 7): VisibleEntityAnchor => ({
  ref: { type, key }, tenantId, title: `Object ${key}`,
});

/** Use the real query builder and parameter binding; substitute only final PostgreSQL execution. */
function captureAccess(batches: unknown[][] = [], principal = user) {
  const tx = drizzle.mock({ casing: 'snake_case' });
  const statements: Statement[] = [];
  const selectDistinct = tx.selectDistinct.bind(tx);
  vi.spyOn(tx, 'selectDistinct').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(selectDistinct, tx, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs) as ExecutableQuery;
      query.execute = async () => { statements.push(query.toSQL()); return batches.shift() ?? []; };
      return query;
    };
    return builder;
  });
  return { tx, statements, access: { user: principal, db: tx as unknown as RelationAccessContext['db'] } };
}

function provider(type: CanonicalEntityType, resolve: ReverseSubjectAnchorResolver) {
  return reverseSubjectProviders(targetTypes, resolve).find((item) => item.sourceType === type)!;
}
function visibleResolver(source: VisibleEntityAnchor, hidden = new Set<string>()): ReverseSubjectAnchorResolver {
  return vi.fn(async (type, key) => {
    if (type === source.ref.type && key === source.ref.key) return source;
    if (hidden.has(key)) throw new HTTPException(404);
    return target(key, type, source.tenantId);
  });
}
function expectBinding(statement: Statement, column: string, value: unknown) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped} = \\$(\\d+)`).exec(statement.sql);
  expect(match, `Missing bound column ${column}`).not.toBeNull();
  expect(statement.params[Number(match![1]) - 1]).toEqual(value);
}

beforeEach(() => state.permissions.clear());

describe('reverse subject queries', () => {
  it.each([
    ['notification.outbox', 'notification_outbox_subjects', 'outbox_id', 'system:notify-policy:list'],
    ['tasks.async', 'async_task_subjects', 'task_id', 'system:async-task:list'],
    ['platform.operation-log', 'operation_log_subjects', 'operation_log_id', 'system:log:operation'],
  ] as const)('%s binds its source and exact tenant, deduplicating roles before limiting', async (type, table, idColumn, permission) => {
    const source = anchor(type);
    // SQL, rather than page-local JS deduplication, collapses primary/related role rows into this projection.
    const f = captureAccess([[{ type: 'payment.order', key: '8' }]], { ...user, tenantId: null, roles: ['super_admin'] });
    const subjectProvider = provider(type, visibleResolver(source));
    const result = await subjectProvider.list(source, { limit: 2, access: f.access });
    expect(subjectProvider).toMatchObject({ key: `${type}.subjects`, permissions: [permission], descriptor: { labelKey: 'relation.common.subjects' } });
    expect(result.items.map((item) => item.ref)).toEqual([{ type: 'payment.order', key: '8' }]);
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
    expect(result).not.toHaveProperty('total');
    const statement = f.statements[0];
    expect(statement.sql).toMatch(/^select distinct .*entity_type.*collate "C".*entity_key.*collate "C"/);
    expect(statement.sql).not.toContain('"role"');
    expect(statement.sql).not.toContain('offset');
    expectBinding(statement, `"${table}"."${idColumn}"`, 41);
    expectBinding(statement, `"${table}"."tenant_id"`, 7);
  });

  it('continues past more than one hidden batch and emits a stable tuple cursor at the last shown object', async () => {
    const source = anchor();
    const hidden = Array.from({ length: 35 }, (_, index) => ({ type: 'payment.order', key: String(1000 + index) }));
    const visible = ['2000', '2001', '2002'].map((key) => ({ type: 'payment.order', key }));
    const f = captureAccess([hidden.slice(0, 32), [...hidden.slice(32), ...visible], visible.slice(1)]);
    const resolve = visibleResolver(source, new Set(hidden.map((ref) => ref.key)));
    const subjectProvider = provider(source.ref.type, resolve);
    const first = await subjectProvider.list(source, { limit: 1, access: f.access });
    expect(first.items.map((item) => item.ref.key)).toEqual(['2000']);
    expect(first).toMatchObject({ hasMore: true, nextCursor: JSON.stringify(['payment.order', '2000']) });
    expect(f.statements).toHaveLength(2);
    expect(f.statements[1].params).toEqual(expect.arrayContaining(['payment.order', '1031']));
    const signed = signRelationCursor(first.nextCursor!, 'source-scope');
    const second = await subjectProvider.list(source, { limit: 2, access: f.access, cursor: readRelationCursor(signed, 'source-scope') });
    expect(second.items.map((item) => item.ref.key)).toEqual(['2001', '2002']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(f.statements[2].sql).toMatch(/collate "C" > \$\d+.* or .*collate "C" = \$\d+.*collate "C" > \$\d+/);
    expect(f.statements[2].params).toEqual(expect.arrayContaining(['payment.order', '2000']));
    expect(first).not.toHaveProperty('total');
  });

  it('filters cross-tenant, unregistered and unsupported targets without exposing a count', async () => {
    const source = anchor();
    const rows = [
      { type: 'retired.type', key: '1' }, { type: 'wiki.document', key: '2' },
      { type: 'payment.order', key: '3' }, { type: 'payment.order', key: '4' },
    ];
    const f = captureAccess([rows]);
    const resolve = vi.fn<ReverseSubjectAnchorResolver>(async (type, key) => type === source.ref.type ? source : target(key, type, key === '3' ? 8 : 7));
    const result = await provider(source.ref.type, resolve).list(source, { limit: 2, access: f.access });
    expect(result.items.map((item) => item.ref.key)).toEqual(['4']);
    expect(resolve.mock.calls.map(([type, key]) => [type, key])).toEqual([['notification.outbox', '41'], ['payment.order', '3'], ['payment.order', '4']]);
    expect(result).not.toHaveProperty('total');
    expect(result).toMatchObject({ hasMore: false });
  });

  it.each(['notification.outbox', 'platform.operation-log'] as const)('uses the real %s source permission boundary before querying subjects', async (type) => {
    const source = anchor(type);
    const f = captureAccess();
    const sourceResolver = subjectAnchorResolvers.find((item) => item.type === type)!;
    const resolve: ReverseSubjectAnchorResolver = async (refType, key, access) => {
      const result = await sourceResolver.resolve({ type: refType, key }, access);
      if (!result) throw new HTTPException(404);
      return result;
    };
    await expect(provider(type, resolve).list(source, { limit: 5, access: f.access })).rejects.toMatchObject({ status: 404 });
    expect(f.tx.selectDistinct).not.toHaveBeenCalled();
  });

  it('rejects a source whose ownership changed instead of using a stale authorized anchor', async () => {
    const f = captureAccess();
    const source = anchor('tasks.async');
    await expect(provider(source.ref.type, async () => anchor('tasks.async', 8)).list(source, { limit: 5, access: f.access })).rejects.toMatchObject({ status: 404 });
    expect(f.statements).toHaveLength(0);
  });

  it('uses IS NULL for a platform-owned source even when the operator can view every tenant', async () => {
    const source = anchor('tasks.async', null);
    const f = captureAccess([], { ...user, tenantId: null, roles: ['super_admin'] });
    await provider(source.ref.type, visibleResolver(source)).list(source, { limit: 5, access: f.access });
    expect(f.statements[0].sql).toContain('"async_task_subjects"."tenant_id" is null');
  });

  it.each(['8', '[]', '["payment.order"]', '["unknown.type","1"]', '["payment.order","1","primary"]'])('rejects malformed tuple cursor %s before a subject query', async (cursor) => {
    const source = anchor();
    const f = captureAccess();
    await expect(provider(source.ref.type, visibleResolver(source)).list(source, { limit: 5, cursor, access: f.access })).rejects.toMatchObject({ status: 400 });
    expect(f.statements).toHaveLength(0);
  });

  it('does not claim the collection is empty when the hidden-target scan budget is exhausted', async () => {
    const source = anchor();
    const rows = Array.from({ length: 512 }, (_, index) => ({ type: 'payment.order', key: String(1000 + index) }));
    const batches = Array.from({ length: 16 }, (_, index) => rows.slice(index * 32, index * 32 + 32));
    const f = captureAccess(batches);
    const resolve = visibleResolver(source, new Set(rows.map((ref) => ref.key)));
    await expect(provider(source.ref.type, resolve).list(source, { limit: 1, access: f.access })).rejects.toMatchObject({ status: 503 });
    expect(f.statements).toHaveLength(16);
  });

  it('enforces the shared deadline before resolving or fetching any objects', async () => {
    const source = anchor();
    const f = captureAccess();
    const resolve = visibleResolver(source);
    await expect(provider(source.ref.type, resolve).list(source, { limit: 1, access: { ...f.access, deadlineAt: 0 } })).rejects.toMatchObject({ status: 503 });
    expect(resolve).not.toHaveBeenCalled();
    expect(f.statements).toHaveLength(0);
  });
});
