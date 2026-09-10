/**
 * 主题搜索页 / 详情页 HTML 快照：搜索结果列表与详情正文段在主题间 / 模板间共用，
 * 抽取共享组件不得改变任何一个字节的输出。
 */
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CmsBaseContext, CmsDetailContext, CmsSearchContext } from './types';
import { defaultTheme } from './default';
import { docsTheme } from './docs';
import { govPortalTheme } from './gov-portal';
import { magazineTheme } from './magazine';
import { newsPortalTheme } from './news-portal';

const pagination = {
  page: 2,
  pageSize: 10,
  total: 25,
  totalPages: 3,
  prevUrl: '/search?keyword=x&page=1',
  nextUrl: '/search?keyword=x&page=3',
  pages: [1, 2, 3].map((page) => ({ page, url: `/search?keyword=x&page=${page}`, current: page === 2 })),
};

function base(theme: string): CmsBaseContext {
  return {
    site: {
      id: 1, code: 'main', name: `${theme} Site`, title: `${theme} Title`, keywords: null, description: 'Theme render test',
      logo: '/logo.png', favicon: null, icp: null, copyright: '© 2026 Zenith', theme, extend: {}, settings: {},
      themeConfig: { ratingField: 'score', slogan: '权威发布', mastheadSubtitle: 'GOV' },
    },
    baseUrl: '',
    nav: [{ id: 1, name: '新闻', url: '/news/', target: '_self' }],
    ads: {},
    friendLinks: [],
    friendLinkGroups: [],
    seo: {
      title: 'Title', keywords: '', description: '', canonical: null, ogTitle: 'Title', ogDescription: '', ogImage: null, ogImageAlt: null,
      ogType: 'website', ogUrl: null, ogSiteName: 'Zenith', articlePublishedTime: null, articleModifiedTime: null, articleAuthor: null,
      twitterCard: 'summary_large_image', twitterSite: null, twitterCreator: null, twitterTitle: 'Title', twitterDescription: '',
      twitterImage: null, twitterImageAlt: null, jsonLd: null,
    },
    searchUrl: '/search',
    analytics: null,
    langAlternates: [],
    audience: { dynamic: false, member: false },
    assets: { cssHref: null, inlineCss: '', darkMode: 'light', jsHref: '/_assets/islands.snapshot.js' },
  };
}

function searchContext(theme: string): CmsSearchContext {
  return {
    ...base(theme),
    keyword: 'x',
    results: [
      {
        id: 1, siteId: 1, channelId: 1, channelName: '新闻中心', title: 'x 命中', titleHighlight: '<mark>x</mark> 命中',
        snippet: '摘要 <mark>x</mark>', url: '/news/1.html', isExternal: false, publishedAt: '2026-09-06 10:00', rank: 1,
      },
      {
        id: 2, siteId: 1, channelId: 2, channelName: null, title: '外链', titleHighlight: '外链',
        snippet: '', url: 'https://example.test/x', isExternal: true, publishedAt: null, rank: 0.5,
      },
    ],
    pagination,
  };
}

function detailContext(): CmsDetailContext {
  return {
    ...base('default'),
    channel: { id: 1, name: '新闻中心', url: '/news/', description: null, image: null },
    breadcrumbs: [{ name: '首页', url: '/' }, { name: '新闻中心', url: '/news/' }],
    content: {
      id: 1, title: '内容标题', titleStyle: { color: '#c00', bold: true }, url: '/news/1.html', isExternal: false, contentType: 'article',
      summary: '摘要', coverImage: '/cover.jpg', coverThumb: '/thumb.jpg', imageCount: 0, mediaType: null,
      author: '作者', source: '来源', publishedAt: '2026-09-06 10:00', viewCount: 10, likeCount: 2, favoriteCount: 1,
      isTop: false, isRecommend: false, isHot: false,
      modelFields: [{ name: 'score', label: '评分', fieldType: 'number', rawValue: 9, displayValue: '9', group: null, sort: 1 }],
      body: '<p>正文第一页</p>',
      bodyPagination: {
        page: 1, totalPages: 2, prevUrl: null, nextUrl: '/news/1_2.html',
        pages: [{ page: 1, url: '/news/1.html', current: true }, { page: 2, url: '/news/1_2.html', current: false }],
      },
      attachments: [{ name: '附件.pdf', url: '/files/a.pdf', size: 1024, ext: 'pdf', sort: 1 }],
      albumImages: [], mediaUrl: null, mediaPoster: null, mediaDuration: null, extend: {},
      tags: [{ name: '标签', slug: 'tag', url: '/tags/tag/' }],
      prev: { title: '上一篇', url: '/news/0.html' },
      next: { title: '下一篇', url: '/news/2.html' },
    },
    related: [{ title: '相关', url: '/news/3.html' }],
    comments: [],
    commentForm: { action: '/comments', contentId: 1, returnUrl: '/news/1.html', memberSubmitApi: '/api/member/comments', captchaEnabled: false },
  };
}

function render<P extends object>(component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props));
}

describe('CMS theme search / detail markup snapshots', () => {
  it.each([
    ['default', defaultTheme],
    ['docs', docsTheme],
    ['gov-portal', govPortalTheme],
    ['magazine', magazineTheme],
    ['news-portal', newsPortalTheme],
  ] as const)('%s search page', (theme, def) => {
    expect(render(def.templates.search, searchContext(theme))).toMatchSnapshot();
  });

  it('default detail templates', () => {
    expect(render(defaultTheme.templates.detail, detailContext())).toMatchSnapshot();
    expect(render(defaultTheme.extraDetailTemplates!['detail-plain'].component, detailContext())).toMatchSnapshot();
  });
});
