import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmsReleaseReviewSchema, type CmsRelease, type CmsReleaseDetail, type CmsReleaseReview } from '@zenith/shared/cms';
import { cmsReleaseHandlers, resetMockCmsReleases } from './handlers/cms-releases';
import { mockCmsContents, mockCmsContentVersions, mockCmsPages } from './data/cms';
import { freezeMockCmsRevision, getMockCmsPublishedContent, getMockCmsWorkingContent, resetMockCmsRevisions, saveMockCmsWorkingContent } from './utils/cms-revisions';

const snapshots = { contents: structuredClone(mockCmsContents), versions: structuredClone(mockCmsContentVersions), pages: structuredClone(mockCmsPages) };
function reset() {
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(snapshots.contents));
  mockCmsContentVersions.splice(0, mockCmsContentVersions.length, ...structuredClone(snapshots.versions));
  mockCmsPages.splice(0, mockCmsPages.length, ...structuredClone(snapshots.pages));
  resetMockCmsRevisions();
  resetMockCmsReleases();
}
beforeEach(() => { reset(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); reset(); });

async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of cmsReleaseHandlers) {
    const request = new Request(`${window.location.origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `cms-release-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { code: number; data: T; message: string } };
  }
  throw new Error(`No release handler matched ${method} ${path}`);
}

describe('发布单 Demo 契约', () => {
  it('builds a candidate from frozen content before explicitly activating it', async () => {
    const working = getMockCmsWorkingContent(1);
    const oldBody = getMockCmsPublishedContent(1)!.body;
    saveMockCmsWorkingContent(1, { body: '<p>经过审批的固定正文</p>' }, working.version);
    const revision = freezeMockCmsRevision(1, 'submission');
    working.approvedRevisionId = revision.id;
    const page = mockCmsPages.find((item) => item.siteId === working.siteId)!;
    page.blocks = [{ id: 'intro', type: 'richtext', props: { html: '<p>固定页面正文</p>' } }];
    const created = await call<CmsRelease>('POST', '/api/cms/releases', { siteId: working.siteId, name: '活动上线', revisionIds: [revision.id], pageIds: [page.id], autoActivate: false });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    saveMockCmsWorkingContent(1, { body: '<p>后来继续编辑的工作稿</p>' }, working.version);
    expect((await call<CmsRelease>('POST', `/api/cms/releases/${id}/build`)).body.data.status).toBe('building');
    await vi.advanceTimersByTimeAsync(300);
    expect(getMockCmsPublishedContent(1)!.body).toBe(oldBody);
    const activated = await call<CmsRelease>('POST', `/api/cms/releases/${id}/activate`, { expectedGenerationId: null });
    expect(activated.body.data.status).toBe('active');
    expect(getMockCmsPublishedContent(1)!.body).toBe('<p>经过审批的固定正文</p>');
    expect(working.body).toBe('<p>后来继续编辑的工作稿</p>');
  });

  it('rejects stale generation activation and preserves the successfully activated deployment', async () => {
    const content = getMockCmsWorkingContent(1);
    const first = await call<CmsRelease>('POST', '/api/cms/releases', { siteId: content.siteId, name: '第一单', revisionIds: [content.publishedRevisionId!] });
    const second = await call<CmsRelease>('POST', '/api/cms/releases', { siteId: content.siteId, name: '并发单', revisionIds: [content.publishedRevisionId!] });
    await call('POST', `/api/cms/releases/${first.body.data.id}/build`);
    await call('POST', `/api/cms/releases/${second.body.data.id}/build`);
    await vi.advanceTimersByTimeAsync(300);
    const activated = await call<CmsRelease>('POST', `/api/cms/releases/${first.body.data.id}/activate`, { expectedGenerationId: null });
    expect(activated.status).toBe(200);
    const rejected = await call('POST', `/api/cms/releases/${second.body.data.id}/activate`, { expectedGenerationId: null });
    expect(rejected.status).toBe(409);
    const detail = await call<CmsReleaseDetail>('GET', `/api/cms/releases/${first.body.data.id}`);
    expect(detail.body.data.activeGenerationId).toBe(activated.body.data.deploymentId);
  });

  it('requires explicit approved dependencies and preserves the original fixed configuration', async () => {
    const source = getMockCmsWorkingContent(1);
    mockCmsContents.push({ ...structuredClone(source), id: 98765, title: '已批准的依赖', status: 'draft', editorialStatus: 'draft', publishedRevisionId: null, approvedRevisionId: null, submittedRevisionId: null, modelId: null, modelFields: [], extend: {}, tagIds: [], relatedIds: [] });
    const target = getMockCmsWorkingContent(98765);
    const targetRevision = freezeMockCmsRevision(target.id, 'submission');
    target.approvedRevisionId = targetRevision.id;
    saveMockCmsWorkingContent(source.id, { modelId: null, modelFields: [], extend: {}, tagIds: [], relatedIds: [target.id] }, source.version);
    const sourceRevision = freezeMockCmsRevision(source.id, 'submission');
    source.approvedRevisionId = sourceRevision.id;
    const page = mockCmsPages.find((item) => item.siteId === source.siteId)!;
    const originalName = page.name;
    const release = (await call<CmsRelease>('POST', '/api/cms/releases', { siteId: source.siteId, name: '依赖选择', revisionIds: [sourceRevision.id], pageIds: [page.id] })).body.data;
    const review = (await call<CmsReleaseReview>('GET', `/api/cms/releases/${release.id}/review`)).body.data;
    expect(cmsReleaseReviewSchema.safeParse(review).success).toBe(true);
    expect(review.validation.inputFingerprint).toBe(review.fingerprint);
    expect(review.checks).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'content-reference', reference: { kind: 'content', id: target.id }, recommendedAction: 'select-approved' })]));
    expect(review.dependencyOptions).toEqual(expect.arrayContaining([expect.objectContaining({ revisionId: targetRevision.id })]));
    expect((await call('POST', `/api/cms/releases/${release.id}/build`)).status).toBe(409);

    page.name = '后来保存但不应混入的页面';
    saveMockCmsWorkingContent(target.id, { title: '未批准的后续工作稿' }, target.version);
    const unapproved = freezeMockCmsRevision(target.id, 'checkpoint');
    const body = { expectedGenerationId: review.currentGenerationId, expectedFingerprint: review.fingerprint, revisionIds: [targetRevision.id] };
    expect((await call('POST', `/api/cms/releases/${release.id}/resolve-dependencies`, { ...body, revisionIds: [unapproved.id] })).status).toBe(409);
    expect((await call('POST', `/api/cms/releases/${release.id}/resolve-dependencies`, { ...body, expectedFingerprint: '0'.repeat(64) })).status).toBe(409);
    const resolved = await call<CmsRelease>('POST', `/api/cms/releases/${release.id}/resolve-dependencies`, body);
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.id).not.toBe(release.id);
    expect(resolved.body.data.items.map(item => item.revisionId)).toEqual([sourceRevision.id, targetRevision.id]);
    expect(resolved.body.data.autoActivate).toBe(false);
    const nextReview = (await call<CmsReleaseReview>('GET', `/api/cms/releases/${resolved.body.data.id}/review`)).body.data;
    expect(nextReview.checks.some(check => check.code === 'content-reference')).toBe(false);
    expect(nextReview.changes.find(change => change.kind === 'page')?.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'name', after: originalName })]));
    expect((await call<CmsRelease>('GET', `/api/cms/releases/${release.id}`)).body.data.items).toHaveLength(1);
    expect(target.title).toBe('未批准的后续工作稿');
    expect(target.approvedRevisionId).toBe(targetRevision.id);
  });
});
