import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { RelationAccessContext, RelationProvider, VisibleEntityAnchor } from './types';

const metrics = vi.hoisted(() => ({ timing: vi.fn(), state: vi.fn() }));
vi.mock('../../../db', () => ({ db: {} }));
vi.mock('../../../lib/context', () => ({ runWithCurrentUser: (_user: unknown, run: () => unknown) => run() }));
vi.mock('../../../lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('./metrics', () => ({ recordRelationMetric: vi.fn(), recordRelationSummaryMetric: metrics.timing, recordRelationSummaryState: metrics.state }));
import { summarizeRelationProviders } from './summary';

const anchor: VisibleEntityAnchor = { ref: { type: 'payment.order', key: '21' }, title: 'Order', tenantId: 7 };
const user: RelationAccessContext['user'] = { userId: 9, username: 'reader', roles: [], tenantId: 7 };
const dialect = new PgDialect({ casing: 'snake_case' });
function provider(suffix: string, extra: Partial<RelationProvider> = {}): RelationProvider {
  const key = `payment.order.${suffix}`;
  return { sourceType: 'payment.order', key, permissions: 'authenticated',
    descriptor: { key, labelKey: key, targetTypes: ['payment.refund'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
    list: vi.fn(async () => ({ items: [], hasMore: false, nextCursor: null })), summaryQuery: () => sql<'has-data'>`'has-data'`, ...extra };
}

/** Emulate PostgreSQL's aborted-savepoint rule without hiding transaction ordering. */
function accessFor(replies: Array<unknown[] | Error | { code: string }>) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const events: string[] = [];
  let aborted = false;
  let inSavepoint = false;
  const tx = {
    async execute(query: SQL) {
      if (aborted) throw Object.assign(new Error('transaction aborted'), { code: '25P02' });
      const statement = dialect.sqlToQuery(query);
      if (statement.sql.includes('set_config')) return [];
      queries.push(statement);
      const reply = replies.shift() ?? [];
      if (!Array.isArray(reply)) { aborted = true; throw reply; }
      return reply;
    },
    async transaction<T>(run: (tx: RelationAccessContext['db']) => Promise<T>): Promise<T> {
      if (inSavepoint) throw new Error('overlapping savepoints on one connection');
      inSavepoint = true;
      events.push('savepoint');
      try {
        const result = await run(tx as unknown as RelationAccessContext['db']);
        if (aborted) throw new Error('cannot release aborted savepoint');
        events.push('release');
        return result;
      } catch (error) { aborted = false; events.push('rollback'); throw error; }
      finally { inSavepoint = false; }
    },
  };
  return { access: { user, db: tx as unknown as RelationAccessContext['db'] }, queries, events };
}

beforeEach(() => vi.clearAllMocks());

describe('authorized relation summary batches', () => {
  it('uses one statement for pure summaries and never loads item payloads', async () => {
    const providers = [provider('refunds'), provider('disputes')];
    const { access, queries, events } = accessFor([[{ key: providers[0].key, state: 'attention' }, { key: providers[1].key, state: 'empty' }]]);
    const sections = await summarizeRelationProviders(providers, anchor, access);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain(' union all ');
    expect(events).toEqual(['savepoint', 'release']);
    expect(sections.map((section) => section.summaryState)).toEqual(['attention', 'empty']);
    for (const item of providers) expect(item.list).not.toHaveBeenCalled();
    expect(sections.every((section) => !('total' in section))).toBe(true);
  });

  it('rolls back a failing batch before retrying groups independently', async () => {
    const providers = [provider('refunds'), provider('disputes')];
    const { access, queries, events } = accessFor([{ code: '57014' }, { code: '57014' }, [{ key: providers[1].key, state: 'has-data' }]]);
    const sections = await summarizeRelationProviders(providers, anchor, access);
    expect(sections.map((section) => section.summaryState)).toEqual(['unavailable', 'has-data']);
    expect(queries).toHaveLength(3);
    expect(events).toEqual(['savepoint', 'rollback', 'savepoint', 'rollback', 'savepoint', 'release']);
    expect(metrics.timing).toHaveBeenCalledWith('payment.order', providers[0].key, 'timeout', expect.any(Number));
  });

  it('isolates failed visibility preparation and preserves another valid group', async () => {
    const broken = provider('refunds', { summaryQuery: undefined, prepareSummaryQuery: async (_anchor, { access }) => {
      await access.db.execute(sql`select 1 / 0`);
      return sql<'empty'>`'empty'`;
    } });
    const valid = provider('disputes');
    const { access } = accessFor([new Error('invalid provider query'), [{ key: valid.key, state: 'attention' }]]);
    const sections = await summarizeRelationProviders([broken, valid], anchor, access);
    expect(sections.map((section) => section.summaryState)).toEqual(['unavailable', 'attention']);
    expect(metrics.timing).toHaveBeenCalledWith('payment.order', broken.key, 'error', expect.any(Number));
  });

  it('keeps all groups unavailable when the budget expires without issuing more SQL', async () => {
    const { access, queries } = accessFor([]);
    const providers = [provider('refunds'), provider('disputes')];
    const sections = await summarizeRelationProviders(providers, anchor, { ...access, deadlineAt: performance.now() - 1 });
    expect(sections.map((section) => section.summaryState)).toEqual(['unavailable', 'unavailable']);
    expect(queries).toHaveLength(0);
    expect(metrics.timing).toHaveBeenCalledWith('payment.order', providers[0].key, 'budget', expect.any(Number));
  });

  it('executes fallback scans sequentially after the cheap summaries', async () => {
    const order: string[] = [];
    const scan = (key: string) => provider(key, { summaryQuery: undefined, list: async () => {
      order.push(key);
      await Promise.resolve();
      return { items: [], nextCursor: null, hasMore: false };
    } });
    const pure = provider('refunds');
    const { access, queries } = accessFor([[{ key: pure.key, state: 'has-data' }]]);
    const sections = await summarizeRelationProviders([scan('links'), pure, scan('subjects')], anchor, access);
    expect(order).toEqual(['links', 'subjects']);
    expect(queries).toHaveLength(1);
    expect(sections.map((section) => section.summaryState)).toEqual(['empty', 'has-data', 'empty']);
  });
});
