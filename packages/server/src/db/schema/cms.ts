import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, text, jsonb, uniqueIndex, index, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';
import { members } from './member';

// ─── 枚举（pgEnum / TS union / Zod enum 三处同步，见 @zenith/shared）────────────
export const cmsStaticModeEnum = pgEnum('cms_static_mode', ['dynamic', 'hybrid', 'static']);
export const cmsChannelTypeEnum = pgEnum('cms_channel_type', ['list', 'page', 'link']);
export const cmsContentStatusEnum = pgEnum('cms_content_status', ['draft', 'pending', 'published', 'offline', 'rejected']);
export const cmsFieldTypeEnum = pgEnum('cms_field_type', ['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch']);
export const cmsFragmentTypeEnum = pgEnum('cms_fragment_type', ['html', 'text', 'image', 'json']);

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
  /** 静态化模式：dynamic=纯 SSR；hybrid=miss 渲染并回写静态；static=仅发布时生成 */
  staticMode: cmsStaticModeEnum('static_mode').notNull().default('hybrid'),
  /** robots.txt 内容（每站点独立） */
  robots: text('robots'),
  /** 主题参数 / URL 规则等站点级配置 */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  remark: text('remark'),
  /** 预留：多租户隔离（第一期不启用，默认 null） */
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  uniqueIndex('cms_sites_domain_uq').on(t.domain).where(sql`${t.domain} is not null`),
]);

export type CmsSiteRow = typeof cmsSites.$inferSelect;
export type NewCmsSite = typeof cmsSites.$inferInsert;

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
  title: varchar('title', { length: 255 }).notNull(),
  /** 自定义 URL 名（可空，默认用 id 生成 URL） */
  slug: varchar('slug', { length: 255 }),
  summary: text('summary'),
  coverImage: varchar('cover_image', { length: 500 }),
  author: varchar('author', { length: 50 }),
  source: varchar('source', { length: 100 }),
  /** 正文富文本 HTML */
  body: text('body'),
  /** 模型自定义字段值（key = cms_model_fields.name） */
  extend: jsonb('extend').$type<Record<string, unknown>>().notNull().default({}),
  /** 外链型内容：点击直接跳转 */
  externalLink: varchar('external_link', { length: 500 }),
  isTop: boolean('is_top').notNull().default(false),
  isRecommend: boolean('is_recommend').notNull().default(false),
  isHot: boolean('is_hot').notNull().default(false),
  status: cmsContentStatusEnum('status').notNull().default('draft'),
  rejectReason: varchar('reject_reason', { length: 500 }),
  publishedAt: timestamp('published_at'),
  /** 定时发布时间（P2 调度使用，先建列） */
  scheduledAt: timestamp('scheduled_at'),
  viewCount: integer('view_count').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  // 内容级 SEO（覆盖栏目/站点默认）
  seoTitle: varchar('seo_title', { length: 255 }),
  seoKeywords: varchar('seo_keywords', { length: 500 }),
  seoDescription: varchar('seo_description', { length: 500 }),
  /** 全文检索向量（应用层 jieba 分词后写入，'simple' parser + setweight A/B/C） */
  searchVector: tsvector('search_vector'),
  /** 回收站：非空表示已进回收站 */
  deletedAt: timestamp('deleted_at'),
  /** 会员投稿：非空表示由前台会员提交（P3 会员投稿） */
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_contents_site_channel_idx').on(t.siteId, t.channelId),
  index('cms_contents_status_idx').on(t.status),
  index('cms_contents_published_at_idx').on(t.publishedAt),
  index('cms_contents_search_idx').using('gin', t.searchVector),
  index('cms_contents_member_idx').on(t.memberId),
  uniqueIndex('cms_contents_site_slug_uq').on(t.siteId, t.slug)
    .where(sql`${t.slug} is not null and ${t.deletedAt} is null`),
]);

export type CmsContentRow = typeof cmsContents.$inferSelect;
export type NewCmsContent = typeof cmsContents.$inferInsert;

// ─── CMS 标签（按站点隔离，带 slug 供生成 tag 聚合页）───────────────────────────
export const cmsTags = pgTable('cms_tags', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 50 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
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

// ─── 评论（前台游客提交，审核后展示；审核通过触发详情页增量重建）─────────────────
export const cmsComments = pgTable('cms_comments', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  contentId: integer('content_id').notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  nickname: varchar('nickname', { length: 50 }).notNull(),
  content: text('content').notNull(),
  status: cmsCommentStatusEnum('status').notNull().default('pending'),
  ip: varchar('ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('cms_comments_content_idx').on(t.contentId, t.status),
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
  /** 字段定义：name/label/fieldType(text|textarea|select|radio)/required/options */
  fields: jsonb('fields').$type<{ name: string; label: string; fieldType: string; required: boolean; options?: { label: string; value: string }[] | null }[]>().notNull().default([]),
  successMessage: varchar('success_message', { length: 255 }),
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

// ═══ P3 Batch1 ════════════════════════════════════════════════════════════════

// ─── 检索自定义词典（jieba 运行时加载；删除词条需重启进程才彻底失效）─────────────
export const cmsSearchWords = pgTable('cms_search_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 50 }).notNull().unique(),
  /** 词频权重（越大越优先成词），jieba 用户词典格式 */
  weight: integer('weight').notNull().default(1000),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 200 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type CmsSearchWordRow = typeof cmsSearchWords.$inferSelect;
