import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  progress: vi.fn(),
  withoutDbExecutor: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock('../../db', () => ({ withoutDbExecutor: mocks.withoutDbExecutor }));

import { cmsStaticBuildResumeAfterKey, reportCmsStaticBuildProgress } from './cms-release-build-plan';

describe('CMS release build progress', () => {
  it('restores the static build cursor from a saved task checkpoint', () => {
    expect(cmsStaticBuildResumeAfterKey({ phase: 'content', lastKey: '~site|2|000000000003', lastId: 3 })).toBe('~site|2|000000000003');
    expect(cmsStaticBuildResumeAfterKey(null)).toBeNull();
    expect(cmsStaticBuildResumeAfterKey({ phase: 'home' })).toBeNull();
  });

  it('stores the static checkpoint through task progress without updating the locked deployment row', async () => {
    const progress = {
      processed: 3,
      total: 12,
      note: '内容 3 已生成',
      checkpoint: { phase: 'content', lastKey: '~site|2|000000000003', lastId: 3 },
    } as const;

    await reportCmsStaticBuildProgress({ progress: mocks.progress }, progress);

    expect(mocks.withoutDbExecutor).toHaveBeenCalledOnce();
    expect(mocks.progress).toHaveBeenCalledWith({
      processed: 3,
      total: 12,
      note: '内容 3 已生成',
      checkpoint: progress.checkpoint,
    });
  });
});
