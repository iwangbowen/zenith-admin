import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmsChannelContract, cmsPageContract, cmsReleaseContract, cmsSiteContract, type CmsChannel, type CmsPage, type CmsRelease, type CmsReleaseDetail, type CmsSite } from '@zenith/shared/cms';
import { cmsHandlers, cmsP6Handlers } from './handlers/cms';
import { cmsStage4Handlers } from './handlers/cms-stage4';
import { cmsReleaseHandlers, resetMockCmsReleases } from './handlers/cms-releases';
import { mockCmsChannels, mockCmsContents, mockCmsContentVersions, mockCmsPages, mockCmsSites, mockCmsWidgetRefs } from './data/cms';
import { resetMockCmsRevisions } from './utils/cms-revisions';

const stores = [mockCmsSites, mockCmsPages, mockCmsChannels, mockCmsWidgetRefs, mockCmsContents, mockCmsContentVersions];
const snapshots = stores.map((rows) => structuredClone(rows));
function reset() {
  stores.forEach((rows, index) => { rows.splice(0, rows.length, ...structuredClone(snapshots[index]) as never[]); });
  resetMockCmsRevisions();
  resetMockCmsReleases();
}
beforeEach(() => { reset(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); reset(); });

async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of [...cmsReleaseHandlers, ...cmsStage4Handlers, ...cmsHandlers, ...cmsP6Handlers]) {
    const request = new Request(`${window.location.origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `cms-config-${Math.random()}` });
    if (result?.response) {
      expect(result.response.status).toBe(200);
      return (await result.response.json() as { data: T }).data;
    }
  }
  throw new Error(`No handler matched ${method} ${path}`);
}
const releasePath = cmsReleaseContract.basePath;
const drafts = async (siteId: number) => (await call<{ list: CmsRelease[] }>('GET', `${releasePath}?siteId=${siteId}&pageSize=100`)).list;

describe('CMS Demo 配置待审阅草稿', () => {
  it('merges consecutive site and page writes into one review draft without touching a manual release', async () => {
    const site = mockCmsSites[0];
    const page = mockCmsPages.find((row) => row.siteId === site.id)!;
    const manual = await call<CmsRelease>('POST', releasePath, { siteId: site.id, name: '人工选择的发布单', pageIds: [page.id] });
    await call('PUT', `${cmsSiteContract.basePath}/${site.id}`, { title: '连续保存的站点标题' });
    await call('PUT', `${cmsPageContract.basePath}/${page.id}`, { name: '配置草稿中的最新页面' });
    await call('PUT', `${cmsSiteContract.basePath}/${site.id}`, { logo: 'cms-res://81', favicon: 'cms-res://82' });
    const rows = await drafts(site.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === manual.id)).toMatchObject({ source: 'manual', status: 'draft', configurationItems: manual.configurationItems });
    const draft = rows.find((row) => row.source === 'configuration')!;
    expect(draft).toMatchObject({ status: 'draft', deploymentId: null, autoActivate: false, baseGenerationId: null });
    expect(draft.configurationItems).toContainEqual({ kind: 'page', id: page.id, title: '配置草稿中的最新页面' });
    await vi.advanceTimersByTimeAsync(1_000);
    const detail = await call<CmsReleaseDetail>('GET', `${releasePath}/${draft.id}`);
    expect(detail).toMatchObject({ status: 'draft', deployment: null, activeGenerationId: null });
  });

  it('freezes the built candidate and starts a new draft for later edits and deletions', async () => {
    const page = mockCmsPages[0];
    await call('PUT', `${cmsPageContract.basePath}/${page.id}`, { name: '审阅时冻结的页面名称' });
    const first = (await drafts(page.siteId))[0];
    await call('POST', `${releasePath}/${first.id}/build`);
    await call('PUT', `${cmsPageContract.basePath}/${page.id}`, { name: '构建后继续修改的页面' });
    const second = (await drafts(page.siteId)).find((row) => row.status === 'draft')!;
    expect(second.id).not.toBe(first.id);
    expect(second.configurationItems).toContainEqual({ kind: 'page', id: page.id, title: '构建后继续修改的页面' });
    await call('DELETE', `${cmsPageContract.basePath}/${page.id}`);
    const updated = await call<CmsRelease>('GET', `${releasePath}/${second.id}`);
    expect(updated.configurationItems.some((item) => item.kind === 'page' && item.id === page.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    const preview = await call<{ html: string }>('GET', `${releasePath}/${first.id}/preview?path=%2F`);
    expect(preview.html).toContain('审阅时冻结的页面名称');
    expect(preview.html).not.toContain('构建后继续修改的页面');
    expect((await call<CmsReleaseDetail>('GET', `${releasePath}/${first.id}`)).activeGenerationId).toBeNull();
  });

  it('keeps different sites and cancelled review drafts separate', async () => {
    const site = mockCmsSites[0];
    const another = await call<CmsSite>('POST', cmsSiteContract.basePath, { name: '独立演示站点', code: 'separate-config-draft' });
    await call('PUT', `${cmsSiteContract.basePath}/${site.id}`, { title: '第一站的草稿' });
    await call('PUT', `${cmsSiteContract.basePath}/${another.id}`, { title: '第二站的草稿' });
    const first = (await drafts(site.id))[0];
    expect((await drafts(another.id))).toHaveLength(1);
    expect((await drafts(another.id))[0].id).not.toBe(first.id);
    await call('POST', `${releasePath}/${first.id}/cancel`);
    await call('PUT', `${cmsSiteContract.basePath}/${site.id}`, { title: '取消后新建草稿' });
    expect((await drafts(site.id)).map((row) => row.status).sort()).toEqual(['cancelled', 'draft']);
  });

  it('persists site image handles and channel form binding through the actual Demo handlers', async () => {
    const site = await call<CmsSite>('POST', cmsSiteContract.basePath, { name: '图片与表单测试', code: 'images-and-form', logo: 'cms-res://81', favicon: 'cms-res://82' });
    expect(site).toMatchObject({ logo: 'cms-res://81', favicon: 'cms-res://82' });
    const channel = await call<CmsChannel>('POST', cmsChannelContract.basePath, { siteId: site.id, name: '联系页', slug: 'contact', type: 'page', settings: { formCode: 'contact', retained: true } });
    expect(channel.settings).toEqual({ formCode: 'contact', retained: true });
    const cleared = await call<CmsChannel>('PUT', `${cmsChannelContract.basePath}/${channel.id}`, { settings: { retained: true } });
    expect(cleared.settings).toEqual({ retained: true });
    const page = await call<CmsPage>('POST', cmsPageContract.basePath, { siteId: site.id, name: '首页', slug: 'home', blocks: [] });
    expect((await drafts(site.id))).toHaveLength(1);
    expect((await drafts(site.id))[0].configurationItems).toContainEqual({ kind: 'page', id: page.id, title: page.name });
  });
});
