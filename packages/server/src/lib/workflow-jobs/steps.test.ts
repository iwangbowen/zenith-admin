import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import type { DbTransaction } from '../../db/types';
import type { WorkflowJobContext } from './types';

const lease = vi.hoisted(() => ({
  context: undefined as WorkflowJobContext | undefined,
  ownedTransaction: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./lease', () => ({
  currentWorkflowJobContext: () => lease.context,
  withWorkflowJobTransaction: lease.ownedTransaction,
  workflowTransaction: lease.transaction,
}));

import { runWorkflowJobStep } from './steps';

interface Receipt { jobId: number; operationKey: string; effectKey: string; result: Record<string, unknown>; }
let receipts: Receipt[];
let businessCounter: number;
let receiptWriteFails: boolean;
const dialect = new PgDialect();

// A transaction adapter stages business mutations and receipts together. The
// helper and Drizzle predicate construction are real; lease ownership has its
// own engine/lease suite.
async function transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const staged = structuredClone(receipts);
  let nextCounter = businessCounter;
  const tx = {
    execute: async () => { nextCounter += 1; },
    select: () => ({ from: () => ({ where: (predicate: SQL) => ({ limit: async () => {
      const { params } = dialect.sqlToQuery(predicate);
      return staged.filter((row) => row.operationKey === params[0] && row.effectKey === params[1]);
    } }) }) }),
    insert: () => ({ values: async (receipt: Receipt) => {
      if (receiptWriteFails) throw new Error('receipt unavailable');
      staged.push(structuredClone(receipt));
    } }),
  } as unknown as DbTransaction;
  const result = await fn(tx);
  receipts = staged;
  businessCounter = nextCounter;
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  receipts = [];
  businessCounter = 0;
  receiptWriteFails = false;
  lease.context = { job: { id: 7 }, operationKey: 'operation-a', generation: 0, leaseToken: 'lease-a' } as WorkflowJobContext;
  lease.ownedTransaction.mockImplementation((_context, fn) => transaction(fn));
  lease.transaction.mockImplementation(transaction);
});

const change = async (tx: DbTransaction) => {
  await tx.execute(sql`select 1`);
  return { field: 'updated' };
};

describe('internal workflow step receipts', () => {
  it('returns a committed result without repeating the business change after an attempt retry', async () => {
    const callback = vi.fn(change);
    const first = await runWorkflowJobStep('trigger-data', callback);
    lease.context = { ...lease.context!, generation: 1, leaseToken: 'lease-b' };
    const retried = await runWorkflowJobStep('trigger-data', callback);
    expect(retried).toEqual(first);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(businessCounter).toBe(1);
    expect(receipts).toHaveLength(1);
    expect(lease.ownedTransaction).toHaveBeenLastCalledWith(lease.context, expect.any(Function));
  });

  it('executes again for a changed payload operation key', async () => {
    await runWorkflowJobStep('trigger-data', change);
    lease.context = { ...lease.context!, operationKey: 'operation-b', generation: 1, leaseToken: 'lease-b' };
    await runWorkflowJobStep('trigger-data', change);
    expect(businessCounter).toBe(2);
    expect(receipts.map((row) => row.operationKey)).toEqual(['operation-a', 'operation-b']);
  });

  it('keeps distinct internal steps independent within an operation', async () => {
    await runWorkflowJobStep('trigger-data', change);
    await runWorkflowJobStep('compensation-data', change);
    expect(businessCounter).toBe(2);
    expect(receipts).toHaveLength(2);
  });

  it('rolls back a business failure without leaving a success receipt', async () => {
    await expect(runWorkflowJobStep('trigger-data', async (tx) => {
      await change(tx);
      throw new Error('business failed');
    })).rejects.toThrow('business failed');
    expect(businessCounter).toBe(0);
    expect(receipts).toEqual([]);
    await runWorkflowJobStep('trigger-data', change);
    expect(businessCounter).toBe(1);
  });

  it('rolls back the business mutation if receipt persistence fails', async () => {
    receiptWriteFails = true;
    await expect(runWorkflowJobStep('trigger-data', change)).rejects.toThrow('receipt unavailable');
    expect(businessCounter).toBe(0);
    expect(receipts).toEqual([]);
  });

  it('uses the normal workflow transaction without receipts outside a job', async () => {
    lease.context = undefined;
    await runWorkflowJobStep('trigger-data', change);
    await runWorkflowJobStep('trigger-data', change);
    expect(businessCounter).toBe(2);
    expect(receipts).toEqual([]);
    expect(lease.transaction).toHaveBeenCalledTimes(2);
    expect(lease.ownedTransaction).not.toHaveBeenCalled();
  });
});
