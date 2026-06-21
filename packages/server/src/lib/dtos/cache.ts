/**
 * 缓存相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const CacheItemDTO = z
  .object({
    key: z.string(),
    displayKey: z.string(),
    segment: z.string(),
    category: z.string(),
    type: z.string(),
    ttl: z.number(),
    size: z.number(),
    value: z.string().nullable(),
  })
  .openapi('CacheItem');

export const CacheOverviewDTO = z
  .object({
    connected: z.boolean(),
    version: z.string(),
    uptimeSeconds: z.number(),
    connectedClients: z.number(),
    usedMemory: z.number(),
    usedMemoryHuman: z.string(),
    maxMemory: z.number(),
    memFragmentationRatio: z.number(),
    keyspaceHits: z.number(),
    keyspaceMisses: z.number(),
    hitRate: z.number(),
    totalKeys: z.number(),
    keyPrefix: z.string(),
  })
  .openapi('CacheOverview');
