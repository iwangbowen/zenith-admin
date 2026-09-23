import * as z from 'zod';
import { dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum, requiredIdQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { CMS_SEARCH_WORD_TYPES } from '../constants';
import {
  batchDeleteCmsSearchWordsSchema,
  batchUpdateCmsSearchWordsSchema,
  cmsSiteIdBodySchema,
  createCmsHotwordGroupSchema,
  createCmsHotwordSchema,
  createCmsSearchWordSchema,
  reindexCmsSearchSchema,
  updateCmsHotwordGroupSchema,
  updateCmsHotwordSchema,
  updateCmsSearchWordSchema,
} from '../validation';
import { cmsSiteScopeQuery } from './tags';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 全文检索结果条目（含高亮片段） */
export const cmsSearchResultSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  channelId: z.int(),
  channelName: z.string().nullable(),
  title: z.string(),
  titleHighlight: z.string().meta({ description: '高亮标题（<mark> 包裹命中词）' }),
  snippet: z.string().meta({ description: '高亮摘要片段' }),
  url: z.string(),
  isExternal: z.boolean().meta({ description: '外链形态内容：url 即外部地址，前台应新窗口打开且不拼 baseUrl' }),
  publishedAt: z.string().nullable(),
  rank: z.number(),
}).meta({ id: 'CmsSearchResult' });

export type CmsSearchResult = z.infer<typeof cmsSearchResultSchema>;

export const cmsSegmentPreviewSchema = z.object({
  tokens: z.array(z.string()),
}).meta({ id: 'CmsSegmentPreview' });

export type CmsSegmentPreview = z.infer<typeof cmsSegmentPreviewSchema>;

export const cmsSearchWordSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  word: z.string().meta({ example: '全文检索' }),
  synonyms: z.array(z.string()).optional(),
  type: z.enum(CMS_SEARCH_WORD_TYPES),
  groupName: z.string(),
  weight: z.int(),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsSearchWord' });

export type CmsSearchWord = z.infer<typeof cmsSearchWordSchema>;

/** 搜索热词榜条目；id 为 null 表示仅来自搜索日志、尚未转为可管理热词 */
export const cmsHotKeywordSchema = z.object({
  id: z.int().nullable(),
  siteId: z.int(),
  groupId: z.int().nullable(),
  groupName: z.string().nullable(),
  keyword: z.string(),
  count: z.int(),
  sort: z.int(),
  status: entityStatusSchema,
}).meta({ id: 'CmsHotKeyword' });

export type CmsHotKeyword = z.infer<typeof cmsHotKeywordSchema>;

export const cmsHotwordGroupSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  name: z.string(),
  sort: z.int(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsHotwordGroup' });

export type CmsHotwordGroup = z.infer<typeof cmsHotwordGroupSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsSearchTestQuery = paginationQuery.extend({
  siteId: requiredIdQuery(),
  keyword: z.string().min(1),
});

export const cmsSegmentQuery = z.object({
  siteId: requiredIdQuery(),
  text: z.string().min(1).max(200),
});

export const cmsSearchWordListQuery = paginationQuery.extend({
  siteId: requiredIdQuery(),
  keyword: keywordQuery(),
  type: queryEnum(CMS_SEARCH_WORD_TYPES),
  groupName: z.string().optional(),
  status: entityStatusQuery,
});

export const cmsHotKeywordQuery = z.object({
  siteId: requiredIdQuery(),
  groupId: idQuery(),
  keyword: keywordQuery(),
  status: entityStatusQuery,
  ...dateRangeQuery(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsSearchContract = defineContract('/api/cms/search', {
  test: op.get('/test', { access: { permission: 'cms:search:manage' }, query: cmsSearchTestQuery, response: paginated(cmsSearchResultSchema), summary: '检索测试（后台联调）' }),
  segment: op.get('/segment', { access: { permission: 'cms:search:manage' }, query: cmsSegmentQuery, response: cmsSegmentPreviewSchema, summary: '分词预览（调试分词效果）' }),
  reindex: op.post('/reindex', { access: { permission: 'cms:search:manage' }, audit: 'CMS 检索索引重建', body: reindexCmsSearchSchema, response: asyncTaskSchema, summary: '提交索引重建任务（任务中心执行）' }),
  wordList: op.get('/words', { access: { permission: 'cms:search:manage' }, query: cmsSearchWordListQuery, response: paginated(cmsSearchWordSchema), summary: '自定义词典分页列表' }),
  wordCreate: op.post('/words', { access: { permission: 'cms:search:manage' }, audit: '新增 CMS 检索词条', body: createCmsSearchWordSchema, response: cmsSearchWordSchema, summary: '新增词条（即时生效，历史内容需重建索引）' }),
  wordBatchUpdate: op.put('/words/batch', { access: { permission: 'cms:search:manage' }, audit: '批量更新 CMS 检索词典', body: batchUpdateCmsSearchWordsSchema, summary: '批量更新词典分组/状态' }),
  wordBatchRemove: op.delete('/words/batch', { access: { permission: 'cms:search:manage' }, audit: '批量删除 CMS 检索词典', body: batchDeleteCmsSearchWordsSchema, summary: '批量删除词典' }),
  wordUpdate: op.put('/words/{id}', { access: { permission: 'cms:search:manage' }, audit: '更新 CMS 检索词条', params: idParam, body: updateCmsSearchWordSchema, response: cmsSearchWordSchema, summary: '更新词条' }),
  wordRemove: op.delete('/words/{id}', { access: { permission: 'cms:search:manage' }, audit: '删除 CMS 检索词条', params: idParam, summary: '删除词条（即时重建当前站点词典）' }),
  hotKeywords: op.get('/hot-keywords', { access: { permission: 'cms:search:manage' }, query: cmsHotKeywordQuery, response: z.array(cmsHotKeywordSchema), summary: '搜索热词榜' }),
  hotwordCreate: op.post('/hot-keywords', { access: { permission: 'cms:search:manage' }, body: createCmsHotwordSchema, summary: '创建可管理热词' }),
  hotwordUpdate: op.put('/hot-keywords/{id}', { access: { permission: 'cms:search:manage' }, params: idParam, body: updateCmsHotwordSchema, summary: '更新可管理热词' }),
  hotwordRemove: op.delete('/hot-keywords/{id}', { access: { permission: 'cms:search:manage' }, params: idParam, summary: '删除可管理热词' }),
  clearHotKeywords: op.post('/hot-keywords/clear', { access: { permission: 'cms:search:manage' }, audit: '清空 CMS 搜索热词', body: cmsSiteIdBodySchema, summary: '清空搜索热词榜' }),
  hotwordGroups: op.get('/hotword-groups', { access: { permission: 'cms:search:manage' }, query: cmsSiteScopeQuery, response: z.array(cmsHotwordGroupSchema), summary: '热词分组列表' }),
  hotwordGroupCreate: op.post('/hotword-groups', { access: { permission: 'cms:search:manage' }, body: createCmsHotwordGroupSchema, response: cmsHotwordGroupSchema, summary: '创建热词分组' }),
  hotwordGroupUpdate: op.put('/hotword-groups/{id}', { access: { permission: 'cms:search:manage' }, params: idParam, body: updateCmsHotwordGroupSchema, response: cmsHotwordGroupSchema, summary: '更新热词分组' }),
  hotwordGroupRemove: op.delete('/hotword-groups/{id}', { access: { permission: 'cms:search:manage' }, params: idParam, summary: '删除空热词分组' }),
}, { auditModule: 'CMS内容管理', tags: ['CMS-全文检索'] });
