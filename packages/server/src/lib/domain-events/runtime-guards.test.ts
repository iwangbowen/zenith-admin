import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('durable event runtime guards', () => {
  it('registers and seals consumers before ingress or worker startup', async () => {
    const source = await readFile(new URL('../../index.ts', import.meta.url), 'utf8');
    const registerAt = source.indexOf('registerEventSubscribers();');
    const sealAt = source.indexOf('sealEventConsumerRegistry();');
    const apiAt = source.indexOf('await startApiRole()');
    const workerAt = source.indexOf('await startWorkerRole()');
    expect(registerAt).toBeGreaterThan(0);
    expect(registerAt).toBeLessThan(sealAt);
    expect(sealAt).toBeLessThan(apiAt);
    expect(sealAt).toBeLessThan(workerAt);
  });

  it('serializes event ids by business stream before insert', async () => {
    const source = await readFile(new URL('./publish.ts', import.meta.url), 'utf8');
    expect(source.indexOf('pg_advisory_xact_lock')).toBeLessThan(source.indexOf('tx.insert(eventOutbox)'));
  });

  it('uses a bounded transaction lease and records terminal failures', async () => {
    const source = await readFile(new URL('./engine.ts', import.meta.url), 'utf8');
    expect(source).toContain('const leaseMs = 5 * 60_000');
    expect(source).toContain("kind: 'event_failure'");
  });
});
