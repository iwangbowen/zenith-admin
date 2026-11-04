import type { DbTransaction } from '../../db/types';
import { ACCESS_REQUEST_BIZ_TYPE } from '@zenith/shared/identity';
import { attachAccessRequestToWorkflow as attachRequest, recordAccessWorkflowOutcome } from '../../services/identity/public/access-approval';
import { lastBusinessDecision } from '../../services/workflow/public/access-approval';

export const attachAccessRequestToWorkflow = attachRequest;
/** Only the integration combines workflow facts with identity-owned commands. */
export async function bridgeAccessWorkflowOutcome(
  tx: DbTransaction,
  instance: { id: number; tenantId: number | null; bizType?: string | null; bizId?: string | null; status: string },
  actorId: number | null,
): Promise<void> {
  if (instance.bizType !== ACCESS_REQUEST_BIZ_TYPE) return;
  const decision = instance.status === 'rejected' ? await lastBusinessDecision(tx, instance.id, 'rejected') : undefined;
  await recordAccessWorkflowOutcome(tx, instance, actorId, decision?.comment);
}
