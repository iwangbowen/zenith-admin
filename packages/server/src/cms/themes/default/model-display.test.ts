import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import type { CmsModelDisplay } from '@zenith/shared/cms';
import type { CmsDetailContext, CmsModelFieldValue } from '../types';
import { ModelDisplayCard } from './ModelDisplayCard';

const field = (name: string, fieldType: string, value: string): CmsModelFieldValue => ({ name, fieldType, rawValue: value, displayValue: value, label: name, group: null, sort: 0 });
function render(binding: CmsModelDisplay, fields: CmsModelFieldValue[]) {
  const ctx = { site: { themeConfig: { modelDisplays: [binding] } }, content: { modelId: binding.modelId, title: '内容标题', modelFields: fields } } as unknown as CmsDetailContext;
  return load(renderToStaticMarkup(createElement(ModelDisplayCard, { ctx })));
}
describe('默认主题模型展示卡', () => {
  it('renders distinct event and person structures using mapped business labels', () => {
    const event = render({ modelId: 1, kind: 'event', fields: { startsAt: 'date', venue: 'address' } }, [field('date', 'datetime', '2026-10-01 09:00:00'), field('address', 'text', '文化馆')]);
    expect(event('.model-display-event').text()).toContain('开始时间2026-10-01 09:00:00');
    expect(event('.model-display-event').text()).toContain('活动地点文化馆');
    const person = render({ modelId: 2, kind: 'person', fields: { name: 'name', role: 'position', portrait: 'photo' } }, [field('name', 'text', '王老师'), field('position', 'text', '讲师'), field('photo', 'image', '/api/files/portrait/content')]);
    expect(person('.model-display-person img').attr('alt')).toBe('王老师');
    expect(person('.model-display-person img').attr('src')).toBe('/api/files/portrait/content');
    expect(person('dl').text()).toContain('职务或身份讲师');
  });
  it('offers a download only for a safe resolved asset URL', () => {
    const binding: CmsModelDisplay = { modelId: 3, kind: 'download', fields: { file: 'document', version: 'edition' } };
    const valid = render(binding, [field('document', 'file', '/api/files/manual/content'), field('edition', 'text', '第二版')]);
    expect(valid('a[download]').attr('href')).toBe('/api/files/manual/content');
    expect(valid('dl').text()).toContain('资料版本第二版');
    const unsafe = render(binding, [field('document', 'file', 'javascript:alert(1)'), field('edition', 'text', '第二版')]);
    expect(unsafe('a')).toHaveLength(0);
    expect(unsafe.text()).toContain('文件暂不可用');
  });
  it('does not reinterpret incompatible fields from an older pinned model revision', () => {
    const binding: CmsModelDisplay = { modelId: 3, kind: 'download', fields: { file: 'document' } };
    expect(render(binding, [field('document', 'text', '这不是文件')])('.model-display')).toHaveLength(0);
  });
});
