import { describe, expect, it } from 'vitest';
import { deriveOverallHealth, deriveSourceHealth } from './health';
import type { JobSourceRawSummary } from './registry';

const raw = (changes: Partial<JobSourceRawSummary> = {}): JobSourceRawSummary => ({
  counts: { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 }, oldestPendingAgeSec: null, issues: [], ...changes,
});
describe('source health', () => {
  it('keeps an empty source healthy', () => expect(deriveSourceHealth(raw())).toBe('ok'));
  it('respects pending age boundaries', () => {
    expect(deriveSourceHealth(raw({ oldestPendingAgeSec: 300 }))).toBe('ok');
    expect(deriveSourceHealth(raw({ oldestPendingAgeSec: 301 }))).toBe('warn');
    expect(deriveSourceHealth(raw({ oldestPendingAgeSec: 1801 }))).toBe('critical');
  });
  it('applies dead and stuck policy overrides', () => {
    expect(deriveSourceHealth(raw({ counts: { ...raw().counts, dead: 1 } }))).toBe('warn');
    expect(deriveSourceHealth(raw({ counts: { ...raw().counts, stuck: 1 } }))).toBe('critical');
    expect(deriveSourceHealth(raw({ counts: { ...raw().counts, stuck: 1 } }), { stuckLevel: 'warn' })).toBe('warn');
  });
  it('requires enough samples before evaluating failure rate', () => {
    expect(deriveSourceHealth(raw({ counts: { ...raw().counts, failed24h: 19 } }))).toBe('ok');
    expect(deriveSourceHealth(raw({ counts: { ...raw().counts, failed24h: 3, succeeded24h: 17 } }))).toBe('warn');
    expect(deriveSourceHealth(raw({ counts: { ...raw().counts, failed24h: 7, succeeded24h: 13 } }))).toBe('critical');
  });
  it('keeps domain issues authoritative', () => expect(deriveSourceHealth(raw({ issues: [{ level: 'critical', message: '错过调度' }] }))).toBe('critical'));
});
describe('overall health', () => {
  const workers = { available: true, reason: null, data: { total: 1, active: 1, stale: 0, workerRoleActive: 1, nodes: [] } };
  it('requires a worker role and reports lost heartbeats', () => {
    expect(deriveOverallHealth([], { ...workers, data: { ...workers.data, workerRoleActive: 0 } })).toBe('critical');
    expect(deriveOverallHealth([], { ...workers, data: { ...workers.data, stale: 1 } })).toBe('warn');
    expect(deriveOverallHealth([{ health: 'critical' }], workers)).toBe('critical');
  });
  it('reports probe failure without fabricating healthy workers', () => expect(deriveOverallHealth([], { available: false, reason: 'offline', data: null })).toBe('unavailable'));
});
