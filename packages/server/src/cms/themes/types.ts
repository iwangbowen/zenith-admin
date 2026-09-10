import type { ComponentType, ReactNode } from 'react';
import type { CmsContentAttachment, CmsFormField, CmsInteractionQuestionType, CmsSearchResult, CmsThemeSettingField, CmsTitleStyle, CmsResolvedWidget, CmsWidgetRendererKey, CmsWidgetType } from '@zenith/shared/cms';
import type { CmsWidgetRendererDefinition } from './widgets';

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
  /** 站点扩展模型字段值（key = 字段标识），主题可直接读取自定义站点字段 */
  extend: Record<string, unknown>;
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
  ogImageAlt: string | null;
  ogType: 'website' | 'article';
  ogUrl: string | null;
  ogSiteName: string;
  articlePublishedTime: string | null;
  articleModifiedTime: string | null;
  articleAuthor: string | null;
  twitterCard: 'summary' | 'summary_large_image';
  twitterSite: string | null;
  twitterCreator: string | null;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string | null;
  twitterImageAlt: string | null;
  /** JSON-LD 结构化数据（detail 页为 Article） */
  jsonLd: Record<string, unknown> | null;
}

/** 列表条目 */
export interface CmsContentItem {
  id: number;
  title: string;
  /** 标题样式（加粗 / 颜色）；空对象 = 主题默认 */
  titleStyle: CmsTitleStyle;
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
  /**
   * 模型字段展示值（仅模型中勾选「列表显示」的字段；卡片角标场景，如评分/平台）。
   * 未绑定模型或无勾选字段时为空数组。
   */
  modelFields: CmsModelFieldValue[];
}

/** 图集图片（详情渲染） */
export interface CmsAlbumImageItem {
  url: string;
  thumb: string | null;
  caption: string | null;
}

/** 模型字段展示值（详情页「模型字段表」消费；由渲染管线按模型定义组装） */
export interface CmsModelFieldValue {
  /** 字段标识（extend key） */
  name: string;
  /** 字段名称（如「文号」） */
  label: string;
  fieldType: string;
  /** 原始值 */
  rawValue: unknown;
  /** 格式化后的展示值：日期格式化、select/radio/checkbox/dict 翻译为选项标签、switch 转 是/否 */
  displayValue: string;
  /** 详情分组标题（如「文件信息」）；空 = 默认分组 */
  group: string | null;
  /** 组内排序 */
  sort: number;
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
  /** 正文附件（可下载） */
  attachments: CmsContentAttachment[];
  /** album：图片列表 */
  albumImages: CmsAlbumImageItem[];
  /** media：媒体地址与海报 */
  mediaUrl: string | null;
  mediaPoster: string | null;
  mediaDuration: string | null;
  extend: Record<string, unknown>;
  /** 模型标记 showInDetail 的字段展示值（按 group/sort 排序）；栏目未绑定模型或无勾选字段时为空数组 */
  modelFields: CmsModelFieldValue[];
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

  /** 广告位 code → 投放中广告列表 */
  ads: Record<string, CmsAdItem[]>;
  friendLinks: { name: string; url: string; logo: string | null }[];
  /**
   * 按分组聚合的友链（组内已排序）。未分组的友链归入 `code: ''` 的兜底组，
   * 主题可据此决定是否渲染组标题。`friendLinks` 保留平铺形态兼容旧主题。
   */
  friendLinkGroups: { code: string; name: string; links: { name: string; url: string; logo: string | null }[] }[];
  seo: CmsSeo;
  searchUrl: string;
  /** 行为统计（站点开启后注入采集脚本）；detail 页附 contentId 供浏览计数 beacon */
  analytics: { siteKey: string; contentId?: number } | null;
  /** 多语言站点关联（P5）：hreflang alternate + 语言切换；空数组 = 未配置 */
  langAlternates: { language: string; name: string; url: string; current: boolean }[];
  /** 搭建页受众渲染上下文；仅 dynamic=true 时使用 Bearer 可选会员身份二次渲染。 */
  audience: { dynamic: boolean; member: boolean };
  /**
   * 主题样式资产（渲染管线装配）：正式渲染输出外链 cssHref（/_assets/theme.{hash}.css，
   * immutable 缓存）；预览渲染内联 inlineCss 保证改动即时可见。SeoHead 统一消费。
   * jsHref：前台岛脚本（/_assets/islands.{hash}.js，type=module 外链），正式与预览渲染均输出，
   * 站点无关；null 时不输出脚本标签（如快照 / 部件缩略图等无交互场景）。
   */
  assets: { cssHref: string | null; inlineCss: string | null; darkMode: 'auto' | 'light' | 'dark'; jsHref: string | null };
}

export interface CmsHomeContext extends CmsBaseContext {
  latest: CmsContentItem[];
  recommended: CmsContentItem[];
  hot: CmsContentItem[];
  /** 主题声明的首页侧栏部件；未绑定或部件未发布时为 null。 */
  homeSidebar: CmsResolvedWidget | null;
}

// ─── Theme API：站点隔离的只读数据门面（首页/聚合模板 load() 消费）──────────────

/** contents.list 查询（白名单参数；limit 上限 100，排序固定 置顶优先 → 发布时间倒序） */
export interface CmsThemeContentQuery {
  /** 栏目标识（站内 code）；留空取全站 */
  channelCode?: string;
  limit: number;
  /** 仅推荐 / 仅热门过滤 */
  recommend?: boolean;
  hot?: boolean;
}

export interface CmsThemeChannelRef {
  id: number;
  code: string;
  name: string;
  url: string;
}

export interface CmsThemeContentCollection {
  /** 按栏目查询时为该栏目信息；全站查询为 null */
  channel: CmsThemeChannelRef | null;
  list: CmsContentItem[];
}

/**
 * 主题模板可用的只读 CMS 数据 API：
 * - 自动锁定当前站点，只返回启用栏目下已发布且未回收的内容；
 * - URL 全部经统一 contentUrl() 生成；
 * - 同一次渲染内相同查询按参数 key 去重复用。
 * 主题代码禁止直接访问 db/service，取数一律经由本接口。
 */
export interface CmsThemeDataApi {
  contents: {
    list(query: CmsThemeContentQuery): Promise<CmsThemeContentCollection>;
  };
}

/** 首页模板定义：可选 load() 在渲染前并发取数，结果以 data 注入组件（类型自动推导，限函数组件） */
export interface CmsHomeTemplateDefinition<D = Record<string, unknown>> {
  load?: (args: { cms: CmsThemeDataApi; site: CmsRenderSite; baseUrl: string }) => Promise<D>;
  Component: (props: CmsHomeContext & { data: D }) => ReactNode;
}

/**
 * 首页模板定义体的存储侧擦除形态（注册表/渲染管线消费）：
 * Component 以最窄参数(never)的裸函数签名擦除，使任意具体 `CmsHomeTemplateDefinition<D>`
 * 都可结构化赋值；具体 D 的类型安全由主题代码内的 defineHomeTemplate 推导保证。
 */
export interface CmsHomeTemplateHandle {
  load?: (args: { cms: CmsThemeDataApi; site: CmsRenderSite; baseUrl: string }) => Promise<unknown>;
  Component: (props: never) => ReactNode;
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
  fields: CmsFormField[];
  captcha: { provider: 'none' | 'math' | 'turnstile'; siteKey: string | null };
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

/** 前台统一互动问卷页上下文 */
export interface CmsInteractionPageContext extends CmsBaseContext {
  breadcrumbs: CmsBreadcrumb[];
  interaction: {
    id: number;
    code: string;
    kind: 'survey' | 'poll';
    title: string;
    description: string | null;
    participantScope: 'anonymous' | 'member';
    repeatPolicy: 'once_per_member' | 'once_per_ip' | 'multiple';
    resultVisibility: 'always' | 'after_submit' | 'after_close' | 'hidden';
    captchaPolicy: 'inherit' | 'none' | 'math' | 'turnstile';
    questions: {
      id: number;
      label: string;
      type: CmsInteractionQuestionType;
      required: boolean;
      options: { id: string; label: string; value: string }[];
      minChoices: number;
      maxChoices: number;
      allowOther: boolean;
      otherLabel: string | null;
      ratingMax: number;
      matrixRows: { id: string; label: string }[];
      pageNo: number;
      visibleWhen: { questionIndex: number; op: 'any' | 'none'; values: string[] } | null;
    }[];
  };
  submit: { stateApi: string; publicSubmitApi: string; memberSubmitApi: string };
}

export interface CmsNotFoundContext extends CmsBaseContext {
  path: string;
}

/** 主题必须实现的模板集合 */
export interface CmsThemeTemplates {
  /** 首页：普通组件或 defineHomeTemplate 定义体（带 load 声明式取数） */
  index: ComponentType<CmsHomeContext> | CmsHomeTemplateHandle;
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
  /** 前台统一互动问卷页模板（缺省回退 default 主题实现） */
  interaction?: ComponentType<CmsInteractionPageContext>;
  /** 扩展模板：站点默认模板 / 栏目 listTemplate / 内容 detailTemplate 按名称引用（如 list-card / detail-plain） */
  extraListTemplates?: Record<string, CmsTemplateVariant<CmsListContext>>;
  extraDetailTemplates?: Record<string, CmsTemplateVariant<CmsDetailContext>>;
  /** 主题参数声明：后台「主题参数」面板按此渲染表单，值存 settings.themeConfig，模板经 site.themeConfig 消费 */
  settingsSchema?: CmsThemeSettingField[];
  /** 暗色模式 CSS 变量组（如 '--text:#e6edf3; --bg:#0d1117;'）；声明后站点可启用暗色/跟随系统 */
  darkVars?: string;
  /** 主题可放置页面部件的位置；第一期仅支持单值 home.sidebar。 */
  widgetSlots?: {
    key: 'home.sidebar';
    label: string;
    allowedTypes: CmsWidgetType[];
    rendererKeys: CmsWidgetRendererKey[];
  }[];
  /** 主题仅在确实需要不同 DOM 时覆盖核心 renderer；普通视觉差异优先使用 CSS Token。 */
  widgetRenderers?: Partial<Record<CmsWidgetRendererKey, CmsWidgetRendererDefinition>>;
}
