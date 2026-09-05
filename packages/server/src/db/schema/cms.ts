import { pgTable, varchar, timestamp, pgEnum, integer, boolean, primaryKey, text, jsonb, uniqueIndex, index, customType, uuid as pgUuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, users, departments } from './core';
import { members } from './member';
import { asyncTasks } from './tasks';
import { CMS_PUBLISH_ARTIFACT_STATUSES, CMS_PUBLISH_TARGET_TYPES, CMS_AD_EVENT_TYPES, CMS_CHANNEL_DETAIL_PATH_RULES, CMS_CHANNEL_STATIC_MODES, CMS_DEVICE_TYPES, CMS_DISTRIBUTION_CONFLICT_STRATEGIES, CMS_DISTRIBUTION_MODES, CMS_FIELD_OPTION_SOURCES, CMS_INTERACTION_CAPTCHA_POLICIES, CMS_INTERACTION_KINDS, CMS_INTERACTION_PARTICIPANT_SCOPES, CMS_INTERACTION_QUESTION_TYPES, CMS_INTERACTION_REPEAT_POLICIES, CMS_INTERACTION_RESULT_VISIBILITIES, CMS_INTERACTION_STATUSES, CMS_RESOURCE_OWNER_TYPES, CMS_SUBSCRIPTION_SUBJECT_TYPES, CMS_WIDGET_REF_OWNER_TYPES, CMS_WIDGET_LIVE_SOURCE_TYPES, CMS_WIDGET_STATUSES, CMS_WIDGET_TYPES } from '@zenith/shared/cms';
import type { CmsContentAttachment, CmsDistributionFilters, CmsFormField, CmsTitleStyle, CmsWidgetData } from '@zenith/shared/cms';

// ─── 枚举（pgEnum / TS union / Zod enum 三处同步，见 @zenith/shared）────────────
export const cmsStaticModeEnum = pgEnum('cms_static_mode', ['dynamic', 'hybrid', 'static']);
/** 栏目静态化模式：inherit=跟随站点，其余覆盖站点 staticMode */
export const cmsChannelStaticModeEnum = pgEnum('cms_channel_static_mode', CMS_CHANNEL_STATIC_MODES);
/** 详情页静态产物目录归档策略（内容 static_path 优先级更高） */
export const cmsChannelDetailPathRuleEnum = pgEnum('cms_channel_detail_path_rule', CMS_CHANNEL_DETAIL_PATH_RULES);
export const cmsChannelTypeEnum = pgEnum('cms_channel_type', ['list', 'page', 'link']);
export const cmsContentStatusEnum = pgEnum('cms_content_status', ['draft', 'pending', 'published', 'offline', 'rejected']);
/** 内容形态：article=图文 album=图集 media=音视频 link=外链 */
export const cmsContentTypeEnum = pgEnum('cms_content_type', ['article', 'album', 'media', 'link']);
export const cmsFieldTypeEnum = pgEnum('cms_field_type', ['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch']);
/** 模型字段选项来源：manual=手工维护，dict=引用系统字典（随字典自动更新） */
export const cmsFieldOptionSourceEnum = pgEnum('cms_field_option_source', CMS_FIELD_OPTION_SOURCES);
export const cmsSearchWordTypeEnum = pgEnum('cms_search_word_type', ['extension', 'stop']);
export const cmsFormCaptchaProviderEnum = pgEnum('cms_form_captcha_provider', ['inherit', 'none', 'math', 'turnstile']);
export const cmsPublishTargetTypeEnum = pgEnum('cms_publish_target_type', CMS_PUBLISH_TARGET_TYPES);
export const cmsPublishArtifactStatusEnum = pgEnum('cms_publish_artifact_status', CMS_PUBLISH_ARTIFACT_STATUSES);
export const cmsAdEventTypeEnum = pgEnum('cms_ad_event_type', CMS_AD_EVENT_TYPES);
export const cmsSubscriptionSubjectTypeEnum = pgEnum('cms_subscription_subject_type', CMS_SUBSCRIPTION_SUBJECT_TYPES);
export const cmsInteractionKindEnum = pgEnum('cms_interaction_kind', CMS_INTERACTION_KINDS);
export const cmsInteractionStatusEnum = pgEnum('cms_interaction_status', CMS_INTERACTION_STATUSES);
export const cmsInteractionQuestionTypeEnum = pgEnum('cms_interaction_question_type', CMS_INTERACTION_QUESTION_TYPES);
export const cmsInteractionParticipantScopeEnum = pgEnum('cms_interaction_participant_scope', CMS_INTERACTION_PARTICIPANT_SCOPES);
export const cmsInteractionRepeatPolicyEnum = pgEnum('cms_interaction_repeat_policy', CMS_INTERACTION_REPEAT_POLICIES);
export const cmsInteractionResultVisibilityEnum = pgEnum('cms_interaction_result_visibility', CMS_INTERACTION_RESULT_VISIBILITIES);
export const cmsInteractionCaptchaPolicyEnum = pgEnum('cms_interaction_captcha_policy', CMS_INTERACTION_CAPTCHA_POLICIES);
export const cmsPageBlockAclSubjectTypeEnum = pgEnum('cms_page_block_acl_subject_type', ['user', 'role']);
export const cmsDistributionModeEnum = pgEnum('cms_distribution_mode', CMS_DISTRIBUTION_MODES);
export const cmsDistributionConflictStrategyEnum = pgEnum(
  'cms_distribution_conflict_strategy',
  CMS_DISTRIBUTION_CONFLICT_STRATEGIES,
);
/** 素材引用方类型（cms_resource_refs.owner_type） */
export const cmsResourceOwnerTypeEnum = pgEnum('cms_resource_owner_type', CMS_RESOURCE_OWNER_TYPES);
export const cmsWidgetTypeEnum = pgEnum('cms_widget_type', CMS_WIDGET_TYPES);
export const cmsWidgetStatusEnum = pgEnum('cms_widget_status', CMS_WIDGET_STATUSES);
export const cmsWidgetRefOwnerTypeEnum = pgEnum('cms_widget_ref_owner_type', CMS_WIDGET_REF_OWNER_TYPES);
export const cmsWidgetSourceTypeEnum = pgEnum('cms_widget_source_type', CMS_WIDGET_LIVE_SOURCE_TYPES);

/** PostgreSQL tsvector 列（drizzle 无内置类型），存全文检索向量 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ─── CMS 站点（站群支持：一站一域名一主题）──────────────────────────────────────
export const cmsSites = pgTable('cms_sites', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 站群父站点；null 为根站点。层级约束由服务层在全局层级锁内维护。 */
  parentId: integer().references((): AnyPgColumn => cmsSites.id, { onDelete: 'restrict' }),
  name: varchar({ length: 100 }).notNull(),
  /** 站点唯一标识：静态目录名 / 预览路径（/__cms/{code}）*/
  code: varchar({ length: 50 }).notNull().unique(),
  /** 绑定主域名（host，如 www.example.com），前台按 Host 匹配站点 */
  domain: varchar({ length: 255 }),
  /** 别名域名列表（同样路由到本站点） */
  aliasDomains: jsonb().$type<string[]>().notNull().default([]),
  /** 未匹配到域名时的兜底默认站点（全局至多一个） */
  isDefault: boolean().notNull().default(false),
  // SEO 默认值（站点级 TDK，可被栏目/内容覆盖）
  title: varchar({ length: 200 }),
  keywords: varchar({ length: 500 }),
  description: varchar({ length: 1000 }),
  logo: varchar({ length: 500 }),
  favicon: varchar({ length: 500 }),
  icp: varchar({ length: 100 }),
  copyright: varchar({ length: 255 }),
  /** 内置主题名（cms/themes/registry 注册的主题） */
  theme: varchar({ length: 50 }).notNull().default('default'),
  /** 站点级扩展模型（对标 XModel 站点/栏目/内容三级绑定的站点级） */
  modelId: integer().references(() => cmsModels.id, { onDelete: 'set null' }),
  /** 站点扩展模型字段值（key = cms_model_fields.name），主题可直接读取 */
  extend: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  /** 主题生命周期事件修订号；每次激活/停用/回滚原子 +1，并进入发布任务幂等键。 */
  themeRevision: integer().notNull().default(0),
  /** 站点/栏目/内容/页面模板引用修订号；引用写入与主题健康检查的 TOCTOU 屏障。 */
  templateRefsRevision: integer().notNull().default(0),
  /** 影响公开渲染的数据修订号；发布任务与静态产物 fence 使用。 */
  publicRevision: integer().notNull().default(0),
  /** 静态化模式：dynamic=纯 SSR；hybrid=miss 渲染并回写静态；static=仅发布时生成 */
  staticMode: cmsStaticModeEnum().notNull().default('hybrid'),
  /** robots.txt 内容（每站点独立） */
  robots: text(),
  /** 主题参数 / URL 规则等站点级配置 */
  settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  remark: text(),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_sites_domain_uq').on(t.domain).where(sql`${t.domain} is not null`),
  uniqueIndex('cms_sites_default_uq').on(t.isDefault).where(sql`${t.isDefault} = true`),
  index('cms_sites_parent_idx').on(t.parentId, t.sort, t.id),
]);

export type CmsSiteRow = typeof cmsSites.$inferSelect;
export type NewCmsSite = typeof cmsSites.$inferInsert;

// ─── CMS 站点逐项显式继承开关（值仍存站点本身，resolver 按字段选择来源）──────────
export const cmsSiteInheritances = pgTable('cms_site_inheritances', {
  siteId: integer().primaryKey().references(() => cmsSites.id, { onDelete: 'cascade' }),
  seoTitle: boolean().notNull().default(false),
  seoKeywords: boolean().notNull().default(false),
  seoDescription: boolean().notNull().default(false),
  staticMode: boolean().notNull().default(false),
  reviewMode: boolean().notNull().default(false),
  webhook: boolean().notNull().default(false),
  cdn: boolean().notNull().default(false),
  theme: boolean().notNull().default(false),
  themeConfig: boolean().notNull().default(false),
  templates: boolean().notNull().default(false),
  revision: integer().notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsSiteInheritanceRow = typeof cmsSiteInheritances.$inferSelect;

// ─── CMS 内容模型（元数据驱动的自定义字段体系）─────────────────────────────────
export const cmsModels = pgTable('cms_models', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 归属站点：NULL = 平台共享（全部站点可用）；非空 = 该站点专属（其他站点不可见、不可绑定） */
  ownerSiteId: integer().references((): AnyPgColumn => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 50 }).notNull().unique(),
  description: text(),
  /** 系统内置模型（article/page 等）不可删除 */
  isSystem: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsModelRow = typeof cmsModels.$inferSelect;
export type NewCmsModel = typeof cmsModels.$inferInsert;

// ─── CMS 模型字段定义（内容 extend JSONB 的字段元数据）──────────────────────────
export const cmsModelFields = pgTable('cms_model_fields', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  modelId: integer().notNull().references(() => cmsModels.id, { onDelete: 'cascade' }),
  /** 字段标识（extend JSONB 的 key，小写字母/数字/下划线） */
  name: varchar({ length: 50 }).notNull(),
  label: varchar({ length: 100 }).notNull(),
  fieldType: cmsFieldTypeEnum().notNull().default('text'),
  required: boolean().notNull().default(false),
  /** 是否纳入全文检索索引 */
  searchable: boolean().notNull().default(false),
  /** 是否在内容列表中显示 */
  showInList: boolean().notNull().default(false),
  /** 是否在前台详情页「模型字段表」中展示（Theme API ctx.content.modelFields 消费） */
  showInDetail: boolean().notNull().default(false),
  /** 详情展示分组标题（如「文件信息」）；空 = 默认分组 */
  detailGroup: varchar({ length: 50 }),
  /** 详情展示排序（组内） */
  detailSort: integer().notNull().default(0),
  placeholder: varchar({ length: 200 }),
  defaultValue: text(),
  /** 选项来源：manual=下方 options 手工维护；dict=引用 dictCode 指向的系统字典 */
  optionSource: cmsFieldOptionSourceEnum().notNull().default('manual'),
  /** optionSource=dict 时引用的字典编码（dicts.code） */
  dictCode: varchar({ length: 64 }),
  /** select/radio/checkbox 的选项（optionSource=manual 时生效） */
  options: jsonb().$type<{ label: string; value: string }[]>(),
  sort: integer().notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_model_fields_model_name_uq').on(t.modelId, t.name),
]);

export type CmsModelFieldRow = typeof cmsModelFields.$inferSelect;
export type NewCmsModelField = typeof cmsModelFields.$inferInsert;

// ─── CMS 栏目（树形，list=列表 / page=单页 / link=外链）─────────────────────────
export const cmsChannels = pgTable('cms_channels', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 父栏目 id，0 = 顶级（与 menus 表约定一致，删除守卫在 service 层） */
  parentId: integer().notNull().default(0),
  modelId: integer().references(() => cmsModels.id, { onDelete: 'set null' }),
  name: varchar({ length: 100 }).notNull(),
  /**
   * 栏目标识（站内唯一）—— 模板 / 页面搭建区块 / 内链 / 开放 API 的稳定引用。
   *
   * 与 `slug` 的分工：`slug` 是 URL 片段，改了 URL 就变（要配 301）；`code` 是程序引用标识，
   * 移动栏目、改 slug、站点复制后都不变，因此 `entity:channel@news` 这类内链跨站点依然有效。
   */
  code: varchar({ length: 50 }).notNull(),
  /** URL 路径段（本级） */
  slug: varchar({ length: 100 }).notNull(),
  /** 完整 URL 路径（各级 slug 以 / 连接，保存时由 service 重算） */
  path: varchar({ length: 255 }).notNull(),
  type: cmsChannelTypeEnum().notNull().default('list'),
  /** type=link 时的跳转地址 */
  linkUrl: varchar({ length: 500 }),
  /** 覆盖主题默认模板名（列表页 / 详情页） */
  listTemplate: varchar({ length: 50 }),
  detailTemplate: varchar({ length: 50 }),
  /** 静态化模式：inherit = 跟随站点，其余覆盖站点设置 */
  staticMode: cmsChannelStaticModeEnum().notNull().default('inherit'),
  /** 详情页静态产物目录归档策略（内容 static_path 非空时不生效） */
  detailPathRule: cmsChannelDetailPathRuleEnum().notNull().default('none'),
  pageSize: integer().notNull().default(20),
  /** type=page 时的单页富文本内容 */
  pageContent: text(),
  // 栏目级 SEO（覆盖站点默认）
  seoTitle: varchar({ length: 255 }),
  seoKeywords: varchar({ length: 500 }),
  seoDescription: varchar({ length: 500 }),
  image: varchar({ length: 500 }),
  /** 是否在前台导航显示 */
  visible: boolean().notNull().default(true),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_channels_site_path_uq').on(t.siteId, t.path),
  uniqueIndex('cms_channels_site_code_uq').on(t.siteId, t.code),
  index('cms_channels_site_parent_idx').on(t.siteId, t.parentId),
]);

export type CmsChannelRow = typeof cmsChannels.$inferSelect;
export type NewCmsChannel = typeof cmsChannels.$inferInsert;

// ─── CMS 受治理内容分发规则（执行记录与行级结果复用 async_tasks/items）──────────
export const cmsDistributionRules = pgTable('cms_distribution_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  sourceSiteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'restrict' }),
  sourceChannelId: integer().references(() => cmsChannels.id, { onDelete: 'restrict' }),
  targetSiteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'restrict' }),
  targetChannelId: integer().notNull().references(() => cmsChannels.id, { onDelete: 'restrict' }),
  mode: cmsDistributionModeEnum().notNull().default('copy'),
  conflictStrategy: cmsDistributionConflictStrategyEnum().notNull().default('skip'),
  filters: jsonb().$type<CmsDistributionFilters>().notNull().default({
    statuses: ['published'],
    contentTypes: [],
    keyword: null,
    publishedFrom: null,
    publishedTo: null,
  }),
  scheduleCron: varchar({ length: 100 }),
  nextRunAt: timestamp(),
  lastRunAt: timestamp(),
  status: statusEnum().notNull().default('enabled'),
  /** 规则变更 fence；每次编辑/启停 +1，旧任务协作取消。 */
  revision: integer().notNull().default(1),
  remark: varchar({ length: 500 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_distribution_rules_source_idx').on(t.sourceSiteId, t.sourceChannelId, t.status),
  index('cms_distribution_rules_target_idx').on(t.targetSiteId, t.targetChannelId, t.status),
  index('cms_distribution_rules_due_idx').on(t.mode, t.status, t.nextRunAt),
]);

export type CmsDistributionRuleRow = typeof cmsDistributionRules.$inferSelect;
export type NewCmsDistributionRule = typeof cmsDistributionRules.$inferInsert;

// ─── CMS 内容（全站统一表 + JSONB 扩展字段 + tsvector 检索向量）─────────────────
export const cmsContents = pgTable('cms_contents', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  channelId: integer().notNull().references(() => cmsChannels.id, { onDelete: 'restrict' }),
  modelId: integer().references(() => cmsModels.id, { onDelete: 'set null' }),
  /** 内容形态（P2 多形态内容类型；创建后不可变更） */
  contentType: cmsContentTypeEnum().notNull().default('article'),
  /** 形态结构化数据：album={images:[{url,thumb?,caption?}]} media={mediaType,mediaUrl,poster?,duration?} */
  mediaData: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  title: varchar({ length: 255 }).notNull(),
  /** 标题样式（加粗 / 颜色），空对象 = 主题默认 */
  titleStyle: jsonb().$type<CmsTitleStyle>().notNull().default({}),
  /** 副标题（P1 内容字段增强） */
  subTitle: varchar({ length: 255 }),
  /** 短标题（列表窄位展示） */
  shortTitle: varchar({ length: 100 }),
  /** 自定义 URL 名（可空，默认用 id 生成 URL） */
  slug: varchar({ length: 255 }),
  summary: text(),
  coverImage: varchar({ length: 500 }),
  author: varchar({ length: 50 }),
  /** 责任编辑 */
  editor: varchar({ length: 50 }),
  source: varchar({ length: 100 }),
  /** 来源链接 */
  sourceUrl: varchar({ length: 500 }),
  /** 原创标记 */
  isOriginal: boolean().notNull().default(false),
  /** 正文富文本 HTML */
  body: text(),
  /** 正文附件列表（前台详情页可下载；非空时 hasAttachment 自动置位） */
  attachments: jsonb().$type<CmsContentAttachment[]>().notNull().default([]),
  /** 模型自定义字段值（key = cms_model_fields.name） */
  extend: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  /** 外链型内容：点击直接跳转 */
  externalLink: varchar({ length: 500 }),
  /** 详情模板覆盖（主题变体模板名；null = 跟随栏目/站点默认） */
  detailTemplate: varchar({ length: 50 }),
  /** 自定义静态化相对路径（如 news/2026/hello.html）；空 = 按 slug/id 生成 */
  staticPath: varchar({ length: 255 }),
  isTop: boolean().notNull().default(false),
  /** 置顶权重（数值越大越靠前，isTop=true 时生效） */
  topWeight: integer().notNull().default(0),
  /** 置顶到期时间（到期由周期任务自动取消置顶；空 = 永久置顶） */
  topExpireAt: timestamp(),
  isRecommend: boolean().notNull().default(false),
  isHot: boolean().notNull().default(false),
  /** 内容属性自动标记（保存时按正文/形态数据/封面自动检测，列表展示图标） */
  hasImage: boolean().notNull().default(false),
  hasVideo: boolean().notNull().default(false),
  hasAttachment: boolean().notNull().default(false),
  status: cmsContentStatusEnum().notNull().default('draft'),
  rejectReason: varchar({ length: 500 }),
  publishedAt: timestamp(),
  /** 定时发布时间（P2 调度使用，先建列） */
  scheduledAt: timestamp(),
  /** 过期自动下线时间（到期由周期任务下线，空 = 永不过期） */
  expireAt: timestamp(),
  viewCount: integer().notNull().default(0),
  /** 会员点赞数（cms_content_likes 冗余计数，原子回写） */
  likeCount: integer().notNull().default(0),
  /** 会员收藏数（cms_content_favorites 冗余计数，原子回写） */
  favoriteCount: integer().notNull().default(0),
  /** 乐观锁版本号（每次更新 +1；更新携带 expectedVersion 不一致时拒绝，防并发编辑覆盖） */
  version: integer().notNull().default(1),
  sort: integer().notNull().default(0),
  // 内容级 SEO（覆盖栏目/站点默认）
  seoTitle: varchar({ length: 255 }),
  seoKeywords: varchar({ length: 500 }),
  seoDescription: varchar({ length: 500 }),
  /** Social SEO 图片替代文本与 Twitter 作者账号 */
  socialImageAlt: varchar({ length: 255 }),
  twitterCreator: varchar({ length: 100 }),
  /** 全文检索向量（应用层 jieba 分词后写入，'simple' parser + setweight A/B/C） */
  searchVector: tsvector('search_vector'),
  /** 回收站：非空表示已进回收站 */
  deletedAt: timestamp(),
  /** 归档：非空表示已归档（前台详情保留，不参与列表聚合；仅已发布/已下线内容可归档） */
  archivedAt: timestamp(),
  /** 映射来源内容 id：非空表示本内容为“映射”（正文/扩展字段共享来源内容，禁止独立编辑） */
  mappingSourceId: integer().references((): AnyPgColumn => cmsContents.id, { onDelete: 'set null' }),
  /** 规则物化来源，用于同步幂等和冲突处理；规则删除后保留内容并清空规则引用。 */
  distributionRuleId: integer().references(() => cmsDistributionRules.id, { onDelete: 'set null' }),
  distributionSourceId: integer().references((): AnyPgColumn => cmsContents.id, { onDelete: 'set null' }),
  distributionSourceVersion: integer(),
  /** 会员投稿：非空表示由前台会员提交（P3 会员投稿） */
  memberId: integer().references(() => members.id, { onDelete: 'set null' }),
  /** 部门归属（P5 部门数据权限：创建时快照创建人部门；投稿/导入为 null） */
  deptId: integer().references(() => departments.id, { onDelete: 'set null' }),
  /** 管理员持久化合规锁（与 Redis 120s 编辑协作锁、version 乐观锁相互独立） */
  lockedAt: timestamp(),
  lockedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  lockReason: varchar({ length: 500 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('cms_contents_channel_idx').on(t.channelId), 
  index('cms_contents_site_channel_idx').on(t.siteId, t.channelId),
  index('cms_contents_status_idx').on(t.status),
  index('cms_contents_published_at_idx').on(t.publishedAt),
  index('cms_contents_search_idx').using('gin', t.searchVector),
  // 标题模糊检索(pg_trgm 扩展由迁移基线 0000 顶部创建)
  index('cms_contents_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  index('cms_contents_member_idx').on(t.memberId),
  index('cms_contents_mapping_source_idx').on(t.mappingSourceId),
  index('cms_contents_distribution_source_idx').on(t.distributionRuleId, t.distributionSourceId),
  index('cms_contents_locked_at_idx').on(t.lockedAt),
  // Headless 增量同步的 keyset 游标（按 updated_at 递增拉变更集）
  index('cms_contents_sync_idx').on(t.siteId, t.updatedAt, t.id),
  uniqueIndex('cms_contents_distribution_materialization_uq').on(t.distributionRuleId, t.distributionSourceId)
    .where(sql`${t.distributionRuleId} is not null and ${t.distributionSourceId} is not null and ${t.deletedAt} is null`),
  uniqueIndex('cms_contents_site_slug_uq').on(t.siteId, t.slug)
    .where(sql`${t.slug} is not null and ${t.deletedAt} is null`),
  uniqueIndex('cms_contents_site_static_path_uq').on(t.siteId, t.staticPath)
    .where(sql`${t.staticPath} is not null and ${t.deletedAt} is null`),
]);

export type CmsContentRow = typeof cmsContents.$inferSelect;
export type NewCmsContent = typeof cmsContents.$inferInsert;

// ─── CMS 内容操作日志（内容级时间线：创建/发布/驳回/归档等；随内容级联删除）────────
export const cmsContentOpLogs = pgTable('cms_content_op_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  /** 操作类型：created/updated/submitted/published/rejected/offlined/recycled/restored/rolled_back/archived/unarchived/moved */
  action: varchar({ length: 30 }).notNull(),
  /** 补充说明（驳回原因、移动目标栏目等） */
  detail: varchar({ length: 500 }),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 冗余操作人昵称（防用户删除后时间线失名；系统任务为“系统”） */
  operatorName: varchar({ length: 50 }).notNull().default('系统'),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('cms_content_op_logs_operator_idx').on(t.operatorId), 
  index('cms_content_op_logs_content_idx').on(t.contentId, t.createdAt),
]);

export type CmsContentOpLogRow = typeof cmsContentOpLogs.$inferSelect;

// ─── CMS 易错词库（编辑辅助：常见错误词 → 正确词，编辑器检查一键替换）────────────
export const cmsErrorProneWords = pgTable('cms_error_prone_words', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  word: varchar({ length: 50 }).notNull().unique(),
  /** 对应正确写法 */
  correction: varchar({ length: 50 }).notNull(),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsErrorProneWordRow = typeof cmsErrorProneWords.$inferSelect;

// ═══ P3 会员互动 ═══════════════════════════════════════════════════════════════

// ─── 内容点赞（会员×内容唯一；计数冗余在 cms_contents.like_count）────────────────
export const cmsContentLikes = pgTable('cms_content_likes', {
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.memberId, t.contentId] }),
  index('cms_content_likes_content_idx').on(t.contentId),
]);

export type CmsContentLikeRow = typeof cmsContentLikes.$inferSelect;

// ─── 内容收藏（会员×内容唯一；计数冗余在 cms_contents.favorite_count）───────────
export const cmsContentFavorites = pgTable('cms_content_favorites', {
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.memberId, t.contentId] }),
  index('cms_content_favorites_content_idx').on(t.contentId),
  index('cms_content_favorites_member_idx').on(t.memberId, t.createdAt),
]);

export type CmsContentFavoriteRow = typeof cmsContentFavorites.$inferSelect;

// ─── 会员浏览历史（会员×内容去重累计；每人保留最近 100 条由 service 裁剪）─────────
export const cmsMemberViewHistory = pgTable('cms_member_view_history', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 重复浏览累计次数 */
  viewCount: integer().notNull().default(1),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('cms_member_view_history_content_idx').on(t.contentId), 
  uniqueIndex('cms_member_view_history_uq').on(t.memberId, t.contentId),
  index('cms_member_view_history_member_idx').on(t.memberId, t.updatedAt),
]);

export type CmsMemberViewHistoryRow = typeof cmsMemberViewHistory.$inferSelect;

// ─── CMS 会员订阅（取消采用 inactive 留痕，保留首次积分幂等事实）────────────────
export const cmsMemberSubscriptions = pgTable('cms_member_subscriptions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  memberId: integer().notNull().references(() => members.id, { onDelete: 'cascade' }),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  subjectType: cmsSubscriptionSubjectTypeEnum().notNull(),
  /** site/channel 使用十进制 ID 字符串；author 使用 NFKC + trim + lowercase 后的稳定键。 */
  subjectKey: varchar({ length: 255 }).notNull(),
  /** site/channel 的实体 ID；author 为 null。 */
  subjectId: integer(),
  /** 展示文本快照，不参与唯一性判定。 */
  subjectLabel: varchar({ length: 255 }).notNull(),
  notificationEnabled: boolean().notNull().default(true),
  active: boolean().notNull().default(true),
  /** 首次有效订阅积分已发放的持久化标记；取消/重新关注不会清除。 */
  pointsAwardedAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_member_subscriptions_subject_uq').on(t.memberId, t.siteId, t.subjectType, t.subjectKey),
  index('cms_member_subscriptions_member_idx').on(t.memberId, t.active, t.createdAt),
  index('cms_member_subscriptions_subject_idx').on(t.siteId, t.subjectType, t.subjectKey, t.active),
]);

export type CmsMemberSubscriptionRow = typeof cmsMemberSubscriptions.$inferSelect;

// ═══ Stage 4：统一互动问卷（survey / poll）══════════════════════════════════════

export const cmsInteractions = pgTable('cms_interactions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  code: varchar({ length: 50 }).notNull(),
  kind: cmsInteractionKindEnum().notNull(),
  title: varchar({ length: 200 }).notNull(),
  description: text(),
  status: cmsInteractionStatusEnum().notNull().default('draft'),
  participantScope: cmsInteractionParticipantScopeEnum().notNull().default('anonymous'),
  repeatPolicy: cmsInteractionRepeatPolicyEnum().notNull().default('once_per_ip'),
  resultVisibility: cmsInteractionResultVisibilityEnum().notNull().default('after_submit'),
  captchaPolicy: cmsInteractionCaptchaPolicyEnum().notNull().default('inherit'),
  turnstileSiteKey: varchar({ length: 200 }),
  turnstileSecret: varchar({ length: 500 }),
  thankYouMessage: varchar({ length: 500 }).notNull().default('感谢您的参与！'),
  startAt: timestamp(),
  endAt: timestamp(),
  responseCount: integer().notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_interactions_site_code_uq').on(t.siteId, t.code),
  index('cms_interactions_site_status_idx').on(t.siteId, t.status, t.kind),
]);

export type CmsInteractionRow = typeof cmsInteractions.$inferSelect;

export const cmsInteractionQuestions = pgTable('cms_interaction_questions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  interactionId: integer().notNull().references(() => cmsInteractions.id, { onDelete: 'cascade' }),
  label: varchar({ length: 200 }).notNull(),
  type: cmsInteractionQuestionTypeEnum().notNull().default('single'),
  required: boolean().notNull().default(true),
  options: jsonb().$type<{ id: string; label: string; value: string }[]>().notNull().default([]),
  minChoices: integer().notNull().default(1),
  maxChoices: integer().notNull().default(1),
  sort: integer().notNull().default(0),
  /** 单选/多选题是否提供「其他 ___」自由填空；答案形如 `__other__:自由文本` */
  allowOther: boolean().notNull().default(false),
  otherLabel: varchar({ length: 50 }),
  /** 评分题上限（NPS 固定 0-10，不读此字段） */
  ratingMax: integer().notNull().default(5),
  /** 矩阵题的行；列复用 options，答案形如 `rowId::optionValue` */
  matrixRows: jsonb().$type<{ id: string; label: string }[]>().notNull().default([]),
  /** 分页问卷页码，从 1 开始 */
  pageNo: integer().notNull().default(1),
  /** 条件显示规则；null 表示始终显示 */
  visibleWhen: jsonb().$type<{ questionIndex: number; op: 'any' | 'none'; values: string[] } | null>(),
}, (t) => [
  index('cms_interaction_questions_parent_idx').on(t.interactionId, t.sort),
]);

export type CmsInteractionQuestionRow = typeof cmsInteractionQuestions.$inferSelect;

export const cmsInteractionResponses = pgTable('cms_interaction_responses', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  interactionId: integer().notNull().references(() => cmsInteractions.id, { onDelete: 'cascade' }),
  memberId: integer().references(() => members.id, { onDelete: 'set null' }),
  visitorHash: varchar({ length: 64 }).notNull(),
  ipHash: varchar({ length: 64 }).notNull(),
  /** once_per_member / once_per_ip 的数据库去重键；multiple 为 null。 */
  repeatKey: varchar({ length: 80 }),
  /** 显式请求幂等键的摘要；同一互动内唯一。 */
  requestKey: varchar({ length: 64 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('cms_interaction_responses_parent_time_idx').on(t.interactionId, t.createdAt, t.id),
  index('cms_interaction_responses_member_idx').on(t.memberId, t.createdAt),
  uniqueIndex('cms_interaction_responses_repeat_uq').on(t.interactionId, t.repeatKey).where(sql`${t.repeatKey} is not null`),
  uniqueIndex('cms_interaction_responses_request_uq').on(t.interactionId, t.requestKey).where(sql`${t.requestKey} is not null`),
]);

export type CmsInteractionResponseRow = typeof cmsInteractionResponses.$inferSelect;

export const cmsInteractionAnswers = pgTable('cms_interaction_answers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  responseId: integer().notNull().references(() => cmsInteractionResponses.id, { onDelete: 'cascade' }),
  questionId: integer().notNull().references(() => cmsInteractionQuestions.id, { onDelete: 'cascade' }),
  value: jsonb().$type<string | string[]>().notNull(),
}, (t) => [
  uniqueIndex('cms_interaction_answers_response_question_uq').on(t.responseId, t.questionId),
  index('cms_interaction_answers_question_idx').on(t.questionId),
]);

export type CmsInteractionAnswerRow = typeof cmsInteractionAnswers.$inferSelect;

// ═══ P4 统计分析 ═══════════════════════════════════════════════════════════════

export const cmsDeviceTypeEnum = pgEnum('cms_device_type', CMS_DEVICE_TYPES);

// ─── 前台访问日志（服务端响应路径记录，静态命中同样统计；原始日志保留 90 天）──────
export const cmsVisitLogs = pgTable('cms_visit_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 站内相对路径（含前导 /，截断 500） */
  path: varchar({ length: 500 }).notNull(),
  /** 页面类型：home/list/detail/page/search/tag 等（渲染 kind） */
  pageKind: varchar({ length: 20 }).notNull().default('other'),
  /** 详情页关联内容（内容排行用） */
  contentId: integer(),
  /** 访客标识（ip+ua 哈希，UV 去重用） */
  visitorHash: varchar({ length: 32 }).notNull(),
  ip: varchar({ length: 64 }),
  deviceType: cmsDeviceTypeEnum().notNull().default('pc'),
  /** 来源页 Host（referrer 域名；直达为空） */
  referrerHost: varchar({ length: 255 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('cms_visit_logs_site_time_idx').on(t.siteId, t.createdAt),
  index('cms_visit_logs_content_idx').on(t.contentId).where(sql`${t.contentId} is not null`),
]);

export type CmsVisitLogRow = typeof cmsVisitLogs.$inferSelect;

// ─── 广告效果日聚合（曝光/点击；CTR 报表用）─────────────────────────────────────
export const cmsAdStats = pgTable('cms_ad_stats', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  adId: integer().notNull().references(() => cmsAds.id, { onDelete: 'cascade' }),
  /** 统计日（YYYY-MM-DD） */
  statDate: varchar({ length: 10 }).notNull(),
  views: integer().notNull().default(0),
  clicks: integer().notNull().default(0),
}, (t) => [
  uniqueIndex('cms_ad_stats_ad_date_uq').on(t.adId, t.statDate),
]);

export type CmsAdStatRow = typeof cmsAdStats.$inferSelect;

// ─── 广告事件明细（append-only；按 occurred_at 范围索引，便于未来按月分区）──────
export const cmsAdEvents = pgTable('cms_ad_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 事实快照 ID，不设 FK：广告/广告位删除后事件仍保留至 retention 清理。 */
  adId: integer().notNull(),
  slotId: integer().notNull(),
  eventType: cmsAdEventTypeEnum().notNull(),
  occurredAt: timestamp().defaultNow().notNull(),
  /** 服务端加盐 SHA-256；绝不保存明文 IP。 */
  visitorHash: varchar({ length: 64 }).notNull(),
  ipHash: varchar({ length: 64 }).notNull(),
  userAgent: varchar({ length: 500 }),
  device: cmsDeviceTypeEnum().notNull().default('pc'),
  referrer: varchar({ length: 1000 }),
  path: varchar({ length: 500 }),
  memberId: integer().references(() => members.id, { onDelete: 'set null' }),
  /** 事件类型 + 广告 + 访客 + 防刷时间桶的摘要，数据库唯一约束为最终幂等屏障。 */
  dedupeKey: varchar({ length: 64 }).notNull(),
}, (t) => [
  uniqueIndex('cms_ad_events_dedupe_uq').on(t.dedupeKey),
  index('cms_ad_events_site_time_idx').on(t.siteId, t.occurredAt, t.id),
  index('cms_ad_events_ad_time_idx').on(t.adId, t.occurredAt, t.id),
  index('cms_ad_events_slot_time_idx').on(t.slotId, t.occurredAt, t.id),
  index('cms_ad_events_type_device_time_idx').on(t.eventType, t.device, t.occurredAt),
]);

export type CmsAdEventRow = typeof cmsAdEvents.$inferSelect;

// ─── 前台搜索日志（搜索量趋势 / 无结果词榜；原始日志保留 90 天）──────────────────
export const cmsSearchLogs = pgTable('cms_search_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  keyword: varchar({ length: 64 }).notNull(),
  resultCount: integer().notNull().default(0),
  ip: varchar({ length: 64 }),
  deviceType: cmsDeviceTypeEnum().notNull().default('pc'),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('cms_search_logs_site_time_idx').on(t.siteId, t.createdAt),
  index('cms_search_logs_keyword_idx').on(t.siteId, t.keyword),
]);

export type CmsSearchLogRow = typeof cmsSearchLogs.$inferSelect;

// ─── CMS 内容-副栏目关联（一文多栏目：主栏目在 cms_contents.channel_id，副栏目在此表）──
export const cmsContentChannels = pgTable('cms_content_channels', {
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  channelId: integer().notNull().references(() => cmsChannels.id, { onDelete: 'cascade' }),
}, (t) => [index('cms_content_channels_channel_idx').on(t.channelId), primaryKey({ columns: [t.contentId, t.channelId] })]);

export type CmsContentChannelRow = typeof cmsContentChannels.$inferSelect;

// ─── CMS 相关文章（手动关联；前台展示时不足可按标签自动补齐）───────────────────
export const cmsContentRelations = pgTable('cms_content_relations', {
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  relatedId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  sort: integer().notNull().default(0),
}, (t) => [primaryKey({ columns: [t.contentId, t.relatedId] })]);

export type CmsContentRelationRow = typeof cmsContentRelations.$inferSelect;

// ─── CMS 标签（按站点隔离，带 slug 供生成 tag 聚合页；可选分组便于归类管理）──────
export const cmsTags = pgTable('cms_tags', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 50 }).notNull(),
  slug: varchar({ length: 100 }).notNull(),
  /** 标签分组（可空；同组标签在管理页聚合展示） */
  groupName: varchar({ length: 50 }),
  /** 冗余计数（打标/移除时由 service 维护） */
  contentCount: integer().notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_tags_site_name_uq').on(t.siteId, t.name),
  uniqueIndex('cms_tags_site_slug_uq').on(t.siteId, t.slug),
]);

export type CmsTagRow = typeof cmsTags.$inferSelect;
export type NewCmsTag = typeof cmsTags.$inferInsert;

// ─── CMS 内容-标签关联 ─────────────────────────────────────────────────────────
export const cmsContentTags = pgTable('cms_content_tags', {
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  tagId: integer().notNull().references(() => cmsTags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.contentId, t.tagId] })]);

export type CmsContentTagRow = typeof cmsContentTags.$inferSelect;

// ─── CMS 友链分组（独立实体：需排序与稳定 code 供主题按组取数，字符串分组表达不了）───
export const cmsFriendLinkGroups = pgTable('cms_friend_link_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  /** 分组标识（站内唯一）：主题按组取数的稳定引用，改名不影响 */
  code: varchar({ length: 50 }).notNull(),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  remark: text(),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_friend_link_groups_site_code_uq').on(t.siteId, t.code),
  index('cms_friend_link_groups_site_sort_idx').on(t.siteId, t.sort, t.id),
]);

export type CmsFriendLinkGroupRow = typeof cmsFriendLinkGroups.$inferSelect;
export type NewCmsFriendLinkGroup = typeof cmsFriendLinkGroups.$inferInsert;

// ─── CMS 友情链接 ─────────────────────────────────────────────────────────────
export const cmsFriendLinks = pgTable('cms_friend_links', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 所属分组；空 = 未分组（主题渲染时归入默认块） */
  groupId: integer().references(() => cmsFriendLinkGroups.id, { onDelete: 'set null' }),
  name: varchar({ length: 100 }).notNull(),
  url: varchar({ length: 500 }).notNull(),
  logo: varchar({ length: 500 }),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  remark: text(),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_friend_links_site_group_idx').on(t.siteId, t.groupId, t.sort, t.id),
]);

export type CmsFriendLinkRow = typeof cmsFriendLinks.$inferSelect;
export type NewCmsFriendLink = typeof cmsFriendLinks.$inferInsert;

// ═══ P2 运营增强 ══════════════════════════════════════════════════════════════

export const cmsCommentStatusEnum = pgEnum('cms_comment_status', ['pending', 'approved', 'rejected']);

// ─── 内容版本快照（更新前自动留档，可回滚；每内容保留最近 N 版）─────────────────
export const cmsContentVersions = pgTable('cms_content_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  title: varchar({ length: 255 }).notNull(),
  /** 完整可回滚快照（title/summary/body/extend/seo/属性等） */
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_content_versions_content_ver_uq').on(t.contentId, t.version),
]);

export type CmsContentVersionRow = typeof cmsContentVersions.$inferSelect;

// ─── 301/302 重定向 ───────────────────────────────────────────────────────────
export const cmsRedirects = pgTable('cms_redirects', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 站内来源路径（以 / 开头，如 /old-news/1.html） */
  fromPath: varchar({ length: 500 }).notNull(),
  /** 目标地址（站内路径或完整 URL） */
  toUrl: varchar({ length: 500 }).notNull(),
  /** 301=永久 302=临时 */
  redirectType: integer().notNull().default(301),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_redirects_site_from_uq').on(t.siteId, t.fromPath),
]);

export type CmsRedirectRow = typeof cmsRedirects.$inferSelect;

// ─── 内链词（正文关键词自动加链，SEO 内链建设）─────────────────────────────────
export const cmsLinkWords = pgTable('cms_link_words', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  keyword: varchar({ length: 50 }).notNull(),
  url: varchar({ length: 500 }).notNull(),
  /** 每篇正文最多替换次数 */
  maxReplaces: integer().notNull().default(1),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_link_words_site_keyword_uq').on(t.siteId, t.keyword),
]);

export type CmsLinkWordRow = typeof cmsLinkWords.$inferSelect;

// ─── 评论（前台游客/登录会员提交，审核后展示；审核通过触发详情页增量重建）─────────
export const cmsComments = pgTable('cms_comments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  /** 父评论 id，0 = 顶级（树形回复，前台展示两级） */
  parentId: integer().notNull().default(0),
  /** 会员评论：非空表示由登录会员提交（昵称快照仍存 nickname；会员注销后保留评论） */
  memberId: integer().references(() => members.id, { onDelete: 'set null' }),
  nickname: varchar({ length: 50 }).notNull(),
  content: text().notNull(),
  /** 点赞数（前台匿名点赞，IP 去重） */
  likeCount: integer().notNull().default(0),
  status: cmsCommentStatusEnum().notNull().default('pending'),
  /** 风控标注（规则中心名单守卫写入，如 watchlist=命中观察灰名单；null=无标注） */
  riskFlag: varchar({ length: 32 }),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 255 }),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_comments_content_idx').on(t.contentId, t.status),
  index('cms_comments_member_idx').on(t.memberId),
]);

export type CmsCommentRow = typeof cmsComments.$inferSelect;

// ─── 广告位 / 广告投放 ─────────────────────────────────────────────────────────
export const cmsAdSlots = pgTable('cms_ad_slots', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 模板引用标识（如 home-ad） */
  code: varchar({ length: 50 }).notNull(),
  name: varchar({ length: 100 }).notNull(),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_ad_slots_site_code_uq').on(t.siteId, t.code),
]);

export type CmsAdSlotRow = typeof cmsAdSlots.$inferSelect;

export const cmsAds = pgTable('cms_ads', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slotId: integer().notNull().references(() => cmsAdSlots.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  image: varchar({ length: 500 }),
  linkUrl: varchar({ length: 500 }),
  /** 投放时间窗（空 = 不限） */
  startAt: timestamp(),
  endAt: timestamp(),
  /** 点击计数（前台经由公开广告点击中转累加） */
  clickCount: integer().notNull().default(0),
  /** 曝光计数（前台页面加载 beacon 批量上报累加） */
  viewCount: integer().notNull().default(0),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsAdRow = typeof cmsAds.$inferSelect;

// ─── 自定义表单（留言/报名等，前台原生 form POST 提交）──────────────────────────
export const cmsForms = pgTable('cms_forms', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 前台提交与栏目绑定引用标识 */
  code: varchar({ length: 50 }).notNull(),
  name: varchar({ length: 100 }).notNull(),
  /** 字段定义与服务端验证策略 */
  fields: jsonb().$type<CmsFormField[]>().notNull().default([]),

  successMessage: varchar({ length: 255 }),
  /** 新提交通知邮箱（逗号分隔多个，空 = 不通知） */
  notifyEmail: varchar({ length: 255 }),
  /** 表单级验证码策略；inherit 保持站点开关兼容 */
  captchaProvider: cmsFormCaptchaProviderEnum().notNull().default('inherit'),
  turnstileSiteKey: varchar({ length: 200 }),
  /** write-only；DTO 仅返回掩码 */
  turnstileSecret: varchar({ length: 500 }),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_forms_site_code_uq').on(t.siteId, t.code),
]);

export type CmsFormRow = typeof cmsForms.$inferSelect;

export const cmsFormSubmissions = pgTable('cms_form_submissions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  formId: integer().notNull().references(() => cmsForms.id, { onDelete: 'cascade' }),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
  ip: varchar({ length: 64 }),
  userAgent: varchar({ length: 255 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('cms_form_submissions_form_idx').on(t.formId),
]);

export type CmsFormSubmissionRow = typeof cmsFormSubmissions.$inferSelect;

// ─── 敏感词库（全局共享，评论/表单提交拦截或替换）────────────────────────────────
export const cmsSensitiveWords = pgTable('cms_sensitive_words', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  word: varchar({ length: 50 }).notNull().unique(),
  /** 非空 = 替换模式；空 = 拦截模式（命中直接拒绝提交） */
  replaceWith: varchar({ length: 50 }),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsSensitiveWordRow = typeof cmsSensitiveWords.$inferSelect;

// ─── 搜索引擎推送日志（百度普通收录 / IndexNow）─────────────────────────────────
export const cmsPushLogs = pgTable('cms_push_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** baidu | indexnow */
  engine: varchar({ length: 20 }).notNull(),
  urls: jsonb().$type<string[]>().notNull(),
  success: boolean().notNull(),
  statusCode: integer(),
  response: text(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('cms_push_logs_site_idx').on(t.siteId, t.createdAt),
]);

export type CmsPushLogRow = typeof cmsPushLogs.$inferSelect;

// ─── 站点数据权限（绑定后仅可管理绑定站点；未绑定用户不受限）────────────────────
export const cmsSiteUsers = pgTable('cms_site_users', {
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [index('cms_site_users_user_idx').on(t.userId), primaryKey({ columns: [t.siteId, t.userId] })]);

export type CmsSiteUserRow = typeof cmsSiteUsers.$inferSelect;

// ─── 栏目数据权限（P5：绑定后该用户仅可管理绑定栏目下的内容；未绑定用户不受限）────
export const cmsChannelUsers = pgTable('cms_channel_users', {
  channelId: integer().notNull().references(() => cmsChannels.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('cms_channel_users_user_idx').on(t.userId),
]);

export type CmsChannelUserRow = typeof cmsChannelUsers.$inferSelect;

// ═══ P3 Batch1 ════════════════════════════════════════════════════════════════

// ─── 检索自定义词典（jieba 运行时加载；删除词条需重启进程才彻底失效）─────────────
export const cmsSearchWords = pgTable('cms_search_words', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  word: varchar({ length: 50 }).notNull(),
  type: cmsSearchWordTypeEnum().notNull().default('extension'),
  groupName: varchar({ length: 100 }).notNull().default('默认分组'),
  /** 词频权重（越大越优先成词），jieba 用户词典格式 */
  weight: integer().notNull().default(1000),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_search_words_site_type_word_uq').on(t.siteId, t.type, t.word),
  index('cms_search_words_site_group_idx').on(t.siteId, t.type, t.groupName),
]);

export type CmsSearchWordRow = typeof cmsSearchWords.$inferSelect;

// ─── 可管理热词分组与词条（实时热度仍存 Redis ZSET）────────────────────────────
export const cmsHotwordGroups = pgTable('cms_hotword_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_hotword_groups_site_name_uq').on(t.siteId, t.name),
  index('cms_hotword_groups_site_sort_idx').on(t.siteId, t.sort),
]);

export type CmsHotwordGroupRow = typeof cmsHotwordGroups.$inferSelect;

export const cmsHotwords = pgTable('cms_hotwords', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  groupId: integer().references(() => cmsHotwordGroups.id, { onDelete: 'set null' }),
  keyword: varchar({ length: 100 }).notNull(),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_hotwords_site_keyword_uq').on(t.siteId, t.keyword),
  index('cms_hotwords_site_group_sort_idx').on(t.siteId, t.groupId, t.sort),
]);

export type CmsHotwordRow = typeof cmsHotwords.$inferSelect;

// ═══ P3 Batch5：采集中心 ════════════════════════════════════════════════════════

export const cmsCollectItemStatusEnum = pgEnum('cms_collect_item_status', ['success', 'skipped', 'failed']);

// ─── 采集规则（列表页翻页 + CSS 选择器抽取，任务中心执行）───────────────────────
export const cmsCollectRules = pgTable('cms_collect_rules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 采集入库的目标栏目 */
  channelId: integer().notNull().references(() => cmsChannels.id, { onDelete: 'restrict' }),
  name: varchar({ length: 100 }).notNull(),
  /** 列表页 URL 模板，{page} 占位翻页（无占位则只抓单页） */
  listUrl: varchar({ length: 500 }).notNull(),
  pageStart: integer().notNull().default(1),
  pageEnd: integer().notNull().default(1),
  /** 列表页条目链接选择器（a 元素或含 a 的容器） */
  listSelector: varchar({ length: 200 }).notNull(),
  titleSelector: varchar({ length: 200 }).notNull(),
  bodySelector: varchar({ length: 200 }).notNull(),
  summarySelector: varchar({ length: 200 }),
  coverSelector: varchar({ length: 200 }),
  /** 正文清洗：待移除节点的选择器数组（广告/推荐位等） */
  removeSelectors: jsonb().$type<string[]>().notNull().default([]),
  /** 采集后直接发布（否则入草稿箱待人工处理） */
  autoPublish: boolean().notNull().default(false),
  /** 正文远程图片本地化（下载转存文件中心并替换 src） */
  localizeImages: boolean().notNull().default(false),
  /** 单次执行最大采集条数 */
  maxItems: integer().notNull().default(50),
  status: statusEnum().notNull().default('enabled'),
  lastRunAt: timestamp(),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('cms_collect_rules_channel_idx').on(t.channelId), 
  index('cms_collect_rules_site_idx').on(t.siteId),
]);

export type CmsCollectRuleRow = typeof cmsCollectRules.$inferSelect;

// ─── 采集明细（URL 去重 + 结果留痕）────────────────────────────────────────────
export const cmsCollectItems = pgTable('cms_collect_items', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ruleId: integer().notNull().references(() => cmsCollectRules.id, { onDelete: 'cascade' }),
  url: varchar({ length: 500 }).notNull(),
  title: varchar({ length: 255 }),
  status: cmsCollectItemStatusEnum().notNull(),
  /** 成功入库的内容 id */
  contentId: integer().references(() => cmsContents.id, { onDelete: 'set null' }),
  error: varchar({ length: 500 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('cms_collect_items_content_idx').on(t.contentId), 
  uniqueIndex('cms_collect_items_rule_url_uq').on(t.ruleId, t.url),
  index('cms_collect_items_rule_idx').on(t.ruleId, t.createdAt),
]);

export type CmsCollectItemRow = typeof cmsCollectItems.$inferSelect;

// ═══ 页面部件与可视化页面搭建 ══════════════════════════════════════════════════

// ─── 页面部件：结构化草稿 + 当前线上快照，不维护历史版本 ────────────────────────
export const cmsWidgets = pgTable('cms_widgets', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 100 }).notNull(),
  type: cmsWidgetTypeEnum().notNull().default('manual-list'),
  schemaVersion: integer().notNull().default(1),
  draftData: jsonb().$type<CmsWidgetData>().notNull().default({ items: [] }),
  publishedData: jsonb().$type<CmsWidgetData>(),
  publishedName: varchar({ length: 100 }),
  draftRevision: integer().notNull().default(1),
  publishedRevision: integer().notNull().default(0),
  status: cmsWidgetStatusEnum().notNull().default('draft'),
  defaultRendererKey: varchar({ length: 50 }).notNull().default('list-sidebar'),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_widgets_site_code_uq').on(t.siteId, t.code),
  index('cms_widgets_site_status_idx').on(t.siteId, t.status),
]);

export type CmsWidgetRow = typeof cmsWidgets.$inferSelect;
export type NewCmsWidget = typeof cmsWidgets.$inferInsert;

/**
 * 部件放置/反向引用。
 * page 行由 cms_pages.blocks 同步生成；theme_slot 行本身就是站点插槽绑定。
 */
export const cmsWidgetRefs = pgTable('cms_widget_refs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  widgetId: integer().notNull().references(() => cmsWidgets.id, { onDelete: 'cascade' }),
  ownerType: cmsWidgetRefOwnerTypeEnum().notNull(),
  /** page = cms_pages.id；theme_slot = cms_sites.id */
  ownerId: integer().notNull(),
  /** page = block.id；theme_slot = slot key */
  field: varchar({ length: 100 }).notNull(),
  rendererKey: varchar({ length: 50 }).notNull(),
  styleProps: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_widget_refs_owner_field_uq').on(t.ownerType, t.ownerId, t.field),
  index('cms_widget_refs_widget_idx').on(t.widgetId),
  index('cms_widget_refs_site_owner_idx').on(t.siteId, t.ownerType, t.ownerId),
]);

export type CmsWidgetRefRow = typeof cmsWidgetRefs.$inferSelect;

/** 已发布部件对实时内容/栏目的依赖索引；发布时整体重建，下线时清空。 */
export const cmsWidgetSourceRefs = pgTable('cms_widget_source_refs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  widgetId: integer().notNull().references(() => cmsWidgets.id, { onDelete: 'cascade' }),
  itemId: varchar({ length: 100 }).notNull(),
  sourceType: cmsWidgetSourceTypeEnum().notNull(),
  sourceId: integer().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_widget_source_refs_widget_item_uq').on(t.widgetId, t.itemId),
  index('cms_widget_source_refs_source_idx').on(t.sourceType, t.sourceId),
  index('cms_widget_source_refs_site_idx').on(t.siteId),
]);

export type CmsWidgetSourceRefRow = typeof cmsWidgetSourceRefs.$inferSelect;

// ─── 自定义页面（区块 JSON 装配，前台 /p/{slug}/；isHome 可接管站点首页）────────
export const cmsPages = pgTable('cms_pages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar({ length: 100 }).notNull(),
  /** 前台路径：/p/{slug}/ */
  slug: varchar({ length: 100 }).notNull(),
  /**
   * 自定义访问路径（不含前后斜杠，如 `about` / `zh/about` / `about.html`）。
   * 为空时回落 `p/{slug}/`。站点内唯一，且保存时校验不与保留路径、栏目路径冲突。
   */
  path: varchar({ length: 200 }),
  /** 接管站点首页（每站点最多一个生效） */
  isHome: boolean().notNull().default(false),
  /** 区块数组：{ id, type, props, displayCondition? }[]，类型见 shared CmsPageBlock */
  blocks: jsonb().$type<{
    id: string;
    type: string;
    props: Record<string, unknown>;
    displayCondition?: { audience: 'always' | 'guest' | 'member'; startAt?: string | null; endAt?: string | null };
  }[]>().notNull().default([]),
  /** guest/member 条件存在时为 true；静态构建和混合回写必须跳过。 */
  requiresDynamic: boolean().notNull().default(false),
  seoTitle: varchar({ length: 255 }),
  seoKeywords: varchar({ length: 500 }),
  seoDescription: varchar({ length: 500 }),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_pages_site_slug_uq').on(t.siteId, t.slug),
  // path 可空，仅对已设置的行做站点内唯一约束
  uniqueIndex('cms_pages_site_path_uq').on(t.siteId, t.path).where(sql`${t.path} IS NOT NULL`),
  index('cms_pages_site_idx').on(t.siteId),
]);

export type CmsPageRow = typeof cmsPages.$inferSelect;

// ─── 页面区块管理 ACL（配置后 fail-closed；未配置继承页面编辑权限）─────────────
export const cmsPageBlockAcls = pgTable('cms_page_block_acls', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  pageId: integer().notNull().references(() => cmsPages.id, { onDelete: 'cascade' }),
  blockId: varchar({ length: 100 }).notNull(),
  subjectType: cmsPageBlockAclSubjectTypeEnum().notNull(),
  subjectId: integer().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_page_block_acls_grant_uq').on(t.pageId, t.blockId, t.subjectType, t.subjectId),
  index('cms_page_block_acls_block_idx').on(t.pageId, t.blockId),
  index('cms_page_block_acls_subject_idx').on(t.subjectType, t.subjectId),
]);

export type CmsPageBlockAclRow = typeof cmsPageBlockAcls.$inferSelect;

// ─── CMS 发布产物事实（队列状态复用 async_tasks，不另建发布任务表）──────────────
export const cmsPublishArtifacts = pgTable('cms_publish_artifacts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  taskId: integer().notNull().references(() => asyncTasks.id, { onDelete: 'cascade' }),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  targetType: cmsPublishTargetTypeEnum().notNull(),
  contentId: integer().references(() => cmsContents.id, { onDelete: 'set null' }),
  channelId: integer().references(() => cmsChannels.id, { onDelete: 'set null' }),
  pageId: integer().references(() => cmsPages.id, { onDelete: 'set null' }),
  themeCode: varchar({ length: 50 }),
  path: varchar({ length: 1000 }).notNull(),
  url: varchar({ length: 1000 }),
  checksum: varchar({ length: 64 }),
  size: integer(),
  /** 写入该产物时站点的公开修订号；用于拒绝旧任务晚写的文件。 */
  publicRevision: integer().notNull().default(0),
  status: cmsPublishArtifactStatusEnum().notNull(),
  error: text(),
  generatedAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('cms_publish_artifacts_content_idx').on(t.contentId), index('cms_publish_artifacts_channel_idx').on(t.channelId), 
  uniqueIndex('cms_publish_artifacts_task_path_uq').on(t.taskId, t.path),
  index('cms_publish_artifacts_site_time_idx').on(t.siteId, t.createdAt),
  index('cms_publish_artifacts_task_status_idx').on(t.taskId, t.status),
  index('cms_publish_artifacts_target_idx').on(t.targetType, t.contentId, t.channelId),
]);

export type CmsPublishArtifactRow = typeof cmsPublishArtifacts.$inferSelect;

// ═══ P2 素材中心 ═══════════════════════════════════════════════════════════════

// ─── 素材（站点级资源库：图片经站点管线处理；删除前校验站内引用）─────────────────
export const cmsResourceTypeEnum = pgEnum('cms_resource_type', ['image', 'video', 'audio', 'document', 'other']);

export const cmsResourceFolders = pgTable('cms_resource_folders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** null = 根目录；规范化自关联，删除前由 service 做非空保护 */
  parentId: integer().references((): AnyPgColumn => cmsResourceFolders.id, { onDelete: 'restrict' }),
  name: varchar({ length: 100 }).notNull(),
  sort: integer().notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('cms_resource_folders_parent_idx').on(t.parentId), 
  uniqueIndex('cms_resource_folders_site_parent_name_uq').on(t.siteId, t.parentId, t.name)
    .where(sql`${t.parentId} is not null`),
  uniqueIndex('cms_resource_folders_site_root_name_uq').on(t.siteId, t.name)
    .where(sql`${t.parentId} is null`),
  index('cms_resource_folders_site_parent_idx').on(t.siteId, t.parentId),
]);

export type CmsResourceFolderRow = typeof cmsResourceFolders.$inferSelect;

export const cmsResources = pgTable('cms_resources', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  folderId: integer().references(() => cmsResourceFolders.id, { onDelete: 'set null' }),
  type: cmsResourceTypeEnum().notNull().default('image'),
  name: varchar({ length: 255 }).notNull(),
  url: varchar({ length: 500 }).notNull(),
  thumbUrl: varchar({ length: 500 }),
  /** 底层 managed_files id（手动登记的外链素材为 null） */
  fileId: pgUuid(),
  /**
   * 本素材是否拥有底层物理文件。
   *
   * `false` 表示文件由别处（文件中心、来源站点）持有，本行只是引用登记：
   * 从文件中心选图时自动登记的素材、站点导入复制出的素材都属于这类。
   * 删除素材时只有 `true` 才允许联动删除物理文件，否则会把其他模块/站点还在用的文件删掉。
   */
  ownsFile: boolean().notNull().default(true),
  size: integer().notNull().default(0),
  width: integer(),
  height: integer(),
  mimeType: varchar({ length: 128 }),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_resources_site_type_idx').on(t.siteId, t.type),
  index('cms_resources_site_folder_idx').on(t.siteId, t.folderId),
  index('cms_resources_file_idx').on(t.fileId),
  // URL → 素材 id 归一化查询依赖它，同时防止同站点重复登记同一文件
  uniqueIndex('cms_resources_site_url_uq').on(t.siteId, t.url),
]);

export type CmsResourceRow = typeof cmsResources.$inferSelect;

/**
 * 素材反向引用索引。
 *
 * 素材在业务对象中以 `cms-res://{id}` 句柄存储，owner 每次写入时在**同一事务内**
 * 按 owner 维度整体重建自己的引用行（先删后插），因此索引不会漂移。
 * 孤立素材判定、删除保护与引用明细全部由本表的索引查询完成，
 * 取代原先「按 URL 子串对 9 张表做全表 LIKE 扫描」的 O(N×M) 实现。
 */
export const cmsResourceRefs = pgTable('cms_resource_refs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  resourceId: integer().notNull().references(() => cmsResources.id, { onDelete: 'cascade' }),
  ownerType: cmsResourceOwnerTypeEnum().notNull(),
  ownerId: integer().notNull(),
  /** 承载引用的字段路径，如 coverImage / body / extend.photos */
  field: varchar({ length: 64 }).notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_resource_refs_uq').on(t.resourceId, t.ownerType, t.ownerId, t.field),
  index('cms_resource_refs_resource_idx').on(t.resourceId),
  index('cms_resource_refs_site_idx').on(t.siteId),
  index('cms_resource_refs_owner_idx').on(t.ownerType, t.ownerId),
]);

export type CmsResourceRefRow = typeof cmsResourceRefs.$inferSelect;

/**
 * 开放应用的 CMS 站点/栏目授权（Headless 写入的 fail-closed 边界）。
 *
 * 持有 `cms:write` scope 只说明「这个应用可以调用写接口」，不等于「可以写任意站点」。
 * 与人类侧的 `cms_site_users` / `cms_channel_users` 同构：未显式授权一律拒绝。
 */
export const cmsOpenAppGrants = pgTable('cms_open_app_grants', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 开放应用 AppKey（= oauth2_clients.client_id） */
  clientId: varchar({ length: 64 }).notNull(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 允许写入的栏目 id；空数组 = 该站点全部栏目 */
  channelIds: integer().array().notNull().default([]),
  /** 是否允许直接发布（还需 cms:publish scope 与站点开关同时成立） */
  canPublish: boolean().notNull().default(false),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 200 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_open_app_grants_client_site_uq').on(t.clientId, t.siteId),
  index('cms_open_app_grants_client_idx').on(t.clientId),
  index('cms_open_app_grants_site_idx').on(t.siteId),
]);

export type CmsOpenAppGrantRow = typeof cmsOpenAppGrants.$inferSelect;

/**
 * 内容硬删除墓碑，供 Headless 增量同步输出 `op=delete`。
 *
 * 回收站是软删（同步侧表现为 `offline`），但「彻底删除」会让行消失，
 * 客户端按 `updated_at` 游标永远拉不到这条变更，本地缓存会残留已删内容。
 */
export const cmsContentTombstones = pgTable('cms_content_tombstones', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  contentId: integer().notNull(),
  deletedAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_content_tombstones_content_uq').on(t.contentId),
  index('cms_content_tombstones_sync_idx').on(t.siteId, t.deletedAt, t.contentId),
]);

export type CmsContentTombstoneRow = typeof cmsContentTombstones.$inferSelect;
