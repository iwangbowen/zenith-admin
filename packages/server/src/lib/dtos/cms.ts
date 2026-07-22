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

export const CmsPublishChannelDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    name: z.string().openapi({ example: 'H5 移动' }),
    code: z.string().openapi({ example: 'h5', description: '通道编码（站点内唯一）：预览段 /__cms/{site}/__{code}、静态子树 __{code}/' }),
    domain: z.string().nullable().openapi({ description: '通道独立域名；默认通道使用站点主域名' }),
    uaRegex: z.string().nullable().openapi({ description: 'UA 匹配正则（与 domain 同配时启用 UA 302 互跳）' }),
    isDefault: z.boolean().openapi({ description: '默认通道（每站点唯一，不可删除/停用）' }),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    remark: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsPublishChannel');

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
    socialImageAlt: z.string().nullable(),
    twitterCreator: z.string().nullable(),
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
    groupName: z.string().nullable().openapi({ description: '标签分组（可空）' }),
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
    contentType: z.enum(['article', 'album', 'media', 'link']).openapi({ description: '内容形态（创建后不可变更）' }),
    mediaData: z.record(z.string(), z.unknown()).openapi({ description: '形态结构化数据：album.images / media.mediaType|mediaUrl|poster|duration' }),
    title: z.string().openapi({ example: '公司荣获行业大奖' }),
    subTitle: z.string().nullable().openapi({ description: '副标题' }),
    shortTitle: z.string().nullable().openapi({ description: '短标题（列表窄位展示）' }),
    slug: z.string().nullable(),
    summary: z.string().nullable(),
    coverImage: z.string().nullable(),
    coverThumb: z.string().nullable().openapi({ description: '封面缩略图（空 = 前台回退原图）' }),
    author: z.string().nullable(),
    editor: z.string().nullable().openapi({ description: '责任编辑' }),
    source: z.string().nullable(),
    sourceUrl: z.string().nullable().openapi({ description: '来源链接' }),
    isOriginal: z.boolean().openapi({ description: '原创标记' }),
    body: z.string().nullable(),
    extend: z.record(z.string(), z.unknown()),
    externalLink: z.string().nullable(),
    detailTemplate: z.string().nullable().openapi({ description: '详情模板覆盖（主题变体模板名；空 = 跟随栏目/站点默认）' }),
    isTop: z.boolean(),
    topWeight: z.number().int().openapi({ description: '置顶权重（数值越大越靠前）' }),
    topExpireAt: z.string().nullable().openapi({ description: '置顶到期时间（到期自动取消置顶；空 = 永久）' }),
    isRecommend: z.boolean(),
    isHot: z.boolean(),
    hasImage: z.boolean().optional().openapi({ description: '含图（保存时自动检测）' }),
    hasVideo: z.boolean().optional().openapi({ description: '含视频（保存时自动检测）' }),
    hasAttachment: z.boolean().optional().openapi({ description: '含附件（保存时自动检测）' }),
    status: z.enum(['draft', 'pending', 'published', 'offline', 'rejected']),
    rejectReason: z.string().nullable(),
    publishedAt: z.string().nullable(),
    scheduledAt: z.string().nullable(),
    expireAt: z.string().nullable().openapi({ description: '过期自动下线时间（空 = 永不过期）' }),
    viewCount: z.number().int(),
    likeCount: z.number().int().openapi({ description: '会员点赞数（冗余计数）' }),
    favoriteCount: z.number().int().openapi({ description: '会员收藏数（冗余计数）' }),
    version: z.number().int().openapi({ description: '乐观锁版本号，更新时回传 expectedVersion' }),
    sort: z.number().int(),
    seoTitle: z.string().nullable(),
    seoKeywords: z.string().nullable(),
    seoDescription: z.string().nullable(),
    tags: z.array(CmsTagDTO).optional(),
    tagIds: z.array(z.number().int()).optional(),
    extraChannelIds: z.array(z.number().int()).optional().openapi({ description: '副栏目 id（一文多栏目）' }),
    relatedIds: z.array(z.number().int()).optional().openapi({ description: '相关文章 id（手动关联）' }),
    archivedAt: z.string().nullable().openapi({ description: '归档时间（非空 = 已归档）' }),
    mappingSourceId: z.number().int().nullable().openapi({ description: '映射来源内容 id（非空 = 映射内容，正文共享来源）' }),
    mappingSourceTitle: z.string().nullable().optional().openapi({ description: '映射来源内容标题' }),
    lockedAt: z.string().nullable(),
    lockedBy: z.number().int().nullable(),
    lockedByName: z.string().nullable().optional(),
    lockReason: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsContent');

export const CmsContentLockDTO = z
  .object({
    lockedAt: z.string(),
    lockedBy: z.number().int().nullable(),
    lockReason: z.string().nullable(),
  })
  .openapi('CmsContentLock');

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

export const CmsThemeTemplateOptionDTO = z
  .object({
    name: z.string().openapi({ example: 'list-card' }),
    label: z.string().openapi({ example: '卡片网格（产品/案例）' }),
  })
  .openapi('CmsThemeTemplateOption');

/** 主题可选模板清单（不含主题默认模板本身，前端下拉自行加「跟随默认」项） */
export const CmsThemeTemplatesDTO = z
  .object({
    list: z.array(CmsThemeTemplateOptionDTO),
    detail: z.array(CmsThemeTemplateOptionDTO),
  })
  .openapi('CmsThemeTemplates');

export const CmsInvalidTemplateRefDTO = z
  .object({
    source: z.enum(['site', 'channel', 'content']).openapi({ description: '引用位置层级' }),
    kind: z.enum(['list', 'detail']),
    template: z.string().openapi({ example: 'list-card', description: '失效的模板名' }),
    location: z.string().openapi({ example: '站点默认模板[pc]列表' }),
    channelId: z.number().int().optional(),
    channelName: z.string().optional(),
    count: z.number().int().optional().openapi({ description: 'source=content 时聚合的内容条数' }),
  })
  .openapi('CmsInvalidTemplateRef');

/** 站点模板健康检查：配置中引用但目标主题不存在的模板清单 */
export const CmsTemplateHealthDTO = z
  .object({
    theme: z.string().openapi({ example: 'default' }),
    themeRegistered: z.boolean().openapi({ description: '主题是否已在代码注册表登记（未登记 = 渲染回退 default）' }),
    invalidRefs: z.array(CmsInvalidTemplateRefDTO),
  })
  .openapi('CmsTemplateHealth');

/** 主题参数字段声明（后台主题参数面板动态表单） */
export const CmsThemeSettingFieldDTO = z
  .object({
    name: z.string().openapi({ example: 'footerText' }),
    label: z.string().openapi({ example: '页脚附加文案' }),
    fieldType: z.enum(['text', 'textarea', 'color', 'number', 'switch', 'select', 'image']),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
    placeholder: z.string().optional(),
    description: z.string().optional(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    group: z.string().optional(),
  })
  .openapi('CmsThemeSettingField');

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
    memberId: z.number().int().nullable().openapi({ description: '会员评论：非空表示由登录会员提交' }),
    memberUsername: z.string().nullable().optional(),
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

export const CmsMemberCommentDTO = z
  .object({
    id: z.number().int(),
    contentId: z.number().int(),
    contentTitle: z.string().nullable(),
    contentUrl: z.string().nullable().openapi({ description: '内容前台地址（未绑定域名时为相对路径）' }),
    parentId: z.number().int(),
    content: z.string(),
    likeCount: z.number().int(),
    status: z.enum(['pending', 'approved', 'rejected']),
    createdAt: z.string(),
  })
  .openapi('CmsMemberComment');

export const CmsResourceDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    folderId: z.number().int().nullable(),
    folderName: z.string().nullable().optional(),
    type: z.enum(['image', 'video', 'audio', 'document', 'other']),
    name: z.string(),
    url: z.string(),
    thumbUrl: z.string().nullable(),
    fileId: z.string().nullable(),
    size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    mimeType: z.string().nullable(),
    remark: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsResource');

export const CmsResourceReferenceDTO = z
  .object({
    kind: z.enum(['site', 'content', 'channel', 'fragment', 'friendLink', 'ad', 'page', 'form', 'theme']),
    id: z.number().int(),
    title: z.string(),
    field: z.string(),
  })
  .openapi('CmsResourceReference');

export const CmsResourceFolderDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    parentId: z.number().int().nullable(),
    name: z.string(),
    sort: z.number().int(),
    resourceCount: z.number().int().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(CmsResourceFolderDTO).optional();
    },
  })
  .openapi('CmsResourceFolder');

export const CmsPollOptionDTO = z.object({
  id: z.number().int(),
  label: z.string(),
});

export const CmsPollDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    code: z.string().openapi({ example: 'reader-vote' }),
    title: z.string(),
    options: z.array(CmsPollOptionDTO),
    maxChoices: z.number().int(),
    allowAnonymous: z.boolean(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    status: z.enum(['draft', 'published', 'closed']),
    totalVotes: z.number().int(),
    remark: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsPoll');

export const CmsPollResultsDTO = z
  .object({
    pollId: z.number().int(),
    title: z.string(),
    totalVotes: z.number().int(),
    options: z.array(CmsPollOptionDTO.extend({ votes: z.number().int() })),
  })
  .openapi('CmsPollResults');

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
    viewCount: z.number().int().openapi({ description: '曝光计数（前台页面 beacon 上报累加）' }),
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
      minLength: z.number().int().nullable().optional(),
      maxLength: z.number().int().nullable().optional(),
      pattern: z.string().nullable().optional(),
      min: z.number().nullable().optional(),
      max: z.number().nullable().optional(),
      errorMessage: z.string().nullable().optional(),
    })),
    successMessage: z.string().nullable(),
    notifyEmail: z.string().nullable().openapi({ description: '新提交通知邮箱（逗号分隔多个）' }),
    captchaProvider: z.enum(['inherit', 'none', 'math', 'turnstile']),
    turnstileSiteKey: z.string().nullable(),
    turnstileSecret: z.string().nullable().openapi({ description: 'write-only 掩码；空串/掩码保留，null 清除' }),
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

export const CmsErrorProneWordDTO = z
  .object({
    id: z.number().int(),
    word: z.string().openapi({ example: '登陆系统' }),
    correction: z.string().openapi({ example: '登录系统' }),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsErrorProneWord');

export const CmsContentOpLogDTO = z
  .object({
    id: z.number().int(),
    contentId: z.number().int(),
    action: z.string().openapi({ example: 'published' }),
    actionLabel: z.string().openapi({ example: '发布' }),
    detail: z.string().nullable(),
    operatorId: z.number().int().nullable(),
    operatorName: z.string(),
    createdAt: z.string(),
  })
  .openapi('CmsContentOpLog');

export const CmsTextCheckResultDTO = z
  .object({
    sensitive: z.array(z.object({
      word: z.string(),
      replaceWith: z.string().nullable().openapi({ description: '空 = 拦截词（提交会被拒绝）' }),
      count: z.number().int(),
    })),
    errorProne: z.array(z.object({
      word: z.string(),
      correction: z.string(),
      count: z.number().int(),
    })),
  })
  .openapi('CmsTextCheckResult');

// ─── P3 会员互动 / 问卷 ────────────────────────────────────────────────────────
export const CmsInteractionStateDTO = z
  .object({
    liked: z.boolean(),
    favorited: z.boolean(),
    likeCount: z.number().int(),
    favoriteCount: z.number().int(),
  })
  .openapi('CmsInteractionState');

export const CmsMemberContentItemDTO = z
  .object({
    contentId: z.number().int(),
    title: z.string(),
    url: z.string().nullable().openapi({ description: '前台详情站内路径（内容已下线/删除时为 null）' }),
    coverThumb: z.string().nullable(),
    contentType: z.enum(['article', 'album', 'media', 'link']),
    viewCount: z.number().int().optional().openapi({ description: '浏览历史：累计次数' }),
    createdAt: z.string(),
    updatedAt: z.string().optional().openapi({ description: '浏览历史：最近浏览时间' }),
  })
  .openapi('CmsMemberContentItem');

export const CmsSurveyQuestionDTO = z
  .object({
    id: z.number().int(),
    surveyId: z.number().int(),
    label: z.string().openapi({ example: '您最常用的功能是？' }),
    type: z.enum(['single', 'multiple', 'text']),
    required: z.boolean(),
    options: z.array(z.object({ label: z.string(), value: z.string() })),
    sort: z.number().int(),
  })
  .openapi('CmsSurveyQuestion');

export const CmsSurveyDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    code: z.string().openapi({ example: 'satisfaction-2026' }),
    title: z.string().openapi({ example: '产品满意度调查' }),
    description: z.string().nullable(),
    status: z.enum(['draft', 'published', 'closed']),
    allowAnonymous: z.boolean(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    answerCount: z.number().int(),
    questions: z.array(CmsSurveyQuestionDTO).optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsSurvey');

export const CmsSurveyStatsDTO = z
  .object({
    surveyId: z.number().int(),
    answerCount: z.number().int(),
    questions: z.array(z.object({
      id: z.number().int(),
      label: z.string(),
      type: z.enum(['single', 'multiple', 'text']),
      options: z.array(z.object({
        label: z.string(),
        value: z.string(),
        count: z.number().int(),
        percent: z.number().openapi({ description: '按已答人数计算的百分比（0-100，1 位小数）' }),
      })),
      texts: z.array(z.string()).openapi({ description: '文字题最近样本（最多 50 条）' }),
    })),
  })
  .openapi('CmsSurveyStats');

// ─── P4 统计分析 ───────────────────────────────────────────────────────────────
const dayMetric = z.object({ pv: z.number().int(), uv: z.number().int(), ips: z.number().int() });

export const CmsVisitStatsDTO = z
  .object({
    today: dayMetric,
    yesterday: dayMetric,
    totalPv: z.number().int().openapi({ description: '统计区间累计 PV（不含爬虫）' }),
    trend: z.array(z.object({ date: z.string(), pv: z.number().int(), uv: z.number().int() })),
    topContents: z.array(z.object({
      contentId: z.number().int(),
      title: z.string(),
      pv: z.number().int(),
      uv: z.number().int(),
    })),
    devices: z.array(z.object({ deviceType: z.enum(['pc', 'mobile', 'bot']), pv: z.number().int() })),
    referrers: z.array(z.object({ host: z.string(), pv: z.number().int() })),
    channels: z.array(z.object({ channelCode: z.string(), pv: z.number().int() })),
  })
  .openapi('CmsVisitStats');

export const CmsSearchAnalyticsDTO = z
  .object({
    total: z.number().int(),
    trend: z.array(z.object({ date: z.string(), count: z.number().int() })),
    topKeywords: z.array(z.object({ keyword: z.string(), count: z.number().int(), avgResults: z.number().int() })),
    noResultKeywords: z.array(z.object({ keyword: z.string(), count: z.number().int() })).openapi({ description: '无结果搜索词榜（内容选题参考）' }),
  })
  .openapi('CmsSearchAnalytics');

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

// ─── P5 企业级治理 ─────────────────────────────────────────────────────────────
export const CmsChannelUsersDTO = z
  .object({
    userIds: z.array(z.number().int()),
    users: z.array(z.object({ id: z.number().int(), username: z.string(), nickname: z.string() })),
  })
  .openapi('CmsChannelUsers');

export const CmsSiteImportResultDTO = z
  .object({
    siteId: z.number().int(),
    siteName: z.string(),
    siteCode: z.string(),
    counts: z.object({
      channels: z.number().int(),
      tags: z.number().int(),
      contents: z.number().int(),
      fragments: z.number().int(),
      friendLinks: z.number().int(),
      redirects: z.number().int(),
      linkWords: z.number().int(),
      adSlots: z.number().int(),
      ads: z.number().int(),
      forms: z.number().int(),
      pages: z.number().int(),
    }),
  })
  .openapi('CmsSiteImportResult');

// ─── P3 Batch1 ────────────────────────────────────────────────────────────────
export const CmsSearchWordDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    word: z.string().openapi({ example: '全文检索' }),
    type: z.enum(['extension', 'stop']),
    groupName: z.string(),
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
    id: z.number().int().nullable(),
    siteId: z.number().int(),
    groupId: z.number().int().nullable(),
    groupName: z.string().nullable(),
    keyword: z.string(),
    count: z.number().int(),
    sort: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
  })
  .openapi('CmsHotKeyword');

export const CmsHotwordGroupDTO = z
  .object({
    id: z.number().int(),
    siteId: z.number().int(),
    name: z.string(),
    sort: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CmsHotwordGroup');

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
