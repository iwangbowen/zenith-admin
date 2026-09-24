import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../../db/types';
import { cmsChannels, cmsModels, cmsModelVersions } from '../../db/schema';
import { assertCmsSiteComposition } from './cms-site-composition.service';

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../cms/themes/registry', () => ({ getThemeSettingsSchema: (theme: string) => theme === 'default' ? [{ name: 'homeSections' }, { name: 'modelDisplays' }] : [] }));
const records = new Map<unknown, unknown[]>();
const executor = { select: () => ({ from: (table: unknown) => ({ where: () => Promise.resolve(records.get(table) ?? []) }) }) } as unknown as DbExecutor;
const section = { id: 'region', source: 'channel', channelId: 9, title: '', count: 6, style: 'cards', imageRatio: 'wide', focusX: 50, focusY: 50 };
const binding = { modelId: 2, kind: 'event', fields: { startsAt: 'start', venue: 'place' } };
const settings = { themeConfig: { homeSections: [section], modelDisplays: [binding] } };
beforeEach(() => {
  records.clear();
  records.set(cmsChannels, [{ id: 9, siteId: 1, name: '活动', type: 'list', status: 'enabled' }]);
  records.set(cmsModels, [{ id: 2, ownerSiteId: 1, status: 'enabled', publishedVersionId: 4 }]);
  records.set(cmsModelVersions, [{ id: 4, modelId: 2, fields: [{ name: 'start', fieldType: 'datetime' }, { name: 'place', fieldType: 'text' }] }]);
});
describe('站点配置保存引用校验', () => {
  it('validates against published fields within the supplied transaction', async () => {
    await expect(assertCmsSiteComposition('default', settings, 1, executor)).resolves.toBeUndefined();
    records.set(cmsModelVersions, []);
    await expect(assertCmsSiteComposition('default', settings, 1, executor)).rejects.toMatchObject({ status: 400 });
  });
  it('rejects cross-site channels and models before committing configuration', async () => {
    records.set(cmsChannels, [{ id: 9, siteId: 2, name: '别站活动', type: 'list', status: 'enabled' }]);
    await expect(assertCmsSiteComposition('default', settings, 1, executor)).rejects.toMatchObject({ status: 400 });
    records.set(cmsChannels, [{ id: 9, siteId: 1, name: '活动', type: 'list', status: 'enabled' }]);
    records.set(cmsModels, [{ id: 2, ownerSiteId: 2, status: 'enabled', publishedVersionId: 4 }]);
    await expect(assertCmsSiteComposition('default', settings, 1, executor)).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unsupported theme capabilities and invalid shape even before creating a site', async () => {
    await expect(assertCmsSiteComposition('docs', settings, undefined, executor)).rejects.toMatchObject({ status: 400 });
    await expect(assertCmsSiteComposition('default', { themeConfig: { homeSections: [{ ...section, count: 300 }] } }, undefined, executor)).rejects.toMatchObject({ status: 400 });
  });
});
