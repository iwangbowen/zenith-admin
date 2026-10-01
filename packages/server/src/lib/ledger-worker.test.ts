import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLedgerWorker } from './ledger-worker';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
afterEach(() => { vi.useRealTimers(); });

describe('scheduler ledger worker', () => {
  it('refills a free slot immediately without waiting for a slow sibling', async () => {
    vi.useFakeTimers(); const slow = deferred(); const jobs = [1, 2, 3];
    const execute = vi.fn(async (id: number) => { if (id === 1) await slow.promise; });
    const claim = vi.fn(async (available: number) => jobs.splice(0, available));
    const worker = createLedgerWorker({ concurrency: 2, claim, execute, onError: vi.fn() });
    worker.start(); await flush();
    expect(execute.mock.calls.flat()).toEqual([1, 2, 3]);
    expect(claim.mock.calls.every(([slots]) => slots <= 2)).toBe(true);
    expect(worker.active).toBe(1);
    slow.resolve(); await worker.stop();
  });
  it('lost hints and future jobs are picked up by polling; hints do not overlap claims', async () => {
    vi.useFakeTimers(); const jobs: number[] = [];
    const execute = vi.fn(async () => undefined);
    const claim = vi.fn(async (available: number) => jobs.splice(0, available));
    const worker = createLedgerWorker({ concurrency: 2, claim, execute, onError: vi.fn() });
    worker.start(); worker.wake(); worker.wake(); await flush();
    jobs.push(7);
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(execute).toHaveBeenCalledWith(7);
    await worker.stop(); const calls = claim.mock.calls.length;
    jobs.push(8); worker.wake(); await vi.advanceTimersByTimeAsync(5000);
    expect(claim).toHaveBeenCalledTimes(calls);
  });
  it('stop waits for already claimed jobs while preventing subsequent claims', async () => {
    vi.useFakeTimers(); const slow = deferred(); const claim = vi.fn().mockResolvedValueOnce([1]).mockResolvedValue([]);
    const worker = createLedgerWorker({ concurrency: 1, claim, execute: () => slow.promise, onError: vi.fn() });
    worker.start(); await flush();
    let stopped = false; const stopping = worker.stop().then(() => { stopped = true; });
    await flush(); expect(stopped).toBe(false);
    slow.resolve(); await stopping; expect(stopped).toBe(true);
    expect(claim).toHaveBeenCalledTimes(1);
  });
});
