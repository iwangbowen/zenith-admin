import * as z from 'zod';
import { batchIdsBody, dateRangeBound, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CMS_CONTENT_STATUSES, CMS_CONTENT_TYPES } from '../constants';
import type { CmsLinkTarget } from '../link';
import {
  batchCmsContentFlagsSchema,
  batchCmsContentStatusSchema,
  batchMoveCmsContentsSchema,
  batchTagCmsContentsSchema,
  checkCmsTextSchema,
  createCmsContentSchema,
  distributeCmsContentsSchema,
  duplicateCmsContentSchema,
  lockCmsContentSchema,
  rejectCmsContentSchema,
  updateCmsContentSchema,
} from '../validation';
import { cmsTagSchema } from './tags';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsContentStatusSchema = z.enum(CMS_CONTENT_STATUSES);

export const cmsContentTypeSchema = z.enum(CMS_CONTENT_TYPES);

/** 内容标题样式（列表页 / 详情页标题展示） */
export const cmsTitleStyleSchema = z.object({
  bold: z.boolean().optional(),
  color: z.string().nullable().optional().meta({ description: '十六进制色值（#rrggbb）；空 / 缺省 = 主题默认色' }),
}).meta({ id: 'CmsTitleStyle' });

export type CmsTitleStyle = z.infer<typeof cmsTitleStyleSchema>;

/** 内容附件（正文之外的可下载文件） */
export const cmsContentAttachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  size: z.int().meta({ description: '字节数（0 = 未知）' }),
  ext: z.string().meta({ description: '扩展名（小写，不含点）' }),
  sort: z.int(),
}).meta({ id: 'CmsContentAttachment' });

export type CmsContentAttachment = z.infer<typeof cmsContentAttachmentSchema>;

/** 图集单图 */
export const cmsAlbumImageSchema = z.object({
  url: z.string(),
  thumb: z.string().nullable().optional().meta({ description: '缩略图（上传管线生成；空 = 用原图）' }),
  caption: z.string().nullable().optional(),
}).meta({ id: 'CmsAlbumImage' });

export type CmsAlbumImage = z.infer<typeof cmsAlbumImageSchema>;

/** 内容形态结构化数据（album / media 使用，article / link 为空对象） */
export const cmsContentMediaDataSchema = z.object({
  images: z.array(cmsAlbumImageSchema).optional().meta({ description: 'album：图片列表' }),
  mediaType: z.enum(['video', 'audio']).optional().meta({ description: 'media：音频 / 视频' }),
  mediaUrl: z.string().optional(),
  poster: z.string().optional(),
  duration: z.string().optional().meta({ description: '展示用时长文本（如 03:45）' }),
}).meta({ id: 'CmsContentMediaData' });

export type CmsContentMediaData = z.infer<typeof cmsContentMediaDataSchema>;

export const cmsContentSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  channelId: z.int(),
  channelName: z.string().nullable().optional(),
  modelId: z.int().nullable(),
  contentType: cmsContentTypeSchema.meta({ description: '内容形态（创建后不可变更）' }),
  mediaData: cmsContentMediaDataSchema.meta({ description: '形态结构化数据：album.images / media.mediaType|mediaUrl|poster|duration' }),
  title: z.string().meta({ example: '公司荣获行业大奖' }),
  titleStyle: cmsTitleStyleSchema.meta({ description: '标题样式（加粗 / 颜色）；空对象 = 主题默认' }),
  subTitle: z.string().nullable().meta({ description: '副标题' }),
  shortTitle: z.string().nullable().meta({ description: '短标题（列表窄位展示）' }),
  slug: z.string().nullable(),
  summary: z.string().nullable(),
  coverImage: z.string().nullable(),
  coverThumb: z.string().nullable().meta({ description: '封面缩略图（空 = 前台回退原图）' }),
  author: z.string().nullable(),
  editor: z.string().nullable().meta({ description: '责任编辑' }),
  source: z.string().nullable(),
  sourceUrl: z.string().nullable().meta({ description: '来源链接' }),
  isOriginal: z.boolean().meta({ description: '原创标记' }),
  body: z.string().nullable(),
  attachments: z.array(cmsContentAttachmentSchema).meta({ description: '正文附件列表（前台详情页可下载）' }),
  extend: z.record(z.string(), z.unknown()),
  externalLink: z.string().nullable(),
  detailTemplate: z.string().nullable().meta({ description: '详情模板覆盖（主题变体模板名；空 = 跟随栏目/站点默认）' }),
  staticPath: z.string().nullable().meta({ description: '自定义静态化相对路径（站内唯一）；空 = 按 slug/id 生成' }),
  canonicalUrl: z.string().nullable().optional().meta({ description: '服务端按栏目路径规则计算的规范前台地址（相对站点根路径）' }),
  previewUrl: z.string().nullable().optional().meta({ description: '服务端生成的后台预览地址；未发布内容可能为空' }),
  isTop: z.boolean(),
  topWeight: z.int().meta({ description: '置顶权重（数值越大越靠前）' }),
  topExpireAt: z.string().nullable().meta({ description: '置顶到期时间（到期自动取消置顶；空 = 永久）' }),
  isRecommend: z.boolean(),
  isHot: z.boolean(),
  hasImage: z.boolean().optional().meta({ description: '含图（保存时自动检测）' }),
  hasVideo: z.boolean().optional().meta({ description: '含视频（保存时自动检测）' }),
  hasAttachment: z.boolean().optional().meta({ description: '含附件（保存时自动检测）' }),
  status: cmsContentStatusSchema,
  rejectReason: z.string().nullable(),
  publishedAt: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  expireAt: z.string().nullable().meta({ description: '过期自动下线时间（空 = 永不过期）' }),
  viewCount: z.int(),
  likeCount: z.int().meta({ description: '会员点赞数（冗余计数）' }),
  favoriteCount: z.int().meta({ description: '会员收藏数（冗余计数）' }),
  version: z.int().meta({ description: '乐观锁版本号，更新时回传 expectedVersion' }),
  sort: z.int(),
  seoTitle: z.string().nullable(),
  seoKeywords: z.string().nullable(),
  seoDescription: z.string().nullable(),
  socialImageAlt: z.string().nullable(),
  twitterCreator: z.string().nullable(),
  memberId: z.int().nullable().optional().meta({ description: '会员投稿：非空表示由前台会员提交' }),
  archivedAt: z.string().nullable().meta({ description: '归档时间（非空 = 已归档）' }),
  mappingSourceId: z.int().nullable().meta({ description: '映射来源内容 id（非空 = 映射内容，正文共享来源）' }),
  mappingSourceTitle: z.string().nullable().optional().meta({ description: '映射来源内容标题' }),
  distributionRuleId: z.int().nullable().meta({ description: '分发规则 id' }),
  distributionSourceId: z.int().nullable().meta({ description: '分发来源内容 id' }),
  distributionSourceVersion: z.int().nullable().meta({ description: '最近同步的来源版本' }),
  lockedAt: z.string().nullable(),
  lockedBy: z.int().nullable(),
  lockedByName: z.string().nullable().optional(),
  lockReason: z.string().nullable(),
  tags: z.array(cmsTagSchema).optional().meta({ description: '详情 / 写接口返回' }),
  tagIds: z.array(z.int()).optional(),
  extraChannelIds: z.array(z.int()).optional().meta({ description: '副栏目 id（一文多栏目）' }),
  relatedIds: z.array(z.int()).optional().meta({ description: '相关文章 id（手动关联）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsContent' });

export type CmsContent = z.infer<typeof cmsContentSchema>;

/** 持久化管理员合规锁状态 */
export const cmsContentLockStateSchema = z.object({
  lockedAt: z.string(),
  lockedBy: z.int().nullable(),
  lockReason: z.string().nullable(),
}).meta({ id: 'CmsContentLock' });

export type CmsContentLockState = z.infer<typeof cmsContentLockStateSchema>;

export const cmsContentVersionSchema = z.object({
  id: z.int(),
  contentId: z.int(),
  version: z.int(),
  title: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
  remark: z.string().nullable(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'CmsContentVersion' });

export type CmsContentVersion = z.infer<typeof cmsContentVersionSchema>;

/** 版本差异对比项（before = 历史版本值，after = 当前值） */
export const cmsContentVersionDiffSchema = z.object({
  field: z.string().meta({ example: 'title' }),
  label: z.string().meta({ example: '标题' }),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
}).meta({ id: 'CmsContentVersionDiff' });

export type CmsContentVersionDiff = z.infer<typeof cmsContentVersionDiffSchema>;

/** 内容编辑锁状态（软锁，防多人同编相互覆盖） */
export const cmsEditLockSchema = z.object({
  acquired: z.boolean().meta({ description: 'true = 当前用户持有编辑锁' }),
  holder: z.object({
    userId: z.int(),
    nickname: z.string(),
    lockedAt: z.string(),
  }).nullable().meta({ description: '他人持锁时的持有人信息' }),
}).meta({ id: 'CmsEditLock' });

export type CmsEditLock = z.infer<typeof cmsEditLockSchema>;

/** 草稿预览链接（签名临时链接） */
export const cmsPreviewLinkSchema = z.object({
  url: z.string().meta({ example: '/__cms/main/preview/1?exp=1789000000&sig=abc' }),
  expiresAt: z.string(),
}).meta({ id: 'CmsPreviewLink' });

export type CmsPreviewLink = z.infer<typeof cmsPreviewLinkSchema>;

export const cmsLinkTargetSchema: z.ZodType<CmsLinkTarget> = z.object({
  kind: z.enum(['entity-content', 'entity-channel', 'internal', 'external', 'invalid']),
  label: z.string().meta({ description: '可读描述：实体链接为目标标题 / 栏目名，其余为原值', example: '关于印发继续教育规程的通知' }),
  targetId: z.int().nullable().meta({ description: '实体链接的目标 id；非实体链接或按标识引用且目标不存在时为 null' }),
  targetCode: z.string().nullable().meta({ description: '按栏目标识引用时回显该标识；其余为 null', example: 'news' }),
  exists: z.boolean().meta({ description: '目标是否仍存在（false 时前端提示链接已失效）' }),
}).meta({ id: 'CmsLinkTarget' });


/** CMS 内容操作日志（内容级时间线） */
export const cmsContentOpLogSchema = z.object({
  id: z.int(),
  contentId: z.int(),
  action: z.string().meta({ example: 'published' }),
  actionLabel: z.string().meta({ example: '发布' }),
  detail: z.string().nullable(),
  operatorId: z.int().nullable(),
  operatorName: z.string(),
  createdAt: z.string(),
}).meta({ id: 'CmsContentOpLog' });

export type CmsContentOpLog = z.infer<typeof cmsContentOpLogSchema>;

/** 内容文本检查命中结果（敏感词 + 易错词） */
export const cmsTextCheckResultSchema = z.object({
  sensitive: z.array(z.object({
    word: z.string(),
    replaceWith: z.string().nullable().meta({ description: '空 = 拦截词（提交会被拒绝）' }),
    count: z.int(),
  })),
  errorProne: z.array(z.object({
    word: z.string(),
    correction: z.string(),
    count: z.int(),
  })),
}).meta({ id: 'CmsTextCheckResult' });

export type CmsTextCheckResult = z.infer<typeof cmsTextCheckResultSchema>;

/** 同站标题查重结果 */
export const cmsTitleDuplicateCheckSchema = z.object({
  duplicate: z.boolean(),
  matches: z.array(z.object({ id: z.int(), title: z.string(), status: cmsContentStatusSchema })),
}).meta({ id: 'CmsTitleDuplicateCheck' });

export type CmsTitleDuplicateCheck = z.infer<typeof cmsTitleDuplicateCheckSchema>;

/** 批量状态流转结果（逐条独立校验的部分成功明细） */
export const cmsContentBatchStatusResultSchema = z.object({
  okIds: z.array(z.int()),
  failed: z.array(z.object({ id: z.int(), reason: z.string() })),
}).meta({ id: 'CmsContentBatchStatusResult' });

export type CmsContentBatchStatusResult = z.infer<typeof cmsContentBatchStatusResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsContentListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  channelId: z.coerce.number().int().positive().optional(),
  status: cmsContentStatusSchema.optional(),
  contentType: cmsContentTypeSchema.optional(),
  keyword: z.string().optional(),
  isTop: queryBool(),
  isRecommend: queryBool(),
  isHot: queryBool(),
  deleted: queryBool('仅回收站内容'),
  archived: queryBool('仅已归档内容'),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const cmsContentTitleCheckQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(255),
  excludeId: z.coerce.number().int().positive().optional(),
});

export const cmsLinkTargetQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  link: z.string().max(500),
});

export const cmsContentVersionParam = idParam.extend({
  versionId: z.coerce.number().int().positive().meta({ description: '版本 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsContentContract = defineContract('/api/cms/contents', {
  list: op.get('/', { query: cmsContentListQuery, response: paginated(cmsContentSchema), summary: '内容分页列表' }),
  checkTitle: op.get('/check-title', { query: cmsContentTitleCheckQuery, response: cmsTitleDuplicateCheckSchema, summary: '同站标题查重（编辑辅助，不阻断保存）' }),
  linkTarget: op.get('/link-target', { query: cmsLinkTargetQuery, response: cmsLinkTargetSchema, summary: '解析内部链接目标（编辑页回显 entity: 链接的可读名称）' }),
  detail: op.get('/{id}', { params: idParam, response: cmsContentSchema, summary: '内容详情' }),
  create: op.post('/', { body: createCmsContentSchema, response: cmsContentSchema, summary: '创建内容（默认草稿）' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsContentSchema, response: cmsContentSchema, summary: '更新内容' }),
  submit: op.post('/{id}/submit', { params: idParam, response: cmsContentSchema, summary: '提交审核' }),
  publish: op.post('/{id}/publish', { params: idParam, response: cmsContentSchema, summary: '发布（直接发布或审核通过）' }),
  reject: op.post('/{id}/reject', { params: idParam, body: rejectCmsContentSchema, response: cmsContentSchema, summary: '驳回' }),
  offline: op.post('/{id}/offline', { params: idParam, response: cmsContentSchema, summary: '下线' }),
  recycle: op.post('/recycle', { body: batchIdsBody, summary: '移入回收站（批量）' }),
  restore: op.post('/restore', { body: batchIdsBody, summary: '从回收站恢复（批量，恢复为草稿）' }),
  purge: op.post('/purge', { body: batchIdsBody, summary: '彻底删除（批量，仅限回收站内容）' }),
  versions: op.get('/{id}/versions', { params: idParam, response: z.array(cmsContentVersionSchema), summary: '内容版本历史' }),
  restoreVersion: op.post('/{id}/versions/{versionId}/restore', { params: cmsContentVersionParam, response: cmsContentSchema, summary: '回滚到指定版本（回滚前自动留档当前状态）' }),
  versionDiff: op.get('/{id}/versions/{versionId}/diff', { params: cmsContentVersionParam, response: z.array(cmsContentVersionDiffSchema), summary: '版本差异对比（历史版本 vs 当前内容，仅返回变更字段）' }),
  acquireEditLock: op.post('/{id}/edit-lock', { params: idParam, response: cmsEditLockSchema, summary: '抢占/续期内容编辑锁（软锁，防多人同编相互覆盖）' }),
  releaseEditLock: op.delete('/{id}/edit-lock', { params: idParam, summary: '释放内容编辑锁（仅持有人生效）' }),
  previewLink: op.post('/{id}/preview-link', { params: idParam, response: cmsPreviewLinkSchema, summary: '生成草稿预览链接（签名临时链接，默认 2 小时有效）' }),
  batchMove: op.post('/batch-move', { body: batchMoveCmsContentsSchema, summary: '批量移动栏目' }),
  batchFlags: op.post('/batch-flags', { body: batchCmsContentFlagsSchema, summary: '批量设置属性（置顶/推荐/热门/原创）' }),
  batchTag: op.post('/batch-tag', { body: batchTagCmsContentsSchema, summary: '批量追加标签' }),
  batchStatus: op.post('/batch-status', { body: batchCmsContentStatusSchema, response: cmsContentBatchStatusResultSchema, summary: '批量状态流转（提审/发布/驳回/下线），逐条独立校验并返回部分成功明细' }),
  duplicate: op.post('/{id}/duplicate', { params: idParam, body: duplicateCmsContentSchema, response: cmsContentSchema, summary: '复制为草稿（可指定本站其他栏目）' }),
  distribute: op.post('/distribute', { body: distributeCmsContentsSchema, summary: '站群分发（创建可独立编辑的完整快照）' }),
  archive: op.post('/archive', { body: batchIdsBody, summary: '归档（批量，仅已发布/已下线内容；前台详情保留，不参与列表聚合）' }),
  unarchive: op.post('/unarchive', { body: batchIdsBody, summary: '取消归档（批量）' }),
  opLogs: op.get('/{id}/op-logs', { params: idParam, response: z.array(cmsContentOpLogSchema), summary: '内容操作日志时间线（新→旧，最近 100 条）' }),
  checkText: op.post('/check-text', { body: checkCmsTextSchema, response: cmsTextCheckResultSchema, summary: '内容词库检查（敏感词 + 易错词命中清单，编辑辅助）' }),
  lock: op.post('/{id}/lock', { params: idParam, body: lockCmsContentSchema, response: cmsContentLockStateSchema, summary: '持久锁定内容（取消待执行计划发布时间）' }),
  unlock: op.post('/{id}/unlock', { params: idParam, summary: '解除内容持久锁' }),
}, { tags: ['CMS-内容管理'] });
