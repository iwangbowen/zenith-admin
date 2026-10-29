import { describe, expect, it } from 'vitest';
import { matchingEventConsumers, registerEventConsumer } from './registry';

describe('durable consumer dependency graph', () => {
  const handle = async () => ({ outcome: 'completed' as const });
  it('separates matching consumers from unrelated registrations', () => {
    registerEventConsumer({ key: 'test-a', matches: (e) => e.domain === 'test-a', handle });
    registerEventConsumer({ key: 'test-a-child', after: ['test-a'], matches: (e) => e.domain === 'test-a', handle });
    expect(matchingEventConsumers({ domain: 'test-a', eventType: 'test-a.created', payload: {} }).map((c) => c.key)).toEqual(['test-a', 'test-a-child']);
    expect(matchingEventConsumers({ domain: 'unrelated', eventType: 'other.created', payload: {} })).toEqual([]);
  });
  it('rejects a prerequisite that does not match the same event', () => {
    registerEventConsumer({ key: 'missing-child', after: ['test-a'], matches: (e) => e.domain === 'missing', handle });
    expect(() => matchingEventConsumers({ domain: 'missing', eventType: 'missing.created', payload: {} })).toThrow('Missing');
  });
  it('rejects cycles and duplicate stable consumer keys', () => {
    const matches = (e: { domain: string }) => e.domain === 'cycle';
    registerEventConsumer({ key: 'cycle-a', after: ['cycle-b'], matches, handle });
    registerEventConsumer({ key: 'cycle-b', after: ['cycle-a'], matches, handle });
    expect(() => matchingEventConsumers({ domain: 'cycle', eventType: 'cycle.created', payload: {} })).toThrow('Cyclic');
    expect(() => registerEventConsumer({ key: 'cycle-a', matches, handle })).toThrow('Duplicate');
  });
});
