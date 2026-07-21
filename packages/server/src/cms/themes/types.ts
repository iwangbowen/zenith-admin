import type { ComponentType } from 'react';
import type { CmsFragmentType, CmsSearchResult, CmsThemeSettingField } from '@zenith/shared';

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
  /** 主题参数（settingsSchema 默认值 ⊕ settings.themeConfig 合并后的最终值，模板直接消费） */
  themeConfig: Record<string, unknown>;
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
  /** 外链型内容：列表点击新窗口直达外链 */
  isExternal: boolean;
  /** 内容形态：article=图文 album=图集 media=音视频 link=外链 */
  contentType: 'article' | 'album' | 'media' | 'link';
  summary: string | null;
  coverImage: string | null;
  /** 封面缩略图（空 = 回退 coverImage） */
  coverThumb: string | null;
  /** album：图片数 */
  imageCount: number;
  /** media：音频/视频 */
  mediaType: 'video' | 'audio' | null;
  author: string | null;
  source: string | null;
  publishedAt: string | null;
  viewCount: number;
  /** 会员点赞数 / 收藏数（冗余计数） */
  likeCount: number;
  favoriteCount: number;
  isTop: boolean;
  isRecommend: boolean;
  isHot: boolean;
}

/** 图集图片（详情渲染） */
export interface CmsAlbumImageItem {
  url: string;
  thumb: string | null;
  caption: string | null;
}

/** 正文多页分页（分页符拆分；单页时为 null） */
export interface CmsBodyPagination {
  page: number;
  totalPages: number;
  pages: { page: number; url: string; current: boolean }[];
  prevUrl: string | null;
  nextUrl: string | null;
}

/** 详情数据 */
export interface CmsContentDetail extends CmsContentItem {
  body: string;
  /** 正文多页分页（含分页符时非 null，body 为当前页片段） */
  bodyPagination: CmsBodyPagination | null;
  /** album：图片列表 */
  albumImages: CmsAlbumImageItem[];
  /** media：媒体地址与海报 */
  mediaUrl: string | null;
  mediaPoster: string | null;
  mediaDuration: string | null;
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
  id: number;
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
  fragments: Record<string, { type: CmsFragmentType; content: string }>;
  /** 广告位 code → 投放中广告列表 */
  ads: Record<string, CmsAdItem[]>;
  friendLinks: { name: string; url: string; logo: string | null }[];
  seo: CmsSeo;
  searchUrl: string;
  /** 行为统计（站点开启后注入采集脚本）；detail 页附 contentId 供浏览计数 beacon */
  analytics: { siteKey: string; contentId?: number } | null;
  /** 多语言站点关联（P5）：hreflang alternate + 语言切换；空数组 = 未配置 */
  langAlternates: { language: string; name: string; url: string; current: boolean }[];
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

/** 前台评论（已审核；树形两级：parentId=0 为顶级） */
export interface CmsCommentItem {
  id: number;
  parentId: number;
  nickname: string;
  content: string;
  likeCount: number;
  /** 是否登录会员发表（前台展示会员徽标） */
  isMember: boolean;
  createdAt: string;
}

/** 评论提交表单配置（原生 HTML form POST；登录会员由内联 JS 走会员 API） */
export interface CmsCommentFormConfig {
  action: string;
  contentId: number;
  returnUrl: string;
  /** 会员评论提交 API（携带 Bearer token 的 JSON POST） */
  memberSubmitApi: string;
  /** 站点开启图形验证码（游客提交时前端加载并携带答案） */
  captchaEnabled: boolean;
}

export interface CmsDetailContext extends CmsBaseContext {
  channel: CmsChannelInfo;
  breadcrumbs: CmsBreadcrumb[];
  content: CmsContentDetail;
  /** 相关文章（手动关联优先，不足按标签补齐） */
  related: { title: string; url: string }[];
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
  /** 站点开启图形验证码（提交时必须携带答案） */
  captchaEnabled: boolean;
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

/** 前台问卷页上下文 */
export interface CmsSurveyPageContext extends CmsBaseContext {
  breadcrumbs: CmsBreadcrumb[];
  survey: {
    id: number;
    code: string;
    title: string;
    description: string | null;
    allowAnonymous: boolean;
    questions: {
      id: number;
      label: string;
      type: 'single' | 'multiple' | 'text';
      required: boolean;
      options: { label: string; value: string }[];
    }[];
  };
  /** 匿名 form POST 地址 / 会员 JSON 提交 API / 回跳地址 */
  submitForm: { action: string; memberSubmitApi: string; returnUrl: string };
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

/** 变体模板：带展示名，供后台「模板选择」下拉列出 */
export interface CmsTemplateVariant<P> {
  label: string;
  component: ComponentType<P>;
}

export interface CmsTheme {
  code: string;
  label: string;
  templates: CmsThemeTemplates;
  /** 可视化搭建页面模板（缺省回退 default 主题实现） */
  customPage?: ComponentType<CmsCustomPageContext>;
  /** 前台问卷页模板（缺省回退 default 主题实现） */
  survey?: ComponentType<CmsSurveyPageContext>;
  /** 扩展模板：站点默认模板 / 栏目 listTemplate / 内容 detailTemplate 按名称引用（如 list-card / detail-plain） */
  extraListTemplates?: Record<string, CmsTemplateVariant<CmsListContext>>;
  extraDetailTemplates?: Record<string, CmsTemplateVariant<CmsDetailContext>>;
  /** 主题参数声明：后台「主题参数」面板按此渲染表单，值存 settings.themeConfig，模板经 site.themeConfig 消费 */
  settingsSchema?: CmsThemeSettingField[];
}
