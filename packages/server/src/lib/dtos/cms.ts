/**
 * CMS 内容管理 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const CmsSiteDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '官方网站' }),
    code: z.string().openapi({ example: 'main' }),
    domain: z.string().nullable(),
    aliasDomains: z.array(z.string()),
    isDefault: z.boolean(),
    title: z.string().nullable(),
    keywords: z.string().nullable(),
    description: z.string().nullable(),
    logo: z.string().nullable(),
    favicon: z.string().nullable(),
    icp: z.string().nullable(),
    copyright: z.string().nullable(),
    theme: z.string(),
    staticMode: z.enum(['dynamic', 'hybrid', 'static']),
    robots: z.string().nullable(),
    settings: z.record(z.string(), z.unknown()),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsSite');

export const CmsModelFieldDTO = z
  .object({
    id: z.number().int(),
    modelId: z.number().int(),
    name: z.string().openapi({ example: 'video_url' }),
    label: z.string().openapi({ example: '视频地址' }),
    fieldType: z.enum(['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch']),
    required: z.boolean(),
    searchable: z.boolean(),
    showInList: z.boolean(),
    placeholder: z.string().nullable(),
    defaultValue: z.string().nullable(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).nullable(),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsModelField');

export const CmsModelDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '文章' }),
    code: z.string().openapi({ example: 'article' }),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    fields: z.array(CmsModelFieldDTO).optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsModel');

export const CmsChannelDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    parentId: z.number().int(),
    modelId: z.number().int().nullable(),
    modelName: z.string().nullable().optional(),
    name: z.string().openapi({ example: '新闻中心' }),
    slug: z.string().openapi({ example: 'news' }),
    path: z.string().openapi({ example: 'news' }),
    type: z.enum(['list', 'page', 'link']),
    linkUrl: z.string().nullable(),
    listTemplate: z.string().nullable(),
    detailTemplate: z.string().nullable(),
    pageSize: z.number().int(),
    pageContent: z.string().nullable(),
    seoTitle: z.string().nullable(),
    seoKeywords: z.string().nullable(),
    seoDescription: z.string().nullable(),
    image: z.string().nullable(),
    visible: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    settings: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(CmsChannelDTO).optional();
    },
  })
  .openapi('CmsChannel');

export const CmsTagDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    name: z.string().openapi({ example: '行业动态' }),
    slug: z.string().openapi({ example: 'industry' }),
    contentCount: z.number().int(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsTag');

export const CmsContentDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    channelId: z.number().int(),
    channelName: z.string().nullable().optional(),
    modelId: z.number().int().nullable(),
    title: z.string().openapi({ example: '公司荣获行业大奖' }),
    slug: z.string().nullable(),
    summary: z.string().nullable(),
    coverImage: z.string().nullable(),
    author: z.string().nullable(),
    source: z.string().nullable(),
    body: z.string().nullable(),
    extend: z.record(z.string(), z.unknown()),
    externalLink: z.string().nullable(),
    isTop: z.boolean(),
    isRecommend: z.boolean(),
    isHot: z.boolean(),
    status: z.enum(['draft', 'pending', 'published', 'offline', 'rejected']),
    rejectReason: z.string().nullable(),
    publishedAt: z.string().nullable(),
    scheduledAt: z.string().nullable(),
    expireAt: z.string().nullable().openapi({ description: '过期自动下线时间（空 = 永不过期）' }),
    viewCount: z.number().int(),
    version: z.number().int().openapi({ description: '乐观锁版本号，更新时回传 expectedVersion' }),
    sort: z.number().int(),
    seoTitle: z.string().nullable(),
    seoKeywords: z.string().nullable(),
    seoDescription: z.string().nullable(),
    tags: z.array(CmsTagDTO).optional(),
    tagIds: z.array(z.number().int()).optional(),
    extraChannelIds: z.array(z.number().int()).optional().openapi({ description: '副栏目 id（一文多栏目）' }),
    relatedIds: z.array(z.number().int()).optional().openapi({ description: '相关文章 id（手动关联）' }),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsContent');

export const CmsFragmentDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    code: z.string().openapi({ example: 'home-banner' }),
    name: z.string().openapi({ example: '首页横幅' }),
    type: z.enum(['html', 'text', 'image', 'json']),
    content: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsFragment');

export const CmsFriendLinkDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    name: z.string().openapi({ example: '合作伙伴' }),
    url: z.string(),
    logo: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsFriendLink');

export const CmsSearchResultDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    channelId: z.number().int(),
    channelName: z.string().nullable(),
    title: z.string(),
    titleHighlight: z.string(),
    snippet: z.string(),
    url: z.string(),
    publishedAt: z.string().nullable(),
    rank: z.number(),
  })
  .openapi('CmsSearchResult');

export const CmsThemeDTO = z
  .object({
    code: z.string().openapi({ example: 'default' }),
    label: z.string().openapi({ example: '默认主题' }),
  })
  .openapi('CmsTheme');

// ─── P2 ───────────────────────────────────────────────────────────────────────
export const CmsContentVersionDTO = z
  .object({
    id: z.number().int(),
    contentId: z.number().int(),
    version: z.number().int(),
    title: z.string(),
    snapshot: z.record(z.string(), z.unknown()),
    remark: z.string().nullable(),
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('CmsContentVersion');

export const CmsContentVersionDiffDTO = z
  .object({
    field: z.string().openapi({ example: 'title' }),
    label: z.string().openapi({ example: '标题' }),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
  })
  .openapi('CmsContentVersionDiff');

export const CmsEditLockDTO = z
  .object({
    acquired: z.boolean().openapi({ description: 'true=当前用户持有编辑锁' }),
    holder: z
      .object({
        userId: z.number().int(),
        nickname: z.string(),
        lockedAt: z.string(),
      })
      .nullable()
      .openapi({ description: '他人持锁时的持有人信息' }),
  })
  .openapi('CmsEditLock');

export const CmsPreviewLinkDTO = z
  .object({
    url: z.string().openapi({ example: '/__cms/main/preview/1?exp=1789000000&sig=abc' }),
    expiresAt: z.string(),
  })
  .openapi('CmsPreviewLink');

export const CmsDashboardStatsDTO = z
  .object({
    totals: z.object({
      published: z.number().int(),
      draft: z.number().int(),
      pending: z.number().int(),
      offline: z.number().int(),
      rejected: z.number().int(),
      recycled: z.number().int(),
    }),
    pendingComments: z.number().int(),
    todayPublished: z.number().int(),
    totalViews: z.number().int(),
    publishTrend: z.array(z.object({ date: z.string(), count: z.number().int() })),
    topViewed: z.array(z.object({
      id: z.number().int(),
      title: z.string(),
      viewCount: z.number().int(),
      channelName: z.string().nullable(),
    })),
    channelDistribution: z.array(z.object({
      channelId: z.number().int(),
      channelName: z.string(),
      count: z.number().int(),
    })),
  })
  .openapi('CmsDashboardStats');

export const CmsRedirectDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    fromPath: z.string().openapi({ example: '/old-page.html' }),
    toUrl: z.string().openapi({ example: '/news/' }),
    redirectType: z.number().int().openapi({ example: 301 }),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsRedirect');

export const CmsLinkWordDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    keyword: z.string().openapi({ example: '全文检索' }),
    url: z.string(),
    maxReplaces: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsLinkWord');

export const CmsCommentDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    contentId: z.number().int(),
    contentTitle: z.string().nullable().optional(),
    parentId: z.number().int().openapi({ description: '父评论 id，0 = 顶级' }),
    parentNickname: z.string().nullable().optional(),
    nickname: z.string(),
    content: z.string(),
    likeCount: z.number().int(),
    status: z.enum(['pending', 'approved', 'rejected']),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsComment');

export const CmsAdSlotDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    code: z.string().openapi({ example: 'home-ad' }),
    name: z.string(),
    remark: z.string().nullable(),
    adCount: z.number().int().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsAdSlot');

export const CmsAdDTO = z
  .object({
    id: z.number().int(),
    slotId: z.number().int(),
    slotName: z.string().nullable().optional(),
    name: z.string(),
    image: z.string().nullable(),
    linkUrl: z.string().nullable(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    clickCount: z.number().int().openapi({ description: '点击计数（前台点击中转累加）' }),
    sort: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsAd');

export const CmsFormDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    code: z.string().openapi({ example: 'contact' }),
    name: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      fieldType: z.string(),
      required: z.boolean(),
      options: z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
    })),
    successMessage: z.string().nullable(),
    notifyEmail: z.string().nullable().openapi({ description: '新提交通知邮箱（逗号分隔多个）' }),
    status: z.enum(['enabled', 'disabled']),
    submissionCount: z.number().int().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsForm');

export const CmsFormSubmissionDTO = z
  .object({
    id: z.number().int(),
    formId: z.number().int(),
    data: z.record(z.string(), z.unknown()),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('CmsFormSubmission');

export const CmsSensitiveWordDTO = z
  .object({
    id: z.number().int(),
    word: z.string(),
    replaceWith: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsSensitiveWord');

export const CmsPushLogDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    engine: z.string().openapi({ example: 'baidu' }),
    urls: z.array(z.string()),
    success: z.boolean(),
    statusCode: z.number().int().nullable(),
    response: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('CmsPushLog');

export const CmsPushResultDTO = z
  .object({
    engine: z.string(),
    submitted: z.boolean(),
    reason: z.string().optional(),
  })
  .openapi('CmsPushResult');

export const CmsSiteUsersDTO = z
  .object({
    userIds: z.array(z.number().int()),
    users: z.array(z.object({ id: z.number().int(), username: z.string(), nickname: z.string() })),
  })
  .openapi('CmsSiteUsers');

// ─── P3 Batch1 ────────────────────────────────────────────────────────────────
export const CmsSearchWordDTO = z
  .object({
    id: z.number().int(),
    word: z.string().openapi({ example: '全文检索' }),
    weight: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsSearchWord');

export const CmsHotKeywordDTO = z
  .object({
    keyword: z.string(),
    count: z.number().int(),
  })
  .openapi('CmsHotKeyword');

// ─── P3 Batch2 ────────────────────────────────────────────────────────────────
export const CmsImageUploadDTO = z
  .object({
    url: z.string().openapi({ example: '/api/files/xxx/content' }),
    thumbUrl: z.string().nullable(),
    fileId: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    watermarked: z.boolean(),
  })
  .openapi('CmsImageUpload');

// ─── P3 Batch4：会员投稿 ──────────────────────────────────────────────────────
export const CmsContributionDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    channelId: z.number().int(),
    channelName: z.string().nullable(),
    title: z.string(),
    summary: z.string().nullable(),
    coverImage: z.string().nullable(),
    body: z.string().nullable(),
    status: z.enum(['draft', 'pending', 'published', 'offline', 'rejected']),
    rejectReason: z.string().nullable(),
    publishedAt: z.string().nullable(),
    viewCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsContribution');

export const CmsContribChannelsDTO = z
  .array(z.object({
    id: z.number().int(),
    name: z.string(),
    channels: z.array(z.object({ id: z.number().int(), name: z.string() })),
  }))
  .openapi('CmsContribChannels');

// ─── P3 Batch5：采集中心 ──────────────────────────────────────────────────────
export const CmsCollectRuleDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    channelId: z.number().int(),
    channelName: z.string().nullable(),
    name: z.string(),
    listUrl: z.string(),
    pageStart: z.number().int(),
    pageEnd: z.number().int(),
    listSelector: z.string(),
    titleSelector: z.string(),
    bodySelector: z.string(),
    summarySelector: z.string().nullable(),
    coverSelector: z.string().nullable(),
    removeSelectors: z.array(z.string()),
    autoPublish: z.boolean(),
    localizeImages: z.boolean(),
    maxItems: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    lastRunAt: z.string().nullable(),
    remark: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsCollectRule');

export const CmsCollectItemDTO = z
  .object({
    id: z.number().int(),
    ruleId: z.number().int(),
    url: z.string(),
    title: z.string().nullable(),
    status: z.enum(['success', 'skipped', 'failed']),
    contentId: z.number().int().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('CmsCollectItem');

// ─── P3 Batch6：可视化页面搭建 ────────────────────────────────────────────────
export const CmsPageBlockDTO = z
  .object({
    id: z.string(),
    type: z.enum(['hero', 'richtext', 'image', 'content-list', 'columns', 'fragment']),
    props: z.record(z.string(), z.unknown()),
  })
  .openapi('CmsPageBlock');

export const CmsPageDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    name: z.string(),
    slug: z.string(),
    isHome: z.boolean(),
    blocks: z.array(CmsPageBlockDTO),
    seoTitle: z.string().nullable(),
    seoKeywords: z.string().nullable(),
    seoDescription: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsPage');
