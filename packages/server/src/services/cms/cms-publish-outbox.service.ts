import dayjs from 'dayjs';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { CmsPublishSubmitInput } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { CMS_PUBLISH_TARGET_TYPE_LABELS } from '@zenith/shared/cms';
import { asyncTasks, cmsSites } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { currentUserOrNull, runWithCurrentUser } from '../../lib/context';
import { enqueueAsyncTask, mapAsyncTask, persistAsyncTask } from '../../lib/task-center';
import logger from '../../lib/logger';
import type { CmsSiteRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { acquireCmsSitePublishLock, bumpCmsPublicRevision, cmsSiteFencePayload } from './cms-site-publish-lock.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';

const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
const transactionPublicRevisions = new WeakMap<object, Map<number, number>>();

async function publicRevisionForOutbox(executor: DbTransaction, siteId: number, bump: boolean, fallback: number): Promise<number> {
  if (!bump) {
    if (typeof executor.select === 'function') {
      const [site] = await executor.select({ revision: cmsSites.publicRevision }).from(cmsSites)
        .where(eq(cmsSites.id, siteId)).limit(1);
      return site?.revision ?? fallback;
    }
    return fallback;
  }
  const key = executor as object;
  const cached = transactionPublicRevisions.get(key)?.get(siteId);
  if (cached != null) return cached;
  const revision = await bumpCmsPublicRevision(executor, siteId);
  const map = transactionPublicRevisions.get(key) ?? new Map<number, number>();
  map.set(siteId, revision);
  transactionPublicRevisions.set(key, map);
  return revision;
}

function cmsPublishIdempotencyKey(eventKey: string): string {
  const digest = createHash('sha256').update(eventKey).digest('hex').slice(0, 48);
  return `cms-publish-event:${digest}`;
}

/**
 * The revision bump and the idempotent outbox insert must share one transaction.
 * In particular, a duplicate event must return the existing task before it
 * advances publicRevision; otherwise a successful old task would invalidate
 * its own artifact without creating a replacement build.
 */
async function insertCmsPublishOutboxInExecutor(
  executor: DbTransaction,
  input: CmsPublishSubmitInput,
  eventKey: string,
): Promise<AsyncTask> {
  const idempotencyKey = cmsPublishIdempotencyKey(eventKey);
  // Production executors are Drizzle instances. The method guards keep the
  // helper usable by lightweight unit-test doubles that only assert payloads.
  if (typeof executor.execute === 'function') await acquireCmsSitePublishLock(executor, input.siteId);
  if (typeof executor.select === 'function') {
    const actor = currentUserOrNull() ?? SYSTEM_USER;
    const [existing] = await executor.select().from(asyncTasks).where(and(
      eq(asyncTasks.taskType, 'cms-publish-build'),
      eq(asyncTasks.createdBy, actor.userId),
      isNull(asyncTasks.tenantId),
      eq(asyncTasks.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) return mapAsyncTask(existing);
  }
  const publicRevision = await publicRevisionForOutbox(
    executor,
    input.siteId,
    input.targetType === 'site' || input.targetType === 'theme',
    input.expectedPublicRevision ?? 0,
  );
  const fencedInput: CmsPublishSubmitInput = { ...input, expectedPublicRevision: publicRevision };
  const row = await persistAsyncTask(executor, {
    taskType: 'cms-publish-build',
    title: `CMS ${CMS_PUBLISH_TARGET_TYPE_LABELS[input.targetType]}发布`,
    payload: {
      ...fencedInput,
      submittedAt: formatDateTime(dayjs().toDate()),
      systemTriggered: true,
      dedupeFingerprint: `event:${eventKey}`,
    },
    idempotencyKey,
  });
  return mapAsyncTask(row);
}

export async function insertCmsPublishOutbox(
  executor: DbTransaction,
  input: CmsPublishSubmitInput,
  eventKey: string,
): Promise<AsyncTask> {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  return runWithCurrentUser(
    { ...actor, tenantId: null, viewingTenantId: undefined },
    () => insertCmsPublishOutboxInExecutor(executor, input, eventKey),
  );
}

export async function enqueueCmsPublishOutboxes(tasks: readonly AsyncTask[], source: string): Promise<void> {
  // Invalidate dynamic/meta Redis entries immediately after the surrounding
  // transaction commits. File generation remains asynchronous, but a request
  // must never serve a cached pre-revision page while it waits in the queue.
  const siteIds = [...new Set(tasks
    .map((task) => task.payload?.siteId)
    .filter((siteId): siteId is number => typeof siteId === 'number' && Number.isInteger(siteId) && siteId > 0))];
  await import('./cms-sites.service').then(({ invalidateSiteCache }) => invalidateSiteCache());
  await Promise.all(siteIds.map((siteId) => invalidateCmsSiteCaches(siteId)));
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
