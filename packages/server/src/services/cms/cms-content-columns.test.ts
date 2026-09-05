import { describe, expect, it } from 'vitest';
import { cmsContentLinkColumns, cmsContentListColumns, listSummaryOf } from './cms-content-columns';

describe('cmsContentListColumns', () => {
  it('列表投影不含正文、检索向量与附件，但保留列表渲染所需的 extend / mediaData / excerpt', () => {
    const keys = Object.keys(cmsContentListColumns);
    expect(keys).not.toContain('body');
    expect(keys).not.toContain('searchVector');
    expect(keys).not.toContain('attachments');
    for (const key of ['id', 'siteId', 'channelId', 'title', 'summary', 'excerpt', 'coverImage', 'extend', 'mediaData', 'slug', 'staticPath', 'publishedAt', 'createdAt', 'externalLink']) {
      expect(keys).toContain(key);
    }
  });

  it('链接投影只含拼「标题 + 链接」所需的列', () => {
    expect(Object.keys(cmsContentLinkColumns).sort()).toEqual(
      ['channelId', 'createdAt', 'externalLink', 'id', 'publishedAt', 'siteId', 'slug', 'staticPath', 'title'],
    );
  });
});

describe('listSummaryOf', () => {
  it('手填摘要优先，原样返回', () => {
    expect(listSummaryOf({ summary: ' 手填摘要 ', excerpt: '正文导语' })).toBe(' 手填摘要 ');
  });

  it('摘要为空或空白时回退到生成列 excerpt，并按 maxLength 截断', () => {
    expect(listSummaryOf({ summary: null, excerpt: 'abcdef' }, 3)).toBe('abc');
    expect(listSummaryOf({ summary: '   ', excerpt: '正文导语' })).toBe('正文导语');
  });

  it('两者都空时返回 null', () => {
    expect(listSummaryOf({ summary: null, excerpt: null })).toBeNull();
    expect(listSummaryOf({ summary: '', excerpt: '  ' })).toBeNull();
  });
});
