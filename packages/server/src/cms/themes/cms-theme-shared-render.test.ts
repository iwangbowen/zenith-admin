import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadHomeBlocks } from './_shared';
import type {
  CmsBaseContext,
  CmsListContext,
  CmsPageContext,
  CmsThemeDataApi,
} from './types';
import { defaultTheme } from './default';
import { docsTheme } from './docs';
import { govPortalTheme } from './gov-portal';
import { magazineTheme } from './magazine';
import { newsPortalTheme } from './news-portal';

const pagination = {
  page: 3,
  pageSize: 10,
  total: 120,
  totalPages: 12,
  prevUrl: '/news/?page=2',
  nextUrl: '/news/?page=4',
  pages: [1, 2, 3, 4, 5].map((page) => ({ page, url: `/news/?page=${page}`, current: page === 3 })),
};

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

const item = {
  id: 1,
  title: '内容标题',
  titleStyle: {},
  url: '/news/1.html',
  isExternal: false,
  contentType: 'article' as const,
  summary: '摘要',
  coverImage: '/cover.jpg',
  coverThumb: '/thumb.jpg',
  imageCount: 0,
  mediaType: null,
  author: '作者',
  source: '来源',
  publishedAt: '2026-09-06 10:00',
  viewCount: 10,
  likeCount: 0,
  favoriteCount: 0,
  isTop: true,
  isRecommend: false,
  isHot: false,
  modelFields: [{ name: 'score', label: '评分', fieldType: 'number', rawValue: 9, displayValue: '9', group: null, sort: 1 }],
};

function render<P extends object>(component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props));
}

function listContext(theme: string): CmsListContext {
  return {
    ...base(theme),
    channel: { id: 1, name: '新闻中心', url: '/news/', description: '频道描述', image: null },
    breadcrumbs: [{ name: '首页', url: '/' }, { name: '新闻中心', url: '/news/' }],
    items: [item],
    pagination,
  };
}

function pageContext(theme: string): CmsPageContext {
  return {
    ...listContext(theme),
    contentHtml: '<p>单页内容</p>',
    form: {
      code: 'contact',
      name: '联系表单',
      action: '/forms/contact',
      returnUrl: '/contact/',
      successMessage: null,
      fields: [
        { name: 'name', label: '姓名', fieldType: 'text', required: true, minLength: 2, maxLength: 20, pattern: null, min: null, max: null, options: null, placeholder: null, helpText: null, defaultValue: null, sort: 1 },
        { name: 'mobile', label: '手机', fieldType: 'mobile', required: true, minLength: null, maxLength: 11, pattern: null, min: null, max: null, options: null, placeholder: null, helpText: null, defaultValue: null, sort: 2 },
      ],
      captcha: { provider: 'math', siteKey: null },
    },
  };
}

describe('CMS shared theme rendering', () => {
  it('keeps representative shared markup available across built-in themes', () => {
    const html = [
      render(defaultTheme.templates.page, pageContext('default')),
      render(docsTheme.templates.page, pageContext('docs')),
      render(govPortalTheme.templates.list, listContext('gov-portal')),
      render(magazineTheme.templates.list, listContext('magazine')),
      render(newsPortalTheme.templates.list, listContext('news-portal')),
    ].join('\n');

    expect(html).toContain('name="name"');
    expect(html).toContain('minLength="2"');
    expect(html).toContain('pattern="1[3-9][0-9]{9}"');
    // 验证码由 islands/captcha.ts 按容器挂载：服务端只输出容器契约，不再内联脚本
    expect(html).toContain('data-island="captcha"');
    expect(html).not.toContain("fetch('/api/public/cms/captcha')");
    expect(html).toContain('href="/news/?page=2"');
    expect(html).toContain('href="/news/?page=4"');
    expect(html.match(/class="current">3/g)).toHaveLength(3);
    expect(html).toContain('京ICP备12345678号-1');
  });

  it('ships no inline executable script: interactions live in the islands bundle (only the theme-toggle bootstrap may stay inline)', () => {
    const executableInline = (markup: string) =>
      [...markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter(([, attrs]) => !/\ssrc=/.test(` ${attrs}`) && !/type="application\/ld\+json"/.test(attrs))
        .map(([, , body]) => body);

    const lightPages = [
      render(defaultTheme.templates.page, pageContext('default')),
      render(docsTheme.templates.page, pageContext('docs')),
      render(govPortalTheme.templates.list, listContext('gov-portal')),
      render(magazineTheme.templates.list, listContext('magazine')),
      render(newsPortalTheme.templates.list, listContext('news-portal')),
    ];
    for (const page of lightPages) {
      expect(executableInline(page)).toEqual([]);
      expect(page).toContain('<script type="module" src="/_assets/islands.test.js"></script>');
    }

    // 暗色站点：唯一允许的内联脚本是内容恒定的主题初始化（须先于首帧执行防闪烁）
    const darkCtx = { ...pageContext('default'), assets: { ...pageContext('default').assets, darkMode: 'auto' as const } };
    const darkScripts = executableInline(render(defaultTheme.templates.page, darkCtx));
    expect(darkScripts).toHaveLength(1);
    expect(darkScripts[0]).toContain("localStorage.getItem('cms_theme')");
  });
});

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