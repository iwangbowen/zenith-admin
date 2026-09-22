import { describe, expect, it } from 'vitest';
import { entityTimelineQuerySchema } from './contracts/entity-timeline';
import { parseDomainEventSummary } from './domain-events';

describe('entity timeline filters and safe terminal events', () => {
  it('normalizes an empty event filter, validates registered events and bounds dates', () => {
    expect(entityTimelineQuerySchema.parse({ eventType: '' })).toEqual({ limit: 20 });
    expect(entityTimelineQuerySchema.parse({ eventType: 'tasks.async-task.failed', startTime: '2026-09-22', endTime: '2026-09-23 23:59:59' })).toMatchObject({ eventType: 'tasks.async-task.failed' });
    expect(entityTimelineQuerySchema.safeParse({ eventType: 'unregistered.event' }).success).toBe(false);
    expect(entityTimelineQuerySchema.safeParse({ startTime: 'yesterday' }).success).toBe(false);
  });
  it('strips handler input, provider messages and addresses from task and delivery summaries', () => {
    expect(parseDomainEventSummary('tasks.async-task.failed', { taskType: 'export', status: 'failed', attempt: 2, errorMessage: 'secret' }))
      .toEqual({ taskType: 'export', status: 'failed', attempt: 2 });
    expect(parseDomainEventSummary('messaging.notification.dispatched', { eventKey: 'safe-event', status: 'done', sent: 1, failed: 1, deferred: 0, suppressed: 0, recipients: ['private'] }))
      .toEqual({ eventKey: 'safe-event', status: 'done', sent: 1, failed: 1, deferred: 0, suppressed: 0 });
  });
});
