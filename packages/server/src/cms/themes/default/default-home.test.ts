import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import type { CmsContentItem, CmsHomeContext, CmsThemeContentCollection } from '../types';
import { HomeTemplate } from './templates';
import { Layout } from './Layout';

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

function renderHome(ctx: CmsHomeContext, channelBlocks: CmsThemeContentCollection[] = []) {
  return load(renderToStaticMarkup(createElement(HomeTemplate.Component, { ...ctx, data: { channelBlocks } })));
}

describe('默认主题首页栏目展示', () => {
  it('preserves all 37 articles in eight channel blocks, emphasizing one lead without repeating every summary or cover', () => {
    const ctx = context();
    let id = 1;
    const blocks = ctx.nav.slice(0, 8).map((channel, index) => ({
      channel: { ...channel, code: `section-${channel.id}` },
      list: Array.from({ length: index < 5 ? 5 : 4 }, () => content(id++)),
    }));
    blocks[0].list[0] = { ...blocks[0].list[0], isTop: true, isHot: true, contentType: 'album', imageCount: 3 };
    blocks[7].list[3] = { ...blocks[7].list[3], isExternal: true, contentType: 'link', url: 'https://example.test/external', titleStyle: { bold: true, color: '#123456' } };
    ctx.recommended = [content(91)];
    ctx.hot = [content(92)];
    const $ = renderHome(ctx, blocks);

    expect($('.home-channel-grid > section')).toHaveLength(8);
    expect($('.home-channel-block .content-item')).toHaveLength(37);
    expect($('.home-content-featured')).toHaveLength(8);
    expect($('.home-content-compact')).toHaveLength(29);
    expect($('.home-channel-block .summary')).toHaveLength(8);
    expect($('.home-channel-block .thumb')).toHaveLength(8);
    expect($('.home-channel-more')).toHaveLength(8);
    for (const [index, block] of blocks.entries()) {
      const region = $(`#home-channel-${block.channel!.id}-${index}`).closest('section');
      expect(region.attr('aria-labelledby')).toBe(`home-channel-${block.channel!.id}-${index}`);
      expect(region.find('.home-channel-more').attr('href')).toBe(block.channel!.url);
      expect(region.find('.home-channel-more').text()).toContain('查看更多');
      for (const article of block.list) expect(region.find('h3 a').toArray().some((link) => $(link).attr('href') === article.url)).toBe(true);
    }
    expect($('.home-content-featured').first().text()).toContain('图集·3');
    expect($('.home-content-featured').first().text()).toContain('置顶');
    const external = $('.home-content-compact a[href="https://example.test/external"]');
    expect(external.attr('target')).toBe('_blank');
    expect(external.attr('rel')).toContain('noopener');
    expect(external.attr('style')).toContain('color:#123456');
    expect($('.home-sidebar').text()).toContain('推荐阅读');
    expect($('.home-sidebar').text()).toContain('热门排行');
  });

  it('keeps each empty configured channel and its more link while avoiding a blank sidebar column', () => {
    const ctx = context();
    const blocks = [{ channel: { id: 1, code: 'empty', name: '空栏目', url: '/__cms/example/empty/' }, list: [] }];
    const $ = renderHome(ctx, blocks);
    const repeated = renderHome(ctx, [blocks[0], blocks[0]]);
    const headings = repeated('.home-channel-heading h2').toArray().map((element) => repeated(element).attr('id'));
    expect(new Set(headings).size).toBe(2);
    expect($('.home-channel-block .empty').text()).toBe('暂无内容');
    expect($('.home-channel-more').attr('href')).toBe('/__cms/example/empty/');
    expect($('.home-grid').hasClass('home-grid-full')).toBe(true);
    expect($('.home-sidebar')).toHaveLength(0);
    expect($('.home-content-featured')).toHaveLength(0);
  });

  it('retains the latest feed and empty state when no channels are configured', () => {
    const ctx = context();
    ctx.latest = [content(1), { ...content(2), coverImage: null, coverThumb: null, summary: null, publishedAt: null }];
    const $ = renderHome(ctx);
    expect($('.home-channel-grid')).toHaveLength(0);
    expect($('.home-main .section-title').text()).toBe('最新发布');
    expect($('.home-main .content-item')).toHaveLength(2);
    expect($('.home-main .summary').text()).toBe('内容摘要 1');
    expect($('.home-main .meta').first().text()).toContain('来源：来源');
    expect($('.home-main .thumb')).toHaveLength(1);
    const empty = renderHome(context());
    expect(empty('.home-main .empty').text()).toBe('暂无内容');
  });

  it('keeps all navigation destinations accessible and names the search field and configured banner', () => {
    const ctx = context();
    ctx.site.themeConfig = { bannerImage: '/images/hero.png', bannerLink: 'https://example.test/campaign' };
    const $ = renderHome(ctx);
    expect($('nav[aria-label="栏目导航"] a')).toHaveLength(12);
    expect($('.site-nav a').last().attr('href')).toBe(ctx.nav[11].url);
    expect($('.site-nav a').last().attr('target')).toBe('_blank');
    expect($('input[type="search"]').attr('aria-label')).toBe('站内搜索');
    expect($('.site-search').attr('action')).toBe(ctx.searchUrl);
    expect($('.home-banner img').attr('alt')).toBe('示例站点首页横幅');
    expect($('.home-banner a').attr('href')).toBe('https://example.test/campaign');
    expect($('.theme-toggle')).toHaveLength(1);
    expect($('script[src="/_assets/islands.js"]')).toHaveLength(1);
    const current = load(renderToStaticMarkup(createElement(Layout, { ctx, currentUrl: ctx.nav[11].url, children: '正文' })));
    expect(current('.site-nav a[aria-current="page"]').attr('href')).toBe(ctx.nav[11].url);
  });

  it('preserves home advertisements and hides only the optional hot section', () => {
    const ctx = context();
    ctx.site.themeConfig.showHotSection = false;
    ctx.hot = [content(8)];
    ctx.ads = { 'home-ad': [{ id: 1, name: '配置中的广告', image: '/images/ad.png', linkUrl: 'https://example.test/ad' }] };
    const $ = renderHome(ctx);
    expect($('.ad-slot [data-ad-id="1"]').attr('data-ad-clickable')).toBe('true');
    expect($('.ad-slot img').attr('alt')).toBe('配置中的广告');
    expect($('.home-sidebar')).toHaveLength(0);
    expect($('.home-hero h1').text()).toBe(ctx.site.name);
    expect($('.home-hero p').text()).toBe(ctx.site.description);
  });
});
