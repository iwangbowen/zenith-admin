import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../../../db/types';
import { workflowInstances, workflowNodeActivations } from '../../../db/schema';

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), cancel: vi.fn() }));
vi.mock('./approval-state', () => ({ reconcileApprovalActivation: mocks.reconcile, cancelApprovalActivations: mocks.cancel }));
import { checkNodeCompletion, killInstanceTokens } from './materialize';

const instance = { id: 1, status: 'running', definitionId: 7 } as typeof workflowInstances.$inferSelect;
function executor(activeId?: string): DbExecutor {
  return { select: () => ({ from: (table: unknown) => {
    const rows = table === workflowNodeActivations && activeId ? [{ id: activeId }] : [];
    const query = { innerJoin: () => query, where: () => query, limit: async () => rows };
    return query;
  } }), update: () => ({ set: () => ({ where: async () => [] }) }) } as unknown as DbExecutor;
}

beforeEach(() => { vi.clearAllMocks(); mocks.reconcile.mockResolvedValue({ completed: false, failed: false, method: 'and' }); });

describe('checkNodeCompletion explicit activation identity', () => {
  it('evaluates the provided round without deriving it from task history or CC row ids', async () => {
    const tx = executor('different-active-round');
    await checkNodeCompletion(tx, instance, 'finance', undefined, 'round-2');
    expect(mocks.reconcile).toHaveBeenCalledWith(tx, instance, 'round-2', { userId: 0, name: 'system:approval' }, undefined);
  });
  it('selects the activation linked to the active execution token when no identity is supplied', async () => {
    const tx = executor('token-round');
    await checkNodeCompletion(tx, instance, 'finance');
    expect(mocks.reconcile.mock.calls[0][2]).toBe('token-round');
  });
  it('refuses to invent a round from historical or noncontrol task records', async () => {
    await expect(checkNodeCompletion(executor(), instance, 'finance')).rejects.toMatchObject({ status: 409 });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it('does not reload an already authorized instance through an unscoped query', async () => {
    const tx = { select: vi.fn(() => { throw new Error('unexpected instance reload'); }) } as unknown as DbExecutor;
    await checkNodeCompletion(tx, instance, 'finance', undefined, 'round-1');
    expect(tx.select).not.toHaveBeenCalled();
  });
  it('returns the evaluator decision including failure and frozen strategy', async () => {
    mocks.reconcile.mockResolvedValue({ completed: false, failed: true, method: 'ratio' });
    await expect(checkNodeCompletion(executor(), instance, 'finance', undefined, 'round-1')).resolves.toEqual({ completed: false, failed: true, method: 'ratio' });
  });
});

describe('killInstanceTokens', () => {
  it('closes active approvals and supplemental groups before killing execution tokens', async () => {
    const tx = executor();
    await killInstanceTokens(tx, 1);
    expect(mocks.cancel).toHaveBeenCalledWith(tx, 1);
  });
});
