import { describe, expect, it } from 'vitest';
import { cmsHomeSectionsSchema, cmsModelDisplaysSchema, validateCmsHomeSections, validateCmsModelDisplay, type CmsHomeSection } from './site-composition';

const section: CmsHomeSection = { id: 'news', source: 'channel', channelId: 3, title: '', count: 6, style: 'cards', imageRatio: 'wide', focusX: 20, focusY: 65 };
describe('站点内容编排与模型展示', () => {
  it('rejects malformed, ambiguous and unbounded home sections', () => {
    expect(cmsHomeSectionsSchema.safeParse([section]).success).toBe(true);
    for (const rows of [[{ ...section, count: 25 }], [{ ...section, focusX: 101 }], [{ ...section, channelId: null }], [{ ...section, source: 'latest' }], [section, section]]) {
      expect(cmsHomeSectionsSchema.safeParse(rows).success).toBe(false);
    }
  });
  it('accepts only enabled list channels within the saved site', () => {
    const channel = { id: 3, siteId: 1, name: '新闻', status: 'enabled', type: 'list' };
    expect(validateCmsHomeSections([section], [channel], 1)).toEqual([]);
    expect(validateCmsHomeSections([section], [channel], 2)).not.toEqual([]);
    expect(validateCmsHomeSections([section], [{ ...channel, status: 'disabled' }], 1)).not.toEqual([]);
    expect(validateCmsHomeSections([section], [{ ...channel, type: 'link' }], 1)).not.toEqual([]);
  });
  it('validates required mapping roles and compatible field types', () => {
    const binding = { modelId: 2, kind: 'event' as const, fields: { startsAt: 'start', venue: 'place' } };
    const model = { id: 2, fields: [{ name: 'start', fieldType: 'datetime' }, { name: 'place', fieldType: 'text' }] };
    expect(validateCmsModelDisplay(binding, model)).toEqual([]);
    expect(validateCmsModelDisplay({ ...binding, fields: { venue: 'place' } }, model)).toContain('活动信息卡必须映射开始时间');
    expect(validateCmsModelDisplay({ ...binding, fields: { startsAt: 'place', venue: 'place' } }, model).join()).toContain('不支持字段');
    expect(validateCmsModelDisplay({ ...binding, fields: { ...binding.fields, invented: 'place' } }, model)).toContain('不支持展示位置 invented');
    expect(validateCmsModelDisplay(binding, undefined)).not.toEqual([]);
  });
  it('keeps one display per model and requires an actual file field for downloads', () => {
    const binding = { modelId: 2, kind: 'download' as const, fields: { file: 'attachment' } };
    expect(cmsModelDisplaysSchema.safeParse([binding, binding]).success).toBe(false);
    expect(validateCmsModelDisplay(binding, { id: 2, fields: [{ name: 'attachment', fieldType: 'file' }] })).toEqual([]);
    expect(validateCmsModelDisplay(binding, { id: 2, fields: [{ name: 'attachment', fieldType: 'text' }] })).not.toEqual([]);
  });
});
