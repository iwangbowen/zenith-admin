import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/types';
import { workflowTasks } from '../../../db/schema';

type Row = Record<string, unknown>;
type State = { tasks: Row[]; urges: Row[]; events: Row[]; nextId: number };
const harness = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  instance: {} as Row,
  failEventAt: 0,
  eventCalls: 0,
  working: new Map<unknown, State>(),
  transaction: (_fn: (tx: DbTransaction) => Promise<unknown>): Promise<unknown> => Promise.resolve(),
}));
vi.mock('../../../db', () => ({ db: harness.db }));
vi.mock('../../../lib/context', () => ({ currentUser: () => ({ userId: 1, username: '发起人', roles: [] }) }));
vi.mock('./mapping', () => ({ mapTask: (row: unknown) => row }));
vi.mock('../../../lib/workflow-jobs/lease', () => ({
  workflowTransaction: (fn: (tx: DbTransaction) => Promise<unknown>) => harness.transaction(fn),
}));
vi.mock('./shared', () => ({
  requireVisibleInstance: async () => harness.instance,
  lockInstanceExpecting: async (tx: unknown, _id: number, status: string) => {
    expect(harness.working.has(tx)).toBe(true);
    if (harness.instance.status !== status) throw new Error('instance status changed');
  },
  emitTaskEvent: async (type: string, task: Row, meta: Row, tx: unknown) => {
    const working = harness.working.get(tx);
    if (!working) throw new Error('event published outside its transaction');
    harness.eventCalls++;
    if (harness.eventCalls === harness.failEventAt) throw new Error('event persistence unavailable');
    working.events.push({ type, task: structuredClone(task), meta: structuredClone(meta) });
  },
}));

import { addInstanceCc, forwardInstance, urgeInstance, urgeTask } from './cc-urge';

const dialect = new PgDialect({ casing: 'snake_case' });
function matches(row: Row, condition: SQL): boolean {
  const query = dialect.sqlToQuery(condition);
  return [...query.sql.matchAll(/"\w+"\."(\w+)"\s*(?:=\s*(\$\d+)|in\s*\(([^)]+)\))/g)].every((match) => {
    const key = match[1].replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return ((match[2] ?? match[3]).match(/\$\d+/g) ?? []).some((placeholder) => query.params[Number(placeholder.slice(1)) - 1] === row[key]);
  });
}

let committed: State;
function executor(state: () => State): DbTransaction {
  const rowsFor = (table: unknown) => table === workflowTasks ? state().tasks : state().urges;
  const select = (distinct = false) => ({ from: (table: unknown) => {
    let rows = [...rowsFor(table)];
    const query = {
      where(condition: SQL) { rows = rows.filter((row) => matches(row, condition)); return query; },
      orderBy() { rows.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)); return query; },
      for() { return query; },
      limit(limit: number) { rows = rows.slice(0, limit); return query; },
      then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
        const result = distinct ? [...new Map(rows.map((row) => [row.taskId, row])).values()] : rows;
        return Promise.resolve(structuredClone(result)).then(resolve, reject);
      },
    };
    return query;
  } });
  return {
    select: () => select(), selectDistinctOn: () => select(true),
    insert: (table: unknown) => ({ values: (input: Row | Row[]) => ({ returning: async () => {
      const rows = (Array.isArray(input) ? input : [input]).map((row) => ({ id: state().nextId++, createdAt: new Date(), ...row }));
      rowsFor(table).push(...rows);
      return structuredClone(rows);
    } }) }),
  } as unknown as DbTransaction;
}

beforeEach(() => {
  harness.instance = { id: 10, definitionId: 3, initiatorId: 1, status: 'running', tenantId: 7,
    definitionSnapshot: { flowData: { nodes: [{ data: { key: 'cc', type: 'ccNode', label: '知会' } }] } } };
  committed = { tasks: [{ id: 20, instanceId: 10, assigneeId: 2, status: 'pending', nodeType: 'approve' }], urges: [], events: [], nextId: 30 };
  harness.failEventAt = 0; harness.eventCalls = 0; harness.working.clear();
  Object.assign(harness.db, executor(() => committed));
  let previous: Promise<unknown> = Promise.resolve();
  harness.transaction = (fn) => {
    // This boundary double models serial transactions and rollback; it does not replace PG integration tests.
    const result = previous.then(async () => {
      const working = structuredClone(committed);
      const tx = executor(() => working);
      harness.working.set(tx, working);
      try { const value = await fn(tx); committed = working; return value; }
      finally { harness.working.delete(tx); }
    });
    previous = result.catch(() => undefined);
    return result;
  };
});

describe('CC and urge transaction handoff', () => {
  it('a failure on the second CC event rolls back both CC rows and the first event', async () => {
    harness.failEventAt = 2;
    await expect(forwardInstance(10, [2, 3])).rejects.toThrow('event persistence unavailable');
    expect(committed.tasks).toHaveLength(1);
    expect(committed.events).toEqual([]);
    harness.failEventAt = 0;
    const retry = await forwardInstance(10, [2, 3]);
    expect(retry.list).toHaveLength(2);
    expect(committed.tasks.slice(1).every((row) => row.nodeKey === '__forward__')).toBe(true);
    expect(committed.events).toHaveLength(2);
  });

  it('concurrent forwarding rechecks duplicates after entering the instance transaction', async () => {
    const results = await Promise.all([forwardInstance(10, [2, 3]), forwardInstance(10, [2, 3])]);
    expect(results.map((result) => result.list.length).sort()).toEqual([0, 2]);
    expect(committed.events).toHaveLength(2);
  });

  it('a failed single urge does not consume the five minute cooldown', async () => {
    harness.failEventAt = 1;
    await expect(urgeTask(20, '请处理')).rejects.toThrow('event persistence unavailable');
    expect(committed.urges).toEqual([]);
    expect(committed.events).toEqual([]);
    harness.failEventAt = 0;
    await urgeTask(20, '请处理');
    expect(committed.urges).toHaveLength(1);
    expect(committed.events[0]).toMatchObject({ type: 'task.urged', meta: { tenantId: 7, comment: '请处理' } });
  });

  it('single and bulk urges share the cooldown transaction and cannot both notify', async () => {
    const outcomes = await Promise.allSettled([urgeTask(20), urgeInstance(10)]);
    expect(outcomes.some((result) => result.status === 'fulfilled')).toBe(true);
    for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ status: 429 });
    expect(committed.urges).toHaveLength(1);
    expect(committed.events).toHaveLength(1);
    await expect(urgeTask(20)).rejects.toMatchObject({ status: 429 });
  });

  it('a later bulk event failure rolls back every urge in the batch', async () => {
    committed.tasks.push({ id: 21, instanceId: 10, assigneeId: 3, status: 'pending', nodeType: 'approve' });
    harness.failEventAt = 2;
    await expect(urgeInstance(10)).rejects.toThrow('event persistence unavailable');
    expect(committed.urges).toEqual([]);
    expect(committed.events).toEqual([]);
  });

  it('additional CC recipients and their events commit together and deduplicate retries', async () => {
    harness.failEventAt = 1;
    await expect(addInstanceCc(10, 'cc', [2, 3])).rejects.toThrow('event persistence unavailable');
    expect(committed.tasks).toHaveLength(1);
    harness.failEventAt = 0;
    expect((await addInstanceCc(10, 'cc', [2, 3])).list).toHaveLength(2);
    expect((await addInstanceCc(10, 'cc', [2, 3])).list).toHaveLength(0);
    expect(committed.events).toHaveLength(2);
  });
});
