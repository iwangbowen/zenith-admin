import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import type { CmsContentItem, CmsHomeContext, CmsThemeContentQuery } from '../types';
import { HomeTemplate } from './templates';

function context(): CmsHomeContext {
  return {
    site: {
      id: 7, code: 'example', name: '示例站点', title: '示例站点标题', description: '站点简介来自配置', keywords: null,
      logo: null, favicon: null, icp: null, copyright: null, theme: 'default', extend: {}, settings: {}, themeConfig: {},
    },
    baseUrl: '/__cms/example',
    nav: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `较长的栏目名称 ${index + 1}`, url: `/__cms/example/section-${index + 1}/`, target: index === 11 ? '_blank' as const : '_self' as const })),
    ads: {}, friendLinks: [], friendLinkGroups: [],
    seo: {
      title: '示例站点', keywords: '', description: '', canonical: null, ogTitle: '示例站点', ogDescription: '', ogImage: null,
      ogImageAlt: null, ogType: 'website', ogUrl: null, ogSiteName: '示例站点', articlePublishedTime: null, articleModifiedTime: null,
      articleAuthor: null, twitterCard: 'summary', twitterSite: null, twitterCreator: null, twitterTitle: '示例站点',
      twitterDescription: '', twitterImage: null, twitterImageAlt: null, jsonLd: null,
    },
    searchUrl: '/__cms/example/search', analytics: null, langAlternates: [], audience: { dynamic: false, member: false },
    assets: { cssHref: '/_assets/default.css', inlineCss: null, darkMode: 'auto', jsHref: '/_assets/islands.js' },
    latest: [], recommended: [], hot: [], homeSidebar: null,
  };
}

function content(id: number): CmsContentItem {
  return {
    id, title: `内容标题 ${id}`, titleStyle: {}, url: `/__cms/example/section-${Math.ceil(id / 5)}/${id}.html`, isExternal: false,
    contentType: 'article', summary: `内容摘要 ${id}`, coverImage: `/images/${id}.png`, coverThumb: `/images/${id}-thumb.png`,
    imageCount: 0, mediaType: null, author: '作者', source: '来源', publishedAt: '2026-09-24 10:00:00',
    viewCount: 12, likeCount: 0, favoriteCount: 0, isTop: false, isRecommend: false, isHot: false, modelFields: [],
  };
}

describe('默认主题首页数据加载', () => {
  it('loads structured sources with independent counts in editorial order', async () => {
    const ctx = context();
    const common = { channelId: null, title: '', imageRatio: 'square' as const, focusX: 25, focusY: 75 };
    ctx.site.themeConfig.homeSections = [
      { ...common, id: 'hot', source: 'hot', count: 2, style: 'cards' },
      { ...common, id: 'news', source: 'channel', channelId: 7, count: 1, style: 'compact', title: '新闻精选' },
    ];
    const query = vi.fn(async (request: CmsThemeContentQuery) => ({ channel: request.channelId ? { id: 7, code: 'news', name: '新闻', url: '/news/' } : null, list: Array.from({ length: request.limit }, (_, index) => content(index + 1)) }));
    const data = await HomeTemplate.load!({ cms: { contents: { list: query } }, site: ctx.site, baseUrl: ctx.baseUrl });
    expect(query.mock.calls.map(([request]) => request)).toEqual([
      { channelId: undefined, limit: 2, recommend: false, hot: true },
      { channelId: 7, limit: 1, recommend: false, hot: false },
    ]);
    expect(data.channelBlocks?.map((block) => ({ id: block.section.id, count: block.list.length }))).toEqual([
      { id: 'hot', count: 2 },
      { id: 'news', count: 1 },
    ]);
  });

  it('keeps external content links isolated from the opener', () => {
    const ctx = context();
    const url = 'https://example.test/external';
    ctx.latest = [{ ...content(1), isExternal: true, contentType: 'link', url }];
    const $ = load(renderToStaticMarkup(createElement(HomeTemplate.Component, { ...ctx, data: { channelBlocks: [] } })));
    const external = $(`a[href="${url}"]`);
    expect(external.attr('target')).toBe('_blank');
    expect(external.attr('rel')).toContain('noopener');
  });
});
