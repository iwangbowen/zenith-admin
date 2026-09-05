import { createLabelOptionsFromMap } from '../core/enum-options';
// ─── CMS 内容管理 ─────────────────────────────────────────────────────────────
export const CMS_STATIC_MODES = ['dynamic', 'hybrid', 'static'] as const;

/** Write-only CMS setting placeholder; never represents the stored secret value. */
export const CMS_SECRET_MASK = '********';

/** 站群层级硬上限（根站点深度为 1）。 */
export const CMS_SITE_MAX_DEPTH = 8;

/** 可逐项显式继承的站点配置。 */
export const CMS_SITE_INHERITABLE_FIELDS = [
  'seoTitle',
  'seoKeywords',
  'seoDescription',
  'staticMode',
  'reviewMode',
  'webhook',
  'cdn',
  'theme',
  'themeConfig',
  'templates',
] as const;

export const CMS_SITE_INHERITABLE_FIELD_LABELS: Record<(typeof CMS_SITE_INHERITABLE_FIELDS)[number], string> = {
  seoTitle: 'SEO 标题',
  seoKeywords: 'SEO 关键词',
  seoDescription: 'SEO 描述',
  staticMode: '静态化模式',
  reviewMode: '审核模式',
  webhook: 'Webhook',
  cdn: 'CDN 刷新',
  theme: '活动主题',
  themeConfig: '主题参数',
  templates: '默认模板',
};

export const CMS_DISTRIBUTION_MODES = ['copy', 'mapping', 'scheduled'] as const;

export const CMS_DISTRIBUTION_MODE_LABELS: Record<(typeof CMS_DISTRIBUTION_MODES)[number], string> = {
  copy: '一次性复制',
  mapping: '映射跟随',
  scheduled: '定时同步',
};

export const CMS_DISTRIBUTION_CONFLICT_STRATEGIES = ['skip', 'overwrite', 'create-new'] as const;

export const CMS_DISTRIBUTION_CONFLICT_STRATEGY_LABELS: Record<(typeof CMS_DISTRIBUTION_CONFLICT_STRATEGIES)[number], string> = {
  skip: '跳过冲突',
  overwrite: '覆盖目标',
  'create-new': '创建新内容',
};

export const CMS_DISTRIBUTION_RUN_OUTCOMES = ['success', 'skipped', 'conflict', 'failed'] as const;

/** 分发同步任务的触发方式 */
export const CMS_DISTRIBUTION_RUN_TRIGGERS = ['manual', 'scheduled', 'mapping-update'] as const;

export const CMS_DISTRIBUTION_RUN_OUTCOME_LABELS: Record<(typeof CMS_DISTRIBUTION_RUN_OUTCOMES)[number], string> = {
  success: '成功',
  skipped: '跳过',
  conflict: '冲突',
  failed: '失败',
};

export const CMS_DISTRIBUTION_TASK_STATUSES = ['pending', 'running', 'success', 'failed', 'cancelled'] as const;

export const CMS_DISTRIBUTION_TASK_STATUS_LABELS: Record<(typeof CMS_DISTRIBUTION_TASK_STATUSES)[number], string> = {
  pending: '等待中',
  running: '进行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

export const CMS_STATIC_MODE_LABELS: Record<(typeof CMS_STATIC_MODES)[number], string> = {
  dynamic: '动态渲染',
  hybrid: '混合（推荐）',
  static: '全静态',
};

/** 栏目静态化模式：inherit=跟随站点，其余覆盖站点设置 */
export const CMS_CHANNEL_STATIC_MODES = ['inherit', 'dynamic', 'hybrid', 'static'] as const;

export const CMS_CHANNEL_STATIC_MODE_LABELS: Record<(typeof CMS_CHANNEL_STATIC_MODES)[number], string> = {
  inherit: '跟随站点',
  dynamic: '动态渲染',
  hybrid: '混合',
  static: '全静态',
};

/**
 * 详情页静态产物的目录归档策略（在栏目路径之后追加一级目录）。
 * 用于把海量内容打散到多目录，避免单目录文件过多拖慢文件系统。
 * 内容自定义 staticPath 优先级更高，设了就完全绕过本规则。
 */
export const CMS_CHANNEL_DETAIL_PATH_RULES = ['none', 'year', 'month', 'date', 'dateStr', 'idHash'] as const;

export const CMS_CHANNEL_DETAIL_PATH_RULE_LABELS: Record<(typeof CMS_CHANNEL_DETAIL_PATH_RULES)[number], string> = {
  none: '不归档（栏目目录下）',
  year: '按年（2026/）',
  month: '按年月（2026/7/）',
  date: '按年月日（2026/7/25/）',
  dateStr: '按日期串（2026-07-25/）',
  idHash: '按 ID 散列（0-9 分桶）',
};

/** 内容标题样式可选色（空 = 主题默认色） */
export const CMS_TITLE_STYLE_COLORS = ['#d93026', '#0064fa', '#1f8f3c', '#f5a623', '#8a2be2'] as const;

/** 模型字段选项来源：manual=手工维护，dict=引用系统字典（随字典自动更新） */
export const CMS_FIELD_OPTION_SOURCES = ['manual', 'dict'] as const;

export const CMS_FIELD_OPTION_SOURCE_LABELS: Record<(typeof CMS_FIELD_OPTION_SOURCES)[number], string> = {
  manual: '手工维护',
  dict: '引用系统字典',
};

/** 需要选项的字段类型（仅这些类型才展示选项来源配置） */
export const CMS_FIELD_TYPES_WITH_OPTIONS = ['select', 'radio', 'checkbox'] as const;

/** 站点内容策略（存 cms_sites.settings JSONB，逐项默认值见 CMS_SITE_OPS_DEFAULTS） */
export const CMS_SITE_OPS_SETTING_KEYS = [
  'publishedContentEditable',
  'recycleKeepDays',
  'maxPageOnContentPublish',
  'autoReplaceSensitiveWords',
  'autoReplaceErrorProneWords',
  'autoCoverFromBody',
  'openApiPublishEnabled',
] as const;

export const CMS_SITE_OPS_DEFAULTS = {
  /** 已发布内容是否允许直接编辑（关闭后需先下线） */
  publishedContentEditable: true,
  /** 回收站保留天数（0 = 永久保留，不自动清理） */
  recycleKeepDays: 30,
  /** 单内容发布时重建所属栏目列表页的页数上限（0 = 全部重建） */
  maxPageOnContentPublish: 0,
  /** 内容保存时按敏感词库自动替换 */
  autoReplaceSensitiveWords: false,
  /** 内容保存时按易错词库自动替换 */
  autoReplaceErrorProneWords: false,
  /** 未填封面时自动提取正文首图作为封面 */
  autoCoverFromBody: false,
  /**
   * 是否允许开放 API 直接发布内容。
   *
   * 默认关闭：外部应用写入的内容一律先落草稿走站点审核管道，与「站点导入包统一降级为草稿」
   * 同一条安全约定。开启后仍需应用同时持有 cms:publish scope 与授权行的 canPublish。
   */
  openApiPublishEnabled: false,
} as const;

/** 内置模板下拉的来源标签（本站直选 / 主题内置） */
export const CMS_TEMPLATE_RESOLUTION_SOURCES = ['own', 'inherited', 'global', 'builtin'] as const;

export const CMS_TEMPLATE_RESOLUTION_SOURCE_LABELS: Record<(typeof CMS_TEMPLATE_RESOLUTION_SOURCES)[number], string> = {
  own: '本站',
  inherited: '继承父级',
  global: '主题全局',
  builtin: '内置',
};

/** 主题参数字段类型（后台主题参数面板动态表单） */
export const CMS_THEME_SETTING_FIELD_TYPES = ['text', 'textarea', 'color', 'number', 'switch', 'select', 'image'] as const;

export const CMS_PUBLISH_TARGET_TYPES = [
  'content',
  'contents',
  'channel',
  'site',
  'theme',
  'page',
] as const;

export const CMS_PUBLISH_TARGET_TYPE_LABELS: Record<(typeof CMS_PUBLISH_TARGET_TYPES)[number], string> = {
  content: '单内容',
  contents: '批量内容',
  channel: '栏目',
  site: '整站',
  theme: '主题影响重建',
  page: '搭建页面',
};

export const CMS_PUBLISH_ARTIFACT_STATUSES = ['generated', 'deleted', 'failed'] as const;

export const CMS_PUBLISH_ARTIFACT_STATUS_LABELS: Record<(typeof CMS_PUBLISH_ARTIFACT_STATUSES)[number], string> = {
  generated: '已生成',
  deleted: '已删除',
  failed: '失败',
};

/** 发布任务可执行的操作 */
export const CMS_PUBLISH_ACTIONS = ['cancel', 'resume', 'restart', 'rebuild'] as const;

/** 发布中心受权投影只包含统一 CMS 发布任务。 */
export const CMS_PUBLISH_TASK_TYPES = [
  'cms-publish-build',
] as const;

export const CMS_CHANNEL_TYPES = ['list', 'page', 'link'] as const;

export const CMS_CHANNEL_TYPE_LABELS: Record<(typeof CMS_CHANNEL_TYPES)[number], string> = {
  list: '列表栏目',
  page: '单页栏目',
  link: '外链栏目',
};

export const CMS_CONTENT_STATUSES = ['draft', 'pending', 'published', 'offline', 'rejected'] as const;

export const CMS_CONTENT_STATUS_LABELS: Record<(typeof CMS_CONTENT_STATUSES)[number], string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  offline: '已下线',
  rejected: '已驳回',
};

/** CMS 内容形态（P2 多形态内容类型） */
export const CMS_CONTENT_TYPES = ['article', 'album', 'media', 'link'] as const;

export const CMS_CONTENT_TYPE_LABELS: Record<(typeof CMS_CONTENT_TYPES)[number], string> = {
  article: '图文',
  album: '图集',
  media: '音视频',
  link: '外链',
};

export const CMS_CONTENT_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_CONTENT_TYPE_LABELS);

/** 正文分页符标记（编辑器插入 <p>[分页]</p>，服务端按此拆分多页） */
export const CMS_PAGE_BREAK_TEXT = '[分页]';

/** CMS 素材类型（P2 素材中心） */
export const CMS_RESOURCE_TYPES = ['image', 'video', 'audio', 'document', 'other'] as const;

export const CMS_RESOURCE_TYPE_LABELS: Record<(typeof CMS_RESOURCE_TYPES)[number], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  document: '文档',
  other: '其他',
};

/**
 * 素材句柄 URI 前缀。
 *
 * 内容正文、JSONB 字段与标量列统一以 `cms-res://{id}` 引用素材中心条目，
 * 写入时由服务端把已知素材 URL 归一为句柄，读取/渲染时再解析回真实 URL。
 * 句柄化使「替换素材」「迁移存储 / CDN」「改文件名」不再产生死链，
 * 并让 `cms_resource_refs` 反向索引可以精确建立（不再靠子串匹配）。
 */
export const CMS_RESOURCE_URI_PREFIX = 'cms-res://';

/** 素材引用方（反向索引 owner_type 取值） */
export const CMS_RESOURCE_OWNER_TYPES = [
  'site', 'content', 'contentVersion', 'channel', 'friendLink', 'ad', 'page', 'widget', 'form',
] as const;

export type CmsResourceOwnerType = (typeof CMS_RESOURCE_OWNER_TYPES)[number];

export const CMS_RESOURCE_OWNER_TYPE_LABELS: Record<CmsResourceOwnerType, string> = {
  site: '站点',
  content: '内容',
  contentVersion: '内容版本',
  channel: '栏目',
  friendLink: '友情链接',
  ad: '广告',
  page: '搭建页面',
  widget: '页面部件',
  form: '表单',
};

/** CMS 广告事件类型。 */
export const CMS_AD_EVENT_TYPES = ['impression', 'click'] as const;

// ─── Headless 开放 API ────────────────────────────────────────────────────────

/**
 * 开放 API 的 CMS scope。
 *
 * 读写分离且发布单列：`cms:write` 只能落草稿并提交审核，直接发布必须同时持有
 * `cms:publish` 且站点开启开关 —— 与「站点导入包一律降级为草稿」是同一条安全约定，
 * 避免外部应用绕过站点的审核管道。
 */
export const CMS_OPEN_SCOPES = ['cms:read', 'cms:write', 'cms:publish'] as const;

export type CmsOpenScope = (typeof CMS_OPEN_SCOPES)[number];

/** 内容列表允许的排序字段（白名单，fail-closed） */
export const CMS_OPEN_SORT_FIELDS = [
  'publishedAt', 'createdAt', 'updatedAt', 'sort', 'topWeight', 'viewCount', 'likeCount', 'favoriteCount', 'id',
] as const;

export type CmsOpenSortField = (typeof CMS_OPEN_SORT_FIELDS)[number];

/** 内容列表允许的 include 展开项 */
export const CMS_OPEN_INCLUDES = ['tags', 'channel', 'relations', 'attachments', 'body', 'extend'] as const;

export type CmsOpenInclude = (typeof CMS_OPEN_INCLUDES)[number];

/** 内容对象允许被 `fields` 裁剪保留的字段（未列出的字段一律不输出） */
export const CMS_OPEN_CONTENT_FIELDS = [
  'id', 'siteId', 'channelId', 'channelCode', 'modelCode', 'contentType',
  'title', 'subTitle', 'shortTitle', 'slug', 'summary', 'coverImage', 'coverThumb',
  'author', 'editor', 'source', 'sourceUrl', 'isOriginal', 'externalLink',
  'isTop', 'topWeight', 'isRecommend', 'isHot', 'hasImage', 'hasVideo', 'hasAttachment',
  'viewCount', 'likeCount', 'favoriteCount', 'sort', 'version',
  'seoTitle', 'seoKeywords', 'seoDescription',
  'publishedAt', 'expireAt', 'createdAt', 'updatedAt', 'url',
  // include 展开项
  'body', 'extend', 'tags', 'channel', 'relations', 'attachments', 'mediaData',
] as const;

/** 列表分页上限（cursor 模式同样适用） */
export const CMS_OPEN_PAGE_SIZE_MAX = 100;

export const CMS_OPEN_SYNC_PAGE_SIZE_MAX = 200;

/** 增量同步的变更类型 */
export const CMS_OPEN_SYNC_OPS = ['upsert', 'delete'] as const;

export type CmsOpenSyncOp = (typeof CMS_OPEN_SYNC_OPS)[number];

/** 开放应用可订阅的 CMS 事件 */
export const CMS_OPEN_WEBHOOK_EVENTS = [
  'cms.content.published',
  'cms.content.updated',
  'cms.content.offline',
  'cms.content.recycled',
  'cms.content.deleted',
  'cms.comment.created',
  'cms.form.submitted',
] as const;

export type CmsOpenWebhookEvent = (typeof CMS_OPEN_WEBHOOK_EVENTS)[number];

export const CMS_OPEN_WEBHOOK_EVENT_LABELS: Record<CmsOpenWebhookEvent, string> = {
  'cms.content.published': 'CMS 内容发布',
  'cms.content.updated': 'CMS 内容更新',
  'cms.content.offline': 'CMS 内容下线',
  'cms.content.recycled': 'CMS 内容回收',
  'cms.content.deleted': 'CMS 内容彻底删除',
  'cms.comment.created': 'CMS 评论提交',
  'cms.form.submitted': 'CMS 表单提交',
};

export const CMS_AD_EVENT_TYPE_LABELS: Record<(typeof CMS_AD_EVENT_TYPES)[number], string> = {
  impression: '曝光',
  click: '点击',
};

export const CMS_AD_EVENT_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_AD_EVENT_TYPE_LABELS);

export const CMS_DEVICE_TYPES = ['pc', 'mobile', 'bot'] as const;

export const CMS_DEVICE_TYPE_LABELS: Record<(typeof CMS_DEVICE_TYPES)[number], string> = {
  pc: '桌面端',
  mobile: '移动端',
  bot: '机器人',
};

export const CMS_DEVICE_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_DEVICE_TYPE_LABELS);

export const CMS_PAGE_BLOCK_AUDIENCES = ['always', 'guest', 'member'] as const;

export const CMS_PAGE_BLOCK_AUDIENCE_LABELS: Record<(typeof CMS_PAGE_BLOCK_AUDIENCES)[number], string> = {
  always: '所有访客',
  guest: '仅游客',
  member: '仅登录会员',
};

export const CMS_PAGE_BLOCK_AUDIENCE_OPTIONS = createLabelOptionsFromMap(CMS_PAGE_BLOCK_AUDIENCE_LABELS);

/** 可视化页面搭建的区块类型 */
export const CMS_PAGE_BLOCK_TYPE_VALUES = ['hero', 'richtext', 'image', 'content-list', 'columns', 'widget-ref'] as const;

export const CMS_PAGE_BLOCK_TYPE_LABELS: Record<(typeof CMS_PAGE_BLOCK_TYPE_VALUES)[number], string> = {
  hero: 'Hero 横幅',
  richtext: '富文本',
  image: '图片',
  'content-list': '内容列表',
  columns: '多列卡片',
  'widget-ref': '页面部件',
};

/** 区块类型选项（区块面板按此顺序展示） */
export const CMS_PAGE_BLOCK_TYPES: { value: (typeof CMS_PAGE_BLOCK_TYPE_VALUES)[number]; label: string }[] =
  CMS_PAGE_BLOCK_TYPE_VALUES.map((value) => ({ value, label: CMS_PAGE_BLOCK_TYPE_LABELS[value] }));

/** CMS 页面部件。 */
export const CMS_WIDGET_TYPES = ['manual-list'] as const;

export const CMS_WIDGET_TYPE_LABELS: Record<(typeof CMS_WIDGET_TYPES)[number], string> = {
  'manual-list': '手工列表',
};

export const CMS_WIDGET_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_WIDGET_TYPE_LABELS);

export const CMS_WIDGET_STATUSES = ['draft', 'published', 'offline'] as const;

export const CMS_WIDGET_HIGH_FANOUT_THRESHOLD = 20;

export const CMS_WIDGET_STATUS_LABELS: Record<(typeof CMS_WIDGET_STATUSES)[number], string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
};

export const CMS_WIDGET_STATUS_OPTIONS = createLabelOptionsFromMap(CMS_WIDGET_STATUS_LABELS);

export const CMS_WIDGET_SOURCE_TYPES = ['manual', 'content', 'channel'] as const;

export const CMS_WIDGET_LIVE_SOURCE_TYPES = ['content', 'channel'] as const;

export const CMS_WIDGET_SOURCE_TYPE_LABELS: Record<(typeof CMS_WIDGET_SOURCE_TYPES)[number], string> = {
  manual: '手工录入',
  content: 'CMS 内容',
  channel: 'CMS 栏目',
};

export const CMS_WIDGET_SOURCE_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_WIDGET_SOURCE_TYPE_LABELS);

export const CMS_WIDGET_RENDERER_KEYS = ['list-sidebar', 'list-grid', 'list-carousel'] as const;

export const CMS_WIDGET_RENDERER_LABELS: Record<(typeof CMS_WIDGET_RENDERER_KEYS)[number], string> = {
  'list-sidebar': '侧边栏列表',
  'list-grid': '卡片宫格',
  'list-carousel': '轮播展示',
};

export const CMS_WIDGET_RENDERER_OPTIONS = createLabelOptionsFromMap(CMS_WIDGET_RENDERER_LABELS);

export const CMS_WIDGET_REF_OWNER_TYPES = ['page', 'theme_slot'] as const;

export const CMS_WIDGET_SLOT_KEYS = ['home.sidebar'] as const;

/** CMS 会员订阅对象类型。 */
export const CMS_SUBSCRIPTION_SUBJECT_TYPES = ['site', 'channel', 'author'] as const;

export const CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS: Record<(typeof CMS_SUBSCRIPTION_SUBJECT_TYPES)[number], string> = {
  site: '站点',
  channel: '栏目',
  author: '作者',
};

export const CMS_SUBSCRIPTION_SUBJECT_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS);

/** 统一互动问卷模型。 */
export const CMS_INTERACTION_KINDS = ['survey', 'poll'] as const;

export const CMS_INTERACTION_STATUSES = ['draft', 'published', 'closed'] as const;

export const CMS_INTERACTION_QUESTION_TYPES = [
  'single', 'multiple', 'text', 'rating', 'nps', 'matrix', 'date', 'number',
] as const;

export const CMS_INTERACTION_PARTICIPANT_SCOPES = ['anonymous', 'member'] as const;

export const CMS_INTERACTION_REPEAT_POLICIES = ['once_per_member', 'once_per_ip', 'multiple'] as const;

export const CMS_INTERACTION_RESULT_VISIBILITIES = ['always', 'after_submit', 'after_close', 'hidden'] as const;

export const CMS_INTERACTION_CAPTCHA_POLICIES = ['inherit', 'none', 'math', 'turnstile'] as const;

/** 互动问卷生效的验证码方式（inherit 已按站点策略解析） */
export const CMS_INTERACTION_RESOLVED_CAPTCHA_PROVIDERS = ['none', 'math', 'turnstile'] as const;

export const CMS_INTERACTION_KIND_LABELS: Record<(typeof CMS_INTERACTION_KINDS)[number], string> = {
  survey: '问卷',
  poll: '投票',
};

export const CMS_INTERACTION_KIND_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_KIND_LABELS);

export const CMS_INTERACTION_STATUS_LABELS: Record<(typeof CMS_INTERACTION_STATUSES)[number], string> = {
  draft: '草稿',
  published: '进行中',
  closed: '已关闭',
};

export const CMS_INTERACTION_STATUS_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_STATUS_LABELS);

export const CMS_INTERACTION_QUESTION_TYPE_LABELS: Record<(typeof CMS_INTERACTION_QUESTION_TYPES)[number], string> = {
  single: '单选',
  multiple: '多选',
  text: '文本',
  rating: '评分',
  nps: 'NPS',
  matrix: '矩阵',
  date: '日期',
  number: '数字',
};


export const CMS_INTERACTION_QUESTION_TYPE_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_QUESTION_TYPE_LABELS);
/** 需要配置候选选项的题型（矩阵的选项即为列） */
export const CMS_INTERACTION_CHOICE_QUESTION_TYPES = ['single', 'multiple', 'matrix'] as const;

/** 「其他」选项的哨兵值；实际提交为 `__other__:自由文本` */
export const CMS_INTERACTION_OTHER_VALUE = '__other__';

export const CMS_INTERACTION_OTHER_PREFIX = `${CMS_INTERACTION_OTHER_VALUE}:`;

/** 矩阵题答案的行列分隔符：`rowId::optionValue` */
export const CMS_INTERACTION_MATRIX_SEPARATOR = '::';

/** NPS 固定 0-10 分 */
export const CMS_INTERACTION_NPS_MAX = 10;

export const CMS_INTERACTION_RATING_MAX_LIMIT = 10;

/** 条件显示比较符 */
export const CMS_INTERACTION_CONDITION_OPS = ['any', 'none'] as const;

export const CMS_INTERACTION_CONDITION_OP_LABELS: Record<(typeof CMS_INTERACTION_CONDITION_OPS)[number], string> = {
  any: '选中其中任一项时显示',
  none: '均未选中时显示',
};

export const CMS_INTERACTION_CONDITION_OP_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_CONDITION_OP_LABELS);

export const CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS: Record<(typeof CMS_INTERACTION_PARTICIPANT_SCOPES)[number], string> = {
  anonymous: '游客与会员',
  member: '仅会员',
};

export const CMS_INTERACTION_PARTICIPANT_SCOPE_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS);

export const CMS_INTERACTION_REPEAT_POLICY_LABELS: Record<(typeof CMS_INTERACTION_REPEAT_POLICIES)[number], string> = {
  once_per_member: '每位会员一次',
  once_per_ip: '每个 IP 一次',
  multiple: '允许多次',
};


export const CMS_INTERACTION_REPEAT_POLICY_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_REPEAT_POLICY_LABELS);
export const CMS_INTERACTION_RESULT_VISIBILITY_LABELS: Record<(typeof CMS_INTERACTION_RESULT_VISIBILITIES)[number], string> = {
  always: '始终可见',
  after_submit: '提交后可见',
  after_close: '关闭后可见',
  hidden: '不公开',
};

export const CMS_INTERACTION_RESULT_VISIBILITY_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_RESULT_VISIBILITY_LABELS);

export const CMS_INTERACTION_CAPTCHA_POLICY_LABELS: Record<(typeof CMS_INTERACTION_CAPTCHA_POLICIES)[number], string> = {
  inherit: '继承站点',
  none: '不启用',
  math: '数学验证码',
  turnstile: 'Cloudflare Turnstile',
};

export const CMS_INTERACTION_CAPTCHA_POLICY_OPTIONS = createLabelOptionsFromMap(CMS_INTERACTION_CAPTCHA_POLICY_LABELS);

/** 正文互动嵌入标记：[互动:code]。 */
export const CMS_INTERACTION_MARKER_PREFIX = '[互动:';

/** CMS 会员互动积分规则（earn 记账 bizType='cms_interaction'） */
export const CMS_INTERACTION_POINTS = {
  /** 阅读内容（每内容仅一次，30 天窗口） */
  view: 1,
  /** 点赞内容（每内容仅一次） */
  like: 1,
  /** 收藏内容（每内容仅一次） */
  favorite: 2,
  /** 首次有效订阅（同一标准化对象永久仅一次） */
  subscribe: 2,
  /** 投稿发布（每内容仅一次） */
  contribution: 10,
} as const;

/** CMS 互动积分每日上限（防刷；按动作独立计） */
export const CMS_INTERACTION_DAILY_LIMITS = {
  view: 10,
  like: 5,
  favorite: 5,
  subscribe: 5,
} as const;

/** CMS 内容操作日志动作（内容级时间线） */
export const CMS_CONTENT_OP_ACTIONS = ['created', 'updated', 'submitted', 'published', 'rejected', 'offlined', 'recycled', 'restored', 'rolled_back', 'archived', 'unarchived', 'moved', 'locked', 'unlocked'] as const;

export const CMS_CONTENT_OP_ACTION_LABELS: Record<(typeof CMS_CONTENT_OP_ACTIONS)[number], string> = {
  created: '创建',
  updated: '更新',
  submitted: '提交审核',
  published: '发布',
  rejected: '驳回',
  offlined: '下线',
  recycled: '移入回收站',
  restored: '恢复',
  rolled_back: '版本回滚',
  archived: '归档',
  unarchived: '取消归档',
  moved: '移动栏目',
  locked: '持久锁定',
  unlocked: '解除锁定',
};

export const CMS_FIELD_TYPES = ['text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch'] as const;

export const CMS_FIELD_TYPE_LABELS: Record<(typeof CMS_FIELD_TYPES)[number], string> = {
  text: '单行文本',
  textarea: '多行文本',
  richtext: '富文本',
  number: '数字',
  date: '日期',
  datetime: '日期时间',
  image: '图片',
  file: '附件',
  select: '下拉选择',
  radio: '单选',
  checkbox: '多选',
  switch: '开关',
};

/** CMS 前台预览路径前缀（无域名绑定时通过 /__cms/{siteCode}/... 访问站点） */
export const CMS_PREVIEW_PREFIX = '/__cms';

/**
 * 搭建页站内路径（不含前导斜杠）：设了自定义 path 用它，否则回落 `p/{slug}/`。
 *
 * 放在 shared 是因为「URL 生成 / 静态产物路径 / 后台预览链接」三处必须完全一致，
 * 前后端各写一份迟早分叉，表现为后台预览 404。
 */
export function cmsCustomPagePath(page: { slug: string; path?: string | null }): string {
  const custom = page.path?.trim();
  if (!custom) return `p/${page.slug}/`;
  return custom.endsWith('.html') ? custom : `${custom}/`;
}

// ─── CMS 采集中心 ─────────────────────────────────────────────────────────────
export const CMS_COLLECT_ITEM_STATUSES = ['success', 'skipped', 'failed'] as const;

export const CMS_COLLECT_ITEM_STATUS_LABELS: Record<(typeof CMS_COLLECT_ITEM_STATUSES)[number], string> = {
  success: '成功',
  skipped: '跳过',
  failed: '失败',
};

// ─── CMS P2 ───────────────────────────────────────────────────────────────────
export const CMS_COMMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const CMS_COMMENT_STATUS_LABELS: Record<(typeof CMS_COMMENT_STATUSES)[number], string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};

export const CMS_PUSH_ENGINES = ['baidu', 'indexnow'] as const;

export const CMS_PUSH_ENGINE_LABELS: Record<(typeof CMS_PUSH_ENGINES)[number], string> = {
  baidu: '百度普通收录',
  indexnow: 'IndexNow（Bing 等）',
};

export const CMS_FORM_FIELD_TYPES = ['text', 'textarea', 'select', 'radio', 'email', 'mobile', 'url', 'number'] as const;

export const CMS_FORM_FIELD_TYPE_LABELS: Record<(typeof CMS_FORM_FIELD_TYPES)[number], string> = {
  text: '单行文本',
  textarea: '多行文本',
  select: '下拉选择',
  radio: '单选',
  email: '邮箱',
  mobile: '手机号',
  url: '网址',
  number: '数字',
};

export const CMS_FORM_CAPTCHA_PROVIDERS = ['inherit', 'none', 'math', 'turnstile'] as const;

export const CMS_FORM_CAPTCHA_PROVIDER_LABELS: Record<(typeof CMS_FORM_CAPTCHA_PROVIDERS)[number], string> = {
  inherit: '继承站点策略',
  none: '不启用',
  math: '算术验证码',
  turnstile: 'Cloudflare Turnstile',
};

export const CMS_SEARCH_WORD_TYPES = ['extension', 'stop'] as const;

export const CMS_SEARCH_DICTIONARY_WORD_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_+.#-]{0,49}$/u;

export const CMS_SEARCH_WORD_TYPE_LABELS: Record<(typeof CMS_SEARCH_WORD_TYPES)[number], string> = {
  extension: '扩展词',
  stop: '停用词',
};

export const CMS_TWITTER_CARDS = ['summary_large_image', 'summary'] as const;

export const CMS_TWITTER_CARD_LABELS: Record<(typeof CMS_TWITTER_CARDS)[number], string> = {
  summary_large_image: '大图摘要',
  summary: '标准摘要',
};
