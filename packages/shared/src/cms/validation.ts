import * as z from 'zod';
import { dateTimeStringSchema, httpUrl, partialForUpdate } from '../core/validation';
import { DATE_TIME_PATTERN } from '../core/constants';
import { CMS_CHANNEL_DETAIL_PATH_RULES, CMS_CHANNEL_STATIC_MODES, CMS_PUBLISH_ACTIONS, CMS_DISTRIBUTION_CONFLICT_STRATEGIES, CMS_DISTRIBUTION_MODES, CMS_FIELD_OPTION_SOURCES, CMS_INTERACTION_CHOICE_QUESTION_TYPES, CMS_INTERACTION_CONDITION_OPS, CMS_INTERACTION_OTHER_VALUE, CMS_INTERACTION_QUESTION_TYPES, CMS_INTERACTION_RATING_MAX_LIMIT, CMS_PUBLISH_TARGET_TYPES, CMS_SEARCH_DICTIONARY_WORD_PATTERN, CMS_SITE_INHERITABLE_FIELDS, CMS_WIDGET_REF_OWNER_TYPES, CMS_WIDGET_RENDERER_KEYS, CMS_WIDGET_SOURCE_TYPES, CMS_WIDGET_TYPES } from './constants';
import { CMS_LINK_FORMAT_MESSAGE, isDirectCmsHref, isValidCmsAssetUrl, isValidCmsLink } from './link';

// ─── CMS 内容管理 Schema ──────────────────────────────────────────────────────
export const cmsSlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CMS_PAGE_RESERVED_PATH_PREFIXES = [
  'p', 'tag', 'interaction', 'search', 'preview', 'api', 'assets',
] as const;

/** 媒体/附件地址：只允许可直接加载的站内路径/http(s)，内部迁移包可暂存素材句柄。 */
const cmsAssetUrlSchema = z.string().trim().max(500).refine(
  isValidCmsAssetUrl,
  CMS_LINK_FORMAT_MESSAGE,
);

/** 页面跳转/重定向/内链词等链接字段，允许完整的 CMS 链接协议集合。 */
const cmsLinkUrlSchema = z.string().trim().max(500).refine(isValidCmsLink, CMS_LINK_FORMAT_MESSAGE);
const cmsDirectHrefSchema = z.string().trim().max(500).refine(isDirectCmsHref, CMS_LINK_FORMAT_MESSAGE);

export const cmsStaticPathSchema = z.string().trim().max(255)
  .regex(/^[a-z0-9][a-z0-9\-_/]*\.html$/, '静态路径需形如 news/2026/hello.html')
  .refine((v) => !v.includes('..') && !v.includes('//'), '静态路径不能包含 .. 或连续斜杠')
  .refine((v) => {
    const first = v.split('/')[0];
    return !CMS_PAGE_RESERVED_PATH_PREFIXES.includes(first as never)
      && !['robots.txt', 'sitemap.xml', 'rss.xml', 'index.html'].includes(v);
  }, '静态路径与系统保留路径冲突')
  .nullable().optional();

export const cmsSiteInheritanceSchema = z.object({
  seoTitle: z.boolean().default(false),
  seoKeywords: z.boolean().default(false),
  seoDescription: z.boolean().default(false),
  staticMode: z.boolean().default(false),
  reviewMode: z.boolean().default(false),
  webhook: z.boolean().default(false),
  cdn: z.boolean().default(false),
  theme: z.boolean().default(false),
  themeConfig: z.boolean().default(false),
  templates: z.boolean().default(false),
});

export const createCmsSiteSchema = z.object({
  parentId: z.number().int().positive().nullable().default(null),
  inheritance: cmsSiteInheritanceSchema.default({
    seoTitle: false,
    seoKeywords: false,
    seoDescription: false,
    staticMode: false,
    reviewMode: false,
    webhook: false,
    cdn: false,
    theme: false,
    themeConfig: false,
    templates: false,
  }),
  name: z.string().min(1, '站点名称不能为空').max(100),
  code: z.string().min(1, '站点标识不能为空').max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  domain: z.string().max(255).nullable().optional(),
  aliasDomains: z.array(z.string().max(255)).default([]),
  isDefault: z.boolean().default(false),
  title: z.string().max(200).nullable().optional(),
  keywords: z.string().max(500).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  logo: z.string().max(500).nullable().optional(),
  favicon: z.string().max(500).nullable().optional(),
  icp: z.string().max(100).nullable().optional(),
  copyright: z.string().max(255).nullable().optional(),
  theme: z.string().max(50).default('default'),
  staticMode: z.enum(['dynamic', 'hybrid', 'static']).default('hybrid'),
  /** 站点级扩展模型与其字段值 */
  modelId: z.number().int().positive().nullable().optional(),
  extend: z.record(z.string(), z.unknown()).default({}),
  robots: z.string().max(4000).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
  remark: z.string().max(500).nullable().optional(),
});

/**
 * parentId / inheritance 分别经 move / inheritance 专用接口变更，不在通用更新中开放；
 * theme 切换仅允许内置主题（服务端校验注册表），变更后 bump themeRevision。
 */
export const updateCmsSiteSchema = partialForUpdate(createCmsSiteSchema.omit({ parentId: true, inheritance: true }));

export const moveCmsSiteSchema = z.object({
  parentId: z.number().int().positive().nullable(),
});

export const updateCmsSiteInheritanceSchema = partialForUpdate(cmsSiteInheritanceSchema)
  .refine((value) => Object.keys(value).some((key) => CMS_SITE_INHERITABLE_FIELDS.includes(key as (typeof CMS_SITE_INHERITABLE_FIELDS)[number])), {
    message: '至少提交一个继承项',
  });

/** 站点内容策略（cms_sites.settings 的受控子集，逐项可缺省） */
export const cmsSiteOpsSettingsSchema = partialForUpdate(z.object({
  publishedContentEditable: z.boolean(),
  recycleKeepDays: z.number().int().min(0).max(3650),
  maxPageOnContentPublish: z.number().int().min(0).max(1000),
  autoReplaceSensitiveWords: z.boolean(),
  autoReplaceErrorProneWords: z.boolean(),
  autoCoverFromBody: z.boolean(),
}));

export type CmsSiteOpsSettingsInput = z.input<typeof cmsSiteOpsSettingsSchema>;

export const cmsDistributionFiltersSchema = z.object({
  statuses: z.array(z.literal('published')).min(1).default(['published']),
  contentTypes: z.array(z.enum(['article', 'album', 'media', 'link'])).default([]),
  keyword: z.string().max(100).nullable().default(null),
  publishedFrom: dateTimeStringSchema.nullable().default(null),
  publishedTo: dateTimeStringSchema.nullable().default(null),
}).refine((value) => !value.publishedFrom || !value.publishedTo || value.publishedFrom <= value.publishedTo, {
  message: '发布时间范围无效',
  path: ['publishedTo'],
});

const cmsDistributionRuleBaseSchema = z.object({
  name: z.string().trim().min(1, '规则名称不能为空').max(100),
  sourceSiteId: z.number().int().positive(),
  sourceChannelId: z.number().int().positive().nullable().default(null),
  targetSiteId: z.number().int().positive(),
  targetChannelId: z.number().int().positive(),
  mode: z.enum(CMS_DISTRIBUTION_MODES).default('copy'),
  conflictStrategy: z.enum(CMS_DISTRIBUTION_CONFLICT_STRATEGIES).default('skip'),
  filters: cmsDistributionFiltersSchema.default({
    statuses: ['published'],
    contentTypes: [],
    keyword: null,
    publishedFrom: null,
    publishedTo: null,
  }),
  scheduleCron: z.string().trim().min(5).max(100).nullable().default(null),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).nullable().default(null),
});

function validateCmsDistributionRuleShape(
  value: Partial<z.infer<typeof cmsDistributionRuleBaseSchema>>,
  ctx: z.RefinementCtx,
): void {
  if (value.sourceSiteId === value.targetSiteId) {
    ctx.addIssue({ code: 'custom', path: ['targetSiteId'], message: '来源站点与目标站点不能相同' });
  }
  if (value.mode === 'scheduled' && !value.scheduleCron) {
    ctx.addIssue({ code: 'custom', path: ['scheduleCron'], message: '定时同步必须配置 Cron 表达式' });
  }
  if (value.mode !== 'scheduled' && value.scheduleCron) {
    ctx.addIssue({ code: 'custom', path: ['scheduleCron'], message: '仅定时同步模式可配置 Cron 表达式' });
  }
}

export const createCmsDistributionRuleSchema = cmsDistributionRuleBaseSchema.superRefine(validateCmsDistributionRuleShape);

export const updateCmsDistributionRuleSchema = partialForUpdate(cmsDistributionRuleBaseSchema).superRefine(validateCmsDistributionRuleShape);

export const submitCmsSiteGroupPublishSchema = z.object({
  rootSiteId: z.number().int().positive(),
  reason: z.string().trim().max(500).nullable().default(null),
});

export type CmsSiteInheritanceInput = z.input<typeof cmsSiteInheritanceSchema>;

export type UpdateCmsSiteInheritanceInput = z.input<typeof updateCmsSiteInheritanceSchema>;

export type MoveCmsSiteInput = z.input<typeof moveCmsSiteSchema>;

export type CreateCmsDistributionRuleInput = z.input<typeof createCmsDistributionRuleSchema>;

export type UpdateCmsDistributionRuleInput = z.input<typeof updateCmsDistributionRuleSchema>;

export type SubmitCmsSiteGroupPublishInput = z.input<typeof submitCmsSiteGroupPublishSchema>;

export const cmsModelFieldSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1, '字段标识不能为空').max(50).regex(/^[a-z][a-z0-9_]*$/, '字段标识须以小写字母开头，仅含小写字母/数字/下划线'),
  label: z.string().min(1, '字段名称不能为空').max(100),
  fieldType: z.enum(['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch']).default('text'),
  required: z.boolean().default(false),
  searchable: z.boolean().default(false),
  showInList: z.boolean().default(false),
  /** 是否在前台详情页「模型字段表」中展示 */
  showInDetail: z.boolean().default(false),
  /** 详情展示分组标题（如「文件信息」） */
  detailGroup: z.string().max(50).nullable().optional(),
  /** 详情展示排序（组内） */
  detailSort: z.number().int().default(0),
  placeholder: z.string().max(200).nullable().optional(),
  defaultValue: z.string().max(1000).nullable().optional(),
  /** 选项来源：manual=手工 options；dict=引用系统字典 */
  optionSource: z.enum(CMS_FIELD_OPTION_SOURCES).default('manual'),
  dictCode: z.string().max(64).nullable().optional(),
  options: z.array(z.object({ label: z.string().max(100), value: z.string().max(100) })).nullable().optional(),
  sort: z.number().int().default(0),
}).superRefine((value, ctx) => {
  // 引用字典却没填字典编码 = 该字段永远渲染成空下拉，属于配置错误，保存时即拦下
  if (value.optionSource === 'dict' && !value.dictCode?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['dictCode'], message: '选择「引用系统字典」时必须指定字典' });
  }
});

export const createCmsModelSchema = z.object({
  /** 归属站点：null = 平台共享；非空 = 该站点专属（其他站点不可见/不可绑定） */
  ownerSiteId: z.number().int().positive().nullable().default(null),
  name: z.string().min(1, '模型名称不能为空').max(100),
  code: z.string().min(1, '模型标识不能为空').max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
  fields: z.array(cmsModelFieldSchema).default([]),
});

/** 归属站点创建后不可变更：避免把在用模型静默转移出其他站点的可见范围 */
export const updateCmsModelSchema = partialForUpdate(createCmsModelSchema).omit({ ownerSiteId: true });

export const createCmsChannelSchema = z.object({
  siteId: z.number().int().positive(),
  parentId: z.number().int().min(0).default(0),
  modelId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, '栏目名称不能为空').max(100),
  /** 栏目标识（站内唯一）：留空时服务端按 slug 自动生成 */
  code: z.string().max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线').optional(),
  slug: z.string().min(1, 'URL 标识不能为空').max(100).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  type: z.enum(['list', 'page', 'link']).default('list'),
  linkUrl: cmsLinkUrlSchema.nullable().optional(),
  listTemplate: z.string().max(50).nullable().optional(),
  detailTemplate: z.string().max(50).nullable().optional(),
  /** 静态化模式：inherit = 跟随站点 */
  staticMode: z.enum(CMS_CHANNEL_STATIC_MODES).default('inherit'),
  /** 详情页静态产物目录归档策略 */
  detailPathRule: z.enum(CMS_CHANNEL_DETAIL_PATH_RULES).default('none'),
  pageSize: z.number().int().min(1).max(100).default(20),
  pageContent: z.string().nullable().optional(),
  seoTitle: z.string().max(255).nullable().optional(),
  seoKeywords: z.string().max(500).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  socialImageAlt: z.string().max(255).nullable().optional(),
  twitterCreator: z.string().max(100).regex(/^@?[A-Za-z0-9_]{1,50}$/, 'Twitter/X 作者账号格式无效').nullable().optional(),
  image: cmsAssetUrlSchema.nullable().optional(),
  visible: z.boolean().default(true),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const updateCmsChannelSchema = partialForUpdate(createCmsChannelSchema).omit({ siteId: true });

export const createCmsContentSchema = z.object({
  siteId: z.number().int().positive(),
  channelId: z.number().int().positive(),
  /** 内容形态（创建后不可变更）：article=图文 album=图集 media=音视频 link=外链 */
  contentType: z.enum(['article', 'album', 'media', 'link']).default('article'),
  /** 形态结构化数据：album.images / media.mediaType|mediaUrl|poster|duration */
  mediaData: z.object({
    images: z.array(z.object({
      url: cmsAssetUrlSchema.min(1),
      thumb: cmsAssetUrlSchema.nullable().optional(),
      caption: z.string().max(200).nullable().optional(),
    })).max(100).optional(),
    mediaType: z.enum(['video', 'audio']).optional(),
    mediaUrl: cmsAssetUrlSchema.optional(),
    poster: cmsAssetUrlSchema.optional(),
    duration: z.string().max(20).optional(),
  }).default({}),
  title: z.string().min(1, '标题不能为空').max(255),
  /** 标题样式（加粗 / 颜色）；color 为 #rrggbb */
  titleStyle: z.object({
    bold: z.boolean().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #rrggbb 格式').nullable().optional(),
  }).default({}),
  subTitle: z.string().max(255).nullable().optional(),
  shortTitle: z.string().max(100).nullable().optional(),
  slug: z.string().max(255).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线').nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
  coverImage: cmsAssetUrlSchema.nullable().optional(),
  author: z.string().max(50).nullable().optional(),
  /** 责任编辑 */
  editor: z.string().max(50).nullable().optional(),
  source: z.string().max(100).nullable().optional(),
  sourceUrl: cmsLinkUrlSchema.nullable().optional(),
  isOriginal: z.boolean().default(false),
  body: z.string().nullable().optional(),
  /** 正文附件列表（前台详情页可下载） */
  attachments: z.array(z.object({
    name: z.string().trim().min(1, '附件名称不能为空').max(200),
    url: cmsAssetUrlSchema.trim().min(1, '附件地址不能为空'),
    size: z.number().int().min(0).default(0),
    ext: z.string().trim().max(20).default(''),
    sort: z.number().int().default(0),
  })).max(50, '附件最多 50 个').default([]),
  extend: z.record(z.string(), z.unknown()).default({}),
  externalLink: z.string().max(500).refine(isValidCmsLink, CMS_LINK_FORMAT_MESSAGE).nullable().optional(),
  /** 详情模板覆盖（主题变体模板名；空 = 跟随栏目/站点默认） */
  detailTemplate: z.string().max(50).nullable().optional(),
  /** 自定义静态化相对路径（站内唯一）；空 = 按 slug/id 生成 */
  staticPath: cmsStaticPathSchema,
  isTop: z.boolean().default(false),
  /** 置顶权重（数值越大越靠前，isTop=true 时生效） */
  topWeight: z.number().int().min(0).max(9999).default(0),
  /** 置顶到期时间（到期自动取消置顶；空 = 永久置顶） */
  topExpireAt: z.string().nullable().optional(),
  isRecommend: z.boolean().default(false),
  isHot: z.boolean().default(false),
  scheduledAt: z.string().nullable().optional(),
  /** 过期自动下线时间（空 = 永不过期） */
  expireAt: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  seoTitle: z.string().max(255).nullable().optional(),
  seoKeywords: z.string().max(500).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  tagIds: z.array(z.number().int().positive()).default([]),
  /** 副栏目 id 列表（一文多栏目；不含主栏目） */
  extraChannelIds: z.array(z.number().int().positive()).default([]),
  /** 相关文章 id 列表（手动关联） */
  relatedIds: z.array(z.number().int().positive()).default([]),
});

export const updateCmsContentSchema = partialForUpdate(createCmsContentSchema).omit({ siteId: true, contentType: true }).extend({
  /** 乐观锁：携带读取时的版本号，服务端版本不一致返回 409（不传则跳过检查） */
  expectedVersion: z.number().int().positive().optional(),
});

export const lockCmsContentSchema = z.object({
  reason: z.string().trim().min(1, '请输入锁定原因').max(500),
});

/** 批量状态流转（提审/发布/驳回/下线）；驳回必须携带原因 */
export const batchCmsContentStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '请选择内容').max(100, '单次最多操作 100 条'),
  action: z.enum(['submit', 'publish', 'reject', 'offline']),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'reject' && !value.reason?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: '批量驳回必须填写原因' });
  }
});

export type BatchCmsContentStatusInput = z.input<typeof batchCmsContentStatusSchema>;

export const createCmsTagSchema = z.object({
  siteId: z.number().int().positive(),
  name: z.string().min(1, '标签名称不能为空').max(50),
  slug: z.string().min(1, 'URL 标识不能为空').max(100).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  groupName: z.string().max(50).nullable().optional(),
});

export const updateCmsTagSchema = partialForUpdate(createCmsTagSchema).omit({ siteId: true });

export const createCmsFriendLinkGroupSchema = z.object({
  siteId: z.number().int().positive(),
  name: z.string().min(1, '分组名称不能为空').max(100),
  code: z.string().min(1, '分组标识不能为空').max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
  remark: z.string().max(500).nullable().optional(),
});

export const updateCmsFriendLinkGroupSchema = partialForUpdate(createCmsFriendLinkGroupSchema).omit({ siteId: true });

export const createCmsFriendLinkSchema = z.object({
  siteId: z.number().int().positive(),
  groupId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1, '链接名称不能为空').max(100),
  url: cmsDirectHrefSchema.min(1, '链接地址不能为空'),
  logo: cmsAssetUrlSchema.nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().default(0),
  remark: z.string().max(500).nullable().optional(),
});

export const updateCmsFriendLinkSchema = partialForUpdate(createCmsFriendLinkSchema).omit({ siteId: true });

export type CreateCmsSiteInput = z.input<typeof createCmsSiteSchema>;

export type UpdateCmsSiteInput = z.input<typeof updateCmsSiteSchema>;

export type CmsModelFieldInput = z.input<typeof cmsModelFieldSchema>;

export type CreateCmsModelInput = z.input<typeof createCmsModelSchema>;

export type UpdateCmsModelInput = z.input<typeof updateCmsModelSchema>;

export type CreateCmsChannelInput = z.input<typeof createCmsChannelSchema>;

export type UpdateCmsChannelInput = z.input<typeof updateCmsChannelSchema>;

export type CreateCmsContentInput = z.input<typeof createCmsContentSchema>;

export type UpdateCmsContentInput = z.input<typeof updateCmsContentSchema>;

export type CreateCmsTagInput = z.input<typeof createCmsTagSchema>;

export type UpdateCmsTagInput = z.input<typeof updateCmsTagSchema>;

export type CreateCmsFriendLinkGroupInput = z.input<typeof createCmsFriendLinkGroupSchema>;

export type UpdateCmsFriendLinkGroupInput = z.input<typeof updateCmsFriendLinkGroupSchema>;

export type CreateCmsFriendLinkInput = z.input<typeof createCmsFriendLinkSchema>;

export type UpdateCmsFriendLinkInput = z.input<typeof updateCmsFriendLinkSchema>;

// ─── CMS 发布中心 ─────────────────────────────────────────────────────────────
const cmsTemplateCodeSchema = z.string().min(1).max(64)
  .regex(/^[a-z][a-z0-9-]*$/, '编码须以小写字母开头，仅含小写字母、数字、中划线');

export const submitCmsPublishSchema = z.object({
  siteId: z.number().int().positive(),
  targetType: z.enum(CMS_PUBLISH_TARGET_TYPES),
  contentIds: z.array(z.number().int().positive()).max(500).optional(),
  channelId: z.number().int().positive().optional(),
  pageId: z.number().int().positive().optional(),
  pageSlug: cmsTemplateCodeSchema.max(100).optional(),
  /** 路径/slug 变更时携带的旧静态路径，用于删除失效产物 */
  pageRemovePath: z.string().max(220).optional(),
  pageIsHome: z.boolean().optional(),
  pageRemoved: z.boolean().optional(),
  themeCode: cmsTemplateCodeSchema.max(50).optional(),
  reason: z.string().max(500).optional(),
}).superRefine((value, ctx) => {
  if ((value.targetType === 'content' || value.targetType === 'contents') && !value.contentIds?.length) {
    ctx.addIssue({ code: 'custom', path: ['contentIds'], message: '内容发布必须选择内容' });
  }
  if (value.targetType === 'content' && value.contentIds?.length && value.contentIds.length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['contentIds'], message: '单内容发布必须且只能选择一条内容' });
  }
  if (value.targetType === 'channel' && !value.channelId) {
    ctx.addIssue({ code: 'custom', path: ['channelId'], message: '栏目发布必须选择栏目' });
  }
  if (value.targetType === 'page' && !value.pageId && !value.pageSlug) {
    ctx.addIssue({ code: 'custom', path: ['pageId'], message: '页面发布必须选择页面或提供页面标识' });
  }
});

export const batchCmsPublishActionSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  action: z.enum(CMS_PUBLISH_ACTIONS),
});

export type SubmitCmsPublishInput = z.input<typeof submitCmsPublishSchema>;

// ─── CMS P2 Schema ────────────────────────────────────────────────────────────
export const createCmsRedirectSchema = z.object({
  siteId: z.number().int().positive(),
  fromPath: z.string().min(1, '来源路径不能为空').max(500).regex(/^\//, '来源路径须以 / 开头'),
  toUrl: cmsLinkUrlSchema.min(1, '目标地址不能为空'),
  redirectType: z.union([z.literal(301), z.literal(302)]).default(301),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullable().optional(),
});

export const updateCmsRedirectSchema = partialForUpdate(createCmsRedirectSchema).omit({ siteId: true });

export const createCmsLinkWordSchema = z.object({
  siteId: z.number().int().positive(),
  keyword: z.string().min(1, '关键词不能为空').max(50),
  url: cmsDirectHrefSchema.min(1, '链接地址不能为空'),
  maxReplaces: z.number().int().min(1).max(10).default(1),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateCmsLinkWordSchema = partialForUpdate(createCmsLinkWordSchema).omit({ siteId: true });

export const createCmsAdSlotSchema = z.object({
  siteId: z.number().int().positive(),
  code: z.string().min(1, '标识不能为空').max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  name: z.string().min(1, '名称不能为空').max(100),
  remark: z.string().max(200).nullable().optional(),
});

export const updateCmsAdSlotSchema = partialForUpdate(createCmsAdSlotSchema).omit({ siteId: true });

export const createCmsAdSchema = z.object({
  slotId: z.number().int().positive(),
  name: z.string().min(1, '广告名称不能为空').max(100),
  image: cmsAssetUrlSchema.nullable().optional(),
  linkUrl: cmsDirectHrefSchema.nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateCmsAdSchema = partialForUpdate(createCmsAdSchema);

export const cleanupCmsAdEventsSchema = z.object({
  siteId: z.number().int().positive().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});

export const cmsFormFieldSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_]*$/, '字段标识须以小写字母开头'),
  label: z.string().min(1).max(100),
  fieldType: z.enum(['text', 'textarea', 'select', 'radio', 'email', 'mobile', 'url', 'number']).default('text'),
  required: z.boolean().default(false),
  options: z.array(z.object({ label: z.string().max(100), value: z.string().max(100) })).nullable().optional(),
  minLength: z.number().int().min(0).max(2000).nullable().optional(),
  maxLength: z.number().int().min(1).max(2000).nullable().optional(),
  pattern: z.string().max(200)
    .refine((value) => !/[\0\r\n]/.test(value), '规则不能包含控制字符或换行')
    .nullable().optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  errorMessage: z.string().max(200).nullable().optional(),
}).superRefine((field, ctx) => {
  if (field.minLength != null && field.maxLength != null && field.minLength > field.maxLength) {
    ctx.addIssue({ code: 'custom', path: ['maxLength'], message: '最大长度不能小于最小长度' });
  }
  if (field.min != null && field.max != null && field.min > field.max) {
    ctx.addIssue({ code: 'custom', path: ['max'], message: '最大值不能小于最小值' });
  }
});

const cmsFormFieldsSchema = z.array(cmsFormFieldSchema).superRefine((fields, ctx) => {
  const seen = new Map<string, number>();
  fields.forEach((field, index) => {
    const previous = seen.get(field.name);
    if (previous !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'name'],
        message: `字段标识不能重复（已在第 ${previous + 1} 项使用）`,
      });
    } else {
      seen.set(field.name, index);
    }
  });
});

const cmsFormBaseSchema = z.object({
  siteId: z.number().int().positive(),
  code: z.string().min(1, '表单标识不能为空').max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  name: z.string().min(1, '表单名称不能为空').max(100),
  fields: cmsFormFieldsSchema.min(1, '至少配置一个字段').default([]),
  successMessage: z.string().max(255).nullable().optional(),
  notifyEmail: z.string().max(255).nullable().optional(),
  captchaProvider: z.enum(['inherit', 'none', 'math', 'turnstile']).default('inherit'),
  turnstileSiteKey: z.string().max(200).nullable().optional(),
  turnstileSecret: z.string().max(500).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const createCmsFormSchema = cmsFormBaseSchema.superRefine((form, ctx) => {
  if (form.captchaProvider === 'turnstile' && !form.turnstileSiteKey?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['turnstileSiteKey'], message: 'Turnstile Site Key 不能为空' });
  }
});

export const updateCmsFormSchema = partialForUpdate(cmsFormBaseSchema).omit({ siteId: true });

export const createCmsSensitiveWordSchema = z.object({
  word: z.string().min(1, '敏感词不能为空').max(50),
  replaceWith: z.string().max(50).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateCmsSensitiveWordSchema = partialForUpdate(createCmsSensitiveWordSchema);

export const createCmsErrorProneWordSchema = z.object({
  word: z.string().min(1, '易错词不能为空').max(50),
  correction: z.string().min(1, '正确写法不能为空').max(50),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullable().optional(),
});

export const updateCmsErrorProneWordSchema = partialForUpdate(createCmsErrorProneWordSchema);

// ─── CMS Stage 4：统一互动问卷 ────────────────────────────────────────────────
export const cmsInteractionOptionSchema = z.strictObject({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, '选项 id 仅支持字母、数字、下划线和中划线'),
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(100),
});

export const cmsInteractionMatrixRowSchema = z.strictObject({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, '矩阵行 id 仅支持字母、数字、下划线和中划线'),
  label: z.string().trim().min(1).max(100),
});

export const cmsInteractionVisibleWhenSchema = z.strictObject({
  questionIndex: z.number().int().min(0).max(99),
  op: z.enum(CMS_INTERACTION_CONDITION_OPS).default('any'),
  values: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
});

export const cmsInteractionQuestionSchema = z.strictObject({
  id: z.number().int().positive().optional(),
  label: z.string().min(1, '题目不能为空').max(200),
  type: z.enum(CMS_INTERACTION_QUESTION_TYPES).default('single'),
  required: z.boolean().default(true),
  options: z.array(cmsInteractionOptionSchema).max(50).default([]),
  minChoices: z.number().int().min(0).max(50).default(1),
  maxChoices: z.number().int().min(1).max(50).default(1),
  sort: z.number().int().default(0),
  allowOther: z.boolean().default(false),
  otherLabel: z.string().trim().max(50).nullable().optional(),
  ratingMax: z.number().int().min(2).max(CMS_INTERACTION_RATING_MAX_LIMIT).default(5),
  matrixRows: z.array(cmsInteractionMatrixRowSchema).max(30).default([]),
  pageNo: z.number().int().min(1).max(50).default(1),
  visibleWhen: cmsInteractionVisibleWhenSchema.nullable().optional(),
});

const cmsInteractionBaseSchema = z.object({
  siteId: z.number().int().positive(),
  code: z.string().min(1, '互动标识不能为空').max(50).regex(cmsSlugRegex, '标识仅支持小写字母、数字、中划线'),
  kind: z.enum(['survey', 'poll']).default('survey'),
  title: z.string().min(1, '标题不能为空').max(200),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'published', 'closed']).default('draft'),
  participantScope: z.enum(['anonymous', 'member']).default('anonymous'),
  repeatPolicy: z.enum(['once_per_member', 'once_per_ip', 'multiple']).default('once_per_ip'),
  resultVisibility: z.enum(['always', 'after_submit', 'after_close', 'hidden']).default('after_submit'),
  captchaPolicy: z.enum(['inherit', 'none', 'math', 'turnstile']).default('inherit'),
  turnstileSiteKey: z.string().trim().max(200).nullable().optional(),
  turnstileSecret: z.string().trim().max(500).nullable().optional(),
  thankYouMessage: z.string().trim().min(1).max(500).default('感谢您的参与！'),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  questions: z.array(cmsInteractionQuestionSchema).min(1, '至少配置一道题目').max(100),
});

function validateCmsInteractionDefinition(
  value: z.infer<typeof cmsInteractionBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (value.repeatPolicy === 'once_per_member' && value.participantScope !== 'member') {
    ctx.addIssue({ code: 'custom', path: ['repeatPolicy'], message: '每位会员一次仅适用于仅会员参与' });
  }
  if (value.startAt && value.endAt && value.startAt > value.endAt) {
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: '结束时间不能早于开始时间' });
  }
  if (value.captchaPolicy === 'turnstile') {
    if (!value.turnstileSiteKey?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['turnstileSiteKey'], message: 'Turnstile Site Key 不能为空' });
    }
    if (!value.turnstileSecret?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['turnstileSecret'], message: 'Turnstile Secret Key 不能为空' });
    }
  }
  if (value.kind === 'poll' && value.questions.length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: '投票必须且只能包含一道选择题' });
  }
  value.questions.forEach((question, index) => {
    const isChoice = (CMS_INTERACTION_CHOICE_QUESTION_TYPES as readonly string[]).includes(question.type);
    if (value.kind === 'poll' && question.type !== 'single' && question.type !== 'multiple') {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'type'], message: '投票只支持单选或多选题' });
    }
    if (!isChoice && question.options.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: '该题型不能配置选项' });
    }
    if (isChoice && question.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: '选择题至少配置两个选项' });
    }
    if (question.type === 'single' && (question.minChoices > 1 || question.maxChoices > 1)) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'maxChoices'], message: '单选题只能选择一项' });
    }
    if (question.type === 'multiple'
      && (question.minChoices > question.maxChoices || question.maxChoices > question.options.length)) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'maxChoices'], message: '选择数量范围无效' });
    }
    if (question.type === 'matrix' && question.matrixRows.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'matrixRows'], message: '矩阵题至少配置一行' });
    }
    if (question.type !== 'matrix' && question.matrixRows.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'matrixRows'], message: '仅矩阵题可配置行' });
    }
    if (question.allowOther && question.type !== 'single' && question.type !== 'multiple') {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'allowOther'], message: '仅单选/多选题支持「其他」填空' });
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    const optionValues = new Set(question.options.map((option) => option.value));
    if (optionIds.size !== question.options.length || optionValues.size !== question.options.length) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: '选项 id 与 value 必须唯一' });
    }
    if (question.options.some((option) => option.value.startsWith(CMS_INTERACTION_OTHER_VALUE))) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: `选项 value 不能以 ${CMS_INTERACTION_OTHER_VALUE} 开头` });
    }
    const rowIds = new Set(question.matrixRows.map((row) => row.id));
    if (rowIds.size !== question.matrixRows.length) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'matrixRows'], message: '矩阵行 id 必须唯一' });
    }
    if (question.visibleWhen) {
      // 条件只能依赖排在前面的题目，避免循环依赖与前台渲染顺序问题
      if (question.visibleWhen.questionIndex >= index) {
        ctx.addIssue({ code: 'custom', path: ['questions', index, 'visibleWhen'], message: '条件显示只能依赖排在前面的题目' });
      } else {
        const source = value.questions[question.visibleWhen.questionIndex];
        if (source && source.type !== 'single' && source.type !== 'multiple') {
          ctx.addIssue({ code: 'custom', path: ['questions', index, 'visibleWhen'], message: '条件显示只能依赖单选或多选题' });
        }
      }
    }
    if (question.pageNo > 1 && value.kind === 'poll') {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'pageNo'], message: '投票不支持分页' });
    }
  });
  // 页码必须从 1 开始且连续，避免出现空白页
  const pages = [...new Set(value.questions.map((question) => question.pageNo))].sort((a, b) => a - b);
  if (pages.length > 0 && pages.some((page, index) => page !== index + 1)) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: '分页页码必须从 1 开始且连续' });
  }
}

export const createCmsInteractionSchema = cmsInteractionBaseSchema.superRefine(validateCmsInteractionDefinition);

export const updateCmsInteractionSchema = partialForUpdate(cmsInteractionBaseSchema).omit({ siteId: true, code: true });

/** 前台统一答卷提交：key = 题目 id 字符串。 */
export const submitCmsInteractionSchema = z.object({
  // 数组项需容纳 `rowId::optionValue`（矩阵）与 `__other__:自由文本`（其他填空）
  answers: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(300)).max(50)])),
  captchaId: z.string().max(128).optional(),
  captchaAnswer: z.string().max(32).optional(),
  turnstileToken: z.string().max(4096).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const batchCmsInteractionStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  status: z.enum(['published', 'closed']),
});

// ─── CMS Stage 4：会员订阅 ────────────────────────────────────────────────────
export const cmsSubscriptionSubjectSchema = z.object({
  siteId: z.number().int().positive(),
  subjectType: z.enum(['site', 'channel', 'author']),
  subjectId: z.number().int().positive().nullable().optional(),
  subjectKey: z.string().trim().max(255).nullable().optional(),
  notificationEnabled: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if ((value.subjectType === 'site' || value.subjectType === 'channel') && !value.subjectId) {
    ctx.addIssue({ code: 'custom', path: ['subjectId'], message: '站点/栏目订阅必须指定对象 ID' });
  }
  if (value.subjectType === 'author' && !value.subjectKey?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['subjectKey'], message: '作者订阅必须指定作者名称' });
  }
});

export const updateCmsSubscriptionSchema = z.object({
  notificationEnabled: z.boolean(),
});

// ─── CMS Stage 4：页面区块 ACL 与公开展示条件 ────────────────────────────────
export const cmsPageBlockDisplayConditionSchema = z.object({
  audience: z.enum(['always', 'guest', 'member']).default('always'),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.startAt && value.endAt && value.startAt > value.endAt) {
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: '展示结束时间不能早于开始时间' });
  }
});

export const cmsPageBlockSchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  type: z.enum(['hero', 'richtext', 'image', 'content-list', 'columns', 'widget-ref']),
  props: z.record(z.string(), z.unknown()),
  displayCondition: cmsPageBlockDisplayConditionSchema.optional(),
}).superRefine((block, ctx) => {
  // Keep the block payload extensible, but every conventionally URL-bearing
  // property must still pass the shared policy before it can reach SSR HTML.
  const inspect = (value: unknown, path: (string | number)[]) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, [...path, index]));
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = [...path, key];
      if (typeof nested === 'string' && /(?:url|src|image)$/i.test(key) && nested.trim() !== ''
        && !((/(?:src|image|poster|logo|icon)$/i.test(key) ? isValidCmsAssetUrl(nested.trim()) : isValidCmsLink(nested.trim())))) {
        ctx.addIssue({ code: 'custom', path: nextPath, message: CMS_LINK_FORMAT_MESSAGE });
      } else {
        inspect(nested, nextPath);
      }
    }
  };
  inspect(block.props, ['props']);
});

/**
 * 搭建页自定义访问路径。
 *
 * 归一为「无前后斜杠、无 /index.html 后缀」的形态存库，让 URL 生成、静态产物路径与前台
 * 路由查表三处用同一个 key，避免 `about` / `about/` / `about/index.html` 三写不一致。
 * 保留段在此拦掉，站点内唯一与栏目冲突由 service 层查库校验。
 */
export const cmsPagePathSchema = z.string().trim().max(200)
  .transform((raw) => {
    const cleaned = raw.replace(/^\/+|\/+$/g, '').replace(/\/index\.html$/i, '');
    return cleaned === '' ? null : cleaned;
  })
  .refine((v) => v === null || /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*(?:\.html)?$/.test(v), {
    message: '访问路径仅支持小写字母、数字、中划线与斜杠分段，可选 .html 结尾',
  })
  .refine((v) => v === null || !CMS_PAGE_RESERVED_PATH_PREFIXES.includes(v.split('/')[0] as never), {
    message: '访问路径首段为系统保留字，请更换',
  })
  .refine((v) => v !== 'index.html', { message: '访问路径不能是 index.html（会覆盖站点首页）' })
  .nullish();

export const createCmsPageSchema = z.object({
  siteId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(cmsSlugRegex, 'slug 仅允许小写字母、数字、中划线'),
  path: cmsPagePathSchema,
  isHome: z.boolean().default(false),
  blocks: z.array(cmsPageBlockSchema).max(50).default([]),
  seoTitle: z.string().max(255).nullish(),
  seoKeywords: z.string().max(500).nullish(),
  seoDescription: z.string().max(500).nullish(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullish(),
});

export const updateCmsPageSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().trim().min(1).max(100).regex(cmsSlugRegex, 'slug 仅允许小写字母、数字、中划线').optional(),
  path: cmsPagePathSchema,
  isHome: z.boolean().optional(),
  blocks: z.array(cmsPageBlockSchema).max(50).optional(),
  seoTitle: z.string().max(255).nullish(),
  seoKeywords: z.string().max(500).nullish(),
  seoDescription: z.string().max(500).nullish(),
  status: z.enum(['enabled', 'disabled']).optional(),
  remark: z.string().max(200).nullish(),
});

export const setCmsPageBlockAclSchema = z.object({
  blockIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  grants: z.array(z.strictObject({
    subjectType: z.enum(['user', 'role']),
    subjectId: z.number().int().positive(),
  })).max(200),
});

// ─── CMS 页面部件 ─────────────────────────────────────────────────────────────
export const cmsWidgetItemSchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  sourceType: z.enum(CMS_WIDGET_SOURCE_TYPES),
  sourceId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().max(255).nullable().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  url: cmsLinkUrlSchema.trim().nullable().optional(),
  image: cmsAssetUrlSchema.trim().nullable().optional(),
  displayDate: z.string().regex(DATE_TIME_PATTERN, '时间格式应为 YYYY-MM-DD HH:mm:ss').nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.sourceType === 'manual') {
    if (value.sourceId != null) {
      ctx.addIssue({ code: 'custom', path: ['sourceId'], message: '手工条目不能指定来源 ID' });
    }
    if (!value.title?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: '手工条目标题不能为空' });
    }
  } else if (!value.sourceId) {
    ctx.addIssue({ code: 'custom', path: ['sourceId'], message: '内容或栏目条目必须指定来源 ID' });
  }
});

export const cmsWidgetDataSchema = z.strictObject({
  items: z.array(cmsWidgetItemSchema).max(100),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (ids.has(item.id)) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: '页面部件条目 id 不能重复' });
    }
    ids.add(item.id);
  });
});

const cmsWidgetEditableSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(100).regex(cmsSlugRegex, '编码仅允许小写字母、数字、中划线'),
  draftData: cmsWidgetDataSchema,
  defaultRendererKey: z.enum(CMS_WIDGET_RENDERER_KEYS),
  remark: z.string().trim().max(200).nullable().optional(),
});

export const createCmsWidgetSchema = cmsWidgetEditableSchema.extend({
  siteId: z.number().int().positive(),
  type: z.enum(CMS_WIDGET_TYPES).default('manual-list'),
  draftData: cmsWidgetDataSchema.default({ items: [] }),
  defaultRendererKey: z.enum(CMS_WIDGET_RENDERER_KEYS).default('list-sidebar'),
});

export const updateCmsWidgetSchema = z.strictObject({
  ...partialForUpdate(cmsWidgetEditableSchema.omit({ code: true })).shape,
  expectedRevision: z.number().int().positive(),
});

export const batchCmsWidgetSchema = z.strictObject({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  action: z.enum(['publish', 'offline', 'delete']),
});

export const cmsWidgetRefOwnerTypeSchema = z.enum(CMS_WIDGET_REF_OWNER_TYPES);

export const submitCmsCommentSchema = z.object({
  contentId: z.coerce.number().int().positive(),
  nickname: z.string().min(1, '昵称不能为空').max(50),
  content: z.string().min(1, '评论内容不能为空').max(1000),
  /** 回复的父评论 id（0/缺省 = 顶级评论） */
  parentId: z.coerce.number().int().min(0).optional(),
  /** 蜜罐字段：正常用户不可见不填写，机器人填写即拒绝 */
  website: z.string().max(0, '提交被拒绝').optional(),
});

export type CreateCmsRedirectInput = z.input<typeof createCmsRedirectSchema>;

export type UpdateCmsRedirectInput = z.input<typeof updateCmsRedirectSchema>;

export type CreateCmsLinkWordInput = z.input<typeof createCmsLinkWordSchema>;

export type UpdateCmsLinkWordInput = z.input<typeof updateCmsLinkWordSchema>;

export type CreateCmsAdSlotInput = z.input<typeof createCmsAdSlotSchema>;

export type UpdateCmsAdSlotInput = z.input<typeof updateCmsAdSlotSchema>;

export type CreateCmsAdInput = z.input<typeof createCmsAdSchema>;

export type UpdateCmsAdInput = z.input<typeof updateCmsAdSchema>;

export type CleanupCmsAdEventsInput = z.input<typeof cleanupCmsAdEventsSchema>;

export type CmsFormFieldInput = z.input<typeof cmsFormFieldSchema>;

export type CreateCmsFormInput = z.input<typeof createCmsFormSchema>;

export type UpdateCmsFormInput = z.input<typeof updateCmsFormSchema>;

export type CreateCmsSensitiveWordInput = z.input<typeof createCmsSensitiveWordSchema>;

export type UpdateCmsSensitiveWordInput = z.input<typeof updateCmsSensitiveWordSchema>;

export type CreateCmsErrorProneWordInput = z.input<typeof createCmsErrorProneWordSchema>;

export type UpdateCmsErrorProneWordInput = z.input<typeof updateCmsErrorProneWordSchema>;

export type CmsInteractionOptionInput = z.input<typeof cmsInteractionOptionSchema>;

export type CmsInteractionQuestionInput = z.input<typeof cmsInteractionQuestionSchema>;

export type CreateCmsInteractionInput = z.input<typeof createCmsInteractionSchema>;

export type UpdateCmsInteractionInput = z.input<typeof updateCmsInteractionSchema>;

export type SubmitCmsInteractionInput = z.input<typeof submitCmsInteractionSchema>;

export type BatchCmsInteractionStatusInput = z.input<typeof batchCmsInteractionStatusSchema>;

export type CmsSubscriptionSubjectInput = z.input<typeof cmsSubscriptionSubjectSchema>;

export type UpdateCmsSubscriptionInput = z.input<typeof updateCmsSubscriptionSchema>;

export type CmsPageBlockInput = z.input<typeof cmsPageBlockSchema>;

export type CreateCmsPageInput = z.input<typeof createCmsPageSchema>;

export type UpdateCmsPageInput = z.input<typeof updateCmsPageSchema>;

export type SetCmsPageBlockAclInput = z.input<typeof setCmsPageBlockAclSchema>;

export type CmsWidgetItemInput = z.input<typeof cmsWidgetItemSchema>;

export type CmsWidgetDataInput = z.input<typeof cmsWidgetDataSchema>;

export type CreateCmsWidgetInput = z.input<typeof createCmsWidgetSchema>;

export type UpdateCmsWidgetInput = z.input<typeof updateCmsWidgetSchema>;

export type BatchCmsWidgetInput = z.input<typeof batchCmsWidgetSchema>;

export type SubmitCmsCommentInput = z.input<typeof submitCmsCommentSchema>;

// ─── CMS 素材中心（P2）────────────────────────────────────────────────────────
export const updateCmsResourceSchema = z.object({
  name: z.string().min(1, '素材名称不能为空').max(255).optional(),
  remark: z.string().max(200).nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
});

export const createCmsResourceFolderSchema = z.object({
  siteId: z.number().int().positive(),
  parentId: z.number().int().positive().nullable().default(null),
  name: z.string().trim().min(1, '文件夹名称不能为空').max(100),
  sort: z.number().int().default(0),
});

export const updateCmsResourceFolderSchema = partialForUpdate(createCmsResourceFolderSchema).omit({ siteId: true });

export const moveCmsResourcesSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  folderId: z.number().int().positive().nullable(),
});

/** 图片裁剪（像素坐标，基于原图） */
export const cropCmsResourceSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  width: z.number().int().min(8, '裁剪宽度至少 8px'),
  height: z.number().int().min(8, '裁剪高度至少 8px'),
});

export type UpdateCmsResourceInput = z.input<typeof updateCmsResourceSchema>;

export type CropCmsResourceInput = z.input<typeof cropCmsResourceSchema>;

export type CreateCmsResourceFolderInput = z.input<typeof createCmsResourceFolderSchema>;

export type UpdateCmsResourceFolderInput = z.input<typeof updateCmsResourceFolderSchema>;

export type MoveCmsResourcesInput = z.input<typeof moveCmsResourcesSchema>;

// ─── CMS P3 Batch1 Schema ─────────────────────────────────────────────────────
export const createCmsSearchWordSchema = z.object({
  siteId: z.number().int().positive(),
  word: z.string().trim().min(1, '词条不能为空').max(50)
    .regex(CMS_SEARCH_DICTIONARY_WORD_PATTERN, '词条仅允许字母、数字、中文及 _ + . # -，且不能包含空白'),
  type: z.enum(['extension', 'stop']).default('extension'),
  groupName: z.string().trim().min(1).max(100).default('默认分组'),
  weight: z.number().int().min(1).max(999999).default(1000),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullable().optional(),
});

export const updateCmsSearchWordSchema = partialForUpdate(createCmsSearchWordSchema).omit({ siteId: true });

export const batchUpdateCmsSearchWordsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  status: z.enum(['enabled', 'disabled']).optional(),
  groupName: z.string().trim().min(1).max(100).optional(),
}).refine((value) => value.status !== undefined || value.groupName !== undefined, {
  message: '至少指定一个批量更新字段',
});

export const createCmsHotwordGroupSchema = z.object({
  siteId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateCmsHotwordGroupSchema = partialForUpdate(createCmsHotwordGroupSchema).omit({ siteId: true });

export const createCmsHotwordSchema = z.object({
  siteId: z.number().int().positive(),
  groupId: z.number().int().positive().nullable().optional(),
  keyword: z.string().trim().min(1).max(100),
  sort: z.number().int().default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateCmsHotwordSchema = partialForUpdate(createCmsHotwordSchema).omit({ siteId: true });

export type CreateCmsSearchWordInput = z.input<typeof createCmsSearchWordSchema>;

export type UpdateCmsSearchWordInput = z.input<typeof updateCmsSearchWordSchema>;

export type BatchUpdateCmsSearchWordsInput = z.input<typeof batchUpdateCmsSearchWordsSchema>;

export type CreateCmsHotwordGroupInput = z.input<typeof createCmsHotwordGroupSchema>;

export type UpdateCmsHotwordGroupInput = z.input<typeof updateCmsHotwordGroupSchema>;

export type CreateCmsHotwordInput = z.input<typeof createCmsHotwordSchema>;

export type UpdateCmsHotwordInput = z.input<typeof updateCmsHotwordSchema>;

// ─── CMS 采集规则（CMS 为平台级全局模块）──────────────────────────────────────
export const createCmsCollectRuleSchema = z.object({
  siteId: z.number().int().positive(),
  channelId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  listUrl: httpUrl().max(500),
  pageStart: z.number().int().min(1).default(1),
  pageEnd: z.number().int().min(1).default(1),
  listSelector: z.string().min(1).max(200),
  titleSelector: z.string().min(1).max(200),
  bodySelector: z.string().min(1).max(200),
  summarySelector: z.string().max(200).nullish(),
  coverSelector: z.string().max(200).nullish(),
  removeSelectors: z.array(z.string().max(200)).max(20).default([]),
  autoPublish: z.boolean().default(false),
  localizeImages: z.boolean().default(false),
  maxItems: z.number().int().min(1).max(200).default(50),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullish(),
}).refine((value) => value.pageEnd >= value.pageStart, {
  message: '结束页不能小于起始页',
  path: ['pageEnd'],
});

export const updateCmsCollectRuleSchema = z.object({
  channelId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100).optional(),
  listUrl: httpUrl().max(500).optional(),
  pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(),
  listSelector: z.string().min(1).max(200).optional(),
  titleSelector: z.string().min(1).max(200).optional(),
  bodySelector: z.string().min(1).max(200).optional(),
  summarySelector: z.string().max(200).nullish(),
  coverSelector: z.string().max(200).nullish(),
  removeSelectors: z.array(z.string().max(200)).max(20).optional(),
  autoPublish: z.boolean().optional(),
  localizeImages: z.boolean().optional(),
  maxItems: z.number().int().min(1).max(200).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  remark: z.string().max(200).nullish(),
});

export type CreateCmsCollectRuleInput = z.input<typeof createCmsCollectRuleSchema>;

export type UpdateCmsCollectRuleInput = z.input<typeof updateCmsCollectRuleSchema>;

// ─── 站点级操作入参 ────────────────────────────────────────────────────────────
/** 只携带站点 ID 的操作请求体（全站静态化 / 死链检测 / 清空热词 / 重建素材引用索引） */
export const cmsSiteIdBodySchema = z.object({
  siteId: z.number().int().positive(),
});

export type CmsSiteIdBodyInput = z.input<typeof cmsSiteIdBodySchema>;

/** 站点 / 栏目授权用户全量赋值 */
export const setCmsAuthorizedUsersSchema = z.object({
  userIds: z.array(z.number().int().positive()),
});

export type SetCmsAuthorizedUsersInput = z.input<typeof setCmsAuthorizedUsersSchema>;

/** 站点导出包（GET /api/cms/sites/{id}/export 的产物）原样回传导入 */
export const cmsSiteImportPackageSchema = z.looseObject({}).meta({ description: '站点导出包 JSON（GET /api/cms/sites/{id}/export 的产物）' });

export type CmsSiteImportPackageInput = z.input<typeof cmsSiteImportPackageSchema>;

/** 按 clientId upsert 开放应用对站点的写入授权 */
export const saveCmsOpenAppGrantSchema = z.object({
  clientId: z.string().min(1).max(64).meta({ description: '开放应用 AppKey' }),
  channelIds: z.array(z.number().int().positive()).default([]).meta({ description: '空数组 = 该站点全部栏目' }),
  canPublish: z.boolean().default(false).meta({ description: '允许直接发布；还需应用持有 cms:publish 且站点开启「允许开放 API 直接发布」' }),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullable().optional(),
});

export type SaveCmsOpenAppGrantInput = z.input<typeof saveCmsOpenAppGrantSchema>;

// ─── 栏目运维入参 ──────────────────────────────────────────────────────────────
export const mergeCmsChannelsSchema = z.object({
  sourceIds: z.array(z.number().int().positive()).min(1, '请选择来源栏目'),
  targetId: z.number().int().positive(),
});

export type MergeCmsChannelsInput = z.input<typeof mergeCmsChannelsSchema>;

export const batchCreateCmsChannelsSchema = z.object({
  siteId: z.number().int().positive(),
  parentId: z.number().int().min(0).default(0),
  names: z.array(z.string().min(1).max(160)).min(1, '请输入栏目名称').max(50, '单次最多创建 50 个栏目'),
  /** slug 生成策略：initials=首字母缩写（政务公开→zwgk）；pinyin=逐字全拼 */
  slugStrategy: z.enum(['initials', 'pinyin']).default('initials'),
});

export type BatchCreateCmsChannelsInput = z.input<typeof batchCreateCmsChannelsSchema>;

// ─── 内容操作入参 ──────────────────────────────────────────────────────────────
export const rejectCmsContentSchema = z.object({
  reason: z.string().min(1, '驳回原因不能为空').max(500),
});

export type RejectCmsContentInput = z.input<typeof rejectCmsContentSchema>;

export const batchMoveCmsContentsSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  channelId: z.number().int().positive(),
});

export type BatchMoveCmsContentsInput = z.input<typeof batchMoveCmsContentsSchema>;

export const batchCmsContentFlagsSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  isTop: z.boolean().optional(),
  isRecommend: z.boolean().optional(),
  isHot: z.boolean().optional(),
  isOriginal: z.boolean().optional(),
});

export type BatchCmsContentFlagsInput = z.input<typeof batchCmsContentFlagsSchema>;

export const batchTagCmsContentsSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  tagIds: z.array(z.number().int()).min(1),
});

export type BatchTagCmsContentsInput = z.input<typeof batchTagCmsContentsSchema>;

export const duplicateCmsContentSchema = z.object({
  /** 目标栏目（同站点）；留空复制到原栏目 */
  targetChannelId: z.number().int().positive().optional(),
});

export type DuplicateCmsContentInput = z.input<typeof duplicateCmsContentSchema>;

export const distributeCmsContentsSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  targetSiteId: z.number().int().positive(),
  targetChannelId: z.number().int().positive(),
});

export type DistributeCmsContentsInput = z.input<typeof distributeCmsContentsSchema>;

export const checkCmsTextSchema = z.object({
  text: z.string().max(200_000, '检查文本过长'),
});

export type CheckCmsTextInput = z.input<typeof checkCmsTextSchema>;

// ─── 检索 / SEO 入参 ──────────────────────────────────────────────────────────
export const reindexCmsSearchSchema = z.object({
  siteId: z.number().int().positive().nullable().optional(),
});

export type ReindexCmsSearchInput = z.input<typeof reindexCmsSearchSchema>;

export const batchDeleteCmsSearchWordsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});

export type BatchDeleteCmsSearchWordsInput = z.input<typeof batchDeleteCmsSearchWordsSchema>;

export const pushCmsUrlsSchema = z.object({
  siteId: z.number().int().positive(),
  urls: z.array(z.string().min(1).max(500)).min(1, '至少填写一个 URL').max(2000),
  engines: z.array(z.enum(['baidu', 'indexnow'])).optional(),
});

export type PushCmsUrlsInput = z.input<typeof pushCmsUrlsSchema>;

// ─── 素材治理入参 ──────────────────────────────────────────────────────────────
export const cmsResourceGovernanceSchema = z.object({
  siteId: z.number().int().positive(),
  operation: z.enum(['scan', 'cleanup']),
  dryRun: z.boolean().default(true),
});

export type CmsResourceGovernanceInput = z.input<typeof cmsResourceGovernanceSchema>;

/** 批量移动素材（任务中心执行）；siteId 用于访问校验 */
export const submitMoveCmsResourcesSchema = moveCmsResourcesSchema.extend({
  siteId: z.number().int().positive(),
});

export type SubmitMoveCmsResourcesInput = z.input<typeof submitMoveCmsResourcesSchema>;

// ─── 互动问卷入参 ──────────────────────────────────────────────────────────────
export const setCmsInteractionStatusSchema = z.object({
  status: z.enum(['draft', 'published', 'closed']),
});

export type SetCmsInteractionStatusInput = z.input<typeof setCmsInteractionStatusSchema>;

// ─── 会员投稿入参 ──────────────────────────────────────────────────────────────
export const createCmsContributionSchema = z.object({
  siteId: z.number().int().positive(),
  channelId: z.number().int().positive(),
  title: z.string().min(1, '请输入标题').max(255),
  summary: z.string().max(500).optional(),
  body: z.string().min(1, '请输入正文').max(50000),
});

export type CreateCmsContributionInput = z.input<typeof createCmsContributionSchema>;

/** 修改投稿：站点随原稿不可变更 */
export const updateCmsContributionSchema = createCmsContributionSchema.omit({ siteId: true });

export type UpdateCmsContributionInput = z.input<typeof updateCmsContributionSchema>;

// ─── 前台广告事件令牌入参 ──────────────────────────────────────────────────────
export const issueCmsAdEventTokensSchema = z.object({
  ads: z.array(z.object({
    adId: z.number().int().positive(),
    renderProof: z.string().max(4096).meta({ description: '页面渲染时随广告下发的签名凭证' }),
  })).max(50).default([]),
});

export type IssueCmsAdEventTokensInput = z.input<typeof issueCmsAdEventTokensSchema>;

// ─── Headless 开放 API 写入入参 ───────────────────────────────────────────────
const openCmsLinkSchema = z.string().max(500).refine(isValidCmsLink, CMS_LINK_FORMAT_MESSAGE).nullable().optional();
const openCmsAssetSchema = z.string().trim().max(500).refine(isValidCmsAssetUrl, CMS_LINK_FORMAT_MESSAGE).nullable().optional();

export const openCmsContentWriteSchema = z.object({
  channel: z.string().min(1).max(50).meta({ description: '目标栏目标识（须在应用授权的栏目白名单内）' }),
  title: z.string().min(1).max(255),
  subTitle: z.string().max(255).nullable().optional(),
  shortTitle: z.string().max(100).nullable().optional(),
  slug: z.string().max(255).nullable().optional(),
  summary: z.string().max(2000).nullable().optional(),
  coverImage: openCmsAssetSchema,
  author: z.string().max(50).nullable().optional(),
  editor: z.string().max(50).nullable().optional(),
  source: z.string().max(100).nullable().optional(),
  sourceUrl: openCmsLinkSchema,
  body: z.string().nullable().optional(),
  extend: z.record(z.string(), z.unknown()).optional(),
  externalLink: openCmsLinkSchema,
  seoTitle: z.string().max(255).nullable().optional(),
  seoKeywords: z.string().max(500).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  publish: z.boolean().optional().meta({ description: '直接发布；需 cms:publish scope + 授权行 canPublish + 站点开关三者同时成立' }),
}).meta({ id: 'CmsOpenContentWrite' });

export type OpenCmsContentWriteInput = z.input<typeof openCmsContentWriteSchema>;

/** 更新不接受 publish：状态流转必须走显式的 /publish 端点 */
export const openCmsContentUpdateSchema = partialForUpdate(openCmsContentWriteSchema.omit({ publish: true })).extend({
  expectedVersion: z.number().int().positive().optional().meta({ description: '与当前 version 不一致返回 409' }),
});

export type OpenCmsContentUpdateInput = z.input<typeof openCmsContentUpdateSchema>;
