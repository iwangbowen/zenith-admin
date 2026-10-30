import { registerEventConsumer } from '../../lib/domain-events';
import { rememberTransactionEffect } from '../../lib/transaction-effects';
import { reportOrphanDriveSpaces } from '../drive/drive-handoff.service';

let registered = false;
export function registerIdentityEventConsumers(): void {
  if (registered) return;
  registered = true;
  registerEventConsumer({ key: 'identity.orphan-drive-reconciliation', matches: (event) => event.domain === 'identity' && event.eventType.endsWith('.removed'),
    handle: async (tx, event) => {
      rememberTransactionEffect(tx, `identity-orphan-drive:${event.eventId}`, reportOrphanDriveSpaces);
      return { outcome: 'handed_off' };
    },
  });
}
