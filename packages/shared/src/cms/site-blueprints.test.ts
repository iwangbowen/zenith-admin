import { describe, expect, it } from 'vitest';
import { buildCmsSiteBlueprint, CMS_SITE_BLUEPRINTS, remapCmsSiteComposition } from './site-blueprints';
import { cmsHomeSectionsSchema, cmsModelDisplaysSchema, validateCmsModelDisplay } from './site-composition';
import { cmsWidgetDataSchema, createCmsFormSchema, createCmsPageSchema } from './validation';

describe('CMS site blueprint graph', () => {
  it.each(CMS_SITE_BLUEPRINTS)('$code has valid forms/pages/widgets and complete model and channel mappings', ({ code }) => {
    const pkg = buildCmsSiteBlueprint({ blueprint: code, name: '文化站点', code: 'culture-site' });
    for (const form of pkg.forms) expect(createCmsFormSchema.safeParse({ ...form, siteId: 42 }).success).toBe(true);
    for (const page of pkg.pages) expect(createCmsPageSchema.safeParse({ ...page, siteId: 42 }).success).toBe(true);
    for (const widget of pkg.widgets) expect(cmsWidgetDataSchema.safeParse(widget.draftData).success).toBe(true);
    for (const binding of pkg.site.settings.themeConfig.modelDisplays) expect(validateCmsModelDisplay(binding, { id: binding.modelId, fields: pkg.modelFields.filter((field) => field.modelId === binding.modelId) })).toEqual([]);
    const remapped = remapCmsSiteComposition(pkg.site.settings, new Map(pkg.channels.map((row) => [row.id, row.id + 1000])), new Map(pkg.models.map((row) => [row.id, row.id + 2000])));
    const config = remapped.themeConfig as Record<string, unknown>;
    expect(cmsHomeSectionsSchema.parse(config.homeSections).every((row) => row.channelId! > 1000)).toBe(true);
    expect(cmsModelDisplaysSchema.parse(config.modelDisplays).every((row) => row.modelId > 2000)).toBe(true);
    expect(pkg.site.settings.themeConfig.modelDisplays[0].modelId).toBe(1);
    expect(() => remapCmsSiteComposition(pkg.site.settings, new Map(), new Map())).toThrow('没有随配置包提供');
  });
});
