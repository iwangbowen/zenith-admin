import { describe, expect, it } from 'vitest';
import { buildCmsSitemapDocument, CMS_SITEMAP_PART_SIZE } from './cms-sitemap';

describe('CMS sitemap partitions', () => {
  it('indexes every partition instead of silently dropping content beyond the cap', () => {
    const entries = Array.from({ length: CMS_SITEMAP_PART_SIZE + 1 }, (_, index) => ({ loc: `https://example.test/${index}`, lastmod: null, priority: '0.6' }));
    expect(buildCmsSitemapDocument(entries, 'https://example.test')).toContain('sitemap-2.xml');
    const second = buildCmsSitemapDocument(entries, 'https://example.test', 2);
    expect(second).toContain(`/${CMS_SITEMAP_PART_SIZE}</loc>`);
    expect(second?.match(/<url>/g)).toHaveLength(1);
    expect(buildCmsSitemapDocument(entries, '', 3)).toBeNull();
  });
  it('escapes URL characters in both manifests and URL sets', () => {
    expect(buildCmsSitemapDocument([{ loc: 'https://example.test/?a=1&b=2', lastmod: null, priority: '1' }], '')).toContain('a=1&amp;b=2');
  });
});
