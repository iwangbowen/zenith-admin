import { describe, expect, it } from 'vitest';
import { WATCHABLE_ENTITY_TYPES, isWatchableDomainEvent, isWatchableEntityType, watchedEntityDetailRoute } from './entity-watches';
import { entityWatchStateSchema } from './contracts/entity-watches';

describe('object watch capabilities', () => {
  it('exposes only real event-backed objects with an exact detail route', () => {
    for (const type of WATCHABLE_ENTITY_TYPES) expect(watchedEntityDetailRoute({ type, key: '41' })).toBeTruthy();
    expect(isWatchableEntityType('wiki.document')).toBe(false);
    expect(isWatchableEntityType('notification.outbox')).toBe(false);
    expect(entityWatchStateSchema.parse({ supported: false, watching: false })).toEqual({ supported: false, watching: false });
  });
  it('never fans out notification meta-events recursively', () => {
    expect(isWatchableDomainEvent('payment.succeeded')).toBe(true);
    expect(isWatchableDomainEvent('iot.alarm.acknowledged')).toBe(true);
    for (const type of ['messaging.notification.queued', 'messaging.notification.dispatched', 'messaging.notification.failed']) {
      expect(isWatchableDomainEvent(type)).toBe(false);
    }
  });
  it('shares exact source routes and rejects malformed keys', () => {
    expect(watchedEntityDetailRoute({ type: 'workflow.instance', key: '7' })).toBe('/workflow/instance/7');
    expect(watchedEntityDetailRoute({ type: 'payment.dispute', key: '8' })).toBe('/payment/disputes?disputeId=8');
    expect(watchedEntityDetailRoute({ type: 'payment.order', key: '../bad' })).toBeUndefined();
  });
});
