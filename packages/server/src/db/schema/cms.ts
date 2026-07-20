import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, text, jsonb, uniqueIndex, index, customType, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';
import { members } from './member';

// ─── 枚举（pgEnum / TS union / Zod enum 三处同步，见 @zenith/shared）────────────
export const cmsStaticModeEnum = pgEnum('cms_static_mode', ['dynamic', 'hybrid', 'static']);
export const cmsChannelTypeEnum = pgEnum('cms_channel_type', ['list', 'page', 'link']);
export const cmsContentStatusEnum = pgEnum('cms_content_status', ['draft', 'pending', 'published', 'offline', 'rejected']);
/** 内容形态：article=图文 album=图集 media=音视频 link=外链 */
export const cmsContentTypeEnum = pgEnum('cms_content_type', ['article', 'album', 'media', 'link']);
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
  status: cmsContentStatusEnum('status').notNull().default('draft'),
  rejectReason: varchar('reject_reason', { length: 500 }),
  publishedAt: timestamp('published_at'),
  /** 定时发布时间（P2 调度使用，先建列） */
  scheduledAt: timestamp('scheduled_at'),
  /** 过期自动下线时间（到期由周期任务下线，空 = 永不过期） */
  expireAt: timestamp('expire_at'),
  viewCount: integer('view_count').notNull().default(0),
  /** 乐观锁版本号（每次更新 +1；更新携带 expectedVersion 不一致时拒绝，防并发编辑覆盖） */
  version: integer('version').notNull().default(1),
  sort: integer('sort').notNull().default(0),
  // 内容级 SEO（覆盖栏目/站点默认）
  seoTitle: varchar('seo_title', { length: 255 }),
  seoKeywords: varchar('seo_keywords', { length: 500 }),
  seoDescription: varchar('seo_description', { length: 500 }),
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
  /** 父评论 id，0 = 顶级（树形回复，前台展示两级） */
  parentId: integer('parent_id').notNull().default(0),
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
  /** 新提交通知邮箱（逗号分隔多个，空 = 不通知） */
  notifyEmail: varchar('notify_email', { length: 255 }),
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
  /** 区块数组：{ id, type, props }[]，类型见 shared CmsPageBlock */
  blocks: jsonb('blocks').$type<{ id: string; type: string; props: Record<string, unknown> }[]>().notNull().default([]),
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
