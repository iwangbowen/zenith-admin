import { describe, expect, it } from 'vitest';
import { parseCmsContentImportCells } from './content-import';

const target = { siteId: 1, channelId: 2, modelId: 3, tagIds: [4] };
describe('rich CMS content import', () => {
  it('retains metadata and structured fields using the normal creation contract', () => {
    const row = parseCmsContentImportCells({ title: '文化影像', contentType: 'media', mediaType: 'video', mediaUrl: 'cms-res://5', poster: 'cms-res://6', coverImage: 'cms-res://6', extend: '{"venue":"书房"}', seoTitle: '影像专题', attachments: '[{"name":"指南","url":"cms-res://7"}]', isRecommend: '是' }, target);
    expect(row).toMatchObject({ ...target, seoTitle: '影像专题', isRecommend: true, extend: { venue: '书房' }, mediaData: { mediaType: 'video', mediaUrl: 'cms-res://5', poster: 'cms-res://6' }, attachments: [{ name: '指南', url: 'cms-res://7', size: 0 }] });
  });
  it.each([
    { title: 'x'.repeat(256) }, { title: '标题', extend: '{broken}' }, { title: '标题', isHot: 'maybe' },
    { title: '标题', contentType: 'media', mediaUrl: 'cms-res://5' },
    { title: '标题', contentType: 'album', images: '[]' },
    { title: '标题', contentType: 'link', externalLink: 'javascript:alert(1)' },
  ])('reports invalid rows without truncation or implicit coercion', (cells) => {
    expect(() => parseCmsContentImportCells(cells, target)).toThrow();
  });
});
