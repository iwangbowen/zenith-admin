import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { workflowInstances, workflowTasks, workflowNodeActivations, workflowApprovalSlots, workflowSignGroups } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';
const mocks = vi.hoisted(() => ({ cancel: vi.fn(), arm: vi.fn(), emit: vi.fn() }));
vi.mock('../../../lib/user-nicknames', () => ({ resolveUserNames: async () => new Map() }));
vi.mock('../../../lib/workflow-jobs/engine', () => ({ cancelJobs: mocks.cancel }));
vi.mock('./async-jobs', () => ({ armTaskAsyncJobs: mocks.arm }));
vi.mock('./shared', () => ({ emitTaskEvent: mocks.emit }));
vi.mock('./mapping', () => ({ mapTask: (row: unknown) => row }));
import { cancelApprovalActivations, reconcileApprovalActivation, recordSlotOutcome } from './approval-state';

type Row = Record<string, unknown>;
const dialect = new PgDialect({ casing: 'snake_case' });
function matches(row: Row, sql: SQL): boolean {
  const query = dialect.sqlToQuery(sql);
  return [...query.sql.matchAll(/"\w+"\."(\w+)"\s*(?:=\s*(\$\d+)|in\s*\(([^)]+)\))/g)].every((match) => {
    const key = match[1].replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return ((match[2] ?? match[3]).match(/\$\d+/g) ?? []).some((placeholder) => query.params[Number(placeholder.slice(1)) - 1] === row[key]);
  });
}
function fixture(position: 'before' | 'after' | 'parallel' = 'after') {
  const inst = { id: 10, definitionId: 3, tenantId: null, status: 'running', formData: {}, definitionSnapshot: { flowData: { nodes: [], edges: [] } } } as typeof workflowInstances.$inferSelect;
  const activations: Row[] = [{ id: 'round-1', instanceId: 10, nodeKey: 'finance', nodeName: '财务审批', tokenId: 1, status: 'active', approveMethod: 'or', approveRatio: null, baseTotal: 2, baseRequired: 1 }];
  const slots: Row[] = [1, 2, 3].map((id) => ({ id, activationId: 'round-1', origin: id === 3 ? 'addSign' : 'base', groupId: id === 3 ? 100 : null, originalAssigneeId: id, currentAssigneeId: id, status: 'pending', order: id === 3 ? null : id - 1, mandatory: false, currentTaskId: id }));
  const groups: Row[] = [{ id: 100, activationId: 'round-1', anchorSlotId: 1, position, signMode: 'and', status: position === 'after' ? 'waiting' : 'active', createdBy: 1, createdAt: new Date() }];
  const tasks: Row[] = slots.map((slot) => ({ id: slot.id, instanceId: 10, activationId: 'round-1', slotId: slot.id, taskKind: 'approval', nodeKey: 'finance', assigneeId: slot.id, status: position === 'after' && slot.id === 3 ? 'waiting' : 'pending', waitReason: position === 'after' && slot.id === 3 ? 'afterSign' : null, externalCallbackId: null, activatedAt: position === 'after' && slot.id === 3 ? null : new Date() }));
  const rowsFor = (table: unknown) => table === workflowTasks ? tasks : table === workflowApprovalSlots ? slots : table === workflowSignGroups ? groups : table === workflowNodeActivations ? activations : [inst as unknown as Row];
  const tx = {
    select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
      const rows = rowsFor(table).filter((row) => matches(row, condition)).map((row) => structuredClone(row));
      const query = { orderBy: () => query, limit: async () => rows, then: (resolve: (rows: Row[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return query;
    } }) }),
    update: (table: unknown) => ({ set: (patch: Row) => ({ where: (condition: SQL) => {
      const changed = rowsFor(table).filter((row) => matches(row, condition)).map((row) => { Object.assign(row, patch); return structuredClone(row); });
      return { returning: async () => changed, then: (resolve: (rows: Row[]) => unknown) => Promise.resolve(changed).then(resolve) };
    } }) }),
  } as unknown as DbExecutor;
  return { inst, activations, slots, groups, tasks, tx };
}
const actor = { userId: 1, name: '审批人' };
beforeEach(() => vi.clearAllMocks());

describe('approval reconciliation persistence', () => {
  it('keeps the after group asleep when another OR seat approves and preserves the anchor', async () => {
    const state = fixture(); state.slots[1].status = 'approved'; state.tasks[1].status = 'approved';
    expect(await reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor)).toMatchObject({ completed: false, failed: false });
    expect(state.tasks[0].status).toBe('pending');
    expect(state.tasks[2]).toMatchObject({ status: 'waiting', activatedAt: null });
    expect(state.slots[0].mandatory).toBe(true);
    expect(mocks.arm).not.toHaveBeenCalled();
  });
  it('activates the after group only after its own anchor approves and arms its timeout once', async () => {
    const state = fixture(); state.slots[0].status = 'approved'; state.tasks[0].status = 'approved';
    expect(await reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor)).toMatchObject({ completed: false });
    expect(state.groups[0].status).toBe('active');
    expect(state.tasks[2]).toMatchObject({ status: 'pending', waitReason: null, activatedAt: expect.any(Date) });
    expect(mocks.arm).toHaveBeenCalledTimes(1);
    expect(mocks.arm.mock.calls[0][2]).toBe(state.tx);
    await reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor);
    expect(mocks.arm).toHaveBeenCalledTimes(1);
  });
  it('restores a before anchor after the formal supplemental seat settles despite overwritten receipt comments', async () => {
    const state = fixture('before');
    state.tasks[0].status = 'waiting'; state.tasks[0].waitReason = 'beforeSign';
    state.slots[2].status = 'approved'; state.tasks[2].status = 'approved'; state.tasks[2].comment = '[委派回执] 建议同意';
    await reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor);
    expect(state.groups[0].status).toBe('approved');
    expect(state.tasks[0]).toMatchObject({ status: 'pending', waitReason: null });
    expect(mocks.emit).toHaveBeenCalledWith('task.assigned', expect.objectContaining({ id: 1 }), expect.anything(), state.tx);
  });
  it('ignores approved CC and older-round task records when the formal supplemental seat is still pending', async () => {
    const state = fixture(); state.slots[0].status = 'approved'; state.tasks[0].status = 'approved';
    state.tasks.push({ id: 999, instanceId: 10, activationId: null, taskKind: 'cc', status: 'approved' }, { id: 998, activationId: 'round-0', status: 'approved' });
    expect(await reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor)).toMatchObject({ completed: false });
  });
  it('does not turn an external callback wait into a human pending task', async () => {
    const state = fixture(); state.tasks[0].status = 'waiting'; state.tasks[0].externalCallbackId = 'callback';
    await reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor);
    expect(state.tasks[0].status).toBe('waiting');
  });
  it('refuses to reconcile a settled activation', async () => {
    const state = fixture(); state.activations[0].status = 'approved';
    await expect(reconcileApprovalActivation(state.tx, state.inst, 'round-1', actor)).rejects.toMatchObject({ status: 409 });
  });
});

describe('one formal outcome per slot', () => {
  it('rejects a delegated suggestion without counting it as consent', async () => {
    const state = fixture(); const task = { ...state.tasks[0], taskKind: 'suggestion' } as typeof workflowTasks.$inferSelect;
    await expect(recordSlotOutcome(state.tx, task, 'approved')).rejects.toMatchObject({ status: 409 });
    expect(state.slots[0].status).toBe('pending');
  });
  it('rejects a superseded task or duplicate outcome on the same slot', async () => {
    const state = fixture(); const task = state.tasks[0] as typeof workflowTasks.$inferSelect;
    await recordSlotOutcome(state.tx, task, 'approved');
    await expect(recordSlotOutcome(state.tx, task, 'approved')).rejects.toMatchObject({ status: 409 });
    await expect(recordSlotOutcome(state.tx, { ...task, id: 900 }, 'approved')).rejects.toMatchObject({ status: 409 });
  });
  it('closes only active rounds and unresolved seats/groups while retaining completed history', async () => {
    const state = fixture(); state.slots[0].status = 'approved';
    state.activations.push({ id: 'round-0', instanceId: 10, status: 'approved' });
    state.slots.push({ id: 90, activationId: 'round-0', status: 'approved' });
    await cancelApprovalActivations(state.tx, 10);
    expect(state.activations.map((row) => row.status)).toEqual(['cancelled', 'approved']);
    expect(state.slots.map((row) => row.status)).toEqual(['approved', 'cancelled', 'cancelled', 'approved']);
    expect(state.groups[0].status).toBe('cancelled');
  });
});
