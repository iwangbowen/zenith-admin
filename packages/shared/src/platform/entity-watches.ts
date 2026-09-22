import type { CanonicalEntityType } from './entity-catalog';

/** Only entities backed by real durable business events expose the watch control. */
export const WATCHABLE_ENTITY_TYPES = ['payment.order', 'payment.refund', 'workflow.instance', 'iot.device', 'iot.alarm', 'tasks.async'] as const satisfies readonly CanonicalEntityType[];
export function isWatchableEntityType(type: string): type is typeof WATCHABLE_ENTITY_TYPES[number] {
  return (WATCHABLE_ENTITY_TYPES as readonly string[]).includes(type);
}
export function isWatchableDomainEvent(type: string): boolean {
  return type.startsWith('payment.') || type.startsWith('refund.') || type.startsWith('workflow.') || type.startsWith('iot.alarm.') || type.startsWith('tasks.async-task.');
}

export { canonicalEntityDetailRoute as watchedEntityDetailRoute } from './entity-detail-routes';
