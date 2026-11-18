import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsContentReviewPolicy, CmsContentReviewRecord } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { mockCmsContents, mockCmsContentVersions } from './data/cms';
import { mockCmsEditorialTasks } from './data/cms-operations';
import { cmsContentReviewHandlers, resetMockCmsContentReviews } from './handlers/cms-reviews';
import { getMockCmsActivePublication, resetMockCmsReleases, submitMockCmsContentRelease } from './handlers/cms-releases';
import { refreshMockAsyncTask } from './handlers/async-tasks';
import { freezeMockCmsRevision, getMockCmsWorkingContent, resetMockCmsRevisions, saveMockCmsWorkingContent } from './utils/cms-revisions';
import { resetMockEditorialOutcomes } from './utils/cms-editorial-outcomes';

const initial = { contents: structuredClone(mockCmsContents), revisions: structuredClone(mockCmsContentVersions) };
const config = { enabled: true, ownerId: 1, intervalDays: 90, nextReviewAt: '2026-09-01 00:00:00', validUntil: null, noticeDays: 30, checkLinks: true, checkAssetRights: true };
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T04:00:00Z')); });
afterEach(() => {
  resetMockCmsContentReviews(); resetMockCmsReleases(); resetMockCmsRevisions(); resetMockEditorialOutcomes(); mockCmsEditorialTasks.length = 0;
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(initial.contents));
  mockCmsContentVersions.splice(0, mockCmsContentVersions.length, ...structuredClone(initial.revisions));
  vi.useRealTimers();
});
async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of cmsContentReviewHandlers) {
    const request = new Request(`${window.location.origin}/api/cms/content-reviews${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `reviews-${Math.random()}` });
    if (result?.response) return { status: result.response.status, data: (await result.response.json() as { data: T }).data };
  }
  throw new Error(`No review handler for ${path}`);
}
async function liveArticle() {
  const content = getMockCmsWorkingContent(mockCmsContents.find(row => row.status === 'published')!.id);
  saveMockCmsWorkingContent(content.id, { body: '<p>文化指南 <a href="/not-a-published-page/">失效入口</a> <a href="https://example.com/">外部参考</a></p>' }, content.version, 'autosave');
  const revision = freezeMockCmsRevision(content.id, 'publication'); content.approvedRevisionId = revision.id;
  submitMockCmsContentRelease(content.id, revision.id); await new Promise(resolve => setTimeout(resolve, 300));
  expect(getMockCmsActivePublication(content.id)?.revisionId).toBe(revision.id);
  return content;
}

describe('CMS Demo content review policies and scans', () => {
  it('requires policy CAS and the real active revision when recording a review', async () => {
    const content = await liveArticle();
    const saved = await call<CmsContentReviewPolicy>('PUT', `/${content.id}`, { ...config, expectedVersion: 0 });
    expect(saved.data.version).toBe(1);
    expect((await call('PUT', `/${content.id}`, { ...config, expectedVersion: 0 })).status).toBe(409);
    expect((await call('POST', `/${content.id}/complete`, { expectedVersion: 1, revisionId: 999999, note: '旧修订' })).status).toBe(409);
    const completed = await call<CmsContentReviewPolicy>('POST', `/${content.id}/complete`, { expectedVersion: 1, revisionId: content.approvedRevisionId, note: '逐项核对在线文化指南' });
    expect(completed.data).toMatchObject({ version: 2, lastReviewedRevisionId: content.approvedRevisionId });
    const records = await call<CmsContentReviewRecord[]>('GET', `/${content.id}/records`);
    expect(records.data).toHaveLength(1);
    expect(records.data[0].generationId).toBe(getMockCmsActivePublication(content.id)!.deploymentId);
  });

  it('skips a changed policy instead of writing stale scan findings', async () => {
    const content = await liveArticle();
    await call('PUT', `/${content.id}`, { ...config, expectedVersion: 0 });
    const submitted = await call<AsyncTask>('POST', '/scan', { siteId: content.siteId, contentId: content.id });
    await call('PUT', `/${content.id}`, { ...config, expectedVersion: 1, nextReviewAt: '2027-01-01 00:00:00', checkLinks: false });
    vi.setSystemTime(Date.now() + 1000);
    const completed = refreshMockAsyncTask(submitted.data.id)!;
    expect(completed.result).toMatchObject({ checked: 0, skipped: 1 });
    expect((await call<CmsContentReviewPolicy>('GET', `/${content.id}`)).data.issues).toEqual([]);
    expect(mockCmsEditorialTasks).toHaveLength(0);
  });

  it('keeps draft-only content out of completed review records', async () => {
    const content = getMockCmsWorkingContent(mockCmsContents.find(row => row.status === 'draft')!.id);
    await call('PUT', `/${content.id}`, { ...config, expectedVersion: 0 });
    const revision = freezeMockCmsRevision(content.id);
    expect((await call('POST', `/${content.id}/complete`, { expectedVersion: 1, revisionId: revision.id, note: '草稿不属于在线复核' })).status).toBe(409);
    expect((await call<CmsContentReviewRecord[]>('GET', `/${content.id}/records`)).data).toEqual([]);
  });

  it('does not apply findings when the task is cancelled before completion', async () => {
    const content = await liveArticle();
    await call('PUT', `/${content.id}`, { ...config, expectedVersion: 0 });
    const submitted = await call<AsyncTask>('POST', '/scan', { siteId: content.siteId, contentId: content.id });
    const running = refreshMockAsyncTask(submitted.data.id)!;
    running.cancelRequested = true;
    vi.setSystemTime(Date.now() + 1000);
    expect(refreshMockAsyncTask(running.id)!.status).toBe('cancelled');
    expect((await call<CmsContentReviewPolicy>('GET', `/${content.id}`)).data.lastCheckedAt).toBeNull();
    expect(mockCmsEditorialTasks).toHaveLength(0);
  });
});
