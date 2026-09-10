import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CmsSiteRow } from '../../db/schema';
import type { CmsBaseContext } from '../../cms/themes/types';
import { Layout as DefaultLayout } from '../../cms/themes/default/Layout';
import { Layout as DocsLayout } from '../../cms/themes/docs';
import { mergeSeo } from './cms-render.service';

const site = {
  id: 1,
  code: 'main',
  name: 'Zenith',
  title: 'Zenith CMS',
  keywords: null,
  description: 'CMS 平台',
  logo: '/logo.png',
  favicon: null,
  domain: 'cms.example.com',
  aliasDomains: [],
  settings: { twitterSite: '@zenith', twitterCard: 'summary_large_image', socialImageAlt: 'Zenith Logo' },
} as unknown as CmsSiteRow;

describe('CMS social SEO rendering behavior', () => {
  it('renders complete OG/article/Twitter metadata in default and docs themes', () => {
    const seo = mergeSeo(site, {
      title: '文章标题',
      description: '文章摘要',
      pathForCanonical: '/news/demo.html',
      ogType: 'article',
      ogImage: '/cover.png',
      ogImageAlt: '文章封面',
      articlePublishedTime: '2026-07-22T01:00:00.000Z',
      articleModifiedTime: '2026-07-22T02:00:00.000Z',
      articleAuthor: '作者',
      twitterCreator: '@author',
    });
    const ctx = {
      site: {
        id: 1, code: 'main', name: 'Zenith', title: 'Zenith CMS', keywords: null,
        description: 'CMS 平台', logo: '/logo.png', favicon: null, icp: null, copyright: null,
        theme: 'default', settings: site.settings, themeConfig: {},
      },
      baseUrl: '',
      nav: [],
      ads: {},
      friendLinks: [],
      friendLinkGroups: [],
      seo,
      searchUrl: '/search',
      analytics: null,
      langAlternates: [],
      audience: { dynamic: false, member: false },
      assets: { cssHref: null, inlineCss: '', darkMode: 'light', jsHref: null },
    } as CmsBaseContext;
    const htmlOutputs = [
      renderToStaticMarkup(createElement(DefaultLayout, { ctx, currentUrl: '/', children: 'body' })),
      renderToStaticMarkup(createElement(DocsLayout, { ctx, currentUrl: '/', children: 'body' })),
    ];
    for (const html of htmlOutputs) {
      expect(html).toContain('property="og:url" content="https://cms.example.com/news/demo.html"');
      expect(html).toContain('property="og:site_name" content="Zenith"');
      expect(html).toContain('property="article:published_time"');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain('name="twitter:creator" content="@author"');
      expect(html).toContain('name="twitter:image:alt" content="文章封面"');
    }
  });
});
