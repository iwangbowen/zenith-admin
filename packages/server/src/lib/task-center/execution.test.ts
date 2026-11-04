import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
const state = vi.hoisted(() => ({ checks: [] as boolean[], committed: false, writes: 0, flush: vi.fn(), conditions: [] as SQL[] }));
vi.mock('../../db', () => ({ db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = { select: () => ({ from: () => ({ where: (condition: SQL) => {
    state.conditions.push(condition);
    return { for: () => ({ limit: async () => state.checks.shift() ? [{ id: 1 }] : [] }) };
  } }) }) };
  const result = await fn(tx); state.committed = true; return result;
} } }));
vi.mock('../transaction-effects', () => ({ flushTransactionEffects: state.flush }));
import { runWithTaskExecution, taskTransaction, TaskExecutionLostError } from './execution';
const execution = { taskId: 1, dispatchToken: 'token', deadline: new Date('2026-12-01') };
beforeEach(() => { state.checks = []; state.committed = false; state.writes = 0; state.conditions = []; state.flush.mockClear(); });
describe('business commit execution fencing', () => {
  it.each(['rotated token', 'expired heartbeat', 'cancellation', 'execution deadline'])('rejects %s before business writes', async () => {
    state.checks = [false];
    await expect(runWithTaskExecution(execution, () => taskTransaction(async () => { state.writes++; }))).rejects.toBeInstanceOf(TaskExecutionLostError);
    expect(state.writes).toBe(0); expect(state.committed).toBe(false); expect(state.flush).not.toHaveBeenCalled();
    const query = new PgDialect({ casing: 'snake_case' }).sqlToQuery(state.conditions[0]);
    expect(query.sql).toContain('clock_timestamp()'); expect(query.sql).toContain('heartbeat_at');
    expect(query.sql).toContain('cancel_requested'); expect(query.params).toContain('token');
  });
  it('rechecks before commit and does not flush effects after lost ownership', async () => {
    state.checks = [true, false];
    await expect(runWithTaskExecution(execution, () => taskTransaction(async () => { state.writes++; }))).rejects.toBeInstanceOf(TaskExecutionLostError);
    expect(state.writes).toBe(1); expect(state.committed).toBe(false); expect(state.flush).not.toHaveBeenCalled();
  });
  it('commits a live owner and flushes effects only after commit', async () => {
    state.checks = [true, true];
    state.flush.mockImplementation(async () => { expect(state.committed).toBe(true); });
    await runWithTaskExecution(execution, () => taskTransaction(async () => { state.writes++; }));
    expect(state.committed).toBe(true); expect(state.conditions).toHaveLength(2); expect(state.flush).toHaveBeenCalledOnce();
  });
});
