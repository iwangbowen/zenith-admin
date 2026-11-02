import { registerEventConsumer } from '../../lib/domain-events';
import { reportOrphanDriveSpacesWithin } from '../drive/drive-handoff.service';

let registered = false;
export function registerIdentityEventConsumers(): void {
  if (registered) return;
  registered = true;
  registerEventConsumer({ key: 'identity.orphan-drive-reconciliation', matches: (event) => event.domain === 'identity' && event.eventType.endsWith('.removed'),
    handle: async (tx) => {
      const count = await reportOrphanDriveSpacesWithin(tx);
      return count > 0 ? { outcome: 'handed_off', refs: { notificationCount: count } } : { outcome: 'skipped', reason: 'no orphan drive spaces or platform administrators' };
    },
  });
}
