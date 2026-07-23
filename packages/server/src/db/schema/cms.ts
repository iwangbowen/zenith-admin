import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, text, jsonb, uniqueIndex, index, customType, uuid as pgUuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, users, departments } from './core';
import { members } from './member';
import { asyncTasks } from './tasks';
import {
  CMS_PUBLISH_ARTIFACT_STATUSES,
  CMS_PUBLISH_TARGET_TYPES,
  CMS_AD_EVENT_TYPES,
  CMS_DEVICE_TYPES,
  CMS_INTERACTION_CAPTCHA_POLICIES,
  CMS_INTERACTION_KINDS,
  CMS_INTERACTION_PARTICIPANT_SCOPES,
  CMS_INTERACTION_QUESTION_TYPES,
  CMS_INTERACTION_REPEAT_POLICIES,
  CMS_INTERACTION_RESULT_VISIBILITIES,
  CMS_INTERACTION_STATUSES,
  CMS_SUBSCRIPTION_SUBJECT_TYPES,
  CMS_TEMPLATE_SOURCES,
  CMS_TEMPLATE_TYPES,
  CMS_THEME_DEPLOYMENT_STATUSES,
  CMS_THEME_PACKAGE_STATUSES,
  type CmsTemplateDslDocument,
  type CmsThemePackageManifest,
  type CmsThemePackageValidationReport,
} from '@zenith/shared';

// ─── 枚举（pgEnum / TS union / Zod enum 三处同步，见 @zenith/shared）────────────
export const cmsStaticModeEnum = pgEnum('cms_static_mode', ['dynamic', 'hybrid', 'static']);
export const cmsChannelTypeEnum = pgEnum('cms_channel_type', ['list', 'page', 'link']);
export const cmsContentStatusEnum = pgEnum('cms_content_status', ['draft', 'pending', 'published', 'offline', 'rejected']);
/** 内容形态：article=图文 album=图集 media=音视频 link=外链 */
export const cmsContentTypeEnum = pgEnum('cms_content_type', ['article', 'album', 'media', 'link']);
export const cmsFieldTypeEnum = pgEnum('cms_field_type', ['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch']);
export const cmsFragmentTypeEnum = pgEnum('cms_fragment_type', ['html', 'text', 'image', 'json']);
export const cmsSearchWordTypeEnum = pgEnum('cms_search_word_type', ['extension', 'stop']);
export const cmsFormCaptchaProviderEnum = pgEnum('cms_form_captcha_provider', ['inherit', 'none', 'math', 'turnstile']);
export const cmsTemplateTypeEnum = pgEnum('cms_template_type', CMS_TEMPLATE_TYPES);
export const cmsTemplateSourceEnum = pgEnum('cms_template_source', CMS_TEMPLATE_SOURCES);
export const cmsThemePackageStatusEnum = pgEnum('cms_theme_package_status', CMS_THEME_PACKAGE_STATUSES);
export const cmsThemeDeploymentStatusEnum = pgEnum('cms_theme_deployment_status', CMS_THEME_DEPLOYMENT_STATUSES);
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

/** PostgreSQL tsvector 列（drizzle 无内置类型），存全文检索向量 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ─── CMS 站点（站群支持：一站一域名一主题）──────────────────────────────────────
export const cmsSites = pgTable('cms_sites', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  /** 站点唯一标识：静态目录名 / 预览路径（/__cms/{code}）*/
  code: varchar('code', { length: 50 }).notNull().unique(),
  /** 绑定主域名（host，如 www.example.com），前台按 Host 匹配站点 */
  domain: varchar('domain', { length: 255 }),
  /** 别名域名列表（同样路由到本站点） */
  aliasDomains: jsonb('alias_domains').$type<string[]>().notNull().default([]),
  /** 未匹配到域名时的兜底默认站点（全局至多一个） */
  isDefault: boolean('is_default').notNull().default(false),
  // SEO 默认值（站点级 TDK，可被栏目/内容覆盖）
  title: varchar('title', { length: 200 }),
  keywords: varchar('keywords', { length: 500 }),
  description: varchar('description', { length: 1000 }),
  logo: varchar('logo', { length: 500 }),
  favicon: varchar('favicon', { length: 500 }),
  icp: varchar('icp', { length: 100 }),
  copyright: varchar('copyright', { length: 255 }),
  /** 主题包名（cms/themes/registry 注册的主题） */
  theme: varchar('theme', { length: 50 }).notNull().default('default'),
  /** 主题生命周期事件修订号；每次激活/停用/回滚原子 +1，并进入发布任务幂等键。 */
  themeRevision: integer('theme_revision').notNull().default(0),
  /** 站点/栏目/内容/页面模板引用修订号；引用写入与主题健康检查的 TOCTOU 屏障。 */
  templateRefsRevision: integer('template_refs_revision').notNull().default(0),
  /** 静态化模式：dynamic=纯 SSR；hybrid=miss 渲染并回写静态；static=仅发布时生成 */
  staticMode: cmsStaticModeEnum('static_mode').notNull().default('hybrid'),
  /** robots.txt 内容（每站点独立） */
  robots: text('robots'),
  /** 主题参数 / URL 规则等站点级配置 */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_sites_domain_uq').on(t.domain).where(sql`${t.domain} is not null`),
  uniqueIndex('cms_sites_default_uq').on(t.isDefault).where(sql`${t.isDefault} = true`),
]);

export type CmsSiteRow = typeof cmsSites.$inferSelect;
export type NewCmsSite = typeof cmsSites.$inferInsert;

// ─── CMS 发布通道（用户自建的输出端维度：PC/H5/小程序/大屏…）────────────────────
export const cmsPublishChannels = pgTable('cms_publish_channels', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  /** 通道编码（站点内唯一）：预览路径段 /__cms/{site}/__{code}、静态子树 __{code}/ */
  code: varchar('code', { length: 50 }).notNull(),
  /** 通道独立域名（host）；默认通道使用站点主域名，此字段留空 */
  domain: varchar('domain', { length: 255 }),
  /** UA 匹配正则（与 domain 同时配置时启用默认通道 ↔ 本通道的 UA 302 互跳） */
  uaRegex: varchar('ua_regex', { length: 255 }),
  /** 默认通道（每站点唯一）：服务静态根目录，不可删除/停用 */
  isDefault: boolean('is_default').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_publish_channels_site_code_uq').on(t.siteId, t.code),
]);

export type CmsPublishChannelRow = typeof cmsPublishChannels.$inferSelect;
export type NewCmsPublishChannel = typeof cmsPublishChannels.$inferInsert;

// ─── CMS 签名主题包版本（仅声明式模板与静态资源，不存私钥）──────────────────────
export const cmsThemePackages = pgTable('cms_theme_packages', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  version: varchar('version', { length: 64 }).notNull(),
  engineMin: integer('engine_min').notNull(),
  engineMax: integer('engine_max').notNull(),
  signingKeyId: varchar('signing_key_id', { length: 64 }).notNull(),
  archiveChecksum: varchar('archive_checksum', { length: 64 }).notNull(),
  manifest: jsonb('manifest').$type<CmsThemePackageManifest>().notNull(),
  validationReport: jsonb('validation_report').$type<CmsThemePackageValidationReport>().notNull(),
  /** CMS_THEME_STORAGE_ROOT 下的相对目录；API 永不暴露物理绝对路径。 */
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  status: cmsThemePackageStatusEnum('status').notNull().default('validated'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_theme_packages_code_version_uq').on(t.code, t.version),
  uniqueIndex('cms_theme_packages_archive_checksum_uq').on(t.archiveChecksum),
  index('cms_theme_packages_code_status_idx').on(t.code, t.status),
]);

export type CmsThemePackageRow = typeof cmsThemePackages.$inferSelect;
export type NewCmsThemePackage = typeof cmsThemePackages.$inferInsert;

// ─── CMS 模板逻辑实体（版本只追加；site_id=null 表示主题级全局模板）──────────────
export const cmsTemplates = pgTable('cms_templates', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').references(() => cmsSites.id, { onDelete: 'cascade' }),
  themeCode: varchar('theme_code', { length: 50 }).notNull(),
  type: cmsTemplateTypeEnum('type').notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  source: cmsTemplateSourceEnum('source').notNull().default('manual'),
  status: statusEnum('status').notNull().default('enabled'),
  currentVersion: integer('current_version').notNull().default(1),
  activeVersion: integer('active_version'),
  /** 模板生命周期事件修订号；每次激活/停用/回滚原子 +1。 */
  lifecycleRevision: integer('lifecycle_revision').notNull().default(0),
  description: varchar('description', { length: 500 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_templates_global_code_uq').on(t.themeCode, t.type, t.code)
    .where(sql`${t.siteId} is null`),
  uniqueIndex('cms_templates_site_code_uq').on(t.siteId, t.themeCode, t.type, t.code)
    .where(sql`${t.siteId} is not null`),
  index('cms_templates_site_theme_idx').on(t.siteId, t.themeCode, t.status),
]);

export type CmsTemplateRow = typeof cmsTemplates.$inferSelect;
export type NewCmsTemplate = typeof cmsTemplates.$inferInsert;

export const cmsTemplateVersions = pgTable('cms_template_versions', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').notNull().references(() => cmsTemplates.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  dsl: jsonb('dsl').$type<CmsTemplateDslDocument>().notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  changeNote: varchar('change_note', { length: 500 }),
  themePackageId: integer('theme_package_id').references(() => cmsThemePackages.id, { onDelete: 'set null' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_template_versions_template_version_uq').on(t.templateId, t.version),
  index('cms_template_versions_package_idx').on(t.themePackageId),
]);

export type CmsTemplateVersionRow = typeof cmsTemplateVersions.$inferSelect;
export type NewCmsTemplateVersion = typeof cmsTemplateVersions.$inferInsert;

// ─── 主题包站点部署历史；部分唯一索引保证每个站点仅一个 active ─────────────────
export const cmsThemeDeployments = pgTable('cms_theme_deployments', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  themeCode: varchar('theme_code', { length: 50 }).notNull(),
  themePackageId: integer('theme_package_id').notNull().references(() => cmsThemePackages.id, { onDelete: 'restrict' }),
  status: cmsThemeDeploymentStatusEnum('status').notNull().default('active'),
  activatedAt: timestamp('activated_at').defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_theme_deployments_site_package_uq').on(t.siteId, t.themePackageId),
  uniqueIndex('cms_theme_deployments_site_active_uq').on(t.siteId)
    .where(sql`${t.status} = 'active'`),
  index('cms_theme_deployments_site_history_idx').on(t.siteId, t.themeCode, t.activatedAt),
]);

export type CmsThemeDeploymentRow = typeof cmsThemeDeployments.$inferSelect;

// ─── CMS 内容模型（元数据驱动的自定义字段体系）─────────────────────────────────
export const cmsModels = pgTable('cms_models', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  description: text('description'),
  /** 系统内置模型（article/page 等）不可删除 */
  isSystem: boolean('is_system').notNull().default(false),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsModelRow = typeof cmsModels.$inferSelect;
export type NewCmsModel = typeof cmsModels.$inferInsert;

// ─── CMS 模型字段定义（内容 extend JSONB 的字段元数据）──────────────────────────
export const cmsModelFields = pgTable('cms_model_fields', {
  id: serial('id').primaryKey(),
  modelId: integer('model_id').notNull().references(() => cmsModels.id, { onDelete: 'cascade' }),
  /** 字段标识（extend JSONB 的 key，小写字母/数字/下划线） */
  name: varchar('name', { length: 50 }).notNull(),
  label: varchar('label', { length: 100 }).notNull(),
  fieldType: cmsFieldTypeEnum('field_type').notNull().default('text'),
  required: boolean('required').notNull().default(false),
  /** 是否纳入全文检索索引 */
  searchable: boolean('searchable').notNull().default(false),
  /** 是否在内容列表中显示 */
  showInList: boolean('show_in_list').notNull().default(false),
  placeholder: varchar('placeholder', { length: 200 }),
  defaultValue: text('default_value'),
  /** select/radio/checkbox 的选项 */
  options: jsonb('options').$type<{ label: string; value: string }[]>(),
  sort: integer('sort').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_model_fields_model_name_uq').on(t.modelId, t.name),
]);

export type CmsModelFieldRow = typeof cmsModelFields.$inferSelect;
export type NewCmsModelField = typeof cmsModelFields.$inferInsert;

// ─── CMS 栏目（树形，list=列表 / page=单页 / link=外链）─────────────────────────
export const cmsChannels = pgTable('cms_channels', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 父栏目 id，0 = 顶级（与 menus 表约定一致，删除守卫在 service 层） */
  parentId: integer('parent_id').notNull().default(0),
  modelId: integer('model_id').references(() => cmsModels.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 100 }).notNull(),
  /** URL 路径段（本级） */
  slug: varchar('slug', { length: 100 }).notNull(),
  /** 完整 URL 路径（各级 slug 以 / 连接，保存时由 service 重算） */
  path: varchar('path', { length: 255 }).notNull(),
  type: cmsChannelTypeEnum('type').notNull().default('list'),
  /** type=link 时的跳转地址 */
  linkUrl: varchar('link_url', { length: 500 }),
  /** 覆盖主题默认模板名（列表页 / 详情页） */
  listTemplate: varchar('list_template', { length: 50 }),
  detailTemplate: varchar('detail_template', { length: 50 }),
  pageSize: integer('page_size').notNull().default(20),
  /** type=page 时的单页富文本内容 */
  pageContent: text('page_content'),
  // 栏目级 SEO（覆盖站点默认）
  seoTitle: varchar('seo_title', { length: 255 }),
  seoKeywords: varchar('seo_keywords', { length: 500 }),
  seoDescription: varchar('seo_description', { length: 500 }),
  image: varchar('image', { length: 500 }),
  /** 是否在前台导航显示 */
  visible: boolean('visible').notNull().default(true),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_channels_site_path_uq').on(t.siteId, t.path),
  index('cms_channels_site_parent_idx').on(t.siteId, t.parentId),
]);

export type CmsChannelRow = typeof cmsChannels.$inferSelect;
export type NewCmsChannel = typeof cmsChannels.$inferInsert;

// ─── CMS 内容（全站统一表 + JSONB 扩展字段 + tsvector 检索向量）─────────────────
export const cmsContents = pgTable('cms_contents', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  channelId: integer('channel_id').notNull().references(() => cmsChannels.id, { onDelete: 'restrict' }),
  modelId: integer('model_id').references(() => cmsModels.id, { onDelete: 'set null' }),
  /** 内容形态（P2 多形态内容类型；创建后不可变更） */
  contentType: cmsContentTypeEnum('content_type').notNull().default('article'),
  /** 形态结构化数据：album={images:[{url,thumb?,caption?}]} media={mediaType,mediaUrl,poster?,duration?} */
  mediaData: jsonb('media_data').$type<Record<string, unknown>>().notNull().default({}),
  title: varchar('title', { length: 255 }).notNull(),
  /** 副标题（P1 内容字段增强） */
  subTitle: varchar('sub_title', { length: 255 }),
  /** 短标题（列表窄位展示） */
  shortTitle: varchar('short_title', { length: 100 }),
  /** 自定义 URL 名（可空，默认用 id 生成 URL） */
  slug: varchar('slug', { length: 255 }),
  summary: text('summary'),
  coverImage: varchar('cover_image', { length: 500 }),
  /** 封面缩略图（上传管线按站点配置生成；空 = 前台回退原图） */
  coverThumb: varchar('cover_thumb', { length: 500 }),
  author: varchar('author', { length: 50 }),
  /** 责任编辑 */
  editor: varchar('editor', { length: 50 }),
  source: varchar('source', { length: 100 }),
  /** 来源链接 */
  sourceUrl: varchar('source_url', { length: 500 }),
  /** 原创标记 */
  isOriginal: boolean('is_original').notNull().default(false),
  /** 正文富文本 HTML */
  body: text('body'),
  /** 模型自定义字段值（key = cms_model_fields.name） */
  extend: jsonb('extend').$type<Record<string, unknown>>().notNull().default({}),
  /** 外链型内容：点击直接跳转 */
  externalLink: varchar('external_link', { length: 500 }),
  /** 详情模板覆盖（主题变体模板名；null = 跟随栏目/站点默认） */
  detailTemplate: varchar('detail_template', { length: 50 }),
  isTop: boolean('is_top').notNull().default(false),
  /** 置顶权重（数值越大越靠前，isTop=true 时生效） */
  topWeight: integer('top_weight').notNull().default(0),
  /** 置顶到期时间（到期由周期任务自动取消置顶；空 = 永久置顶） */
  topExpireAt: timestamp('top_expire_at'),
  isRecommend: boolean('is_recommend').notNull().default(false),
  isHot: boolean('is_hot').notNull().default(false),
  /** 内容属性自动标记（保存时按正文/形态数据/封面自动检测，列表展示图标） */
  hasImage: boolean('has_image').notNull().default(false),
  hasVideo: boolean('has_video').notNull().default(false),
  hasAttachment: boolean('has_attachment').notNull().default(false),
  status: cmsContentStatusEnum('status').notNull().default('draft'),
  rejectReason: varchar('reject_reason', { length: 500 }),
  publishedAt: timestamp('published_at'),
  /** 定时发布时间（P2 调度使用，先建列） */
  scheduledAt: timestamp('scheduled_at'),
  /** 过期自动下线时间（到期由周期任务下线，空 = 永不过期） */
  expireAt: timestamp('expire_at'),
  viewCount: integer('view_count').notNull().default(0),
  /** 会员点赞数（cms_content_likes 冗余计数，原子回写） */
  likeCount: integer('like_count').notNull().default(0),
  /** 会员收藏数（cms_content_favorites 冗余计数，原子回写） */
  favoriteCount: integer('favorite_count').notNull().default(0),
  /** 乐观锁版本号（每次更新 +1；更新携带 expectedVersion 不一致时拒绝，防并发编辑覆盖） */
  version: integer('version').notNull().default(1),
  sort: integer('sort').notNull().default(0),
  // 内容级 SEO（覆盖栏目/站点默认）
  seoTitle: varchar('seo_title', { length: 255 }),
  seoKeywords: varchar('seo_keywords', { length: 500 }),
  seoDescription: varchar('seo_description', { length: 500 }),
  /** Social SEO 图片替代文本与 Twitter 作者账号 */
  socialImageAlt: varchar('social_image_alt', { length: 255 }),
  twitterCreator: varchar('twitter_creator', { length: 100 }),
  /** 全文检索向量（应用层 jieba 分词后写入，'simple' parser + setweight A/B/C） */
  searchVector: tsvector('search_vector'),
  /** 回收站：非空表示已进回收站 */
  deletedAt: timestamp('deleted_at'),
  /** 归档：非空表示已归档（前台详情保留，不参与列表聚合；仅已发布/已下线内容可归档） */
  archivedAt: timestamp('archived_at'),
  /** 映射来源内容 id：非空表示本内容为“映射”（正文/扩展字段共享来源内容，禁止独立编辑） */
  mappingSourceId: integer('mapping_source_id').references((): AnyPgColumn => cmsContents.id, { onDelete: 'set null' }),
  /** 会员投稿：非空表示由前台会员提交（P3 会员投稿） */
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  /** 部门归属（P5 部门数据权限：创建时快照创建人部门；投稿/导入为 null） */
  deptId: integer('dept_id').references(() => departments.id, { onDelete: 'set null' }),
  /** 管理员持久化合规锁（与 Redis 120s 编辑协作锁、version 乐观锁相互独立） */
  lockedAt: timestamp('locked_at'),
  lockedBy: integer('locked_by').references(() => users.id, { onDelete: 'set null' }),
  lockReason: varchar('lock_reason', { length: 500 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_contents_site_channel_idx').on(t.siteId, t.channelId),
  index('cms_contents_status_idx').on(t.status),
  index('cms_contents_published_at_idx').on(t.publishedAt),
  index('cms_contents_search_idx').using('gin', t.searchVector),
  index('cms_contents_member_idx').on(t.memberId),
  index('cms_contents_mapping_source_idx').on(t.mappingSourceId),
  index('cms_contents_locked_at_idx').on(t.lockedAt),
  uniqueIndex('cms_contents_site_slug_uq').on(t.siteId, t.slug)
    .where(sql`${t.slug} is not null and ${t.deletedAt} is null`),
]);

export type CmsContentRow = typeof cmsContents.$inferSelect;
export type NewCmsContent = typeof cmsContents.$inferInsert;

// ─── CMS 内容操作日志（内容级时间线：创建/发布/驳回/归档等；随内容级联删除）────────
export const cmsContentOpLogs = pgTable('cms_content_op_logs', {
  id: serial('id').primaryKey(),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  /** 操作类型：created/updated/submitted/published/rejected/offlined/recycled/restored/rolled_back/archived/unarchived/moved */
  action: varchar('action', { length: 30 }).notNull(),
  /** 补充说明（驳回原因、移动目标栏目等） */
  detail: varchar('detail', { length: 500 }),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  /** 冗余操作人昵称（防用户删除后时间线失名；系统任务为“系统”） */
  operatorName: varchar('operator_name', { length: 50 }).notNull().default('系统'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('cms_content_op_logs_content_idx').on(t.contentId, t.createdAt),
]);

export type CmsContentOpLogRow = typeof cmsContentOpLogs.$inferSelect;

// ─── CMS 易错词库（编辑辅助：常见错误词 → 正确词，编辑器检查一键替换）────────────
export const cmsErrorProneWords = pgTable('cms_error_prone_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 50 }).notNull().unique(),
  /** 对应正确写法 */
  correction: varchar('correction', { length: 50 }).notNull(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsErrorProneWordRow = typeof cmsErrorProneWords.$inferSelect;

// ═══ P3 会员互动 ═══════════════════════════════════════════════════════════════

// ─── 内容点赞（会员×内容唯一；计数冗余在 cms_contents.like_count）────────────────
export const cmsContentLikes = pgTable('cms_content_likes', {
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.memberId, t.contentId] }),
  index('cms_content_likes_content_idx').on(t.contentId),
]);

export type CmsContentLikeRow = typeof cmsContentLikes.$inferSelect;

// ─── 内容收藏（会员×内容唯一；计数冗余在 cms_contents.favorite_count）───────────
export const cmsContentFavorites = pgTable('cms_content_favorites', {
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.memberId, t.contentId] }),
  index('cms_content_favorites_content_idx').on(t.contentId),
  index('cms_content_favorites_member_idx').on(t.memberId, t.createdAt),
]);

export type CmsContentFavoriteRow = typeof cmsContentFavorites.$inferSelect;

// ─── 会员浏览历史（会员×内容去重累计；每人保留最近 100 条由 service 裁剪）─────────
export const cmsMemberViewHistory = pgTable('cms_member_view_history', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 重复浏览累计次数 */
  viewCount: integer('view_count').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_member_view_history_uq').on(t.memberId, t.contentId),
  index('cms_member_view_history_member_idx').on(t.memberId, t.updatedAt),
]);

export type CmsMemberViewHistoryRow = typeof cmsMemberViewHistory.$inferSelect;

// ─── CMS 会员订阅（取消采用 inactive 留痕，保留首次积分幂等事实）────────────────
export const cmsMemberSubscriptions = pgTable('cms_member_subscriptions', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  subjectType: cmsSubscriptionSubjectTypeEnum('subject_type').notNull(),
  /** site/channel 使用十进制 ID 字符串；author 使用 NFKC + trim + lowercase 后的稳定键。 */
  subjectKey: varchar('subject_key', { length: 255 }).notNull(),
  /** site/channel 的实体 ID；author 为 null。 */
  subjectId: integer('subject_id'),
  /** 展示文本快照，不参与唯一性判定。 */
  subjectLabel: varchar('subject_label', { length: 255 }).notNull(),
  notificationEnabled: boolean('notification_enabled').notNull().default(true),
  active: boolean('active').notNull().default(true),
  /** 首次有效订阅积分已发放的持久化标记；取消/重新关注不会清除。 */
  pointsAwardedAt: timestamp('points_awarded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_member_subscriptions_subject_uq').on(t.memberId, t.siteId, t.subjectType, t.subjectKey),
  index('cms_member_subscriptions_member_idx').on(t.memberId, t.active, t.createdAt),
  index('cms_member_subscriptions_subject_idx').on(t.siteId, t.subjectType, t.subjectKey, t.active),
]);

export type CmsMemberSubscriptionRow = typeof cmsMemberSubscriptions.$inferSelect;

// ═══ Stage 4：统一互动问卷（survey / poll）══════════════════════════════════════

export const cmsInteractions = pgTable('cms_interactions', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  kind: cmsInteractionKindEnum('kind').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  status: cmsInteractionStatusEnum('status').notNull().default('draft'),
  participantScope: cmsInteractionParticipantScopeEnum('participant_scope').notNull().default('anonymous'),
  repeatPolicy: cmsInteractionRepeatPolicyEnum('repeat_policy').notNull().default('once_per_ip'),
  resultVisibility: cmsInteractionResultVisibilityEnum('result_visibility').notNull().default('after_submit'),
  captchaPolicy: cmsInteractionCaptchaPolicyEnum('captcha_policy').notNull().default('inherit'),
  turnstileSiteKey: varchar('turnstile_site_key', { length: 200 }),
  turnstileSecret: varchar('turnstile_secret', { length: 500 }),
  thankYouMessage: varchar('thank_you_message', { length: 500 }).notNull().default('感谢您的参与！'),
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  responseCount: integer('response_count').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_interactions_site_code_uq').on(t.siteId, t.code),
  index('cms_interactions_site_status_idx').on(t.siteId, t.status, t.kind),
]);

export type CmsInteractionRow = typeof cmsInteractions.$inferSelect;

export const cmsInteractionQuestions = pgTable('cms_interaction_questions', {
  id: serial('id').primaryKey(),
  interactionId: integer('interaction_id').notNull().references(() => cmsInteractions.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 200 }).notNull(),
  type: cmsInteractionQuestionTypeEnum('type').notNull().default('single'),
  required: boolean('required').notNull().default(true),
  options: jsonb('options').$type<{ id: string; label: string; value: string }[]>().notNull().default([]),
  minChoices: integer('min_choices').notNull().default(1),
  maxChoices: integer('max_choices').notNull().default(1),
  sort: integer('sort').notNull().default(0),
}, (t) => [
  index('cms_interaction_questions_parent_idx').on(t.interactionId, t.sort),
]);

export type CmsInteractionQuestionRow = typeof cmsInteractionQuestions.$inferSelect;

export const cmsInteractionResponses = pgTable('cms_interaction_responses', {
  id: serial('id').primaryKey(),
  interactionId: integer('interaction_id').notNull().references(() => cmsInteractions.id, { onDelete: 'cascade' }),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  visitorHash: varchar('visitor_hash', { length: 64 }).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }).notNull(),
  /** once_per_member / once_per_ip 的数据库去重键；multiple 为 null。 */
  repeatKey: varchar('repeat_key', { length: 80 }),
  /** 显式请求幂等键的摘要；同一互动内唯一。 */
  requestKey: varchar('request_key', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('cms_interaction_responses_parent_time_idx').on(t.interactionId, t.createdAt, t.id),
  index('cms_interaction_responses_member_idx').on(t.memberId, t.createdAt),
  uniqueIndex('cms_interaction_responses_repeat_uq').on(t.interactionId, t.repeatKey).where(sql`${t.repeatKey} is not null`),
  uniqueIndex('cms_interaction_responses_request_uq').on(t.interactionId, t.requestKey).where(sql`${t.requestKey} is not null`),
]);

export type CmsInteractionResponseRow = typeof cmsInteractionResponses.$inferSelect;

export const cmsInteractionAnswers = pgTable('cms_interaction_answers', {
  id: serial('id').primaryKey(),
  responseId: integer('response_id').notNull().references(() => cmsInteractionResponses.id, { onDelete: 'cascade' }),
  questionId: integer('question_id').notNull().references(() => cmsInteractionQuestions.id, { onDelete: 'cascade' }),
  value: jsonb('value').$type<string | string[]>().notNull(),
}, (t) => [
  uniqueIndex('cms_interaction_answers_response_question_uq').on(t.responseId, t.questionId),
  index('cms_interaction_answers_question_idx').on(t.questionId),
]);

export type CmsInteractionAnswerRow = typeof cmsInteractionAnswers.$inferSelect;

// ═══ P4 统计分析 ═══════════════════════════════════════════════════════════════

export const cmsDeviceTypeEnum = pgEnum('cms_device_type', CMS_DEVICE_TYPES);

// ─── 前台访问日志（服务端响应路径记录，静态命中同样统计；原始日志保留 90 天）──────
export const cmsVisitLogs = pgTable('cms_visit_logs', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 站内相对路径（含前导 /，截断 500） */
  path: varchar('path', { length: 500 }).notNull(),
  /** 页面类型：home/list/detail/page/search/tag 等（渲染 kind） */
  pageKind: varchar('page_kind', { length: 20 }).notNull().default('other'),
  /** 详情页关联内容（内容排行用） */
  contentId: integer('content_id'),
  /** 发布通道编码 */
  channelCode: varchar('channel_code', { length: 50 }).notNull().default('pc'),
  /** 访客标识（ip+ua 哈希，UV 去重用） */
  visitorHash: varchar('visitor_hash', { length: 32 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  deviceType: cmsDeviceTypeEnum('device_type').notNull().default('pc'),
  /** 来源页 Host（referrer 域名；直达为空） */
  referrerHost: varchar('referrer_host', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('cms_visit_logs_site_time_idx').on(t.siteId, t.createdAt),
  index('cms_visit_logs_content_idx').on(t.contentId).where(sql`${t.contentId} is not null`),
]);

export type CmsVisitLogRow = typeof cmsVisitLogs.$inferSelect;

// ─── 广告效果日聚合（曝光/点击；CTR 报表用）─────────────────────────────────────
export const cmsAdStats = pgTable('cms_ad_stats', {
  id: serial('id').primaryKey(),
  adId: integer('ad_id').notNull().references(() => cmsAds.id, { onDelete: 'cascade' }),
  /** 统计日（YYYY-MM-DD） */
  statDate: varchar('stat_date', { length: 10 }).notNull(),
  views: integer('views').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
}, (t) => [
  uniqueIndex('cms_ad_stats_ad_date_uq').on(t.adId, t.statDate),
]);

export type CmsAdStatRow = typeof cmsAdStats.$inferSelect;

// ─── 广告事件明细（append-only；按 occurred_at 范围索引，便于未来按月分区）──────
export const cmsAdEvents = pgTable('cms_ad_events', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 事实快照 ID，不设 FK：广告/广告位删除后事件仍保留至 retention 清理。 */
  adId: integer('ad_id').notNull(),
  slotId: integer('slot_id').notNull(),
  eventType: cmsAdEventTypeEnum('event_type').notNull(),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  /** 服务端加盐 SHA-256；绝不保存明文 IP。 */
  visitorHash: varchar('visitor_hash', { length: 64 }).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }).notNull(),
  userAgent: varchar('user_agent', { length: 500 }),
  device: cmsDeviceTypeEnum('device').notNull().default('pc'),
  referrer: varchar('referrer', { length: 1000 }),
  path: varchar('path', { length: 500 }),
  publishChannelId: integer('publish_channel_id').references(() => cmsPublishChannels.id, { onDelete: 'set null' }),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  /** 事件类型 + 广告 + 访客 + 防刷时间桶的摘要，数据库唯一约束为最终幂等屏障。 */
  dedupeKey: varchar('dedupe_key', { length: 64 }).notNull(),
}, (t) => [
  uniqueIndex('cms_ad_events_dedupe_uq').on(t.dedupeKey),
  index('cms_ad_events_site_time_idx').on(t.siteId, t.occurredAt, t.id),
  index('cms_ad_events_ad_time_idx').on(t.adId, t.occurredAt, t.id),
  index('cms_ad_events_slot_time_idx').on(t.slotId, t.occurredAt, t.id),
  index('cms_ad_events_type_device_time_idx').on(t.eventType, t.device, t.occurredAt),
  index('cms_ad_events_channel_time_idx').on(t.publishChannelId, t.occurredAt),
]);

export type CmsAdEventRow = typeof cmsAdEvents.$inferSelect;

// ─── 前台搜索日志（搜索量趋势 / 无结果词榜；原始日志保留 90 天）──────────────────
export const cmsSearchLogs = pgTable('cms_search_logs', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  keyword: varchar('keyword', { length: 64 }).notNull(),
  resultCount: integer('result_count').notNull().default(0),
  ip: varchar('ip', { length: 64 }),
  deviceType: cmsDeviceTypeEnum('device_type').notNull().default('pc'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('cms_search_logs_site_time_idx').on(t.siteId, t.createdAt),
  index('cms_search_logs_keyword_idx').on(t.siteId, t.keyword),
]);

export type CmsSearchLogRow = typeof cmsSearchLogs.$inferSelect;

// ─── CMS 内容-副栏目关联（一文多栏目：主栏目在 cms_contents.channel_id，副栏目在此表）──
export const cmsContentChannels = pgTable('cms_content_channels', {
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  channelId: integer('channel_id').notNull().references(() => cmsChannels.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.contentId, t.channelId] })]);

export type CmsContentChannelRow = typeof cmsContentChannels.$inferSelect;

// ─── CMS 相关文章（手动关联；前台展示时不足可按标签自动补齐）───────────────────
export const cmsContentRelations = pgTable('cms_content_relations', {
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  relatedId: integer('related_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  sort: integer('sort').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.contentId, t.relatedId] })]);

export type CmsContentRelationRow = typeof cmsContentRelations.$inferSelect;

// ─── CMS 标签（按站点隔离，带 slug 供生成 tag 聚合页；可选分组便于归类管理）──────
export const cmsTags = pgTable('cms_tags', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 50 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  /** 标签分组（可空；同组标签在管理页聚合展示） */
  groupName: varchar('group_name', { length: 50 }),
  /** 冗余计数（打标/移除时由 service 维护） */
  contentCount: integer('content_count').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_tags_site_name_uq').on(t.siteId, t.name),
  uniqueIndex('cms_tags_site_slug_uq').on(t.siteId, t.slug),
]);

export type CmsTagRow = typeof cmsTags.$inferSelect;
export type NewCmsTag = typeof cmsTags.$inferInsert;

// ─── CMS 内容-标签关联 ─────────────────────────────────────────────────────────
export const cmsContentTags = pgTable('cms_content_tags', {
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => cmsTags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.contentId, t.tagId] })]);

export type CmsContentTagRow = typeof cmsContentTags.$inferSelect;

// ─── CMS 碎片（模板中可引用的后台可编辑区块）───────────────────────────────────
export const cmsFragments = pgTable('cms_fragments', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 模板引用标识：<ThemeFragment code="home-banner" /> */
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  type: cmsFragmentTypeEnum('type').notNull().default('html'),
  content: text('content'),
  status: statusEnum('status').notNull().default('enabled'),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_fragments_site_code_uq').on(t.siteId, t.code),
]);

export type CmsFragmentRow = typeof cmsFragments.$inferSelect;
export type NewCmsFragment = typeof cmsFragments.$inferInsert;

// ─── CMS 友情链接 ─────────────────────────────────────────────────────────────
export const cmsFriendLinks = pgTable('cms_friend_links', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  logo: varchar('logo', { length: 500 }),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsFriendLinkRow = typeof cmsFriendLinks.$inferSelect;
export type NewCmsFriendLink = typeof cmsFriendLinks.$inferInsert;

// ═══ P2 运营增强 ══════════════════════════════════════════════════════════════

export const cmsCommentStatusEnum = pgEnum('cms_comment_status', ['pending', 'approved', 'rejected']);

// ─── 内容版本快照（更新前自动留档，可回滚；每内容保留最近 N 版）─────────────────
export const cmsContentVersions = pgTable('cms_content_versions', {
  id: serial('id').primaryKey(),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  /** 完整可回滚快照（title/summary/body/extend/seo/属性等） */
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_content_versions_content_ver_uq').on(t.contentId, t.version),
]);

export type CmsContentVersionRow = typeof cmsContentVersions.$inferSelect;

// ─── 301/302 重定向 ───────────────────────────────────────────────────────────
export const cmsRedirects = pgTable('cms_redirects', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 站内来源路径（以 / 开头，如 /old-news/1.html） */
  fromPath: varchar('from_path', { length: 500 }).notNull(),
  /** 目标地址（站内路径或完整 URL） */
  toUrl: varchar('to_url', { length: 500 }).notNull(),
  /** 301=永久 302=临时 */
  redirectType: integer('redirect_type').notNull().default(301),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_redirects_site_from_uq').on(t.siteId, t.fromPath),
]);

export type CmsRedirectRow = typeof cmsRedirects.$inferSelect;

// ─── 内链词（正文关键词自动加链，SEO 内链建设）─────────────────────────────────
export const cmsLinkWords = pgTable('cms_link_words', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  keyword: varchar('keyword', { length: 50 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  /** 每篇正文最多替换次数 */
  maxReplaces: integer('max_replaces').notNull().default(1),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_link_words_site_keyword_uq').on(t.siteId, t.keyword),
]);

export type CmsLinkWordRow = typeof cmsLinkWords.$inferSelect;

// ─── 评论（前台游客/登录会员提交，审核后展示；审核通过触发详情页增量重建）─────────
export const cmsComments = pgTable('cms_comments', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  /** 父评论 id，0 = 顶级（树形回复，前台展示两级） */
  parentId: integer('parent_id').notNull().default(0),
  /** 会员评论：非空表示由登录会员提交（昵称快照仍存 nickname；会员注销后保留评论） */
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  nickname: varchar('nickname', { length: 50 }).notNull(),
  content: text('content').notNull(),
  /** 点赞数（前台匿名点赞，IP 去重） */
  likeCount: integer('like_count').notNull().default(0),
  status: cmsCommentStatusEnum('status').notNull().default('pending'),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_comments_content_idx').on(t.contentId, t.status),
  index('cms_comments_member_idx').on(t.memberId),
]);

export type CmsCommentRow = typeof cmsComments.$inferSelect;

// ─── 广告位 / 广告投放 ─────────────────────────────────────────────────────────
export const cmsAdSlots = pgTable('cms_ad_slots', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 模板引用标识（如 home-ad） */
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_ad_slots_site_code_uq').on(t.siteId, t.code),
]);

export type CmsAdSlotRow = typeof cmsAdSlots.$inferSelect;

export const cmsAds = pgTable('cms_ads', {
  id: serial('id').primaryKey(),
  slotId: integer('slot_id').notNull().references(() => cmsAdSlots.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  image: varchar('image', { length: 500 }),
  linkUrl: varchar('link_url', { length: 500 }),
  /** 投放时间窗（空 = 不限） */
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  /** 点击计数（前台经由 /api/public/cms/ads/{id}/click 中转累加） */
  clickCount: integer('click_count').notNull().default(0),
  /** 曝光计数（前台页面加载 beacon 批量上报累加） */
  viewCount: integer('view_count').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsAdRow = typeof cmsAds.$inferSelect;

// ─── 自定义表单（留言/报名等，前台原生 form POST 提交）──────────────────────────
export const cmsForms = pgTable('cms_forms', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 前台提交与栏目绑定引用标识 */
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  /** 字段定义与服务端验证策略 */
  fields: jsonb('fields').$type<{
    name: string;
    label: string;
    fieldType: string;
    required: boolean;
    options?: { label: string; value: string }[] | null;
    minLength?: number | null;
    maxLength?: number | null;
    pattern?: string | null;
    min?: number | null;
    max?: number | null;
    errorMessage?: string | null;
  }[]>().notNull().default([]),
  successMessage: varchar('success_message', { length: 255 }),
  /** 新提交通知邮箱（逗号分隔多个，空 = 不通知） */
  notifyEmail: varchar('notify_email', { length: 255 }),
  /** 表单级验证码策略；inherit 保持站点开关兼容 */
  captchaProvider: cmsFormCaptchaProviderEnum('captcha_provider').notNull().default('inherit'),
  turnstileSiteKey: varchar('turnstile_site_key', { length: 200 }),
  /** write-only；DTO 仅返回掩码 */
  turnstileSecret: varchar('turnstile_secret', { length: 500 }),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_forms_site_code_uq').on(t.siteId, t.code),
]);

export type CmsFormRow = typeof cmsForms.$inferSelect;

export const cmsFormSubmissions = pgTable('cms_form_submissions', {
  id: serial('id').primaryKey(),
  formId: integer('form_id').notNull().references(() => cmsForms.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('cms_form_submissions_form_idx').on(t.formId),
]);

export type CmsFormSubmissionRow = typeof cmsFormSubmissions.$inferSelect;

// ─── 敏感词库（全局共享，评论/表单提交拦截或替换）────────────────────────────────
export const cmsSensitiveWords = pgTable('cms_sensitive_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 50 }).notNull().unique(),
  /** 非空 = 替换模式；空 = 拦截模式（命中直接拒绝提交） */
  replaceWith: varchar('replace_with', { length: 50 }),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsSensitiveWordRow = typeof cmsSensitiveWords.$inferSelect;

// ─── 搜索引擎推送日志（百度普通收录 / IndexNow）─────────────────────────────────
export const cmsPushLogs = pgTable('cms_push_logs', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** baidu | indexnow */
  engine: varchar('engine', { length: 20 }).notNull(),
  urls: jsonb('urls').$type<string[]>().notNull(),
  success: boolean('success').notNull(),
  statusCode: integer('status_code'),
  response: text('response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('cms_push_logs_site_idx').on(t.siteId, t.createdAt),
]);

export type CmsPushLogRow = typeof cmsPushLogs.$inferSelect;

// ─── 站点数据权限（绑定后仅可管理绑定站点；未绑定用户不受限）────────────────────
export const cmsSiteUsers = pgTable('cms_site_users', {
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.siteId, t.userId] })]);

export type CmsSiteUserRow = typeof cmsSiteUsers.$inferSelect;

// ─── 栏目数据权限（P5：绑定后该用户仅可管理绑定栏目下的内容；未绑定用户不受限）────
export const cmsChannelUsers = pgTable('cms_channel_users', {
  channelId: integer('channel_id').notNull().references(() => cmsChannels.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('cms_channel_users_user_idx').on(t.userId),
]);

export type CmsChannelUserRow = typeof cmsChannelUsers.$inferSelect;

// ═══ P3 Batch1 ════════════════════════════════════════════════════════════════

// ─── 检索自定义词典（jieba 运行时加载；删除词条需重启进程才彻底失效）─────────────
export const cmsSearchWords = pgTable('cms_search_words', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  word: varchar('word', { length: 50 }).notNull(),
  type: cmsSearchWordTypeEnum('type').notNull().default('extension'),
  groupName: varchar('group_name', { length: 100 }).notNull().default('默认分组'),
  /** 词频权重（越大越优先成词），jieba 用户词典格式 */
  weight: integer('weight').notNull().default(1000),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_search_words_site_type_word_uq').on(t.siteId, t.type, t.word),
  index('cms_search_words_site_group_idx').on(t.siteId, t.type, t.groupName),
]);

export type CmsSearchWordRow = typeof cmsSearchWords.$inferSelect;

// ─── 可管理热词分组与词条（实时热度仍存 Redis ZSET）────────────────────────────
export const cmsHotwordGroups = pgTable('cms_hotword_groups', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_hotword_groups_site_name_uq').on(t.siteId, t.name),
  index('cms_hotword_groups_site_sort_idx').on(t.siteId, t.sort),
]);

export type CmsHotwordGroupRow = typeof cmsHotwordGroups.$inferSelect;

export const cmsHotwords = pgTable('cms_hotwords', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').references(() => cmsHotwordGroups.id, { onDelete: 'set null' }),
  keyword: varchar('keyword', { length: 100 }).notNull(),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_hotwords_site_keyword_uq').on(t.siteId, t.keyword),
  index('cms_hotwords_site_group_sort_idx').on(t.siteId, t.groupId, t.sort),
]);

export type CmsHotwordRow = typeof cmsHotwords.$inferSelect;

// ═══ P3 Batch5：采集中心 ════════════════════════════════════════════════════════

export const cmsCollectItemStatusEnum = pgEnum('cms_collect_item_status', ['success', 'skipped', 'failed']);

// ─── 采集规则（列表页翻页 + CSS 选择器抽取，任务中心执行）───────────────────────
export const cmsCollectRules = pgTable('cms_collect_rules', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** 采集入库的目标栏目 */
  channelId: integer('channel_id').notNull().references(() => cmsChannels.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 100 }).notNull(),
  /** 列表页 URL 模板，{page} 占位翻页（无占位则只抓单页） */
  listUrl: varchar('list_url', { length: 500 }).notNull(),
  pageStart: integer('page_start').notNull().default(1),
  pageEnd: integer('page_end').notNull().default(1),
  /** 列表页条目链接选择器（a 元素或含 a 的容器） */
  listSelector: varchar('list_selector', { length: 200 }).notNull(),
  titleSelector: varchar('title_selector', { length: 200 }).notNull(),
  bodySelector: varchar('body_selector', { length: 200 }).notNull(),
  summarySelector: varchar('summary_selector', { length: 200 }),
  coverSelector: varchar('cover_selector', { length: 200 }),
  /** 正文清洗：待移除节点的选择器数组（广告/推荐位等） */
  removeSelectors: jsonb('remove_selectors').$type<string[]>().notNull().default([]),
  /** 采集后直接发布（否则入草稿箱待人工处理） */
  autoPublish: boolean('auto_publish').notNull().default(false),
  /** 正文远程图片本地化（下载转存文件中心并替换 src） */
  localizeImages: boolean('localize_images').notNull().default(false),
  /** 单次执行最大采集条数 */
  maxItems: integer('max_items').notNull().default(50),
  status: statusEnum('status').notNull().default('enabled'),
  lastRunAt: timestamp('last_run_at'),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_collect_rules_site_idx').on(t.siteId),
]);

export type CmsCollectRuleRow = typeof cmsCollectRules.$inferSelect;

// ─── 采集明细（URL 去重 + 结果留痕）────────────────────────────────────────────
export const cmsCollectItems = pgTable('cms_collect_items', {
  id: serial('id').primaryKey(),
  ruleId: integer('rule_id').notNull().references(() => cmsCollectRules.id, { onDelete: 'cascade' }),
  url: varchar('url', { length: 500 }).notNull(),
  title: varchar('title', { length: 255 }),
  status: cmsCollectItemStatusEnum('status').notNull(),
  /** 成功入库的内容 id */
  contentId: integer('content_id').references(() => cmsContents.id, { onDelete: 'set null' }),
  error: varchar('error', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_collect_items_rule_url_uq').on(t.ruleId, t.url),
  index('cms_collect_items_rule_idx').on(t.ruleId, t.createdAt),
]);

export type CmsCollectItemRow = typeof cmsCollectItems.$inferSelect;

// ═══ P3 Batch6：可视化页面搭建 ══════════════════════════════════════════════════

// ─── 自定义页面（区块 JSON 装配，前台 /p/{slug}/；isHome 可接管站点首页）────────
export const cmsPages = pgTable('cms_pages', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  /** 前台路径：/p/{slug}/ */
  slug: varchar('slug', { length: 100 }).notNull(),
  /** 接管站点首页（每站点最多一个生效） */
  isHome: boolean('is_home').notNull().default(false),
  /** 区块数组：{ id, type, props, displayCondition? }[]，类型见 shared CmsPageBlock */
  blocks: jsonb('blocks').$type<{
    id: string;
    type: string;
    props: Record<string, unknown>;
    displayCondition?: { audience: 'always' | 'guest' | 'member'; startAt?: string | null; endAt?: string | null };
  }[]>().notNull().default([]),
  /** guest/member 条件存在时为 true；静态构建和混合回写必须跳过。 */
  requiresDynamic: boolean('requires_dynamic').notNull().default(false),
  seoTitle: varchar('seo_title', { length: 255 }),
  seoKeywords: varchar('seo_keywords', { length: 500 }),
  seoDescription: varchar('seo_description', { length: 500 }),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_pages_site_slug_uq').on(t.siteId, t.slug),
  index('cms_pages_site_idx').on(t.siteId),
]);

export type CmsPageRow = typeof cmsPages.$inferSelect;

// ─── 页面区块管理 ACL（配置后 fail-closed；未配置继承页面编辑权限）─────────────
export const cmsPageBlockAcls = pgTable('cms_page_block_acls', {
  id: serial('id').primaryKey(),
  pageId: integer('page_id').notNull().references(() => cmsPages.id, { onDelete: 'cascade' }),
  blockId: varchar('block_id', { length: 100 }).notNull(),
  subjectType: cmsPageBlockAclSubjectTypeEnum('subject_type').notNull(),
  subjectId: integer('subject_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_page_block_acls_grant_uq').on(t.pageId, t.blockId, t.subjectType, t.subjectId),
  index('cms_page_block_acls_block_idx').on(t.pageId, t.blockId),
  index('cms_page_block_acls_subject_idx').on(t.subjectType, t.subjectId),
]);

export type CmsPageBlockAclRow = typeof cmsPageBlockAcls.$inferSelect;

// ─── CMS 发布产物事实（队列状态复用 async_tasks，不另建发布任务表）──────────────
export const cmsPublishArtifacts = pgTable('cms_publish_artifacts', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => asyncTasks.id, { onDelete: 'cascade' }),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  publishChannelId: integer('publish_channel_id').references(() => cmsPublishChannels.id, { onDelete: 'set null' }),
  targetType: cmsPublishTargetTypeEnum('target_type').notNull(),
  contentId: integer('content_id').references(() => cmsContents.id, { onDelete: 'set null' }),
  channelId: integer('channel_id').references(() => cmsChannels.id, { onDelete: 'set null' }),
  pageId: integer('page_id').references(() => cmsPages.id, { onDelete: 'set null' }),
  themeCode: varchar('theme_code', { length: 50 }),
  themePackageId: integer('theme_package_id').references(() => cmsThemePackages.id, { onDelete: 'set null' }),
  templateId: integer('template_id').references(() => cmsTemplates.id, { onDelete: 'set null' }),
  templateVersion: integer('template_version'),
  path: varchar('path', { length: 1000 }).notNull(),
  url: varchar('url', { length: 1000 }),
  checksum: varchar('checksum', { length: 64 }),
  size: integer('size'),
  status: cmsPublishArtifactStatusEnum('status').notNull(),
  error: text('error'),
  generatedAt: timestamp('generated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
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
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  /** null = 根目录；规范化自关联，删除前由 service 做非空保护 */
  parentId: integer('parent_id').references((): AnyPgColumn => cmsResourceFolders.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 100 }).notNull(),
  sort: integer('sort').notNull().default(0),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_resource_folders_site_parent_name_uq').on(t.siteId, t.parentId, t.name)
    .where(sql`${t.parentId} is not null`),
  uniqueIndex('cms_resource_folders_site_root_name_uq').on(t.siteId, t.name)
    .where(sql`${t.parentId} is null`),
  index('cms_resource_folders_site_parent_idx').on(t.siteId, t.parentId),
]);

export type CmsResourceFolderRow = typeof cmsResourceFolders.$inferSelect;

export const cmsResources = pgTable('cms_resources', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id').references(() => cmsResourceFolders.id, { onDelete: 'set null' }),
  type: cmsResourceTypeEnum('type').notNull().default('image'),
  name: varchar('name', { length: 255 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  thumbUrl: varchar('thumb_url', { length: 500 }),
  /** 底层 managed_files id（删除素材时联动删除物理文件；手动登记的外链素材为 null） */
  fileId: pgUuid('file_id'),
  size: integer('size').notNull().default(0),
  width: integer('width'),
  height: integer('height'),
  mimeType: varchar('mime_type', { length: 128 }),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_resources_site_type_idx').on(t.siteId, t.type),
  index('cms_resources_site_folder_idx').on(t.siteId, t.folderId),
]);

export type CmsResourceRow = typeof cmsResources.$inferSelect;
