import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { cmsGenerationContext } from './cms-generation-context';

const PAGE_CACHE_PREFIX = `${config.redis.keyPrefix}cms:page:`;
const META_CACHE_PREFIX = `${config.redis.keyPrefix}cms:sitemap:`;
const CACHE_EPOCH_PREFIX = `${config.redis.keyPrefix}cms:epoch:`;

export async function readCmsCacheEpoch(siteId: number): Promise<string> {
  const epoch = String(await redis.get(`${CACHE_EPOCH_PREFIX}${siteId}`).catch(() => '0') ?? '0');
  const generation = cmsGenerationContext();
  return generation ? `${generation.generationId}:${epoch}` : epoch;
}

function pageKey(siteId: number, path: string): string {
  return `${PAGE_CACHE_PREFIX}${siteId}:${path.replace(/^\/+/, '')}`;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '500');
    cursor = String(next);
    if (Array.isArray(batch)) keys.push(...batch.map(String));
  } while (cursor !== '0');
  return keys;
}

/**
 * Invalidate all public CMS cache variants for a site.
 *
 * Static file generation and cache invalidation are separate concerns: dynamic
 * sites still need this call, and metadata endpoints share the same invalidation
 * boundary as HTML pages. Redis failures are logged and never make a committed
 * content mutation fail.
 */
export async function invalidateCmsSiteCaches(siteId: number, paths: readonly string[] = []): Promise<void> {
  if (cmsGenerationContext()?.candidate) return;
  if (!Number.isInteger(siteId) || siteId <= 0) return;
  try {
    await redis.incr(`${CACHE_EPOCH_PREFIX}${siteId}`);
    const exact = paths.map((path) => pageKey(siteId, path));
    const [pageKeys, sitemapKeys, rssKeys] = await Promise.all([
      scanKeys(`${PAGE_CACHE_PREFIX}${siteId}:*`),
      // Sitemap uses the exact site id; RSS has an explicit `rss:{siteId}:`
      // segment. Keep the delimiter in both patterns so site 3 cannot evict
      // site 30 and RSS keys are not missed.
      scanKeys(`${META_CACHE_PREFIX}${siteId}`),
      scanKeys(`${META_CACHE_PREFIX}rss:${siteId}:*`),
    ]);
    const keys = [...new Set([...exact, ...pageKeys, ...sitemapKeys, ...rssKeys])];
    if (keys.length > 0) await redis.del(...keys);
  } catch (error) {
    logger.warn(`[CMS] 站点 ${siteId} 缓存失效失败`, error);
  }
}
