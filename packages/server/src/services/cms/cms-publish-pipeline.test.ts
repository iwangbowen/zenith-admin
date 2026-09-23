import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';

const mocks = vi.hoisted(() => ({
  persistAsyncTask: vi.fn(),
  enqueueAsyncTask: vi.fn(),
}));
vi.mock('../../lib/task-center', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/task-center')>(),
  persistAsyncTask: mocks.persistAsyncTask,
  enqueueAsyncTask: mocks.enqueueAsyncTask,
  mapAsyncTask: (row: unknown) => row,
}));
vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => ({ userId: 7, username: 'editor', roles: ['cms_editor'], tenantId: null }),
  runWithCurrentUser: (_user: unknown, fn: () => unknown) => Promise.resolve(fn()),
}));
vi.mock('./cms-site-publish-lock.service', async (importOriginal) => ({
  ...await importOriginal<typeof import('./cms-site-publish-lock.service')>(),
  bumpCmsPublicRevision: vi.fn(async () => 4),
}));

import { insertCmsPublishOutbox } from './cms-publish-outbox.service';
import { assertLockedCmsPublishPreconditions, canAutoOfflineCmsContent } from './cms-contents.service';
import type { CmsContentRow } from '../../db/schema';
import { assertCmsContentVersion } from './cms-content-revisions.service';

const executorDouble = () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }) as unknown as DbTransaction;

describe('CMS standard publish pipeline behavior', () => {
  it('persists a content snapshot task through the caller transaction without pre-commit enqueue', async () => {
    const executor = executorDouble();
    const row = { id: 42, taskType: 'cms-publish-build', payload: {}, status: 'pending' };
    mocks.persistAsyncTask.mockResolvedValueOnce(row);
    const task = await insertCmsPublishOutbox(executor, {
      siteId: 1,
      targetType: 'content',
      contentIds: [9],
      expectedThemeRevision: 2,
      expectedTemplateRefsRevision: 3,
      expectedDeploymentId: null,
      contentSnapshots: [{
        contentId: 9,
        siteId: 1,
        contentVersion: 4,
        channelId: 2,
        channelPath: 'news',
        slug: 'snapshot',
        bodyPages: 1,
        build: true,
        targets: [{ publishChannelCode: 'pc', paths: ['news/snapshot.html'] }],
        refreshChannelIds: [2],
      }],
      deletePaths: ['news/old.html'],
    }, 'content:9:version:4:update');
    expect(task).toBe(row);
    expect(mocks.persistAsyncTask).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({
        taskType: 'cms-publish-build',
        idempotencyKey: expect.stringMatching(/^cms-publish-event:[0-9a-f]{48}$/),
        payload: expect.objectContaining({
          contentSnapshots: expect.any(Array),
          deletePaths: ['news/old.html'],
          // Content-scoped tasks use the current site revision and an
          // immutable content snapshot; only full-site/theme tasks advance
          // publicRevision.
          expectedPublicRevision: 0,
          systemTriggered: true,
          configurationCapture: expect.objectContaining({ baseGenerationId: null, items: [], snapshot: expect.objectContaining({ tables: {}, replaceAll: [] }) }),
        }),
      }),
    );
    expect(mocks.enqueueAsyncTask).not.toHaveBeenCalled();
  });

  it('propagates outbox insertion failure so the surrounding content transaction can roll back', async () => {
    mocks.persistAsyncTask.mockRejectedValueOnce(new Error('outbox insert failed'));
    await expect(insertCmsPublishOutbox(executorDouble(), {
      siteId: 1,
      targetType: 'content',
      contentIds: [9],
    }, 'content:9:version:5:offline')).rejects.toThrow('outbox insert failed');
  });

  it('keeps scheduled offline eligibility deterministic', () => {
    expect(canAutoOfflineCmsContent({
      status: 'published',
      expireAt: new Date('2026-07-23T10:00:00Z'),
      deletedAt: null,
      lockedAt: null,
    }, new Date('2026-07-23T10:00:01Z'))).toBe(true);
  });

  it('uses working-copy CAS even when both operations publish an already public identity', () => {
    const row = (status: CmsContentRow['status']) => ({
      id: 9,
      status,
      contentType: 'article',
      mediaData: {},
      externalLink: null,
      deletedAt: null,
      archivedAt: null,
      lockedAt: null,
      lockReason: null,
      scheduledAt: null,
    }) as CmsContentRow;
    let versionIncrements = 0;
    let outboxes = 0;
    let sideEffects = 0;
    const working = { version: 4 };
    const commitAfterFence = (locked: CmsContentRow, expectedVersion: number | undefined) => {
      assertCmsContentVersion(working, expectedVersion);
      assertLockedCmsPublishPreconditions('draft', locked);
      working.version++;
      versionIncrements += 1;
      outboxes += 1;
      sideEffects += 1;
    };
    commitAfterFence(row('published'), 4);
    expect(() => commitAfterFence(row('published'), 4)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => commitAfterFence(row('published'), undefined)).toThrow(expect.objectContaining({ status: 409 }));
    expect({ versionIncrements, outboxes, sideEffects }).toEqual({ versionIncrements: 1, outboxes: 1, sideEffects: 1 });
  });
});
