import * as z from 'zod';
import { dateRangeBound, idParam, paginated } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  CMS_CONTENT_TYPES,
  CMS_OPEN_INCLUDES,
  CMS_OPEN_PAGE_SIZE_MAX,
  CMS_OPEN_SORT_FIELDS,
  CMS_OPEN_SYNC_OPS,
  CMS_OPEN_SYNC_PAGE_SIZE_MAX,
} from '../constants';
import { openCmsContentUpdateSchema, openCmsContentWriteSchema } from '../validation';
import { cmsChannelSchema } from './channels';
import { cmsContentSchema } from './contents';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/**
 * 开放 API 的内容对象。
 *
 * 字段随 `fields` 裁剪、随 `include` 展开，因此除 `id` 外全部可选；
 * 可用字段清单见 `CMS_OPEN_CONTENT_FIELDS`。
 */
export const cmsOpenContentSchema = z.object({
  id: z.int(),
  siteId: z.int().optional(),
  channelId: z.int().optional(),
  channelCode: z.string().nullable().optional(),
  modelCode: z.string().nullable().optional(),
  contentType: z.enum(CMS_CONTENT_TYPES).optional(),
  title: z.string().optional(),
  subTitle: z.string().nullable().optional(),
  shortTitle: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  coverThumb: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  editor: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  isOriginal: z.boolean().optional(),
  externalLink: z.string().nullable().optional(),
  isTop: z.boolean().optional(),
  topWeight: z.int().optional(),
  isRecommend: z.boolean().optional(),
  isHot: z.boolean().optional(),
  hasImage: z.boolean().optional(),
  hasVideo: z.boolean().optional(),
  hasAttachment: z.boolean().optional(),
  viewCount: z.int().optional(),
  likeCount: z.int().optional(),
  favoriteCount: z.int().optional(),
  sort: z.int().optional(),
  version: z.int().optional(),
  seoTitle: z.string().nullable().optional(),
  seoKeywords: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  expireAt: z.string().nullable().optional().meta({ description: '内容公开到期时间；客户端应在到期时停止展示' }),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  url: z.string().nullable().optional().meta({ description: '站内详情页相对路径' }),
  body: z.string().nullable().optional().meta({ description: 'include=body 或详情接口返回' }),
  extend: z.record(z.string(), z.unknown()).optional(),
  mediaData: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).optional(),
  tags: z.array(z.object({ name: z.string(), slug: z.string() })).optional(),
  relations: z.array(z.int()).optional(),
  channel: z.object({ id: z.int(), code: z.string(), path: z.string() }).nullable().optional(),
}).meta({ id: 'CmsOpenContent' });

export type CmsOpenContent = z.infer<typeof cmsOpenContentSchema>;

/** 游标分页结果（深翻不退化，且并发插入不错行） */
export const cmsOpenContentCursorPageSchema = z.object({
  list: z.array(cmsOpenContentSchema),
  pageSize: z.int(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().meta({ description: '下一页游标；null 表示已到末页' }),
}).meta({ id: 'CmsOpenContentCursorPage' });

export type CmsOpenContentCursorPage = z.infer<typeof cmsOpenContentCursorPageSchema>;

export const cmsOpenSyncChangeSchema = z.object({
  op: z.enum(CMS_OPEN_SYNC_OPS),
  id: z.int(),
  updatedAt: z.string(),
  content: cmsOpenContentSchema.optional().meta({ description: 'op=upsert 时返回；delete 时省略' }),
}).meta({ id: 'CmsOpenSyncChange' });

export type CmsOpenSyncChange = z.infer<typeof cmsOpenSyncChangeSchema>;

export const cmsOpenSyncResultSchema = z.object({
  changes: z.array(cmsOpenSyncChangeSchema),
  pageSize: z.int(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
}).meta({ id: 'CmsOpenSyncResult' });

export type CmsOpenSyncResult = z.infer<typeof cmsOpenSyncResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const openCmsSiteCodeQuery = z.object({
  siteCode: z.string().min(1).max(50).meta({ example: 'main', description: '站点标识' }),
});

/** 内容查询 DSL：过滤 / 排序 / 字段裁剪 / 关联展开 / 分页；服务端按原始查询串解析 */
export const openCmsContentListQuery = openCmsSiteCodeQuery.extend({
  channel: z.string().max(500).optional().meta({ example: 'news,notice', description: '栏目标识，逗号分隔多选（聚合主栏目与副栏目）' }),
  channelPath: z.string().max(255).optional().meta({ example: 'news', description: '栏目路径前缀，含全部子栏目' }),
  tag: z.string().max(500).optional().meta({ description: '标签 slug，逗号分隔多选' }),
  contentType: z.string().max(100).optional().meta({ example: 'article,album' }),
  keyword: z.string().max(64).optional().meta({ description: '全文检索（与站内搜索同一分词管线）' }),
  author: z.string().max(50).optional(),
  model: z.string().max(50).optional().meta({ description: '内容模型标识' }),
  isTop: z.string().optional(),
  isRecommend: z.string().optional(),
  isHot: z.string().optional(),
  isOriginal: z.string().optional(),
  publishedFrom: dateRangeBound('发布时间起'),
  publishedTo: dateRangeBound('发布时间止'),
  sort: z.string().max(200).optional().meta({ example: '-publishedAt', description: `可用字段：${CMS_OPEN_SORT_FIELDS.join(', ')}；前缀 - 为倒序` }),
  fields: z.string().max(500).optional().meta({ description: '字段裁剪，逗号分隔；id 始终返回' }),
  include: z.string().max(200).optional().meta({ description: `关联展开：${CMS_OPEN_INCLUDES.join(', ')}` }),
  page: z.string().optional(),
  pageSize: z.string().optional().meta({ description: `每页条数，上限 ${CMS_OPEN_PAGE_SIZE_MAX}` }),
  cursor: z.string().max(200).optional().meta({ description: '游标翻页；传入后忽略 page' }),
}).meta({ id: 'CmsOpenContentListQuery' });

export const openCmsSyncQuery = openCmsSiteCodeQuery.extend({
  since: z.string().max(20).optional().meta({ example: '2026-07-01 00:00:00', description: '起始时间；首次同步可留空取全量' }),
  cursor: z.string().max(200).optional().meta({ description: '上次返回的 nextCursor，优先于 since' }),
  pageSize: z.string().optional().meta({ description: `每批条数，上限 ${CMS_OPEN_SYNC_PAGE_SIZE_MAX}` }),
  include: z.string().max(200).optional(),
});

export const openCmsContentDetailQuery = openCmsSiteCodeQuery.extend({
  fields: z.string().max(500).optional(),
  include: z.string().max(200).optional(),
});

export const openCmsContentIdOrSlugParam = z.object({
  idOrSlug: z.string().min(1).max(255).meta({ description: '内容 id 或 slug' }),
});

// ─── 契约（开放网关 CMS 子端点，鉴权 / 计量 / 限流由网关中间件统一施加） ────────

export const openCmsContract = defineContract('/api/open', {
  channels: op.get('/v1/cms/channels', {
    security: 'open-gateway',
    query: openCmsSiteCodeQuery,
    response: z.array(cmsChannelSchema),
    summary: '站点栏目树（启用中）',
    description: '所需 scope：cms:read。',
  }),
  contents: op.get('/v1/cms/contents', {
    security: 'open-gateway',
    query: openCmsContentListQuery,
    response: paginated(cmsOpenContentSchema),
    summary: '已发布内容查询（过滤 / 排序 / 字段裁剪 / 游标翻页）',
    description: '所需 scope：cms:read。',
  }),
  contentsCursor: op.get('/v1/cms/contents/cursor', {
    security: 'open-gateway',
    query: openCmsContentListQuery,
    response: cmsOpenContentCursorPageSchema,
    summary: '已发布内容游标翻页（深翻不退化，适合全量拉取）',
    description: '所需 scope：cms:read。游标模式返回结构与 page 模式不同。',
  }),
  sync: op.get('/v1/cms/contents/sync', {
    security: 'open-gateway',
    query: openCmsSyncQuery,
    response: cmsOpenSyncResultSchema,
    summary: '内容增量同步（含删除变更）',
    description: '所需 scope：cms:read。',
  }),
  contentDetail: op.get('/v1/cms/contents/{idOrSlug}', {
    security: 'open-gateway',
    params: openCmsContentIdOrSlugParam,
    query: openCmsContentDetailQuery,
    response: cmsOpenContentSchema,
    summary: '已发布内容详情（含正文与扩展字段）',
    description: '所需 scope：cms:read。',
  }),
  createContent: op.post('/v1/cms/contents', {
    security: 'open-gateway',
    query: openCmsSiteCodeQuery,
    body: openCmsContentWriteSchema,
    response: cmsContentSchema,
    summary: '创建内容（默认落草稿并提交审核）',
    description: '所需 scope：cms:write；直接发布还需 cms:publish + 授权行 canPublish + 站点开关。',
  }),
  updateContent: op.patch('/v1/cms/contents/{id}', {
    security: 'open-gateway',
    params: idParam,
    query: openCmsSiteCodeQuery,
    body: openCmsContentUpdateSchema,
    response: cmsContentSchema,
    summary: '更新内容（支持 expectedVersion 乐观锁）',
    description: '所需 scope：cms:write。版本冲突返回 409。',
  }),
  submitContent: op.post('/v1/cms/contents/{id}/submit', {
    security: 'open-gateway',
    params: idParam,
    query: openCmsSiteCodeQuery,
    response: cmsContentSchema,
    summary: '提交审核',
    description: '所需 scope：cms:write。',
  }),
  publishContent: op.post('/v1/cms/contents/{id}/publish', {
    security: 'open-gateway',
    params: idParam,
    query: openCmsSiteCodeQuery,
    response: cmsContentSchema,
    summary: '直接发布（需 cms:publish + 授权 + 站点开关）',
    description: '所需 scope：cms:publish。',
  }),
  recycleContent: op.delete('/v1/cms/contents/{id}', {
    security: 'open-gateway',
    params: idParam,
    query: openCmsSiteCodeQuery,
    summary: '移入回收站（彻底删除仅限后台）',
    description: '所需 scope：cms:write。',
  }),
}, { tags: ['开放API-CMS'] });
