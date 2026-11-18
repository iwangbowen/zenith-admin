import { describe, expect, it } from 'vitest';
import type { CmsSiteRow } from '../../db/schema';
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
  it('uses readable fallback metadata for empty or whitespace overrides', () => {
    expect(mergeSeo(site, { title: ' ', description: '', ogTitle: '', twitterTitle: '  ' })).toMatchObject({
      title: 'Zenith CMS', description: 'CMS 平台', ogTitle: 'Zenith CMS', twitterTitle: 'Zenith CMS',
    });
  });
});
