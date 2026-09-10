import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFile } from 'node:fs/promises';
import { cmsAdEvents } from '../../db/schema';
import { dbColumnName } from '../../db/types';
import {
  cmsAdEventDedupeKey,
  normalizeCmsAdClickUrl,
} from './cms-ad-events.service';

describe('CMS Stage4 ad event policy', () => {
  it('accepts only safe relative/http(s) click targets', () => {
    expect(normalizeCmsAdClickUrl('/products/enterprise.html')).toBe('/products/enterprise.html');
    expect(normalizeCmsAdClickUrl('https://example.com/landing')).toBe('https://example.com/landing');
    expect(normalizeCmsAdClickUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeCmsAdClickUrl('//evil.example/path')).toBeNull();
    expect(normalizeCmsAdClickUrl('https://user:secret@example.com')).toBeNull();
    expect(normalizeCmsAdClickUrl("https://example.com/\r\nX-Test: yes")).toBeNull();
  });

  it('deduplicates by event/ad/visitor/time bucket without merging distinct events', () => {
    const at = new Date('2026-07-23T12:00:05Z');
    const sameBucket = new Date('2026-07-23T12:00:55Z');
    expect(cmsAdEventDedupeKey(1, 'impression', 'visitor-a', at))
      .toBe(cmsAdEventDedupeKey(1, 'impression', 'visitor-a', sameBucket));
    expect(cmsAdEventDedupeKey(1, 'click', 'visitor-a', at))
      .not.toBe(cmsAdEventDedupeKey(1, 'impression', 'visitor-a', at));
    expect(cmsAdEventDedupeKey(2, 'impression', 'visitor-a', at))
      .not.toBe(cmsAdEventDedupeKey(1, 'impression', 'visitor-a', at));
  });

  it('stores hashes instead of plaintext IP and has retention-friendly indexes', () => {
    const config = getTableConfig(cmsAdEvents);
    const names = config.columns.map((column) => dbColumnName(column));
    expect(names).toContain('ip_hash');
    expect(names).toContain('visitor_hash');
    expect(names).not.toContain('ip');
    const foreignKeyColumns = config.foreignKeys.flatMap((key) => key.reference().columns.map((column) => dbColumnName(column)));
    expect(foreignKeyColumns).not.toContain('ad_id');
    expect(foreignKeyColumns).not.toContain('slot_id');
    expect(config.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'cms_ad_events_dedupe_uq',
      'cms_ad_events_site_time_idx',
      'cms_ad_events_ad_time_idx',
    ]));
  });

  it('requires signed one-time page-bound tokens before public view/click recording', async () => {
    // 令牌换取逻辑位于浏览器端岛脚本 islands/ads.ts（原内联于 default/Layout.tsx）
    const [routes, island, layout] = await Promise.all([
      readFile(new URL('../../routes/cms/front-public.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../cms/islands/ads.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../cms/themes/default/Layout.tsx', import.meta.url), 'utf8'),
    ]);
    expect(routes).toContain('consumeCmsAdEventToken');
    expect(routes).toContain("eventType: 'click'");
    expect(routes).toContain("eventType: 'impression'");
    expect(island).toContain('/api/public/cms/ads/tokens/');
    expect(island).toContain('data-ad-render-proof');
    expect(island).not.toContain("JSON.stringify({ids:ids");
    expect(layout).not.toContain('/api/public/cms/ads/tokens/');
  });
});
