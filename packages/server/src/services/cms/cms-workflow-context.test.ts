import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ siteAccess: vi.fn(), channelAccess: vi.fn(), channel: vi.fn(), site: vi.fn(),
  content: vi.fn(), preview: vi.fn(), context: vi.fn(), definitions: vi.fn(), start: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.definitions, orderBy: () => ({ limit: mocks.definitions }) }) }) }) } }));
vi.mock('../../lib/workflow-biz-bridge', () => ({ startWorkflowForBiz: mocks.start, onWorkflowResult: vi.fn() }));
vi.mock('../workflow/workflow-business-context.service', () => ({ previewBusinessWorkflow: mocks.preview, getBusinessWorkflowContext: mocks.context }));
vi.mock('./cms-contents-query.service', () => ({ getCmsContent: mocks.content }));
vi.mock('./cms-site-inheritance.service', () => ({ resolveEffectiveCmsSiteRow: mocks.site }));
vi.mock('./cms-sites.service', () => ({ assertSiteAccess: mocks.siteAccess }));
vi.mock('./cms-channels.service', () => ({ assertChannelAccess: mocks.channelAccess, ensureCmsChannelExists: mocks.channel }));
import { getCmsContentWorkflowContext, previewCmsContentWorkflow } from './cms-workflow.service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.channel.mockResolvedValue({ id: 2, siteId: 1, name: '通知' });
  mocks.site.mockResolvedValue({ id: 1, name: '门户', settings: { auditMode: 'workflow', auditWorkflowDefinitionId: 6 } });
  mocks.definitions.mockResolvedValue([{ id: 6 }]);
  mocks.siteAccess.mockResolvedValue(undefined);
  mocks.channelAccess.mockResolvedValue(undefined);
  mocks.preview.mockResolvedValue({ definition: { id: 6 }, nodes: [] });
});
describe('CMS business workflow entry points', () => {
  it('requires both site and channel visibility for a read-only preview', async () => {
    mocks.channelAccess.mockRejectedValueOnce(new Error('栏目不可见'));
    await expect(previewCmsContentWorkflow({ siteId: 1, channelId: 2 })).rejects.toThrow('栏目不可见');
    expect(mocks.siteAccess).toHaveBeenCalledWith(1);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('rejects a channel belonging to another site', async () => {
    mocks.channel.mockResolvedValueOnce({ id: 2, siteId: 99, name: '其他' });
    await expect(previewCmsContentWorkflow({ siteId: 1, channelId: 2 })).rejects.toThrow('不属于');
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('returns an empty definition only when workflow auditing is not enabled', async () => {
    mocks.site.mockResolvedValueOnce({ id: 1, name: '门户', settings: { auditMode: 'simple' } });
    await expect(previewCmsContentWorkflow({ siteId: 1, channelId: 2 })).resolves.toEqual({ definition: null, nodes: [] });
    expect(mocks.definitions).not.toHaveBeenCalled();
  });
  it('fails invalid explicit definitions instead of silently selecting a fallback', async () => {
    mocks.definitions.mockResolvedValueOnce([]);
    await expect(previewCmsContentWorkflow({ siteId: 1, channelId: 2 })).rejects.toThrow('未发布');
    expect(mocks.definitions).toHaveBeenCalledTimes(1);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('derives routing variables from authorized site/channel and the current title', async () => {
    await previewCmsContentWorkflow({ siteId: 1, channelId: 2, title: '新标题' });
    expect(mocks.preview).toHaveBeenCalledWith(6, { contentTitle: '新标题', siteName: '门户', channelName: '通知' });
  });
  it.each(['draft', 'rejected'])('%s work defaults to this submission preview even when a prior version is public', async (editorialStatus) => {
    mocks.content.mockResolvedValueOnce({ id: 10, status: 'published', editorialStatus, submittedRevisionId: null });
    await getCmsContentWorkflowContext(10, 3);
    expect(mocks.content).toHaveBeenCalledWith(10);
    expect(mocks.context).toHaveBeenCalledWith('cms_content', '10', null, 3);
  });
  it.each(['draft', 'pending', 'approved', 'clean'])('%s work retains the submitted revision round regardless of public status', async (editorialStatus) => {
    mocks.content.mockResolvedValueOnce({ id: 10, status: 'draft', editorialStatus, submittedRevisionId: 41 });
    await getCmsContentWorkflowContext(10);
    expect(mocks.context).toHaveBeenCalledWith('cms_content', '10', 'latest', undefined);
  });
});
