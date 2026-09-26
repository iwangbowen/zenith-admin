import { cmsBodyDocumentSchema } from '../document';
import * as z from 'zod';
import { dateRangeQuery, dateRangeBound, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryBool, queryEnum, requiredIdQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CMS_CONTENT_STATUSES, CMS_CONTENT_TYPES } from '../constants';
import { CMS_EDITORIAL_STATUSES, cmsContentCasSchema, cmsContentBatchCasSchema } from '../content-revision';
import type { CmsLinkTarget } from '../link';
import {
  batchCmsContentFlagsSchema,
  batchCmsContentStatusSchema,
  batchMoveCmsContentsSchema,
  batchTagCmsContentsSchema,
  checkCmsTextSchema,
  createCmsContentSchema,
  previewCmsContentWorkflowSchema,
  distributeCmsContentsSchema,
  duplicateCmsContentSchema,
  lockCmsContentSchema,
  rejectCmsContentSchema,
  updateCmsContentSchema,
} from '../validation';
import { cmsModelFieldViewSchema } from './models';
import { cmsTagSchema } from './tags';
import { workflowBusinessApprovalQuery, workflowBusinessContextQuery, workflowBusinessContextSchema, workflowBusinessPreviewSchema } from '../../workflow/contracts/business';

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
  ownerId: z.int().nullable(),
  locale: z.string(),
  translationOfId: z.int().nullable(),
  sourceRevisionId: z.int().nullable(),
  dueAt: z.string().nullable(),
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
  editorialStatus: z.enum(CMS_EDITORIAL_STATUSES),
  publishedRevisionId: z.int().nullable(),
  submittedRevisionId: z.int().nullable(),
  approvedRevisionId: z.int().nullable(),
  hasUnpublishedChanges: z.boolean(),
  bodyDocument: cmsBodyDocumentSchema.nullable().optional(),
  modelVersionId: z.int().nullable().optional(),
  modelFields: z.array(cmsModelFieldViewSchema).optional(),
  revisionId: z.int().optional(),
  contentHash: z.string().optional(),
  assetVersions: z.record(z.string(), z.int()).optional(),
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

/**
 * 后台内容列表项：不含正文与两个大 JSONB（扩展字段 / 形态数据）。
 * 列表页只展示元数据与附件计数；编辑、审批视图另走 detail 取全量。
 */
export const cmsContentListItemSchema = cmsContentSchema.omit({ body: true, extend: true, mediaData: true, bodyDocument: true }).extend({ listFields: z.record(z.string(), z.unknown()).optional() }).meta({ id: 'CmsContentListItem' });

export type CmsContentListItem = z.infer<typeof cmsContentListItemSchema>;

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
  hash: z.string(),
  kind: z.string(),
  sourceVersion: z.int(),
  remark: z.string().nullable(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'CmsContentVersion' });

export type CmsContentVersion = z.infer<typeof cmsContentVersionSchema>;
export const cmsContentVersionSummarySchema = cmsContentVersionSchema.omit({ snapshot: true }).meta({ id: 'CmsContentVersionSummary' });
export type CmsContentVersionSummary = z.infer<typeof cmsContentVersionSummarySchema>;

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
  revisionId: z.int(),
  grantId: z.string(),
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
  approvedIds: z.array(z.int()),
  releases: z.array(z.object({ id: z.int(), siteId: z.int(), status: z.string(), contentIds: z.array(z.int()) })),
  failed: z.array(z.object({ id: z.int(), reason: z.string() })),
}).meta({ id: 'CmsContentBatchStatusResult' });

export type CmsContentBatchStatusResult = z.infer<typeof cmsContentBatchStatusResultSchema>;

// ─── 内容日历 ────────────────────────────────────────────────────────────────

/**
 * 日历事件类型：`published` 是**实际发布时间**（`cms_contents.published_at`），
 * 其余三类是稿件上的待办日程（计划发布 / 审稿截止 / 过期下线）。
 * 直接发布的内容没有 `scheduledAt`，因此实际发布必须单独成类，否则日历经查不到已发布内容。
 */
export const CMS_CONTENT_CALENDAR_EVENT_KINDS = ['published', 'scheduled', 'due', 'expire'] as const;

export const cmsContentCalendarEventKindSchema = z.enum(CMS_CONTENT_CALENDAR_EVENT_KINDS);

export type CmsContentCalendarEventKind = z.infer<typeof cmsContentCalendarEventKindSchema>;

/** 日历事件明细（悬浮列表用；只带展示与跳转所需字段） */
export const cmsContentCalendarItemSchema = z.object({
  contentId: z.int(),
  title: z.string(),
  kind: cmsContentCalendarEventKindSchema,
}).meta({ id: 'CmsContentCalendarItem' });

export type CmsContentCalendarItem = z.infer<typeof cmsContentCalendarItemSchema>;

const cmsContentCalendarCountsSchema = z.object({
  published: z.int(),
  scheduled: z.int(),
  due: z.int(),
  expire: z.int(),
});

/**
 * 日历中的一天。`counts` 是精确计数（格子徽标），`items` 是悬浮列表用的明细，
 * 每天最多 `CMS_CONTENT_CALENDAR_DAY_ITEM_LIMIT` 条，超出部分由 `counts - items.length` 提示。
 */
export const cmsContentCalendarDaySchema = z.object({
  date: z.string().meta({ description: '应用时区下的 YYYY-MM-DD', example: '2026-09-26' }),
  counts: cmsContentCalendarCountsSchema,
  items: z.array(cmsContentCalendarItemSchema),
}).meta({ id: 'CmsContentCalendarDay' });

export type CmsContentCalendarDay = z.infer<typeof cmsContentCalendarDaySchema>;

/** 悬浮列表每天展示的事件上限（超出只影响明细，不影响 counts） */
export const CMS_CONTENT_CALENDAR_DAY_ITEM_LIMIT = 20;

// ─── 入参 ────────────────────────────────────────────────────────────────────

/** 内容日历查询（按月聚合，不翻页） */
export const cmsContentCalendarQuery = z.object({
  siteId: requiredIdQuery(),
  month: z.string().regex(/^\d{4}-\d{2}$/, '月份格式为 YYYY-MM').meta({ example: '2026-09' }),
});

export const cmsContentListQuery = paginationQuery.extend({
  calendarFrom: dateRangeBound('发布、到期或审稿截止起点', 'start'),
  calendarTo: dateRangeBound('发布、到期或审稿截止终点', 'end'),
  modelId: idQuery(),
  ownerId: idQuery(),
  locale: z.string().max(35).optional(),
  hasUnpublishedChanges: queryBool(),
  tags: z.string().regex(/^\d+(?:,\d+)*$/).optional(),
  siteId: requiredIdQuery(),
  channelId: idQuery(),
  status: queryEnum(CMS_CONTENT_STATUSES),
  editorialStatus: queryEnum(CMS_EDITORIAL_STATUSES),
  contentType: queryEnum(CMS_CONTENT_TYPES),
  keyword: keywordQuery(),
  isTop: queryBool(),
  isRecommend: queryBool(),
  isHot: queryBool(),
  isOriginal: queryBool(),
  deleted: queryBool('仅回收站内容'),
  archived: queryBool('仅已归档内容'),
  ...dateRangeQuery(),
});

export const cmsContentTitleCheckQuery = z.object({
  siteId: requiredIdQuery(),
  title: z.string().min(1).max(255),
  excludeId: idQuery(),
});

export const cmsLinkTargetQuery = z.object({
  siteId: requiredIdQuery(),
  link: z.string().max(500),
});

export const cmsContentVersionParam = idParam.extend({
  versionId: z.coerce.number().int().positive().meta({ description: '版本 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsContentContract = defineContract('/api/cms/contents', {
  list: op.get('/', { access: { permission: 'cms:content:list' }, query: cmsContentListQuery, response: paginated(cmsContentListItemSchema), summary: '内容分页列表（不含正文 / 扩展字段 / 形态数据）' }),
  checkTitle: op.get('/check-title', { access: { permission: 'cms:content:list' }, query: cmsContentTitleCheckQuery, response: cmsTitleDuplicateCheckSchema, summary: '同站标题查重（编辑辅助，不阻断保存）' }),
  calendar: op.get('/calendar', { access: { permission: 'cms:content:list' }, query: cmsContentCalendarQuery, response: z.array(cmsContentCalendarDaySchema), summary: '内容日历（按天聚合实际发布与待办日程）' }),
  linkTarget: op.get('/link-target', { access: { permission: 'cms:content:list' }, query: cmsLinkTargetQuery, response: cmsLinkTargetSchema, summary: '解析内部链接目标（编辑页回显 entity: 链接的可读名称）' }),
  workflowPreview: op.post('/workflow-preview', { access: { permission: ['cms:content:list', 'cms:content:create', 'cms:content:update'] }, body: previewCmsContentWorkflowSchema, response: workflowBusinessPreviewSchema, summary: '内容审核链路预览（不保存）' }),
  workflowContext: op.get('/{id}/workflow', { access: { permission: 'cms:content:list' }, params: idParam, query: workflowBusinessContextQuery, response: workflowBusinessContextSchema, summary: '内容审批流程与往次记录' }),
  approvalDetail: op.get('/{id}/approval-detail', { access: 'authenticated', params: idParam, query: workflowBusinessApprovalQuery, response: cmsContentSchema, summary: '指定审批轮次的当前内容资料' }),
  detail: op.get('/{id}', { access: { permission: 'cms:content:list' }, params: idParam, response: cmsContentSchema, summary: '内容详情' }),
  create: op.post('/', { access: { permission: 'cms:content:create' }, audit: '创建 CMS 内容', body: createCmsContentSchema, response: cmsContentSchema, summary: '创建内容（默认草稿）' }),
  update: op.put('/{id}', { access: { permission: 'cms:content:update' }, audit: '更新 CMS 内容', params: idParam, body: updateCmsContentSchema, response: cmsContentSchema, summary: '更新内容' }),
  submit: op.post('/{id}/submit', { access: { permission: 'cms:content:update' }, audit: '提交 CMS 内容审核', params: idParam, body: cmsContentCasSchema, response: cmsContentSchema, summary: '提交审核' }),
  publish: op.post('/{id}/publish', { access: { permission: 'cms:content:publish' }, audit: '发布 CMS 内容', params: idParam, body: cmsContentCasSchema, response: cmsContentSchema, summary: '发布（直接发布或审核通过）' }),
  preparePublication: op.post('/{id}/prepare-publication', { access: { permission: 'cms:content:publish' }, audit: '批准 CMS 内容待发布稿', params: idParam, body: cmsContentCasSchema, response: cmsContentSchema, summary: '冻结并批准修订，供组合发布单选择' }),
  reject: op.post('/{id}/reject', { access: { permission: 'cms:content:audit' }, audit: '驳回 CMS 内容', params: idParam, body: rejectCmsContentSchema, response: cmsContentSchema, summary: '驳回' }),
  offline: op.post('/{id}/offline', { access: { permission: 'cms:content:publish' }, audit: '下线 CMS 内容', params: idParam, body: cmsContentCasSchema, response: cmsContentSchema, summary: '下线' }),
  recycle: op.post('/recycle', { access: { permission: 'cms:content:delete' }, audit: 'CMS 内容移入回收站', body: cmsContentBatchCasSchema, summary: '移入回收站（批量）' }),
  restore: op.post('/restore', { access: { permission: 'cms:content:delete' }, audit: 'CMS 内容从回收站恢复', body: cmsContentBatchCasSchema, summary: '从回收站恢复（批量，恢复为草稿）' }),
  purge: op.post('/purge', { access: { permission: 'cms:content:delete' }, audit: 'CMS 内容彻底删除', body: cmsContentBatchCasSchema, summary: '彻底删除（批量，仅限回收站内容）' }),
  versions: op.get('/{id}/versions', { access: { permission: 'cms:content:list' }, params: idParam, query: paginationQuery, response: paginated(cmsContentVersionSummarySchema), summary: '内容修订历史（分页摘要，不含正文）' }),
  version: op.get('/{id}/versions/{versionId}', { access: { permission: 'cms:content:list' }, params: cmsContentVersionParam, response: cmsContentVersionSchema, summary: '固定模型与素材的完整修订' }),
  restoreVersion: op.post('/{id}/versions/{versionId}/restore', { access: { permission: 'cms:content:update' }, audit: 'CMS 内容版本回滚', params: cmsContentVersionParam, body: cmsContentCasSchema, response: cmsContentSchema, summary: '回滚到指定版本（回滚前自动留档当前状态）' }),
  versionDiff: op.get('/{id}/versions/{versionId}/diff', { access: { permission: 'cms:content:list' }, params: cmsContentVersionParam, response: z.array(cmsContentVersionDiffSchema), summary: '版本差异对比（历史版本 vs 当前内容，仅返回变更字段）' }),
  acquireEditLock: op.post('/{id}/edit-lock', { access: { permission: 'cms:content:update' }, params: idParam, response: cmsEditLockSchema, summary: '抢占/续期内容编辑锁（软锁，防多人同编相互覆盖）' }),
  releaseEditLock: op.delete('/{id}/edit-lock', { access: { permission: 'cms:content:update' }, params: idParam, summary: '释放内容编辑锁（仅持有人生效）' }),
  previewLink: op.post('/{id}/preview-link', { access: { permission: 'cms:content:list' }, params: idParam, response: cmsPreviewLinkSchema, summary: '生成草稿预览链接（签名临时链接，默认 2 小时有效）' }),
  revokePreview: op.post('/{id}/preview-links/{grantId}/revoke', { access: { permission: 'cms:content:update' }, params: idParam.extend({ grantId: z.uuid() }), summary: '撤销固定修订预览链接' }),
  batchMove: op.post('/batch-move', { access: { permission: 'cms:content:update' }, audit: 'CMS 内容批量移动', body: batchMoveCmsContentsSchema, summary: '批量移动栏目' }),
  batchFlags: op.post('/batch-flags', { access: { permission: 'cms:content:update' }, audit: 'CMS 内容批量设置属性', body: batchCmsContentFlagsSchema, summary: '批量设置属性（置顶/推荐/热门/原创）' }),
  batchTag: op.post('/batch-tag', { access: { permission: 'cms:content:update' }, audit: 'CMS 内容批量打标', body: batchTagCmsContentsSchema, summary: '批量追加标签' }),
  batchStatus: op.post('/batch-status', { access: { permission: ['cms:content:update', 'cms:content:publish', 'cms:content:audit'] }, audit: 'CMS 内容批量状态流转', body: batchCmsContentStatusSchema, response: cmsContentBatchStatusResultSchema, summary: '批量状态流转（提审/发布/驳回/下线），逐条独立校验并返回部分成功明细' }),
  duplicate: op.post('/{id}/duplicate', { access: { permission: 'cms:content:create' }, audit: 'CMS 内容复制', params: idParam, body: duplicateCmsContentSchema, response: cmsContentSchema, summary: '复制为草稿（可指定本站其他栏目）' }),
  distribute: op.post('/distribute', { access: { permission: 'cms:distribution:run' }, audit: 'CMS 内容站群分发', body: distributeCmsContentsSchema, summary: '站群分发（创建可独立编辑的完整快照）' }),
  archive: op.post('/archive', { access: { permission: 'cms:content:update' }, audit: 'CMS 内容归档', body: cmsContentBatchCasSchema, summary: '归档（批量，仅已发布/已下线内容；前台详情保留，不参与列表聚合）' }),
  unarchive: op.post('/unarchive', { access: { permission: 'cms:content:update' }, audit: 'CMS 内容取消归档', body: cmsContentBatchCasSchema, summary: '取消归档（批量）' }),
  opLogs: op.get('/{id}/op-logs', { access: { permission: 'cms:content:list' }, params: idParam, response: z.array(cmsContentOpLogSchema), summary: '内容操作日志时间线（新→旧，最近 100 条）' }),
  checkText: op.post('/check-text', { access: { permission: 'cms:content:update' }, body: checkCmsTextSchema, response: cmsTextCheckResultSchema, summary: '内容词库检查（敏感词 + 易错词命中清单，编辑辅助）' }),
  lock: op.post('/{id}/lock', { access: { permission: 'cms:content:lock' }, audit: '持久锁定 CMS 内容', params: idParam, body: lockCmsContentSchema, response: cmsContentLockStateSchema, summary: '持久锁定内容（取消待执行计划发布时间）' }),
  unlock: op.post('/{id}/unlock', { access: { permission: 'cms:content:lock' }, audit: '解除 CMS 内容持久锁', params: idParam, body: cmsContentCasSchema, summary: '解除内容持久锁' }),
}, { auditModule: 'CMS内容管理', tags: ['CMS-内容管理'] });
