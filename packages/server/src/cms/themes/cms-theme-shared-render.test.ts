import { describe, expect, it, vi } from 'vitest';
import { loadHomeBlocks } from './_shared';
import type { CmsBaseContext, CmsThemeDataApi } from './types';

function base(theme: string): CmsBaseContext {
  return {
    site: {
      id: 1,
      code: 'main',
      name: `${theme} Site`,
      title: `${theme} Title`,
      keywords: null,
      description: 'Theme render test',
      logo: '/logo.png',
      favicon: null,
      icp: '京ICP备12345678号-1',
      copyright: '© 2026 Zenith',
      theme,
      extend: {},
      settings: {},
      themeConfig: {
        contactPhone: '400-800-8888',
        footerText: 'Footer extra text',
        ratingField: 'score',
        slogan: '权威发布',
        mastheadSubtitle: 'GOV',
      },
    },
    baseUrl: '',
    nav: [{ id: 1, name: '新闻', url: '/news/', target: '_self' }],
    ads: {},
    friendLinks: [{ name: '友链A', url: 'https://friend.example.test', logo: null }],
    friendLinkGroups: [{ code: 'links', name: '友情链接', links: [{ name: '友链A', url: 'https://friend.example.test', logo: null }] }],
    seo: {
      title: 'Title',
      keywords: '',
      description: '',
      canonical: null,
      ogTitle: 'Title',
      ogDescription: '',
      ogImage: null,
      ogImageAlt: null,
      ogType: 'website',
      ogUrl: null,
      ogSiteName: 'Zenith',
      articlePublishedTime: null,
      articleModifiedTime: null,
      articleAuthor: null,
      twitterCard: 'summary_large_image',
      twitterSite: null,
      twitterCreator: null,
      twitterTitle: 'Title',
      twitterDescription: '',
      twitterImage: null,
      twitterImageAlt: null,
      jsonLd: null,
    },
    searchUrl: '/search',
    analytics: null,
    langAlternates: [],
    audience: { dynamic: false, member: false },
    assets: { cssHref: null, inlineCss: '', darkMode: 'light', jsHref: '/_assets/islands.test.js' },
  };
}

describe('loadHomeBlocks', () => {
  it('按中英文逗号切分 homeChannels、去空白、截断上限并过滤不存在的栏目', async () => {
    const list = vi.fn(async ({ channelCode }: { channelCode?: string; limit: number }) => ({
      channel: channelCode === 'missing' ? null : { id: 1, code: channelCode ?? '', name: channelCode ?? '', url: /${channelCode}/ },
      list: [],
    }));
    const cms: CmsThemeDataApi = { contents: { list } };
    const site = { ...base('default').site, themeConfig: { homeChannels: ' a ，b,missing, c,d,e,f,g ' } };

    const blocks = await loadHomeBlocks(cms, site, { limit: 9 });
    expect(list).toHaveBeenCalledTimes(6);
    expect(list).toHaveBeenCalledWith({ channelCode: 'a', limit: 9 });
    expect(blocks.map((block) => block.channel.code)).toEqual(['a', 'b', 'c', 'd', 'e']);

    list.mockClear();
    await loadHomeBlocks(cms, site, { limit: 8, maxChannels: 8 });
    expect(list).toHaveBeenCalledTimes(8);

    list.mockClear();
    expect(await loadHomeBlocks(cms, { ...site, themeConfig: {} }, { limit: 8 })).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});
