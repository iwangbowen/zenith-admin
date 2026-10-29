import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../db/types';
import { flushTransactionEffects, rememberTransactionEffect } from './transaction-effects';

describe('post commit hints', () => {
  it('coalesces hints per transaction and does not publish uncommitted executors', async () => {
    const committed = {} as DbTransaction; const rolledBack = {} as DbTransaction;
    const wake = vi.fn(async () => undefined);
    rememberTransactionEffect(committed, 'one', wake); rememberTransactionEffect(committed, 'one', wake);
    rememberTransactionEffect(rolledBack, 'one', wake);
    expect(wake).not.toHaveBeenCalled();
    await flushTransactionEffects(committed); await flushTransactionEffects(committed);
    expect(wake).toHaveBeenCalledTimes(1);
  });
  it('a failed wake does not fail an already committed business transaction', async () => {
    const tx = {} as DbTransaction;
    rememberTransactionEffect(tx, 'broken', async () => { throw new Error('offline'); });
    await expect(flushTransactionEffects(tx)).resolves.toBeUndefined();
  });
});
