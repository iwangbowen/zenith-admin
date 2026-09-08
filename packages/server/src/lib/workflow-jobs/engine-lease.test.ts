import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Execute the real engine against an atomic in-memory query adapter. Fake time controls
// handler stalls independently of heartbeat, cancellation and reconciliation.
const model = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Expr = { evaluate: (row: Row) => unknown };
  type Table = { tableName: string } & Record<string, unknown>;
  const state: Record<string, Row[]> = { jobs: [], executions: [], instances: [] };
  const expr = (evaluate: Expr['evaluate']): Expr => ({ evaluate });
  const value = (input: unknown, row: Row): unknown => input && typeof input === 'object' && 'evaluate' in input
    ? (input as Expr).evaluate(row) : input;
  const scalar = (input: unknown, row: Row): number | string | null | undefined => {
    const resolved = value(input, row);
    return resolved instanceof Date ? resolved.getTime() : resolved as number | string | null | undefined;
  };
  const table = (name: string): Table => new Proxy({ tableName: name }, {
    get: (target, key) => key === 'tableName' ? target.tableName : expr((row) => row[String(key)]),
  });
  const tables = { workflowJobs: table('jobs'), workflowJobExecutions: table('executions'), workflowInstances: table('instances') };
  const operations = {
    eq: (a: unknown, b: unknown) => expr((row) => scalar(a, row) === scalar(b, row)),
    ne: (a: unknown, b: unknown) => expr((row) => scalar(a, row) !== scalar(b, row)),
    gt: (a: unknown, b: unknown) => expr((row) => scalar(a, row) != null && scalar(b, row) != null && Number(scalar(a, row)) > Number(scalar(b, row))),
    lte: (a: unknown, b: unknown) => expr((row) => scalar(a, row) != null && scalar(b, row) != null && Number(scalar(a, row)) <= Number(scalar(b, row))),
    isNull: (a: unknown) => expr((row) => value(a, row) == null),
    inArray: (a: unknown, b: unknown[]) => expr((row) => b.includes(value(a, row))),
    notInArray: (a: unknown, b: unknown[]) => expr((row) => !b.includes(value(a, row))),
    and: (...items: unknown[]) => expr((row) => items.filter(Boolean).every((item) => value(item, row))),
    or: (...items: unknown[]) => expr((row) => items.filter(Boolean).some((item) => value(item, row))),
    asc: (a: unknown) => a,
    sql: (strings: TemplateStringsArray, ...args: unknown[]) => expr((row) => {
      const text = strings.join('?');
      if (text.includes('least(')) return new Date(Math.min(Date.now() + Number(value(args[0], row)), Number(scalar(args[1], row))));
      if (text.includes("case when") && text.includes("= 'running'")) {
        return Math.max(Number(value(args[0], row)) - (value(args[1], row) === 'running' ? 1 : 0), 0);
      }
      if (text.includes('extract(epoch')) {
        const elapsed = text.includes('clock_timestamp() -') ? Date.now() - Number(scalar(args[0], row)) : Number(scalar(args[0], row)) - Date.now();
        return Math.max(0, elapsed);
      }
      if (text.includes("interval '1 millisecond'")) return new Date(Date.now() + Number(value(args[0], row) ?? 0));
      if (text.includes("interval '1 minute'")) return new Date(Date.now() - Number(value(args[0], row)) * 60_000);
      if (text.includes('+ 1')) return Number(value(args[0], row)) + 1;
      if (text.includes(' < ')) return Number(value(args[0], row)) < Number(value(args[1], row));
      if (text === 'clock_timestamp()') return new Date();
      throw new Error(`Unsupported SQL expression in test adapter: ${text}`);
    }),
  };
  class Query {
    tableName = 'jobs';
    predicate: unknown = expr(() => true);
    selection?: Row;
    patch: Row = {};
    inserted?: Row;
    cap = Infinity;
    order: unknown[] = [];
    constructor(readonly mode: 'read' | 'update' | 'insert', selection?: Row) { this.selection = selection; }
    from(t: Table) { this.tableName = t.tableName; return this; }
    set(patch: Row) { this.patch = patch; return this; }
    values(row: Row) { this.inserted = row; return this; }
    onConflictDoNothing() { return this; }
    where(predicate: unknown) { this.predicate = predicate; return this; }
    orderBy(...order: unknown[]) { this.order = order; return this; }
    limit(cap: number) { this.cap = cap; return this; }
    for() { return this; }
    execute(): Row[] {
      const all = state[this.tableName];
      if (this.inserted) {
        const id = all.length + 1;
        all.push({ id, generation: 0, attempts: 0, maxAttempts: 1, operationKey: `op-${id}`, status: 'pending',
          executionTimeoutMs: 600_000, runAt: new Date(), createdAt: new Date(), leaseToken: null, leaseUntil: null,
          executionDeadline: null, ...this.inserted });
      }
      let found = this.mode === 'insert' ? all.slice(-1) : all.filter((row) => value(this.predicate, row));
      if (this.order.length) found = found.toSorted((a, b) => {
        for (const column of this.order) { const delta = Number(scalar(column, a)) - Number(scalar(column, b)); if (delta) return delta; }
        return 0;
      });
      found = found.slice(0, this.cap);
      if (this.mode === 'update') for (const row of found) {
        Object.assign(row, Object.fromEntries(Object.entries(this.patch).map(([key, input]) => [key, value(input, row)])));
      }
      return found.map((row) => this.selection
        ? Object.fromEntries(Object.entries(this.selection).map(([key, input]) => [key, value(input, row)]))
        : structuredClone(row));
    }
    returning(selection?: Row) { this.selection = selection; return Promise.resolve(this.execute()); }
    then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
  }
  const db = {
    select: (selection?: Row) => new Query('read', selection),
    update: (t: Table) => new Query('update').from(t),
    insert: (t: Table) => new Query('insert').from(t),
    $count: async (t: Table, predicate: unknown) => state[t.tableName].filter((row) => value(predicate, row)).length,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(state);
      try { return await fn({ ...db }); } catch (error) { Object.assign(state, snapshot); throw error; }
    },
  };
  return { state, db, tables, operations, handler: vi.fn(), send: vi.fn().mockResolvedValue('wake') };
});

vi.mock('drizzle-orm', () => model.operations);
vi.mock('../../db', () => ({ db: model.db }));
vi.mock('../../db/schema', () => model.tables);
vi.mock('../context', () => ({ currentTraceId: () => null, currentParentRef: () => null,
  runWithTraceId: (_id: string, fn: () => unknown) => fn(), runWithParentRef: (_id: string, fn: () => unknown) => fn() }));
vi.mock('../pg-boss-scheduler', () => ({ registerSystemQueueWorker: vi.fn(), sendSystemJobAfter: model.send }));
vi.mock('../logger', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../datetime', () => ({ formatDateTime: (date: Date) => date.toISOString() }));
vi.mock('./registry', () => ({ getJobHandler: () => model.handler }));

import { cancelJobs, drainWorkflowJobs, enqueueJob, pauseInstanceJobs, resumeInstanceJobs, retryJob, runJob } from './engine';
import { workflowTransaction } from './lease';
import { WorkflowJobError } from './errors';
import { deferWorkflowJobEffect } from './execution-context';
import type { DbExecutor } from '../../db/types';
import type { WorkflowJobContext } from './types';

function seed(count = 1, patch: Record<string, unknown> = {}) {
  model.state.jobs = Array.from({ length: count }, (_, i) => ({ id: i + 1, jobType: 'webhook_delivery', status: 'pending',
    attempts: 0, maxAttempts: 3, generation: 0, operationKey: `op-${i + 1}`, priority: 100, runAt: new Date(),
    createdAt: new Date(), payload: {}, instanceId: 7, taskId: i + 1, leaseToken: null, leaseUntil: null,
    executionDeadline: null, executionTimeoutMs: 600_000, ...patch }));
  model.state.instances = [{ id: 7 }];
}
function deferred() { let resolve!: (result?: { result: Record<string, unknown> }) => void;
  const promise = new Promise<{ result: Record<string, unknown> } | undefined>((r) => { resolve = r; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

describe('workflow execution leases', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
    model.state.jobs = []; model.state.executions = []; model.state.instances = [];
    model.handler.mockReset(); model.handler.mockResolvedValue(undefined); model.send.mockClear();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('reconciliation publishes 50 wakeups without claiming or running any handler', async () => {
    seed(50); const result = await drainWorkflowJobs({ limit: 50 });
    expect(result).toEqual({ recovered: 0, dead: 0, requeued: 50 });
    expect(model.handler).not.toHaveBeenCalled();
    expect(model.state.jobs.every((job) => job.status === 'pending' && job.attempts === 0)).toBe(true);
  });
  it('transactional enqueue has no pre-commit queue or direct-execution side effects', async () => {
    await enqueueJob({ jobType: 'event_dispatch' }, { ...model.db } as unknown as DbExecutor);
    await vi.advanceTimersByTimeAsync(1000);
    expect(model.send).not.toHaveBeenCalled(); expect(model.handler).not.toHaveBeenCalled();
  });
  it('publishes transactional intents after commit and discards rolled-back wakeups', async () => {
    await workflowTransaction(async (tx) => {
      await enqueueJob({ jobType: 'event_dispatch' }, tx);
      expect(model.send).not.toHaveBeenCalled();
    });
    expect(model.send).toHaveBeenCalledTimes(1);
    model.send.mockClear();
    await expect(workflowTransaction(async (tx) => {
      await enqueueJob({ jobType: 'event_dispatch' }, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(model.state.jobs).toHaveLength(1); expect(model.send).not.toHaveBeenCalled();
  });
  it('rolls back ownership if the initial attempt audit cannot be persisted', async () => {
    seed(); vi.spyOn(model.db, 'insert').mockImplementationOnce(() => { throw new Error('audit unavailable'); });
    await expect(runJob(1)).rejects.toThrow('audit unavailable');
    expect(model.state.jobs[0]).toMatchObject({ status: 'pending', attempts: 0, leaseToken: null });
    expect(model.handler).not.toHaveBeenCalled(); expect(model.state.executions).toHaveLength(0);
  });
  it('concurrent wakeups execute one owner and create exactly one attempt record', async () => {
    seed(); const wait = deferred(); model.handler.mockReturnValue(wait.promise);
    const first = runJob(1), second = runJob(1); await flush();
    expect(model.handler).toHaveBeenCalledTimes(1); expect(model.state.executions).toHaveLength(1);
    wait.resolve(); await Promise.all([first, second]);
    expect(model.state.jobs[0].status).toBe('succeeded'); expect(model.state.executions[0].status).toBe('succeeded');
  });
  it('does not finalize success until deferred event outbox writes commit', async () => {
    seed(); const effect = deferred();
    model.handler.mockImplementation(async (context: WorkflowJobContext) => {
      deferWorkflowJobEffect(context, effect.promise);
    });
    const running = runJob(1); await flush();
    expect(model.state.jobs[0].status).toBe('running');
    effect.resolve(); await running;
    expect(model.state.jobs[0].status).toBe('succeeded');
  });
  it('turns a rejected deferred event write into an owned retry', async () => {
    seed();
    model.handler.mockImplementation(async (context: WorkflowJobContext) => {
      deferWorkflowJobEffect(context, Promise.reject(new Error('event outbox unavailable')));
    });
    await runJob(1);
    expect(model.state.jobs[0]).toMatchObject({ status: 'pending', lastError: 'event outbox unavailable' });
    expect(model.state.executions[0]).toMatchObject({ status: 'failed', errorMessage: 'event outbox unavailable' });
    expect(model.send).toHaveBeenCalledTimes(1);
  });
  it('a canceled attempt cannot overwrite cancellation when its handler returns', async () => {
    seed(); const wait = deferred(); model.handler.mockReturnValue(wait.promise);
    const run = runJob(1); await flush(); await cancelJobs({ instanceId: 7 }); wait.resolve(); await run;
    expect(model.state.jobs[0]).toMatchObject({ status: 'canceled', generation: 1, leaseToken: null });
    expect(model.state.executions[0].status).toBe('failed');
  });
  it('a recovered old attempt cannot overwrite a newer successful owner', async () => {
    seed(); const old = deferred(); model.handler.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ result: { owner: 'new' } });
    const running = runJob(1); await flush();
    model.state.jobs[0].leaseUntil = new Date(Date.now() - 1);
    await drainWorkflowJobs(); await runJob(1); old.resolve({ result: { owner: 'old' } }); await running;
    expect(model.state.jobs[0]).toMatchObject({ status: 'succeeded', attempts: 2, result: { owner: 'new' } });
    expect(model.state.executions.map((row) => row.status)).toEqual(['failed', 'succeeded']);
  });
  it('heartbeat keeps a healthy long attempt alive but cannot extend its execution deadline', async () => {
    seed(1, { executionTimeoutMs: 100_000 }); const wait = deferred(); model.handler.mockReturnValue(wait.promise);
    const run = runJob(1); await flush(); await vi.advanceTimersByTimeAsync(75_000);
    expect((await drainWorkflowJobs()).recovered).toBe(0); expect(model.state.jobs[0].status).toBe('running');
    await vi.advanceTimersByTimeAsync(25_000); await run;
    expect(model.state.jobs[0].status).toBe('pending');
    expect(model.state.executions[0]).toMatchObject({ status: 'failed', errorMessage: 'Workflow job execution deadline exceeded' });
    wait.resolve({ result: { late: true } }); await flush(); expect(model.state.jobs[0].result).toBeNull();
  });
  it('uncertain external writes are dead-lettered instead of automatically repeated', async () => {
    seed(); model.handler.mockImplementation(async () => {
      model.state.executions[0].requestMethod = 'POST'; throw new Error('connection dropped');
    });
    await runJob(1);
    expect(model.state.jobs[0].status).toBe('dead'); expect(model.state.jobs[0].lastError).toContain('外部操作结果待确认');
    expect(model.state.executions[0].requestMethod).toBe('POST'); expect(model.send).not.toHaveBeenCalled();
    const oldKey = model.state.jobs[0].operationKey; await retryJob(1);
    expect(model.state.jobs[0]).toMatchObject({ generation: 1, operationKey: oldKey });
  });
  it('can retry a definitive client rejection while keeping the stable operation key', async () => {
    seed(); model.handler.mockImplementation(async () => {
      model.state.executions[0].requestMethod = 'POST';
      throw new WorkflowJobError('invalid request', { detail: { responseStatus: 400 } });
    });
    await runJob(1);
    expect(model.state.jobs[0]).toMatchObject({ status: 'pending', operationKey: 'op-1' });
    expect(model.state.executions[0]).toMatchObject({ status: 'failed', responseStatus: 400 });
    expect(model.send).toHaveBeenCalledTimes(1);
  });
  it('recovery preserves external uncertainty and exhausts the attempt without requeueing', async () => {
    seed(); const wait = deferred(); model.handler.mockReturnValue(wait.promise);
    const running = runJob(1); await flush();
    model.state.executions[0].requestMethod = 'POST';
    model.state.jobs[0].leaseUntil = new Date(Date.now() - 1);
    expect(await drainWorkflowJobs()).toEqual({ recovered: 1, requeued: 0, dead: 1 });
    wait.resolve(); await running;
    expect(model.state.jobs[0].status).toBe('dead'); expect(model.state.jobs[0].lastError).toContain('外部操作结果待确认');
  });
  it('instance completion cancels other jobs but preserves the executing owner fence', async () => {
    seed(2); model.handler.mockImplementation(async (_context: WorkflowJobContext) => {
      await workflowTransaction(async (tx) => { await cancelJobs({ instanceId: 7 }, tx); });
    });
    await runJob(1);
    expect(model.state.jobs.map((row) => row.status)).toEqual(['succeeded', 'canceled']);
  });
  it('applies an operations limit to unique recoveries and wakeups', async () => {
    seed(3);
    for (const job of model.state.jobs.slice(0, 2)) {
      Object.assign(job, {
        status: 'running', attempts: 1, leaseToken: `expired-${job.id}`,
        leaseUntil: new Date(Date.now() - 1), executionDeadline: new Date(Date.now() + 10_000),
        lockedBy: 'old-worker',
      });
    }
    const result = await drainWorkflowJobs({ limit: 2 });
    expect(result).toEqual({ recovered: 2, dead: 0, requeued: 2 });
    expect(model.send.mock.calls.map((call) => call[1])).toEqual([{ jobId: 1 }, { jobId: 2 }]);
    expect(model.state.jobs.slice(0, 2).every((job) => job.lockedBy === null)).toBe(true);
  });
  it('paused timers cannot be claimed and resume with their remaining delay', async () => {
    seed(1, { jobType: 'delay_wake', attempts: 2, runAt: new Date(Date.now() + 30_000) });
    await pauseInstanceJobs(model.db as unknown as DbExecutor, 7, ['delay_wake']);
    await vi.advanceTimersByTimeAsync(60_000); await runJob(1);
    expect(model.handler).not.toHaveBeenCalled();
    await resumeInstanceJobs(model.db as unknown as DbExecutor, 7, ['delay_wake']);
    expect(model.state.jobs[0]).toMatchObject({ status: 'pending', generation: 2, attempts: 2, pausedRemainingMs: null });
    expect(Number(model.state.jobs[0].runAt)).toBe(Date.now() + 30_000);
  });
  it('does not charge retry budget for a pre-I/O attempt interrupted by suspension', async () => {
    seed(1, {
      jobType: 'external_dispatch', status: 'running', attempts: 1,
      leaseToken: 'pre-io', leaseUntil: new Date(Date.now() + 60_000),
      executionDeadline: new Date(Date.now() + 300_000), lockedBy: 'worker-1',
    });
    await pauseInstanceJobs(model.db as unknown as DbExecutor, 7, ['external_dispatch']);
    expect(model.state.jobs[0]).toMatchObject({ status: 'paused', generation: 1, attempts: 0, lockedBy: null });
    await resumeInstanceJobs(model.db as unknown as DbExecutor, 7, ['external_dispatch']);
    expect(model.state.jobs[0]).toMatchObject({ status: 'pending', generation: 2, attempts: 0 });
  });
  it('dead-letters an in-flight unsafe write instead of replaying it after suspension', async () => {
    seed(1, {
      jobType: 'external_dispatch', status: 'running', attempts: 1,
      leaseToken: 'unsafe-write', leaseUntil: new Date(Date.now() + 60_000),
      executionDeadline: new Date(Date.now() + 300_000), lockedBy: 'worker-1',
    });
    model.state.executions = [{
      id: 1, jobId: 1, jobType: 'external_dispatch', attempt: 1, generation: 0,
      leaseToken: 'unsafe-write', status: 'running', requestMethod: 'POST', startedAt: new Date(),
    }];
    await pauseInstanceJobs(model.db as unknown as DbExecutor, 7, ['external_dispatch']);
    expect(model.state.jobs[0]).toMatchObject({
      status: 'dead', generation: 1, leaseToken: null, lockedBy: null,
    });
    expect(String(model.state.jobs[0].lastError)).toContain('外部操作结果待确认');
    await resumeInstanceJobs(model.db as unknown as DbExecutor, 7, ['external_dispatch']);
    expect(model.state.jobs[0].status).toBe('dead');
    expect(model.state.executions[0].status).toBe('failed');
  });
});
