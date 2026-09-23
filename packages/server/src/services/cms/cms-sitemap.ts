import { escapeHtml } from '@zenith/shared/core';
export const CMS_SITEMAP_PART_SIZE = 45_000;
type SitemapEntry = { loc: string; lastmod: string | null; priority: string };

export function buildCmsSitemapDocument(entries: readonly SitemapEntry[], origin: string, part?: number): string | null {
  const parts = Math.max(1, Math.ceil(entries.length / CMS_SITEMAP_PART_SIZE));
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
  if (part === undefined && parts > 1) {
    return `${header}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Array.from({ length: parts }, (_, index) => `  <sitemap><loc>${escapeHtml(origin)}/sitemap-${index + 1}.xml</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  }
  if (part !== undefined && (!Number.isSafeInteger(part) || part < 1 || part > parts)) return null;
  const offset = ((part ?? 1) - 1) * CMS_SITEMAP_PART_SIZE;
  const body = entries.slice(offset, offset + CMS_SITEMAP_PART_SIZE).map((entry) => `  <url><loc>${escapeHtml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : ''}<priority>${entry.priority}</priority></url>`).join('\n');
  return `${header}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
