import { describe, expect, it } from 'vitest';
import { resolveIdempotent } from './idempotency';

describe('resolveIdempotent', () => {
  it('replays cached payloads for the same X-Idempotency-Key', async () => {
    const cache = new Map<string, { data: { count: number }; message: string }>();
    let runs = 0;
    const request = new Request('https://example.test/batch', { headers: { 'X-Idempotency-Key': 'k1' } });

    const first = await resolveIdempotent({ request, cache, run: () => ({ data: { count: ++runs }, message: 'ok' }) });
    const second = await resolveIdempotent({ request, cache, run: () => ({ data: { count: ++runs }, message: 'ok' }) });

    expect(first).toEqual({ data: { count: 1 }, message: 'ok' });
    expect(second).toBe(first);
    expect(runs).toBe(1);
  });

  it('does not cache requests without an idempotency key', async () => {
    const cache = new Map<string, { data: number; message: string }>();
    let runs = 0;
    const request = new Request('https://example.test/batch');
    await resolveIdempotent({ request, cache, run: () => ({ data: ++runs, message: 'ok' }) });
    await resolveIdempotent({ request, cache, run: () => ({ data: ++runs, message: 'ok' }) });
    expect(runs).toBe(2);
    expect(cache.size).toBe(0);
  });
});
