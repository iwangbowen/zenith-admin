import { describe, expect, it } from 'vitest';
import { RETENTION_POLICIES } from './policies';

describe('durable event retention policies', () => {
  it.each(['event_outbox', 'event_consumer_deliveries', 'event_consumer_attempts'])('%s uses terminal-aware custom cleanup', (key) => {
    const policy = RETENTION_POLICIES.find((item) => item.key === key);
    expect(policy).toMatchObject({ mode: 'custom' });
    expect(policy?.run).toBeTypeOf('function');
    expect(policy?.previewPending).toBeTypeOf('function');
  });
});
