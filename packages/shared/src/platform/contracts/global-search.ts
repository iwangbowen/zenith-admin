import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { SEARCH_TYPE_ENTITY_TYPES, type CanonicalEntityType, type SearchType } from '../entity-registry';

/** 顶部统一搜索支持的适配器类型（SearchType）；菜单结果由 Web 本地菜单树提供。 */
export const globalSearchTypes = [
  'user',
  'member',
  'order',
  'workflow',
  'file',
  'iot-device',
  'iot-alarm',
  'cms-content',
  'wiki-document',
  'announcement',
  'chat-message',
  'biz-leave',
  'report-dashboard',
  'report-dataset',
  'ai-knowledge-base',
  'async-task',
  'operation-log',
  'exception-log',
] as const satisfies readonly SearchType[];

/**
 * 搜索词到 canonical EntityType 的映射。搜索接口继续返回原有 SearchType，
 * 关系接口和事件协议一律使用 canonical 类型；新增搜索适配器时必须在平台
 * 实体注册表登记对应映射，避免产生第二套对象词典。
 */
export const globalSearchEntityTypes: Readonly<Record<GlobalSearchType, CanonicalEntityType>> = SEARCH_TYPE_ENTITY_TYPES;

export function canonicalEntityTypeForSearchType(type: GlobalSearchType): CanonicalEntityType {
  return globalSearchEntityTypes[type];
}

/** 业务结果跳转的后台内部路由前缀；新增领域适配器时同步追加一项。 */
export const globalSearchRoutePrefixes = [
  '/system/',
  '/member/',
  '/payment/',
  '/workflow/',
  '/drive/',
  '/iot/',
  '/alerts/',
  '/cms/',
  '/wiki/',
  '/system/announcements',
  '/chat',
  '/biz/',
  '/report/',
  '/ai/',
  '/system/task-center',
  '/system/operation-logs',
  '/system/exception-logs',
] as const;

export const globalSearchTypeSchema = z.enum(globalSearchTypes).meta({ id: 'GlobalSearchType' });
export type GlobalSearchType = z.infer<typeof globalSearchTypeSchema>;

export const globalSearchHighlightSchema = z.object({
  field: z.string(),
  text: z.string(),
}).meta({ id: 'GlobalSearchHighlight' });

export const globalSearchResultSchema = z.object({
  type: globalSearchTypeSchema,
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  route: z.string(),
  highlights: z.array(globalSearchHighlightSchema).default([]),
  /** 结果摘要上的动作能力；详情接口仍会再次鉴权。 */
  actions: z.object({
    view: z.boolean().default(true),
    download: z.boolean().default(false),
  }).optional(),
}).meta({ id: 'GlobalSearchResult' });
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const globalSearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  /** 逗号分隔的类型筛选；省略表示搜索已注册的全部适配器。 */
  types: z.string().optional(),
  /** 每个适配器最多返回的摘要条数。 */
  limit: z.coerce.number().int().min(1).max(50).default(5),
}).meta({ id: 'GlobalSearchQuery' });

export const globalSearchResponseSchema = z.object({
  results: z.array(globalSearchResultSchema),
  /** 单个领域失败时仍返回其他领域结果。 */
  partial: z.boolean(),
  failedTypes: z.array(globalSearchTypeSchema),
}).meta({ id: 'GlobalSearchResponse' });
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;

export const globalSearchContract = defineContract('/api/platform/search', {
  search: op.get('/', {
    access: 'authenticated',
    query: globalSearchQuery,
    response: globalSearchResponseSchema,
    summary: '顶部统一搜索',
  }),
}, { tags: ['GlobalSearch'] });
