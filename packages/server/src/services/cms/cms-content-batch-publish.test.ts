import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), revision: vi.fn(), create: vi.fn(), build: vi.fn() }));
vi.mock('../../db', () => ({ db: {} }));
vi.mock('./cms-contents-write.service', () => ({ prepareCmsContentPublication: mocks.prepare }));
vi.mock('./cms-content-revisions.service', () => ({ loadCmsPublishableRevision: mocks.revision }));
vi.mock('./cms-releases.service', () => ({ createCmsRelease: mocks.create, buildCmsRelease: mocks.build }));
import { publishCmsContentBatch } from './cms-content-batch-publish.service';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockImplementation(async (id) => ({ contentId: id, revisionId: id + 100, version: 2 }));
  mocks.revision.mockImplementation(async (_executor: unknown, id: number) => ({ id, contentId: id - 100, siteId: 4, payload: { scheduledAt: null } }));
  mocks.create.mockResolvedValue({ id: 9 }); mocks.build.mockResolvedValue({ id: 9, status: 'building' });
});
describe('batch publication grouping', () => {
  it('approves every item before submitting exactly one release for the site', async () => {
    const result = await publishCmsContentBatch([1, 2, 3, 2], { 1: 1, 2: 1, 3: 1 });
    expect(mocks.prepare).toHaveBeenCalledTimes(3);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ siteId: 4, revisionIds: [101, 102, 103] }), undefined, 'content');
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(result).toEqual({ okIds: [1, 2, 3], approvedIds: [1, 2, 3], releases: [{ id: 9, siteId: 4, status: 'building', contentIds: [1, 2, 3] }], failed: [] });
  });
  it('retains approval facts and draft release ID when build submission fails', async () => {
    mocks.build.mockRejectedValueOnce(new Error('queue unavailable'));
    const result = await publishCmsContentBatch([1]);
    expect(result.okIds).toEqual([]); expect(result.approvedIds).toEqual([1]);
    expect(result.releases).toEqual([{ id: 9, siteId: 4, status: 'draft', contentIds: [1] }]);
    expect(result.failed[0].reason).toContain('发布单 #9 已保存');
  });
  it('keeps independent sites in separate releases', async () => {
    mocks.revision.mockImplementation(async (_executor: unknown, id: number) => ({ id, contentId: id - 100, siteId: id === 103 ? 5 : 4, payload: { scheduledAt: null } }));
    await publishCmsContentBatch([1, 2, 3]); expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});
