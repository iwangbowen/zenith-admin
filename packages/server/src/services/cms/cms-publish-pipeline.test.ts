import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../../db/types';

const mocks = vi.hoisted(() => ({
  submitAsyncTask: vi.fn(),
  enqueueAsyncTask: vi.fn(),
}));
vi.mock('../../lib/task-center', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/task-center')>(),
  submitAsyncTask: mocks.submitAsyncTask,
  enqueueAsyncTask: mocks.enqueueAsyncTask,
  mapAsyncTask: (row: unknown) => row,
}));
vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => ({ userId: 7, username: 'editor', roles: ['cms_editor'], tenantId: null }),
  runWithCurrentUser: (_user: unknown, fn: () => unknown) => Promise.resolve(fn()),
}));

import { insertCmsPublishOutbox } from './cms-publish-outbox.service';
import { assertLockedCmsPublishPreconditions, canAutoOfflineCmsContent } from './cms-contents.service';
import type { CmsContentRow } from '../../db/schema';

describe('CMS standard publish pipeline behavior', () => {
  it('persists a content snapshot task through the caller transaction without pre-commit enqueue', async () => {
    const executor = {} as DbExecutor;
    const row = { id: 42, taskType: 'cms-publish-build', payload: {}, status: 'pending' };
    mocks.submitAsyncTask.mockResolvedValueOnce(row);
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
    expect(mocks.submitAsyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'cms-publish-build',
        idempotencyKey: 'cms-publish-event:content:9:version:4:update',
        payload: expect.objectContaining({
          contentSnapshots: expect.any(Array),
          deletePaths: ['news/old.html'],
          systemTriggered: true,
        }),
      }),
      { executor },
    );
    expect(mocks.enqueueAsyncTask).not.toHaveBeenCalled();
  });

  it('propagates outbox insertion failure so the surrounding content transaction can roll back', async () => {
    mocks.submitAsyncTask.mockRejectedValueOnce(new Error('outbox insert failed'));
    await expect(insertCmsPublishOutbox({} as DbExecutor, {
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

  it('rejects the second concurrent publish at the locked-row fence before version/outbox/side effects', () => {
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
    const commitAfterFence = (locked: CmsContentRow) => {
      assertLockedCmsPublishPreconditions('draft', locked);
      versionIncrements += 1;
      outboxes += 1;
      sideEffects += 1;
    };
    commitAfterFence(row('draft'));
    expect(() => commitAfterFence(row('published'))).toThrow(expect.objectContaining({ status: 409 }));
    expect({ versionIncrements, outboxes, sideEffects }).toEqual({ versionIncrements: 1, outboxes: 1, sideEffects: 1 });
  });
});
