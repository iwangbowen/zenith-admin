import dayjs from 'dayjs';
import type { AsyncTask, CmsPublishSubmitInput } from '@zenith/shared';
import { CMS_PUBLISH_TARGET_TYPE_LABELS } from '@zenith/shared';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { currentUserOrNull, runWithCurrentUser } from '../../lib/context';
import { enqueueAsyncTask, mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import logger from '../../lib/logger';
import type { CmsSiteRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { cmsSiteFencePayload } from './cms-site-publish-lock.service';

const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };

export async function insertCmsPublishOutbox(
  executor: DbExecutor,
  input: CmsPublishSubmitInput,
  eventKey: string,
): Promise<AsyncTask> {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  return runWithCurrentUser({ ...actor, tenantId: null, viewingTenantId: undefined }, async () => {
    const row = await submitAsyncTask({
      taskType: 'cms-publish-build',
      title: `CMS ${CMS_PUBLISH_TARGET_TYPE_LABELS[input.targetType]}发布`,
      payload: {
        ...input,
        submittedAt: formatDateTime(dayjs().toDate()),
        systemTriggered: true,
        dedupeFingerprint: `event:${eventKey}`,
      },
      idempotencyKey: `cms-publish-event:${eventKey}`.slice(0, 128),
    }, { executor });
    return mapAsyncTask(row);
  });
}

export async function enqueueCmsPublishOutboxes(tasks: readonly AsyncTask[], source: string): Promise<void> {
  for (const task of tasks) {
    await enqueueAsyncTask(task.id).catch((error) => {
      logger.error(`[cms-publish-outbox] ${source} task #${task.id} 入队失败，等待 pending 恢复扫描补投`, error);
    });
  }
}

export async function insertCmsSiteRefsRebuildOutbox(
  tx: DbTransaction,
  site: CmsSiteRow,
  reason: string,
  eventKey: string,
): Promise<AsyncTask> {
  return insertCmsPublishOutbox(tx, {
    siteId: site.id,
    targetType: 'site',
    ...await cmsSiteFencePayload(tx, site),
    reason,
  }, eventKey);
}
