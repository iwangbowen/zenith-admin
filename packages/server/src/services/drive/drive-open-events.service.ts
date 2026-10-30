import { DRIVE_ACTIVITY_OPEN_EVENT, type DriveActivityAction } from '@zenith/shared/drive';
import type { DbTransaction } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { publishOpenEventInTx } from '../open-platform/open-events.service';

export function openEventForAction(action: DriveActivityAction) {
  return DRIVE_ACTIVITY_OPEN_EVENT[action];
}

/** Freeze the activity snapshot before commit; delivery workers never re-read mutable Drive rows. */
export async function publishDriveOpenEventInTx(tx: DbTransaction, input: {
  activityId: number; spaceId: number; nodeId: number | null; nodeName: string; nodeType: string;
  action: DriveActivityAction; detail?: Record<string, unknown> | null; shareId?: number | null;
  actorId?: number | null; tenantId: number | null; occurredAt: Date;
}): Promise<void> {
  const type = openEventForAction(input.action);
  if (!type) return;
  await publishOpenEventInTx(tx, {
    type, tenantId: input.tenantId, scope: { spaceId: input.spaceId },
    businessKey: `drive-activity:${input.activityId}`, orderingKey: `drive-space:${input.spaceId}`,
    subjects: [{ type: input.nodeId ? 'drive.file' : 'drive.space', key: String(input.nodeId ?? input.spaceId), role: 'primary' }],
    data: { action: input.action, occurredAt: formatDateTime(input.occurredAt),
      space: { id: input.spaceId }, node: { id: input.nodeId, name: input.nodeName, type: input.nodeType },
      share: input.shareId == null ? null : { id: input.shareId }, actorId: input.actorId ?? null, detail: input.detail ?? null },
  });
}
