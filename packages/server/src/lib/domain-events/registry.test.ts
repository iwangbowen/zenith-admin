import { beforeEach, describe, expect, it } from 'vitest';
import { __resetEventConsumerRegistryForTest, matchingEventConsumers, registerEventConsumer, sealEventConsumerRegistry } from './registry';

describe('durable consumer dependency graph', () => {
  const handle = async () => ({ outcome: 'completed' as const });
  beforeEach(() => __resetEventConsumerRegistryForTest());

  it('separates matching consumers from unrelated registrations', () => {
    registerEventConsumer({ key: 'test-a', matches: (e) => e.domain === 'test-a', handle });
    registerEventConsumer({ key: 'test-a-child', after: ['test-a'], matches: (e) => e.domain === 'test-a', handle });
    sealEventConsumerRegistry();
    expect(matchingEventConsumers({ domain: 'test-a', eventType: 'test-a.created', payload: {} }).map((c) => c.key)).toEqual(['test-a', 'test-a-child']);
    expect(matchingEventConsumers({ domain: 'unrelated', eventType: 'other.created', payload: {} })).toEqual([]);
  });

  it('requires the complete catalog to be sealed before publication', () => {
    registerEventConsumer({ key: 'test-a', matches: (e) => e.domain === 'test-a', handle });
    expect(() => matchingEventConsumers({ domain: 'test-a', eventType: 'test-a.created', payload: {} })).toThrow('sealed');
    sealEventConsumerRegistry();
    expect(() => registerEventConsumer({ key: 'late', matches: () => true, handle })).toThrow('already sealed');
  });

  it('rejects a prerequisite that does not match the same event', () => {
    registerEventConsumer({ key: 'test-a', matches: (e) => e.domain === 'test-a', handle });
    registerEventConsumer({ key: 'missing-child', after: ['test-a'], matches: (e) => e.domain === 'missing', handle });
    sealEventConsumerRegistry();
    expect(() => matchingEventConsumers({ domain: 'missing', eventType: 'missing.created', payload: {} })).toThrow('Missing');
  });

  it('rejects cycles and duplicate stable consumer keys', () => {
    const matches = (e: { domain: string }) => e.domain === 'cycle';
    registerEventConsumer({ key: 'cycle-a', after: ['cycle-b'], matches, handle });
    registerEventConsumer({ key: 'cycle-b', after: ['cycle-a'], matches, handle });
    expect(() => registerEventConsumer({ key: 'cycle-a', matches, handle })).toThrow('Duplicate');
    sealEventConsumerRegistry();
    expect(() => matchingEventConsumers({ domain: 'cycle', eventType: 'cycle.created', payload: {} })).toThrow('Cyclic');
  });
});
