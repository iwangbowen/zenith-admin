import type { ComponentType } from 'react';
import type { CmsSearchResult } from '@zenith/shared';

/** 渲染上下文：站点信息 */
export interface CmsRenderSite {
  id: number;
  code: string;
  name: string;
  title: string | null;
  keywords: string | null;
  description: string | null;
  logo: string | null;
  favicon: string | null;
  icp: string | null;
  copyright: string | null;
  theme: string;
  settings: Record<string, unknown>;
}

/** 前台导航节点 */
export interface CmsNavItem {
  id: number;
  name: string;
  url: string;
  target: '_self' | '_blank';
  children?: CmsNavItem[];
}

export interface CmsBreadcrumb {
  name: string;
  url: string;
}

/** 页面 SEO 元信息（三级 TDK 覆盖后的最终值） */
export interface CmsSeo {
  title: string;
  keywords: string;
  description: string;
  canonical: string | null;
  ogTitle: string;
  ogDescription: string;
  ogImage: string | null;
  /** JSON-LD 结构化数据（detail 页为 Article） */
  jsonLd: Record<string, unknown> | null;
}

/** 列表条目 */
export interface CmsContentItem {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  coverImage: string | null;
  author: string | null;
  source: string | null;
  publishedAt: string | null;
  viewCount: number;
  isTop: boolean;
  isRecommend: boolean;
  isHot: boolean;
}

/** 详情数据 */
export interface CmsContentDetail extends CmsContentItem {
  body: string;
  extend: Record<string, unknown>;
  tags: { name: string; slug: string; url: string }[];
  prev: { title: string; url: string } | null;
  next: { title: string; url: string } | null;
}

/** 分页数据（URL 已预生成，模板直接渲染） */
export interface CmsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  prevUrl: string | null;
  nextUrl: string | null;
  pages: { page: number; url: string; current: boolean }[];
}

/** 广告条目 */
export interface CmsAdItem {
  name: string;
  image: string | null;
  linkUrl: string | null;
}

/** 所有模板共享的基础上下文 */
export interface CmsBaseContext {
  site: CmsRenderSite;
  /** URL 前缀：正式域名下为 ''，预览模式为 /__cms/{code} */
  baseUrl: string;
  nav: CmsNavItem[];
  /** 碎片 code → { type, content } */
  fragments: Record<string, { type: string; content: string }>;
  /** 广告位 code → 投放中广告列表 */
  ads: Record<string, CmsAdItem[]>;
  friendLinks: { name: string; url: string; logo: string | null }[];
  seo: CmsSeo;
  searchUrl: string;
  /** 行为统计（站点开启后注入采集脚本）；detail 页附 contentId 供浏览计数 beacon */
  analytics: { siteKey: string; contentId?: number } | null;
}

export interface CmsHomeContext extends CmsBaseContext {
  latest: CmsContentItem[];
  recommended: CmsContentItem[];
  hot: CmsContentItem[];
}

export interface CmsChannelInfo {
  id: number;
  name: string;
  url: string;
  description: string | null;
  image: string | null;
}

export interface CmsListContext extends CmsBaseContext {
  channel: CmsChannelInfo;
  breadcrumbs: CmsBreadcrumb[];
  items: CmsContentItem[];
  pagination: CmsPagination;
}

/** 前台评论（已审核） */
export interface CmsCommentItem {
  nickname: string;
  content: string;
  createdAt: string;
}

/** 评论提交表单配置（原生 HTML form POST） */
export interface CmsCommentFormConfig {
  action: string;
  contentId: number;
  returnUrl: string;
}

export interface CmsDetailContext extends CmsBaseContext {
  channel: CmsChannelInfo;
  breadcrumbs: CmsBreadcrumb[];
  content: CmsContentDetail;
  comments: CmsCommentItem[];
  commentForm: CmsCommentFormConfig;
}

/** 前台自定义表单配置（栏目 settings.formCode 绑定） */
export interface CmsFrontFormConfig {
  code: string;
  name: string;
  action: string;
  returnUrl: string;
  successMessage: string | null;
  fields: { name: string; label: string; fieldType: string; required: boolean; options?: { label: string; value: string }[] | null }[];
}

export interface CmsPageContext extends CmsBaseContext {
  channel: CmsChannelInfo;
  breadcrumbs: CmsBreadcrumb[];
  contentHtml: string;
  form: CmsFrontFormConfig | null;
}

export interface CmsSearchContext extends CmsBaseContext {
  keyword: string;
  results: CmsSearchResult[];
  pagination: CmsPagination;
}

/** 标签聚合页上下文 */
export interface CmsTagPageContext extends CmsBaseContext {
  tag: { name: string; slug: string; contentCount: number };
  breadcrumbs: CmsBreadcrumb[];
  items: CmsContentItem[];
  pagination: CmsPagination;
}

/** 可视化搭建页面上下文（区块 JSON 装配渲染） */
export interface CmsCustomPageContext extends CmsBaseContext {
  page: { name: string; slug: string };
  /** 已渲染的区块 HTML（由 blocks.tsx 统一渲染，主题只负责 Layout 包裹） */
  blocksHtml: string;
}

export interface CmsNotFoundContext extends CmsBaseContext {
  path: string;
}

/** 主题必须实现的模板集合 */
export interface CmsThemeTemplates {
  index: ComponentType<CmsHomeContext>;
  list: ComponentType<CmsListContext>;
  detail: ComponentType<CmsDetailContext>;
  page: ComponentType<CmsPageContext>;
  search: ComponentType<CmsSearchContext>;
  tag: ComponentType<CmsTagPageContext>;
  notFound: ComponentType<CmsNotFoundContext>;
}

export interface CmsTheme {
  code: string;
  label: string;
  templates: CmsThemeTemplates;
  /** 可视化搭建页面模板（缺省回退 default 主题实现） */
  customPage?: ComponentType<CmsCustomPageContext>;
  /** 扩展模板：栏目 listTemplate/detailTemplate 可按名称引用（如 list-image / detail-video） */
  extraListTemplates?: Record<string, ComponentType<CmsListContext>>;
  extraDetailTemplates?: Record<string, ComponentType<CmsDetailContext>>;
}
