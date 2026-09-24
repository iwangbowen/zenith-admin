import { cmsHomeSectionsSchema, cmsModelDisplaysSchema, validateCmsHomeSections, validateCmsModelDisplay } from '@zenith/shared/cms';
import { mockCmsChannels, mockCmsModels } from '../data/cms';
import { MockHttpError } from './contract';
import { badRequest } from './handlers';
import { getMockCmsPublishedModelFields } from '../handlers/cms-editorial';

export function assertMockCmsSiteComposition(siteId: number, theme: string, settings: Record<string, unknown>) {
  const config = settings.themeConfig as Record<string, unknown> | undefined;
  if (!config) return;
  const home = cmsHomeSectionsSchema.safeParse(config.homeSections ?? []);
  const displays = cmsModelDisplaysSchema.safeParse(config.modelDisplays ?? []);
  if (!home.success || !displays.success) throw new MockHttpError(badRequest('首页编排或模型展示映射格式无效', { status: 400 }));
  if (theme !== 'default' && (home.data.length || displays.data.length)) throw new MockHttpError(badRequest('当前主题不支持首页编排或模型展示映射', { status: 400 }));
  const issues = validateCmsHomeSections(home.data, mockCmsChannels, siteId);
  for (const binding of displays.data) {
    const model = mockCmsModels.find((row) => row.id === binding.modelId && row.status === 'enabled' && (row.ownerSiteId == null || row.ownerSiteId === siteId));
    issues.push(...validateCmsModelDisplay(binding, model ? { id: model.id, fields: getMockCmsPublishedModelFields(model.id) } : undefined));
  }
  if (issues.length) throw new MockHttpError(badRequest(issues.join('；'), { status: 400 }));
}
