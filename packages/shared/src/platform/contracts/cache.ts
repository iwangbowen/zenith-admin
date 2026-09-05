import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cacheItemSchema = z.object({
  key: z.string().meta({ example: 'zenith:session:abc' }),
  displayKey: z.string().meta({ description: '去掉命名空间前缀后的 key' }),
  segment: z.string(),
  category: z.string(),
  type: z.string().meta({ description: 'Redis 数据类型', example: 'string' }),
  ttl: z.number().meta({ description: '剩余秒数；-1 为永久' }),
  size: z.number().meta({ description: 'string 为字节数，集合类为元素个数' }),
  value: z.string().nullable().meta({ description: 'string 类型的值预览（超长截断）；其他类型为 null' }),
}).meta({ id: 'CacheItem' });

export type CacheItem = z.infer<typeof cacheItemSchema>;

export const cacheListSchema = z.object({
  list: z.array(cacheItemSchema),
  total: z.int(),
}).meta({ id: 'CacheList' });

export type CacheList = z.infer<typeof cacheListSchema>;

export const cacheOverviewSchema = z.object({
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
}).meta({ id: 'CacheOverview' });

export type CacheOverview = z.infer<typeof cacheOverviewSchema>;

export const cacheCountResultSchema = z.object({
  count: z.int(),
}).meta({ id: 'CacheCountResult' });

export type CacheCountResult = z.infer<typeof cacheCountResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cacheListQuery = z.object({
  keyword: z.string().optional().meta({ example: 'session' }),
});

export const cacheKeyQuery = z.object({
  key: z.string().meta({ example: 'zenith:session:abc' }),
});

export const cacheKeyBody = z.object({
  key: z.string().meta({ example: 'zenith:session:abc' }),
});

export const cacheKeysBody = z.object({
  keys: z.array(z.string()).min(1).meta({ example: ['zenith:session:abc'] }),
});

export const cacheSegmentBody = z.object({
  segment: z.string().meta({ example: 'session' }),
});

export const cacheTtlBody = z.object({
  key: z.string().meta({ example: 'zenith:session:abc' }),
  ttl: z.number().int().meta({ example: 3600, description: '-1 为永久，正整数为秒数' }),
});

export const cacheValueBody = z.object({
  key: z.string().meta({ example: 'zenith:perm:1' }),
  value: z.string().meta({ example: '["dashboard:view"]' }),
  ttl: z.number().int().optional().meta({ example: 600, description: '不传保留原 TTL，-1 为永久，正整数为秒数' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cacheContract = defineContract('/api/cache', {
  list: op.get('/', { query: cacheListQuery, response: cacheListSchema, summary: '列出所有缓存 key（可按关键词过滤）' }),
  overview: op.get('/overview', { response: cacheOverviewSchema, summary: 'Redis 概览统计' }),
  value: op.get('/value', { query: cacheKeyQuery, response: z.string().nullable(), summary: '获取指定 key 的完整值' }),
  updateTtl: op.put('/ttl', { body: cacheTtlBody, summary: '修改指定 key 的过期时间' }),
  updateValue: op.put('/value', { body: cacheValueBody, summary: '修改指定 key 的值（仅字符串）' }),
  removeKey: op.delete('/', { body: cacheKeyBody, summary: '删除指定 key' }),
  removeKeys: op.delete('/batch', { body: cacheKeysBody, response: cacheCountResultSchema, summary: '批量删除指定 key' }),
  removeByCategory: op.delete('/by-category', { body: cacheSegmentBody, response: cacheCountResultSchema, summary: '按分类批量删除' }),
  removeAll: op.delete('/all', { response: cacheCountResultSchema, summary: '清空当前命名空间所有缓存' }),
}, { tags: ['Cache'] });
