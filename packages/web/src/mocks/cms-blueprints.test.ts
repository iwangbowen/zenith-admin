import { describe, expect, it } from 'vitest';
import { cmsSiteContract, type CmsSiteImportResult } from '@zenith/shared/cms';
import { cmsBlueprintHandlers } from './handlers/cms-blueprints';
import { mockCmsChannels, mockCmsSites, mockCmsModels, mockCmsWidgetRefs, mockCmsWidgets } from './data/cms';
import { getMockCmsPublishedModelFields } from './handlers/cms-editorial';

describe('CMS blueprint Demo persistence', () => {
  it('creates independently editable graphs and preserves local widget/model bindings', async () => {
    const request = new Request(`${window.location.origin}${cmsSiteContract.basePath}/from-blueprint`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprint: 'culture-portal', name: '蓝图集成测试', code: 'demo-blueprint' }) });
    const handler = cmsBlueprintHandlers[1];
    const result = await handler.run({ request, requestId: 'blueprint-test' });
    expect(result?.response?.status).toBe(200);
    const { data } = await result!.response!.json() as { data: CmsSiteImportResult };
    expect(data.counts).toMatchObject({ channels: 8, models: 3, pages: 2, widgets: 1 });
    const site = mockCmsSites.find((row) => row.id === data.siteId)!;
    const config = site.settings.themeConfig as { homeSections: { channelId: number }[]; modelDisplays: { modelId: number }[] };
    expect(config.homeSections.every((item) => mockCmsChannels.some((row) => row.id === item.channelId && row.siteId === site.id))).toBe(true);
    expect(config.modelDisplays.every((item) => getMockCmsPublishedModelFields(item.modelId).length > 0 && mockCmsModels.some((row) => row.id === item.modelId && row.ownerSiteId === site.id))).toBe(true);
    expect(mockCmsWidgetRefs.filter((row) => row.siteId === site.id)).toHaveLength(2);
    expect(mockCmsWidgets.find((row) => row.siteId === site.id)?.status).toBe('published');
  });
});
