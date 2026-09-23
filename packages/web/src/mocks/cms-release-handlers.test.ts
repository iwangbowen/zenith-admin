import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsRelease, CmsReleaseDetail } from '@zenith/shared/cms';
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
  it('previews frozen content and page configuration before explicitly activating the candidate', async () => {
    const working = getMockCmsWorkingContent(1);
    const oldBody = getMockCmsPublishedContent(1)!.body;
    saveMockCmsWorkingContent(1, { body: '<p>经过审批的固定正文</p>' }, working.version);
    const revision = freezeMockCmsRevision(1, 'submission');
    working.approvedRevisionId = revision.id;
    const page = mockCmsPages.find((item) => item.siteId === working.siteId)!;
    const pageName = page.name;
    const created = await call<CmsRelease>('POST', '/api/cms/releases', { siteId: working.siteId, name: '活动上线', revisionIds: [revision.id], pageIds: [page.id], autoActivate: false });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    saveMockCmsWorkingContent(1, { body: '<p>后来继续编辑的工作稿</p>' }, working.version);
    page.name = '后来修改的页面名称';
    expect((await call<CmsRelease>('POST', `/api/cms/releases/${id}/build`)).body.data.status).toBe('building');
    await vi.advanceTimersByTimeAsync(300);
    expect(getMockCmsPublishedContent(1)!.body).toBe(oldBody);
    const preview = await call<{ html: string }>('GET', `/api/cms/releases/${id}/preview?path=%2F`);
    expect(preview.body.data.html).toContain('经过审批的固定正文');
    expect(preview.body.data.html).toContain(pageName);
    expect(preview.body.data.html).not.toContain('后来继续编辑');
    expect(preview.body.data.html).not.toContain('后来修改的页面名称');
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
});
