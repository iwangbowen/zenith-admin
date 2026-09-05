import type { CmsAd, CmsAdEvent, CmsAdSlot, CmsChannel, CmsCollectItem, CmsCollectRule, CmsComment, CmsContent, CmsContentVersion, CmsDistributionRule, CmsErrorProneWord, CmsForm, CmsFriendLink, CmsFriendLinkGroup, CmsHotwordGroup, CmsInteraction, CmsInteractionQuestion, CmsLinkWord, CmsMemberSubscription, CmsModel, CmsPage, CmsResource, CmsResourceFolder, CmsSearchWord, CmsSensitiveWord, CmsSite, CmsSiteInheritanceFlags, CmsTag, CmsWidget } from '../cms/contracts';
import { SEED_DATE } from './_base';

export const SEED_CMS_EDITOR_USER = {
  username: 'cms_editor',
  nickname: 'CMS 演示编辑',
  email: 'cms-editor@zenith.dev',
  password: '123456',
  roleId: 3,
  departmentId: 2,
} as const;

// ─── CMS：站点 / 模型 / 栏目 / 内容 / 标签 / 友链 ─────────────────────────────
export const SEED_CMS_SITES: CmsSite[] = [
  {
    id: 1, parentId: null, name: 'Zenith 官方网站', code: 'main', domain: null, aliasDomains: [], isDefault: true,
    title: 'Zenith Admin — 企业级全栈管理系统', keywords: 'Zenith,CMS,后台管理,内容管理',
    description: 'Zenith Admin 是基于 Hono + React + PostgreSQL 的企业级全栈管理系统，内置 CMS 内容管理、多站点与全文检索。',
    logo: null, favicon: null, icp: null, copyright: '© 2024 Zenith Admin', theme: 'default',
    themeRevision: 0, templateRefsRevision: 0, publicRevision: 0, staticMode: 'hybrid', robots: null, modelId: null, extend: {},
    settings: {
      auditMode: 'simple',
      webhookUrl: 'https://hooks.example.invalid/cms',
      webhookSecret: 'demo-parent-secret',
      themeConfig: { footerText: '由 Zenith CMS 驱动' },
      // 内容策略（缺省值见 CMS_SITE_OPS_DEFAULTS，此处显式写出便于演示）
      publishedContentEditable: true,
      recycleKeepDays: 30,
      maxPageOnContentPublish: 0,
      autoReplaceSensitiveWords: true,
      autoReplaceErrorProneWords: true,
      autoCoverFromBody: true,
    },
    status: 'enabled', sort: 0, remark: '默认演示根站点',
    inheritance: {
      seoTitle: false, seoKeywords: false, seoDescription: false, staticMode: false,
      reviewMode: false, webhook: false, cdn: false, theme: false, themeConfig: false, templates: false,
    },
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, parentId: 1, name: 'Zenith 技术子站', code: 'tech', domain: null, aliasDomains: [], isDefault: false,
    title: 'Zenith 技术中心', keywords: null, description: null,
    logo: null, favicon: null, icp: null, copyright: '© 2024 Zenith Tech', theme: 'default',
    themeRevision: 0, templateRefsRevision: 0, publicRevision: 0, staticMode: 'dynamic', robots: null, modelId: null, extend: {},
    settings: {
      cdnPurgeUrl: 'https://cdn.example.invalid/purge',
      cdnPurgeToken: 'demo-child-token',
      themeConfig: { footerText: '子站自有文案（当前选择继承父级）' },
      defaultTemplates: {},
    },
    status: 'enabled', sort: 1, remark: 'Stage 5 父子继承演示子站',
    inheritance: {
      seoTitle: false, seoKeywords: true, seoDescription: true, staticMode: true,
      reviewMode: true, webhook: true, cdn: false, theme: true, themeConfig: true, templates: true,
    },
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_SITE_INHERITANCES: Array<{ siteId: number } & CmsSiteInheritanceFlags> =
  SEED_CMS_SITES.map((site) => ({
    siteId: site.id,
    seoTitle: site.inheritance?.seoTitle ?? false,
    seoKeywords: site.inheritance?.seoKeywords ?? false,
    seoDescription: site.inheritance?.seoDescription ?? false,
    staticMode: site.inheritance?.staticMode ?? false,
    reviewMode: site.inheritance?.reviewMode ?? false,
    webhook: site.inheritance?.webhook ?? false,
    cdn: site.inheritance?.cdn ?? false,
    theme: site.inheritance?.theme ?? false,
    themeConfig: site.inheritance?.themeConfig ?? false,
    templates: site.inheritance?.templates ?? false,
  }));

export const SEED_CMS_MODELS: (CmsModel & { fields: NonNullable<CmsModel['fields']> })[] = [
  {
    id: 1, ownerSiteId: null, ownerSiteName: null, name: '文章', code: 'article', description: '通用图文文章模型', isSystem: true,
    status: 'enabled', sort: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    fields: [],
  },
  {
    id: 2, ownerSiteId: null, ownerSiteName: null, name: '产品', code: 'product', description: '产品展示模型（含价格/规格自定义字段）', isSystem: true,
    status: 'enabled', sort: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    fields: [
      { id: 1, modelId: 2, name: 'price', label: '价格', fieldType: 'text', required: false, searchable: false, showInList: true, showInDetail: true, detailGroup: '产品信息', detailSort: 1, placeholder: '如：￥9999', defaultValue: null, optionSource: 'manual', dictCode: null, options: null, sort: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
      { id: 2, modelId: 2, name: 'spec', label: '规格参数', fieldType: 'textarea', required: false, searchable: true, showInList: false, showInDetail: true, detailGroup: '产品信息', detailSort: 2, placeholder: null, defaultValue: null, optionSource: 'manual', dictCode: null, options: null, sort: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
      { id: 3, modelId: 2, name: 'status_tag', label: '售卖状态', fieldType: 'select', required: false, searchable: false, showInList: true, showInDetail: true, detailGroup: '产品信息', detailSort: 3, placeholder: null, defaultValue: null, optionSource: 'dict', dictCode: 'common_status', options: null, sort: 3, createdAt: SEED_DATE, updatedAt: SEED_DATE },
    ],
  },
];

export const SEED_CMS_CHANNELS: CmsChannel[] = [
  { id: 1, siteId: 1, parentId: 0, modelId: 1, name: '新闻中心', code: 'news',     slug: 'news',     path: 'news',     type: 'list', linkUrl: null, listTemplate: null, detailTemplate: null, staticMode: 'inherit', detailPathRule: 'year', pageSize: 20, pageContent: null, seoTitle: null, seoKeywords: null, seoDescription: '最新公司动态与行业资讯', image: null, visible: true, status: 'enabled', sort: 1, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, parentId: 0, modelId: 2, name: '产品中心', code: 'products', slug: 'products', path: 'products', type: 'list', linkUrl: null, listTemplate: null, detailTemplate: null, staticMode: 'inherit', detailPathRule: 'none', pageSize: 20, pageContent: null, seoTitle: null, seoKeywords: null, seoDescription: '产品与解决方案', image: null, visible: true, status: 'enabled', sort: 2, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, siteId: 1, parentId: 0, modelId: null, name: '关于我们', code: 'about',    slug: 'about', path: 'about',    type: 'page', linkUrl: null, listTemplate: null, detailTemplate: null, staticMode: 'inherit', detailPathRule: 'none', pageSize: 20, pageContent: '<h2>关于 Zenith</h2><p>Zenith Admin 是一套企业级全栈管理系统，本页面由 CMS 单页栏目渲染。</p>', seoTitle: null, seoKeywords: null, seoDescription: '关于 Zenith Admin', image: null, visible: true, status: 'enabled', sort: 3, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, siteId: 2, parentId: 0, modelId: 1, name: '技术动态', code: 'news', slug: 'news', path: 'news', type: 'list', linkUrl: null, listTemplate: null, detailTemplate: null, staticMode: 'inherit', detailPathRule: 'none', pageSize: 20, pageContent: null, seoTitle: null, seoKeywords: null, seoDescription: '来自根站点治理分发的技术动态', image: null, visible: true, status: 'enabled', sort: 1, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_TAGS: CmsTag[] = [
  { id: 1, siteId: 1, name: '产品发布', slug: 'release',  groupName: '产品', contentCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, name: '行业动态', slug: 'industry', groupName: '资讯', contentCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

/** coverThumb 由封面素材派生而非独立字段，种子数据不声明 */
export const SEED_CMS_CONTENTS: (Omit<CmsContent, 'coverThumb'> & { tagIds: number[] })[] = [
  {
    id: 1, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'article', mediaData: {},
    titleStyle: {}, title: 'Zenith Admin 发布 CMS 内容管理模块', subTitle: null, shortTitle: 'CMS 模块发布', slug: null,
    summary: '全新 CMS 模块支持多站点、SEO 优化、SSR 静态化发布与基于 PostgreSQL 的中文全文检索。',
    coverImage: 'https://picsum.photos/seed/zenith-cms-launch/1200/800', author: '管理员', editor: '管理员', source: '官方', sourceUrl: null, isOriginal: true, body: '<p>Zenith Admin 全新 CMS 模块正式发布：支持站群管理、内容模型自定义字段、React SSR 静态化与 PostgreSQL 全文检索，功能全面对标国内主流 CMS。</p>',
    attachments: [], extend: {}, externalLink: null, detailTemplate: null, staticPath: null, isTop: true, topWeight: 10, topExpireAt: null, isRecommend: true, isHot: false,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 128, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: 'CMS,发布', seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: null, distributionRuleId: null, distributionSourceId: null, distributionSourceVersion: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [1], extraChannelIds: [2], relatedIds: [2], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'article', mediaData: {},
    titleStyle: {}, title: '内容管理系统选型指南：静态化与全文检索实践', subTitle: null, shortTitle: null, slug: null,
    summary: '解析传统 CMS 的静态化方案与现代 SSR 渲染的结合方式，以及不依赖 Elasticsearch 的 PostgreSQL 全文检索实现。',
    coverImage: null, author: '管理员', editor: null, source: '原创', sourceUrl: null, isOriginal: true, body: '<p>本文介绍混合静态化模式（发布时增量生成 + 访问时回写）与应用层中文分词方案在 PostgreSQL tsvector 上的落地实践。</p>',
    attachments: [], extend: {}, externalLink: null, detailTemplate: null, staticPath: null, isTop: false, topWeight: 0, topExpireAt: null, isRecommend: true, isHot: true,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 86, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: '静态化,全文检索', seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: null, distributionRuleId: null, distributionSourceId: null, distributionSourceVersion: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [2], extraChannelIds: [], relatedIds: [1], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 3, siteId: 1, channelId: 2, channelName: '产品中心', modelId: 2,
    contentType: 'article', mediaData: {},
    titleStyle: {}, title: 'Zenith 企业版', subTitle: '一体化数字化底座', shortTitle: null, slug: 'enterprise',
    summary: '面向中大型企业的一体化数字化底座。',
    coverImage: null, author: null, editor: null, source: null, sourceUrl: null, isOriginal: false, body: '<p>Zenith 企业版提供完整的权限体系、工作流引擎、支付中心与 CMS 内容管理能力。</p>',
    attachments: [
      { name: 'Zenith 企业版产品白皮书.pdf', url: 'cms-res://3', size: 1_048_576, ext: 'pdf', sort: 0 },
    ],
    extend: { price: '联系销售', spec: '支持私有化部署，PostgreSQL 16 + Redis 7' }, externalLink: null, detailTemplate: null, staticPath: null,
    isTop: false, topWeight: 0, topExpireAt: null, isRecommend: false, isHot: false,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 45, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: null, seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: null, distributionRuleId: null, distributionSourceId: null, distributionSourceVersion: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 4, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'album', mediaData: {
      images: [
        { url: 'https://picsum.photos/seed/zenith-album-1/1200/800', thumb: 'https://picsum.photos/seed/zenith-album-1/400/267', caption: '发布会现场' },
        { url: 'https://picsum.photos/seed/zenith-album-2/1200/800', thumb: 'https://picsum.photos/seed/zenith-album-2/400/267', caption: '圆桌讨论' },
        { url: 'https://picsum.photos/seed/zenith-album-3/1200/800', thumb: 'https://picsum.photos/seed/zenith-album-3/400/267', caption: null },
      ],
    },
    titleStyle: {}, title: '产品发布会精彩瞬间（图集）', subTitle: null, shortTitle: '发布会图集', slug: null,
    summary: 'Zenith Admin 年度产品发布会现场图集。',
    coverImage: 'https://picsum.photos/seed/zenith-album-1/1200/800',
    author: '管理员', editor: null, source: '官方', sourceUrl: null, isOriginal: true, body: '<p>发布会现场图集，点击图片查看大图。</p>',
    attachments: [], extend: {}, externalLink: null, detailTemplate: null, staticPath: null, isTop: false, topWeight: 0, topExpireAt: null, isRecommend: true, isHot: false,
    hasImage: true,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 66, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: '发布会,图集', seoDescription: null, socialImageAlt: 'Zenith 产品发布会现场', twitterCreator: '@zenith_admin',
    archivedAt: null, mappingSourceId: null, distributionRuleId: null, distributionSourceId: null, distributionSourceVersion: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [1], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 5, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'media', mediaData: {
      mediaType: 'video',
      mediaUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      poster: 'https://picsum.photos/seed/zenith-video/1200/675',
      duration: '00:06',
    },
    titleStyle: {}, title: '三分钟了解 Zenith CMS（视频）', subTitle: null, shortTitle: null, slug: null,
    summary: '视频快速导览：站群、静态化、全文检索与多形态内容。',
    coverImage: 'https://picsum.photos/seed/zenith-video/1200/675',
    author: '管理员', editor: null, source: '官方', sourceUrl: null, isOriginal: true, body: '<p>视频简介：本片演示 CMS 模块核心能力。</p>',
    attachments: [], extend: {}, externalLink: null, detailTemplate: null, staticPath: null, isTop: false, topWeight: 0, topExpireAt: null, isRecommend: false, isHot: true,
    hasImage: true, hasVideo: true,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 88, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: '视频,导览', seoDescription: null, socialImageAlt: 'Zenith CMS 视频导览', twitterCreator: '@zenith_admin',
    archivedAt: null, mappingSourceId: null, distributionRuleId: null, distributionSourceId: null, distributionSourceVersion: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 6, siteId: 2, channelId: 4, channelName: '技术动态', modelId: 1,
    contentType: 'article', mediaData: {},
    titleStyle: {}, title: 'Zenith Admin 发布 CMS 内容管理模块', subTitle: null, shortTitle: 'CMS 模块发布', slug: null,
    summary: '由 Stage 5 分发规则映射自根站点；正文跟随来源，发布仍需走子站审核管道。',
    coverImage: null, author: '管理员', editor: null, source: '站群分发', sourceUrl: null,
    isOriginal: false, body: null, attachments: [], extend: {}, externalLink: null, detailTemplate: null, staticPath: null,
    isTop: false, topWeight: 0, topExpireAt: null, isRecommend: false, isHot: false,
    status: 'draft', rejectReason: null, publishedAt: null, scheduledAt: null, expireAt: null,
    viewCount: 0, likeCount: 0, favoriteCount: 0, version: 1, sort: 0,
    seoTitle: null, seoKeywords: 'CMS,发布', seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: 1, distributionRuleId: 1, distributionSourceId: 1,
    distributionSourceVersion: 1, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [], extraChannelIds: [], relatedIds: [], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_CONTENT_CHANNELS = [
  { contentId: 1, channelId: 2 },
];

export const SEED_CMS_CONTENT_RELATIONS = [
  { contentId: 1, relatedId: 2, sort: 1 },
  { contentId: 2, relatedId: 1, sort: 1 },
];

export const SEED_CMS_CONTENT_VERSIONS: CmsContentVersion[] = [
  {
    id: 1,
    contentId: 1,
    version: 1,
    title: 'Zenith Admin 发布 CMS 内容管理模块',
    snapshot: { title: 'Zenith Admin 发布 CMS 内容管理模块', summary: '首个已发布版本' },
    remark: 'Demo 初始发布快照',
    createdByName: '管理员',
    createdAt: SEED_DATE,
  },
];

export const SEED_CMS_FRIEND_LINK_GROUPS: CmsFriendLinkGroup[] = [
  { id: 1, siteId: 1, name: '技术栈', code: 'tech', status: 'enabled', sort: 1, remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, name: '合作伙伴', code: 'partner', status: 'enabled', sort: 2, remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_FRIEND_LINKS: CmsFriendLink[] = [
  { id: 1, siteId: 1, groupId: 1, name: 'Hono',       url: 'https://hono.dev',           logo: null, status: 'enabled', sort: 1, remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, groupId: 1, name: 'PostgreSQL', url: 'https://www.postgresql.org', logo: null, status: 'enabled', sort: 2, remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, siteId: 1, groupId: null, name: 'Zenith 文档', url: 'https://example.invalid/docs', logo: null, status: 'enabled', sort: 3, remark: '未分组示例', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── CMS 素材中心（P2 示例素材）──────────────────────────────────────────────────
export const SEED_CMS_RESOURCES: CmsResource[] = [
  { id: 3, siteId: 1, folderId: 2, type: 'document', name: '产品白皮书.pdf', url: '/files/demo-whitepaper.pdf', thumbUrl: null, fileId: null, ownsFile: true, size: 1048576, width: null, height: null, mimeType: 'application/pdf', remark: '示例文档素材', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_RESOURCE_FOLDERS: CmsResourceFolder[] = [
  { id: 1, siteId: 1, parentId: null, name: '图片素材', sort: 1, resourceCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, parentId: null, name: '文档资料', sort: 2, resourceCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_SEARCH_WORDS: CmsSearchWord[] = [
  { id: 1, siteId: 1, word: 'ZenithAdmin', type: 'extension', groupName: '品牌词', weight: 3000, status: 'enabled', remark: '品牌完整词（词典 token 不含空白）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, word: '的', type: 'stop', groupName: '通用停用词', weight: 1, status: 'enabled', remark: '过滤低价值助词', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_HOTWORD_GROUPS: CmsHotwordGroup[] = [
  { id: 1, siteId: 1, name: '产品推荐', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_HOTWORDS = [
  { id: 1, siteId: 1, groupId: 1, keyword: 'CMS', sort: 1, status: 'enabled' as const },
  { id: 2, siteId: 1, groupId: 1, keyword: '企业版', sort: 2, status: 'enabled' as const },
];

export const SEED_CMS_COLLECT_RULES: CmsCollectRule[] = [
  {
    id: 1, siteId: 1, channelId: 1, channelName: '新闻中心', name: '官方博客采集演示',
    listUrl: 'https://example.com/news?page={page}', pageStart: 1, pageEnd: 1,
    listSelector: '.news-list a', titleSelector: 'h1', bodySelector: 'article',
    summarySelector: '.summary', coverSelector: '.cover img', removeSelectors: ['.ad'],
    autoPublish: false, localizeImages: false, maxItems: 10, status: 'enabled',
    lastRunAt: SEED_DATE, remark: '仅用于展示任务中心与采集明细', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_COLLECT_ITEMS: CmsCollectItem[] = [
  { id: 1, ruleId: 1, url: 'https://example.com/news/demo', title: '采集演示文章', status: 'success', contentId: 1, error: null, createdAt: SEED_DATE },
  { id: 2, ruleId: 1, url: 'https://example.com/news/failure', title: null, status: 'failed', contentId: null, error: '演示：页面结构不匹配', createdAt: SEED_DATE },
];

export const SEED_CMS_DISTRIBUTION_RULES: CmsDistributionRule[] = [
  {
    id: 1,
    name: '根站技术资讯映射至子站',
    sourceSiteId: 1,
    sourceSiteName: 'Zenith 官方网站',
    sourceChannelId: 1,
    sourceChannelName: '新闻中心',
    targetSiteId: 2,
    targetSiteName: 'Zenith 技术子站',
    targetChannelId: 4,
    targetChannelName: '技术动态',
    mode: 'mapping',
    conflictStrategy: 'skip',
    filters: {
      statuses: ['published'],
      contentTypes: ['article'],
      keyword: 'CMS',
      publishedFrom: null,
      publishedTo: null,
    },
    scheduleCron: null,
    nextRunAt: null,
    lastRunAt: SEED_DATE,
    status: 'enabled',
    revision: 1,
    remark: 'Stage 5 演示：正文跟随来源，目标内容仍为草稿并独立审核',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_PAGES: CmsPage[] = [
  {
    id: 1, siteId: 1, name: '产品能力落地页', slug: 'capabilities', path: 'capabilities.html', isHome: false,
    blocks: [
      { id: 'hero-1', type: 'hero', props: { title: 'Zenith CMS', subtitle: '内容、检索与素材治理一体化' } },
      { id: 'content-1', type: 'content-list', props: { title: '最新内容', channelId: 1, limit: 5 } },
      { id: 'widget-1', type: 'widget-ref', props: { widgetId: 1, rendererKey: 'list-grid', styleProps: {} } },
    ],
    seoTitle: 'Zenith CMS 产品能力', seoKeywords: 'CMS,内容管理', seoDescription: '可视化页面搭建演示',
    requiresDynamic: false,
    status: 'enabled', remark: 'Stage 4 Demo 页面', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_WIDGETS: CmsWidget[] = [
  {
    id: 1,
    siteId: 1,
    name: '首页侧栏推荐',
    code: 'home-sidebar',
    type: 'manual-list',
    schemaVersion: 1,
    draftData: {
      items: [
        { id: 'content-1', sourceType: 'content', sourceId: 1 },
        { id: 'channel-1', sourceType: 'channel', sourceId: 1, title: '浏览产品与能力' },
        {
          id: 'manual-1',
          sourceType: 'manual',
          title: '关注 Zenith CMS',
          summary: '获取产品更新与实践案例',
          url: 'https://example.invalid/zenith-cms',
          image: 'https://picsum.photos/seed/zenith-cms-widget/400/267',
          displayDate: null,
        },
      ],
    },
    publishedData: {
      items: [
        { id: 'content-1', sourceType: 'content', sourceId: 1 },
        { id: 'channel-1', sourceType: 'channel', sourceId: 1, title: '浏览产品与能力' },
        {
          id: 'manual-1',
          sourceType: 'manual',
          title: '关注 Zenith CMS',
          summary: '获取产品更新与实践案例',
          url: 'https://example.invalid/zenith-cms',
          image: 'https://picsum.photos/seed/zenith-cms-widget/400/267',
          displayDate: null,
        },
      ],
    },
    publishedName: '首页侧栏推荐',
    draftRevision: 1,
    publishedRevision: 1,
    status: 'published',
    defaultRendererKey: 'list-sidebar',
    remark: '页面部件演示数据',
    referenceCount: 2,
    impactCount: 2,
    highFanout: false,
    hasUnpublishedChanges: false,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_WIDGET_REFS = [
  {
    id: 1, siteId: 1, widgetId: 1, ownerType: 'theme_slot' as const, ownerId: 1,
    field: 'home.sidebar', rendererKey: 'list-sidebar' as const, styleProps: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, siteId: 1, widgetId: 1, ownerType: 'page' as const, ownerId: 1,
    field: 'widget-1', rendererKey: 'list-grid' as const, styleProps: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_WIDGET_SOURCE_REFS = [
  { id: 1, siteId: 1, widgetId: 1, itemId: 'content-1', sourceType: 'content' as const, sourceId: 1, createdAt: SEED_DATE },
  { id: 2, siteId: 1, widgetId: 1, itemId: 'channel-1', sourceType: 'channel' as const, sourceId: 1, createdAt: SEED_DATE },
];

export const SEED_CMS_PAGE_BLOCK_ACLS = [
  { id: 1, pageId: 1, blockId: 'hero-1', subjectType: 'role' as const, subjectId: 1, createdAt: SEED_DATE },
];

export const SEED_CMS_PUBLISH_TASKS = [
  {
    id: 900001,
    taskType: 'cms-publish-build',
    title: 'CMS 整站发布（演示）',
    status: 'success' as const,
    payload: { siteId: 1, targetType: 'site', reason: 'Stage 3 演示发布' },
    totalCount: 3,
    processedCount: 3,
    failedCount: 0,
    progressNote: '演示发布完成',
    result: { artifacts: 3, failedArtifacts: 0, targetType: 'site' },
    attempts: 1,
    maxAttempts: 3,
    startedAt: SEED_DATE,
    completedAt: SEED_DATE,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_DISTRIBUTION_TASKS = [
  {
    id: 900002,
    taskType: 'cms-distribution-sync',
    title: 'CMS 内容分发：根站技术资讯映射至子站（演示）',
    status: 'success' as const,
    payload: {
      ruleId: 1,
      expectedRevision: 1,
      sourceSiteId: 1,
      targetSiteId: 2,
      trigger: 'manual',
    },
    totalCount: 1,
    processedCount: 1,
    failedCount: 0,
    progressNote: '分发完成：成功 1，跳过 0，冲突 0，失败 0',
    result: { succeeded: 1, skipped: 0, conflicts: 0, failed: 0 },
    attempts: 1,
    maxAttempts: 3,
    startedAt: SEED_DATE,
    completedAt: SEED_DATE,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_DISTRIBUTION_TASK_ITEMS = [
  {
    key: 'source:1',
    label: 'Zenith Admin 发布 CMS 内容管理模块',
    status: 'success' as const,
    message: '已创建映射草稿 #6',
    data: {
      outcome: 'success',
      ruleId: 1,
      sourceContentId: 1,
      targetContentId: 6,
    },
  },
];

export const SEED_CMS_PUBLISH_ARTIFACTS = [
  { id: 1, taskId: 900001, siteId: 1, targetType: 'site' as const, path: 'index.html', url: null, checksum: 'f3f39f3b8456f63a1a414a8c311260e0b73e978fdfc8e0161653c9b92fc9c4bc', size: 4280, status: 'generated' as const, generatedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, taskId: 900001, siteId: 1, targetType: 'site' as const, path: 'sitemap.xml', url: null, checksum: 'e152f7eafc61e5aa9e0f8e83de6fdb203f415f8eaff86ab8f54cf0f9e850caef', size: 860, status: 'generated' as const, generatedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, taskId: 900001, siteId: 1, targetType: 'site' as const, path: 'robots.txt', url: null, checksum: 'b884b75b9a9d5c1b28627a65105f0b62b7f24e633eeb3e4b3de414e8ee3dc1c4', size: 56, status: 'generated' as const, generatedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── CMS P2：广告位 / 广告 / 表单 / 敏感词 / 内链词 / 评论（示例）────────────────
export const SEED_CMS_AD_SLOTS: CmsAdSlot[] = [
  { id: 1, siteId: 1, code: 'home-ad', name: '首页通栏广告位', remark: '首页横幅下方', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_ADS: CmsAd[] = [
  { id: 1, slotId: 1, name: 'Zenith 企业版上线', image: null, linkUrl: '/products/enterprise.html', startAt: null, endAt: null, clickCount: 0, viewCount: 0, sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

const CMS_SEED_VISITOR_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const CMS_SEED_IP_HASH = '60303ae22b998861e0b4a7f9dfecefb7e5f817e746c44649e5f9b8654ebdfdc4';

export const SEED_CMS_AD_EVENTS: CmsAdEvent[] = [
  {
    id: 1, siteId: 1, adId: 1, slotId: 1, eventType: 'impression', occurredAt: SEED_DATE,
    visitorHash: CMS_SEED_VISITOR_HASH, ipHash: CMS_SEED_IP_HASH, userAgent: 'Zenith Demo',
    device: 'pc', referrer: null, path: '/', memberId: null,
  },
];

export const SEED_CMS_FORMS: CmsForm[] = [
  {
    id: 1, siteId: 1, code: 'contact', name: '联系我们',
    fields: [
      { name: 'name', label: '姓名', fieldType: 'text', required: true },
      { name: 'phone', label: '联系电话', fieldType: 'text', required: true },
      { name: 'message', label: '留言内容', fieldType: 'textarea', required: true },
    ],
    successMessage: '提交成功，我们会尽快与您联系！',
    notifyEmail: null,
    captchaProvider: 'math', turnstileSiteKey: null, turnstileSecret: null,
    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_SENSITIVE_WORDS: CmsSensitiveWord[] = [
  { id: 1, word: '赌博', replaceWith: null, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, word: '广告勿扰', replaceWith: '***', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_ERROR_PRONE_WORDS: CmsErrorProneWord[] = [
  { id: 1, word: '登陆系统', correction: '登录系统', status: 'enabled', remark: '登陆=着陆义，账号进入应为登录', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, word: '按装', correction: '安装', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, word: '部署完毕', correction: '部署完成', status: 'enabled', remark: '书面语统一用“完成”', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_LINK_WORDS: CmsLinkWord[] = [
  { id: 1, siteId: 1, keyword: '全文检索', url: '/news/2.html', maxReplaces: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── CMS Stage 4：统一互动问卷（survey + poll 示例）────────────────────────────

/** 题目默认值填充，避免每条种子重复书写新增字段 */
function interactionQuestion(
  question: Pick<CmsInteractionQuestion, 'id' | 'interactionId' | 'label' | 'type' | 'required' | 'minChoices' | 'maxChoices' | 'sort' | 'options'>
    & Partial<CmsInteractionQuestion>,
): CmsInteractionQuestion {
  return {
    allowOther: false,
    otherLabel: null,
    ratingMax: 5,
    matrixRows: [],
    pageNo: 1,
    visibleWhen: null,
    ...question,
  };
}

export const SEED_CMS_INTERACTIONS: (CmsInteraction & { questions: CmsInteractionQuestion[] })[] = [
  {
    id: 1, siteId: 1, code: 'satisfaction', kind: 'survey', title: '产品满意度调查',
    description: '感谢使用 Zenith CMS，您的反馈将帮助我们持续改进。', status: 'published',
    participantScope: 'anonymous', repeatPolicy: 'once_per_ip', resultVisibility: 'after_submit',
    captchaPolicy: 'inherit', turnstileSiteKey: null, turnstileSecretConfigured: false, thankYouMessage: '感谢您的反馈！',
    startAt: null, endAt: null, responseCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
    questions: [
      interactionQuestion({
        id: 1, interactionId: 1, label: '您对 Zenith CMS 的整体满意度？', type: 'single', required: true,
        minChoices: 1, maxChoices: 1, sort: 0,
        options: [
          { id: 'very-satisfied', label: '非常满意', value: 'very-satisfied' },
          { id: 'satisfied', label: '满意', value: 'satisfied' },
          { id: 'neutral', label: '一般', value: 'neutral' },
          { id: 'unsatisfied', label: '不满意', value: 'unsatisfied' },
        ],
      }),
      interactionQuestion({
        id: 2, interactionId: 1, label: '您使用过哪些功能？', type: 'multiple', required: false,
        minChoices: 0, maxChoices: 3, sort: 1,
        options: [
          { id: 'sites', label: '站群管理', value: 'sites' },
          { id: 'publish', label: '静态化发布', value: 'publish' },
          { id: 'search', label: '全文检索', value: 'search' },
          { id: 'interaction', label: '互动问卷', value: 'interaction' },
        ],
      }),
      interactionQuestion({
        id: 3, interactionId: 1, label: '其他意见或建议', type: 'text', required: false,
        minChoices: 0, maxChoices: 1, sort: 2, options: [],
      }),
    ],
  },
  {
    id: 2, siteId: 1, code: 'reader-vote', kind: 'poll', title: '您最期待哪项 CMS 能力？',
    description: '统一互动模型中的投票示例。', status: 'published',
    participantScope: 'member', repeatPolicy: 'once_per_member', resultVisibility: 'always',
    captchaPolicy: 'none', turnstileSiteKey: null, turnstileSecretConfigured: false, thankYouMessage: '投票成功！',
    startAt: null, endAt: null, responseCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
    questions: [
      interactionQuestion({
        id: 4, interactionId: 2, label: '请选择一项', type: 'single', required: true,
        minChoices: 1, maxChoices: 1, sort: 0,
        options: [
          { id: 'ai-writing', label: 'AI 辅助写作', value: 'ai-writing' },
          { id: 'page-builder', label: '可视化页面搭建', value: 'page-builder' },
          { id: 'distribution', label: '内容分发推送', value: 'distribution' },
        ],
      }),
    ],
  },
  {
    id: 3, siteId: 1, code: 'nps-2026', kind: 'survey', title: '2026 年度体验调研',
    description: '演示评分、NPS、矩阵、「其他」填空、条件显示与分页问卷。', status: 'draft',
    participantScope: 'anonymous', repeatPolicy: 'once_per_ip', resultVisibility: 'after_close',
    captchaPolicy: 'inherit', turnstileSiteKey: null, turnstileSecretConfigured: false, thankYouMessage: '感谢您抽出时间！',
    startAt: null, endAt: null, responseCount: 0,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
    questions: [
      interactionQuestion({
        id: 5, interactionId: 3, label: '您有多大可能把我们推荐给同事？', type: 'nps', required: true,
        minChoices: 0, maxChoices: 1, sort: 0, options: [], ratingMax: 10,
      }),
      interactionQuestion({
        id: 6, interactionId: 3, label: '请为文档质量打分', type: 'rating', required: true,
        minChoices: 0, maxChoices: 1, sort: 1, options: [], ratingMax: 5,
      }),
      interactionQuestion({
        id: 7, interactionId: 3, label: '请评价以下模块', type: 'matrix', required: false,
        minChoices: 0, maxChoices: 1, sort: 2,
        options: [
          { id: 'good', label: '好用', value: 'good' },
          { id: 'ok', label: '一般', value: 'ok' },
          { id: 'bad', label: '待改进', value: 'bad' },
        ],
        matrixRows: [
          { id: 'content', label: '内容管理' },
          { id: 'publish', label: '发布静态化' },
          { id: 'interaction', label: '互动问卷' },
        ],
      }),
      interactionQuestion({
        id: 8, interactionId: 3, label: '您所在的行业', type: 'single', required: false,
        minChoices: 0, maxChoices: 1, sort: 3, pageNo: 2,
        allowOther: true, otherLabel: '其他行业',
        options: [
          { id: 'gov', label: '政府机构', value: 'gov' },
          { id: 'edu', label: '教育科研', value: 'edu' },
          { id: 'media', label: '媒体出版', value: 'media' },
        ],
      }),
      interactionQuestion({
        id: 9, interactionId: 3, label: '请补充说明贵单位的使用场景', type: 'text', required: false,
        minChoices: 0, maxChoices: 1, sort: 4, options: [], pageNo: 2,
        visibleWhen: { questionIndex: 3, op: 'any', values: ['gov', 'edu'] },
      }),
      interactionQuestion({
        id: 10, interactionId: 3, label: '预计上线时间', type: 'date', required: false,
        minChoices: 0, maxChoices: 1, sort: 5, options: [], pageNo: 2,
      }),
    ],
  },
];

export const SEED_CMS_INTERACTION_RESPONSES = [
  {
    id: 1, interactionId: 1, memberId: null, visitorHash: CMS_SEED_VISITOR_HASH,
    ipHash: CMS_SEED_IP_HASH, repeatKey: `i:${CMS_SEED_IP_HASH}`, requestKey: 'seed-survey-response',
    createdAt: SEED_DATE,
  },
  {
    id: 2, interactionId: 2, memberId: 1, visitorHash: CMS_SEED_VISITOR_HASH,
    ipHash: CMS_SEED_IP_HASH, repeatKey: 'm:1', requestKey: 'seed-poll-response',
    createdAt: SEED_DATE,
  },
];

export const SEED_CMS_INTERACTION_ANSWERS = [
  { id: 1, responseId: 1, questionId: 1, value: 'very-satisfied' as const },
  { id: 2, responseId: 1, questionId: 2, value: ['sites', 'search'] },
  { id: 3, responseId: 1, questionId: 3, value: '继续完善素材治理' as const },
  { id: 4, responseId: 2, questionId: 4, value: 'page-builder' as const },
];

export const SEED_CMS_SUBSCRIPTIONS: CmsMemberSubscription[] = [
  {
    id: 1, memberId: 1, siteId: 1, subjectType: 'site', subjectKey: '1', subjectId: 1,
    subjectLabel: 'Zenith 官方站', notificationEnabled: true, active: true,
    pointsAwardedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, memberId: 1, siteId: 1, subjectType: 'channel', subjectKey: '1', subjectId: 1,
    subjectLabel: '新闻中心', notificationEnabled: true, active: true,
    pointsAwardedAt: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_COMMENTS: CmsComment[] = [
  { id: 1, siteId: 1, contentId: 1, parentId: 0, memberId: null, nickname: '热心网友', content: '期待 CMS 模块的采集功能！', likeCount: 3, status: 'approved', riskFlag: null, ip: null, userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, contentId: 1, parentId: 0, memberId: null, nickname: '路人甲', content: '静态化方案讲得很清楚', likeCount: 0, status: 'pending', riskFlag: null, ip: null, userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, siteId: 1, contentId: 1, parentId: 0, memberId: 1, nickname: '演示会员', content: '登录会员的评论会带会员标识，支持在会员中心统一管理。', likeCount: 1, status: 'approved', riskFlag: null, ip: null, userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, siteId: 1, contentId: 1, parentId: 0, memberId: null, nickname: '匿名用户', content: '内容不错，收藏了。', likeCount: 0, status: 'pending', riskFlag: 'watchlist', ip: '203.0.113.66', userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
