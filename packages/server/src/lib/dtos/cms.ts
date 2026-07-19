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
    viewCount: z.number().int(),
    sort: z.number().int(),
    seoTitle: z.string().nullable(),
    seoKeywords: z.string().nullable(),
    seoDescription: z.string().nullable(),
    tags: z.array(CmsTagDTO).optional(),
    tagIds: z.array(z.number().int()).optional(),
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
