import { sendSystemJob } from '../pg-boss-scheduler';
import logger from '../logger';
import { rememberTransactionEffect } from '../transaction-effects';
import type { DbExecutor } from '../../db/types';

export const EVENT_OUTBOX_QUEUE = 'domain-event-outbox';
let publishing: Promise<void> | undefined;
export function wakeEventConsumers(): Promise<void> {
  return publishing ??= Promise.all([EVENT_OUTBOX_QUEUE, `${EVENT_OUTBOX_QUEUE}-analytics`]
    .map((name) => sendSystemJob(name, {}, { retryLimit: 0, retentionSeconds: 60 })))
    .then(() => undefined).catch((error) => { logger.warn('[domain-events] wake failed; polling will recover', { error }); })
    .finally(() => { publishing = undefined; });
}
export function rememberEventPickup(tx: DbExecutor): void {
  rememberTransactionEffect(tx, EVENT_OUTBOX_QUEUE, wakeEventConsumers);
}
