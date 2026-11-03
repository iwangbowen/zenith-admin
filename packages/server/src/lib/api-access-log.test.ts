import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewApiAccessLog } from '../db/schema';

vi.mock('../db', () => ({ db: {} }));
vi.mock('./logger', () => ({ default: { warn: vi.fn() } }));
vi.mock('./tenant', () => ({ getEffectiveTenantId: (user: { tenantId: number | null }) => user.tenantId }));
vi.mock('../config', () => ({ config: { multiTenantMode: false, roles: { label: 'api' }, otel: { serviceName: 'test' } } }));
import { createApiAccessLogBuffer } from './api-access-log';

const entry = (index: number): NewApiAccessLog => ({ method: 'GET', path: `/api/probe/${index}` });

afterEach(() => { vi.useRealTimers(); });

describe('API access log batch buffer', () => {
  it('does not invoke storage on the request stack and drains all batches on shutdown', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_rows: NewApiAccessLog[]) => undefined);
    const buffer = createApiAccessLogBuffer(write);
    for (let i = 0; i < 250; i++) buffer.enqueue(entry(i));
    expect(write).not.toHaveBeenCalled();
    expect(buffer.stats().pending).toBe(250);
    await buffer.stop();
    expect(write.mock.calls.map((call) => call[0].length)).toEqual([100, 100, 50]);
    expect(buffer.stats()).toMatchObject({ stored: 250, pending: 0, flushing: false });
    buffer.enqueue(entry(251));
    expect(buffer.stats().dropped).toBe(1);
  });

  it('limits in-flight writes to one and bounds the queue while a write is slow', async () => {
    vi.useFakeTimers();
    let complete: (() => void) | undefined;
    const write = vi.fn((_rows: NewApiAccessLog[]) => new Promise<void>((resolve) => { complete = resolve; }));
    const buffer = createApiAccessLogBuffer(write);
    buffer.enqueue(entry(0));
    const flushing = buffer.flush();
    const firstComplete = complete!;
    for (let i = 1; i <= 2_100; i++) buffer.enqueue(entry(i));
    expect(write).toHaveBeenCalledTimes(1);
    expect(buffer.stats()).toMatchObject({ pending: 2000, dropped: 100, flushing: true });
    // Subsequent batches complete immediately, while the first write has been held open.
    write.mockImplementation(async () => undefined);
    firstComplete();
    await flushing;
    expect(buffer.stats()).toMatchObject({ stored: 2001, pending: 0, flushing: false });
    await buffer.stop();
  });

  it('counts failed batches, drops them without retries, and continues draining', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_rows: NewApiAccessLog[]) => undefined)
      .mockRejectedValueOnce(new Error('database unavailable'));
    const buffer = createApiAccessLogBuffer(write);
    for (let i = 0; i < 101; i++) buffer.enqueue(entry(i));
    await buffer.stop();
    expect(write).toHaveBeenCalledTimes(2);
    expect(buffer.stats()).toMatchObject({ stored: 1, dropped: 100, flushFailures: 1, pending: 0 });
  });
});
