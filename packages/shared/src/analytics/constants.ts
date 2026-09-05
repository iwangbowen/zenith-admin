import { COMMON_STATUS_LABELS, COMMON_STATUS_OPTIONS } from '../core/constants';
import { createLabelOptions, createLabelOptionsFromMap } from '../core/enum-options';

export const SOURCE_MAP_MAX_BYTES = 20 * 1024 * 1024;

export const ANALYTICS_PROPERTIES_MAX_BYTES = 16 * 1024;

export const ANALYTICS_CONTEXT_MAX_BYTES = 32 * 1024;

export const ANALYTICS_BREADCRUMB_DATA_MAX_BYTES = 4 * 1024;

/** 埋点配置版本号存储 key（localStorage），跨标签页广播采集配置已更新，触发其他标签重新拉取 */
export const ANALYTICS_CONFIG_VERSION_KEY = 'zenith_analytics_config_version';

export const ANALYTICS_SITE_KEY_HEADER = 'X-Analytics-Site-Key';

export const ANALYTICS_EXPERIMENT_EXPOSURE_EVENT = '$experiment_exposure';

/** 挫败点击（同元素短时间连点）事件名，SDK 上报与服务端聚合共用 */
export const ANALYTICS_RAGE_CLICK_EVENT = '$rage_click';

/** 路径分析中代表「会话在此结束」的终点节点标识，服务端产出、前端渲染为「退出」 */
export const ANALYTICS_PATH_EXIT_PAGE = '$exit';

/** 可保存的分析报表类型 */
export const ANALYTICS_SAVED_REPORT_TYPES = ['funnel'] as const;

export type AnalyticsSavedReportType = (typeof ANALYTICS_SAVED_REPORT_TYPES)[number];

// ─── 数据分析与报表 ────────────────────────────────────────────────────
/** 行为事件类型（SDK 上报、服务端落库枚举与前端筛选共用） */
export const USER_BEHAVIOR_EVENT_TYPES = [
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
] as const;

export type UserBehaviorEventType = (typeof USER_BEHAVIOR_EVENT_TYPES)[number];

/** 行为事件类型中文标签（列表/详情/时间轴/字典分类统一使用，SSOT） */
export const USER_BEHAVIOR_EVENT_TYPE_LABELS: Record<UserBehaviorEventType, string> = {
  page_view: '页面进入',
  page_leave: '页面离开',
  feature_use: '功能点击',
  area_click: '区域点击',
  custom: '自定义',
  perf: '性能采样',
  api_request: 'API 请求',
  identify: '身份识别',
};

export const USER_BEHAVIOR_EVENT_TYPE_OPTIONS: Array<{ value: UserBehaviorEventType; label: string }> =
  createLabelOptionsFromMap(USER_BEHAVIOR_EVENT_TYPE_LABELS);

export const ANALYTICS_DEVICE_TYPES = ['desktop', 'mobile', 'tablet', 'bot', 'unknown'] as const;

export type AnalyticsDeviceType = (typeof ANALYTICS_DEVICE_TYPES)[number];

export const ANALYTICS_DEVICE_TYPE_LABELS: Record<AnalyticsDeviceType, string> = {
  desktop: '桌面端',
  mobile: '移动端',
  tablet: '平板',
  bot: '爬虫/机器人',
  unknown: '未知',
};

export const ANALYTICS_DEVICE_TYPE_OPTIONS: Array<{ value: AnalyticsDeviceType; label: string }> =
  createLabelOptions(ANALYTICS_DEVICE_TYPES, ANALYTICS_DEVICE_TYPE_LABELS);

/** Web Vitals 指标评级 */
export const ANALYTICS_PERF_RATINGS = ['good', 'needs-improvement', 'poor'] as const;

export type AnalyticsPerfRating = (typeof ANALYTICS_PERF_RATINGS)[number];

// ─── 行为中心阶段 1：多端来源 / 环境 / 身份归属 ────────────────────────────────
/** 事件来源平台：后台管理端 SPA / 会员前台 SPA / 服务端埋点 */
export const ANALYTICS_EVENT_SOURCES = ['web_admin', 'web_member', 'server'] as const;

export type AnalyticsEventSource = (typeof ANALYTICS_EVENT_SOURCES)[number];

export const ANALYTICS_EVENT_SOURCE_LABELS: Record<AnalyticsEventSource, string> = {
  web_admin: '后台管理端',
  web_member: '会员前台',
  server: '服务端',
};

export const ANALYTICS_EVENT_SOURCE_OPTIONS: Array<{ value: AnalyticsEventSource; label: string }> =
  createLabelOptions(ANALYTICS_EVENT_SOURCES, ANALYTICS_EVENT_SOURCE_LABELS);

/** 采集环境（与 DB varchar 列对应，取值受校验层约束，允许后续扩展） */
export const ANALYTICS_ENVIRONMENTS = ['production', 'staging', 'development'] as const;

export type AnalyticsEnvironment = (typeof ANALYTICS_ENVIRONMENTS)[number];

export const ANALYTICS_ENVIRONMENT_LABELS: Record<AnalyticsEnvironment, string> = {
  production: '生产环境',
  staging: '预发环境',
  development: '开发环境',
};

export const ANALYTICS_ENVIRONMENT_OPTIONS: Array<{ value: AnalyticsEnvironment; label: string }> =
  createLabelOptions(ANALYTICS_ENVIRONMENTS, ANALYTICS_ENVIRONMENT_LABELS);

/** 身份归属类型：后台管理员 / 前台会员 / 匿名访客 */
export const ANALYTICS_IDENTITY_TYPES = ['admin', 'member', 'anonymous'] as const;

export type AnalyticsIdentityType = (typeof ANALYTICS_IDENTITY_TYPES)[number];

export const ANALYTICS_IDENTITY_TYPE_LABELS: Record<AnalyticsIdentityType, string> = {
  admin: '后台管理员',
  member: '前台会员',
  anonymous: '匿名访客',
};

export const ANALYTICS_IDENTITY_TYPE_OPTIONS: Array<{ value: AnalyticsIdentityType; label: string }> =
  createLabelOptions(ANALYTICS_IDENTITY_TYPES, ANALYTICS_IDENTITY_TYPE_LABELS);

/** 事件覆盖 / 分群 / 站点的启停状态 */
export const ANALYTICS_EVENT_OVERRIDE_STATUSES = ['enabled', 'disabled'] as const;

export type AnalyticsEventOverrideStatus = (typeof ANALYTICS_EVENT_OVERRIDE_STATUSES)[number];

/** 事件覆盖 / 分群状态标签（enabled|disabled，与 COMMON_STATUS_LABELS 同源） */
export const ANALYTICS_EVENT_OVERRIDE_STATUS_LABELS: Record<AnalyticsEventOverrideStatus, string> = COMMON_STATUS_LABELS;

export const ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS: Array<{ value: AnalyticsEventOverrideStatus; label: string }> =
  COMMON_STATUS_OPTIONS;

/** 事件字典（Tracking Plan）状态 */
export const ANALYTICS_EVENT_META_STATUSES = ['active', 'deprecated', 'blocked'] as const;

export type AnalyticsEventMetaStatus = (typeof ANALYTICS_EVENT_META_STATUSES)[number];

export const ANALYTICS_QUALITY_ISSUE_TYPES = ['missing_required', 'type_mismatch', 'invalid_enum', 'event_disabled', 'origin_rejected', 'quota_exceeded'] as const;

export type AnalyticsQualityIssueType = (typeof ANALYTICS_QUALITY_ISSUE_TYPES)[number];

export const ANALYTICS_QUALITY_ISSUE_TYPE_LABELS: Record<(typeof ANALYTICS_QUALITY_ISSUE_TYPES)[number], string> = {
  missing_required: '缺失必填属性',
  type_mismatch: '属性类型不匹配',
  invalid_enum: '枚举取值非法',
  event_disabled: '事件已禁用',
  origin_rejected: '来源被拒绝',
  quota_exceeded: '站点配额超限',
};

export const ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS: Array<{ value: (typeof ANALYTICS_QUALITY_ISSUE_TYPES)[number]; label: string }> =
  createLabelOptions(ANALYTICS_QUALITY_ISSUE_TYPES, ANALYTICS_QUALITY_ISSUE_TYPE_LABELS);

export const ANALYTICS_EVENT_PROPERTY_TYPES = ['string', 'number', 'boolean', 'datetime', 'object', 'array'] as const;

/** Tracking Plan 属性类型（阶段 1 支持的最小类型集） */
export type AnalyticsEventPropertyType = (typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number];

export const ANALYTICS_EVENT_PROPERTY_TYPE_LABELS: Record<(typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number], string> = {
  string: '字符串',
  number: '数字',
  boolean: '布尔值',
  datetime: '日期时间',
  object: '对象',
  array: '数组',
};

export const ANALYTICS_EVENT_PROPERTY_TYPE_OPTIONS: Array<{ value: (typeof ANALYTICS_EVENT_PROPERTY_TYPES)[number]; label: string }> =
  createLabelOptions(ANALYTICS_EVENT_PROPERTY_TYPES, ANALYTICS_EVENT_PROPERTY_TYPE_LABELS);

export const ANALYTICS_SEGMENT_COMPARE_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const;

/** 分群条件比较运算符 */
export type AnalyticsSegmentCompareOp = (typeof ANALYTICS_SEGMENT_COMPARE_OPS)[number];

/** 分群规则条件间的逻辑关系 */
export const ANALYTICS_SEGMENT_RULE_OPERATORS = ['AND', 'OR'] as const;

export type AnalyticsSegmentRuleOperator = (typeof ANALYTICS_SEGMENT_RULE_OPERATORS)[number];

/**
 * 事件/画像属性 key 的白名单正则（字母数字下划线点横线，1~64 位）。
 * 前后端唯一来源：属性 key 会被拼进 jsonb 路径表达式，两处各写一份正则一旦漂移，
 * 就会出现「前端放行、服务端 400」或更糟的「服务端放行了本该拒绝的 key」。
 */
export const ANALYTICS_PROPERTY_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

export const ANALYTICS_SEGMENT_COMPARE_OP_LABELS: Record<(typeof ANALYTICS_SEGMENT_COMPARE_OPS)[number], string> = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '属于',
};

export const ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS: Array<{ value: (typeof ANALYTICS_SEGMENT_COMPARE_OPS)[number]; label: string }> =
  createLabelOptions(ANALYTICS_SEGMENT_COMPARE_OPS, ANALYTICS_SEGMENT_COMPARE_OP_LABELS);

export const ANALYTICS_EXPERIMENT_STATUSES = ['draft', 'running', 'paused', 'completed'] as const;

export type AnalyticsExperimentStatus = (typeof ANALYTICS_EXPERIMENT_STATUSES)[number];

export const ANALYTICS_EXPERIMENT_STATUS_LABELS: Record<AnalyticsExperimentStatus, string> = {
  draft: '草稿',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
};

export const ANALYTICS_EXPERIMENT_STATUS_OPTIONS: Array<{ value: AnalyticsExperimentStatus; label: string }> =
  createLabelOptions(ANALYTICS_EXPERIMENT_STATUSES, ANALYTICS_EXPERIMENT_STATUS_LABELS);

export const ANALYTICS_CAMPAIGN_CHANNELS = ['email', 'in_app', 'sms', 'webhook'] as const;

export type AnalyticsCampaignChannel = (typeof ANALYTICS_CAMPAIGN_CHANNELS)[number];

export const ANALYTICS_CAMPAIGN_CHANNEL_LABELS: Record<AnalyticsCampaignChannel, string> = {
  email: '邮件',
  in_app: '站内信',
  sms: '短信',
  webhook: 'Webhook',
};

export const ANALYTICS_CAMPAIGN_CHANNEL_OPTIONS: Array<{ value: AnalyticsCampaignChannel; label: string }> =
  createLabelOptions(ANALYTICS_CAMPAIGN_CHANNELS, ANALYTICS_CAMPAIGN_CHANNEL_LABELS);

export const ANALYTICS_CAMPAIGN_STATUSES = ['draft', 'running', 'completed', 'failed'] as const;

export type AnalyticsCampaignStatus = (typeof ANALYTICS_CAMPAIGN_STATUSES)[number];

export const ANALYTICS_CAMPAIGN_STATUS_LABELS: Record<AnalyticsCampaignStatus, string> = {
  draft: '草稿',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
};

export const ANALYTICS_CAMPAIGN_STATUS_OPTIONS: Array<{ value: AnalyticsCampaignStatus; label: string }> =
  createLabelOptions(ANALYTICS_CAMPAIGN_STATUSES, ANALYTICS_CAMPAIGN_STATUS_LABELS);

// ─── 行为中心阶段 1：通用事件分析工作台 ────────────────────────────────────────
export const ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS = [
  'date', 'eventName', 'pagePath', 'source', 'appId', 'environment', 'browser', 'os', 'deviceType', 'region',
] as const;

/** 事件分析可分组维度白名单：禁止任意列/原始 SQL，仅允许以上预置维度 */
export type AnalyticsEventQueryGroupByField = (typeof ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS)[number];

export const ANALYTICS_EVENT_QUERY_GROUP_BY_LABELS: Record<(typeof ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS)[number], string> = {
  date: '日期',
  eventName: '事件名称',
  pagePath: '页面路径',
  source: '来源端',
  appId: '应用',
  environment: '环境',
  browser: '浏览器',
  os: '操作系统',
  deviceType: '设备类型',
  region: '地区',
};

export const ANALYTICS_EVENT_QUERY_GROUP_BY_OPTIONS: Array<{ value: (typeof ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS)[number]; label: string }> =
  createLabelOptions(ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS, ANALYTICS_EVENT_QUERY_GROUP_BY_LABELS);

export const ANALYTICS_EVENT_QUERY_METRICS = [
  'events', 'uv', 'eventsPerUser', 'sum', 'avg', 'min', 'max', 'p50', 'p90', 'p95',
] as const;

/**
 * 统计指标。
 * `events`/`uv`/`eventsPerUser` 直接作用于事件流；
 * 其余作用于 `metricProperty` 指定的数值属性（非数值行不参与计算）。
 */
export type AnalyticsEventQueryMetric = (typeof ANALYTICS_EVENT_QUERY_METRICS)[number];

export const ANALYTICS_EVENT_QUERY_METRIC_LABELS: Record<(typeof ANALYTICS_EVENT_QUERY_METRICS)[number], string> = {
  events: '事件次数',
  uv: '去重用户数',
  eventsPerUser: '人均次数',
  sum: '属性求和',
  avg: '属性均值',
  min: '属性最小值',
  max: '属性最大值',
  p50: '属性中位数',
  p90: '属性 P90',
  p95: '属性 P95',
};

export const ANALYTICS_EVENT_QUERY_METRIC_OPTIONS: Array<{ value: (typeof ANALYTICS_EVENT_QUERY_METRICS)[number]; label: string }> =
  createLabelOptions(ANALYTICS_EVENT_QUERY_METRICS, ANALYTICS_EVENT_QUERY_METRIC_LABELS);

/**
 * 需要指定数值属性字段的指标。
 * 这些指标作用于 `properties->>key` 的数值转换结果，未指定 key 时无法计算，
 * 由 shared 校验层直接拒绝，避免服务端拿到 undefined 后静默退化成事件计数。
 */
export const ANALYTICS_EVENT_QUERY_PROPERTY_METRICS = ['sum', 'avg', 'min', 'max', 'p50', 'p90', 'p95'] as const;

export function analyticsMetricRequiresProperty(metric: string): boolean {
  return (ANALYTICS_EVENT_QUERY_PROPERTY_METRICS as readonly string[]).includes(metric);
}

// ─── 行为中心阶段 1：留存双口径 ────────────────────────────────────────────────
export const ANALYTICS_RETENTION_MODES = ['first_seen', 'window_first'] as const;

/** 留存计算口径：first_seen = 全历史真实首访；window_first = 当前统计窗口内首次出现 */
export type AnalyticsRetentionMode = (typeof ANALYTICS_RETENTION_MODES)[number];

export const ANALYTICS_RETENTION_MODE_LABELS: Record<(typeof ANALYTICS_RETENTION_MODES)[number], string> = {
  first_seen: '真实首访（全历史）',
  window_first: '窗口内首现',
};

export const ANALYTICS_RETENTION_MODE_OPTIONS: Array<{ value: (typeof ANALYTICS_RETENTION_MODES)[number]; label: string }> =
  createLabelOptions(ANALYTICS_RETENTION_MODES, ANALYTICS_RETENTION_MODE_LABELS);

// ─── 留存周期粒度（日 / 周 / 月留存）──────────────────────────────────────────
export const ANALYTICS_RETENTION_PERIOD_TYPES = ['day', 'week', 'month'] as const;

/** 留存周期粒度：day = 日留存，week = 周留存，month = 月留存 */
export type AnalyticsRetentionPeriodType = (typeof ANALYTICS_RETENTION_PERIOD_TYPES)[number];

export const ANALYTICS_RETENTION_PERIOD_TYPE_LABELS: Record<(typeof ANALYTICS_RETENTION_PERIOD_TYPES)[number], string> = {
  day: '日留存',
  week: '周留存',
  month: '月留存',
};

export const ANALYTICS_RETENTION_PERIOD_TYPE_OPTIONS: Array<{ value: (typeof ANALYTICS_RETENTION_PERIOD_TYPES)[number]; label: string }> =
  createLabelOptions(ANALYTICS_RETENTION_PERIOD_TYPES, ANALYTICS_RETENTION_PERIOD_TYPE_LABELS);

/** 留存矩阵列标题前缀（day → Day 1、week → Week 1、month → Month 1） */
export const ANALYTICS_RETENTION_PERIOD_UNIT_LABELS: Record<(typeof ANALYTICS_RETENTION_PERIOD_TYPES)[number], string> = {
  day: '日',
  week: '周',
  month: '月',
};

/**
 * 各粒度的回溯窗口与周期列数上限。
 * 周/月留存必须能回溯足够长的窗口，否则矩阵右下角永远是空的：
 * 12 周留存至少需要 84 天原始数据，12 个月留存至少需要 365 天。
 */
export const ANALYTICS_RETENTION_PERIOD_LIMITS: Record<
  (typeof ANALYTICS_RETENTION_PERIOD_TYPES)[number],
  { defaultDays: number; maxDays: number; defaultPeriods: number; maxPeriods: number }
> = {
  day: { defaultDays: 14, maxDays: 90, defaultPeriods: 8, maxPeriods: 30 },
  week: { defaultDays: 84, maxDays: 365, defaultPeriods: 8, maxPeriods: 26 },
  month: { defaultDays: 365, maxDays: 730, defaultPeriods: 6, maxPeriods: 24 },
};

/** 留存回溯窗口的全局上限（各粒度再按 ANALYTICS_RETENTION_PERIOD_LIMITS 收敛） */
export const ANALYTICS_RETENTION_MAX_DAYS = 730;

/** 留存周期列数的全局上限（各粒度再按 ANALYTICS_RETENTION_PERIOD_LIMITS 收敛） */
export const ANALYTICS_RETENTION_MAX_PERIODS = 30;

// ─── 阶段 2：统一对比轴（breakdown 维度 / 群组对比）──────────────────────────
/**
 * 漏斗、留存共用同一条「对比轴」，来源二选一：按维度拆分，或按分群对比。
 * 不做「维度 × 分群」的组合：两者叠加会产生笛卡尔积序列，图表无法阅读，
 * 且每条序列的样本量被摊薄到失去统计意义。
 */
export const ANALYTICS_BREAKDOWN_DIMENSIONS = [
  'browser', 'os', 'deviceType', 'region', 'country',
  'source', 'appId', 'environment',
  'channel', 'utmSource', 'utmMedium', 'utmCampaign', 'referrerHost',
] as const;

export type AnalyticsBreakdownDimension = (typeof ANALYTICS_BREAKDOWN_DIMENSIONS)[number];

export const ANALYTICS_BREAKDOWN_DIMENSION_LABELS: Record<(typeof ANALYTICS_BREAKDOWN_DIMENSIONS)[number], string> = {
  browser: '浏览器',
  os: '操作系统',
  deviceType: '设备类型',
  region: '地区',
  country: '国家',
  source: '来源端',
  appId: '应用',
  environment: '环境',
  channel: '获客渠道',
  utmSource: 'UTM 来源',
  utmMedium: 'UTM 媒介',
  utmCampaign: 'UTM 活动',
  referrerHost: '引荐域名',
};

export const ANALYTICS_BREAKDOWN_DIMENSION_OPTIONS: Array<{ value: (typeof ANALYTICS_BREAKDOWN_DIMENSIONS)[number]; label: string }> =
  createLabelOptions(ANALYTICS_BREAKDOWN_DIMENSIONS, ANALYTICS_BREAKDOWN_DIMENSION_LABELS);

/** 维度拆分保留的序列数上限：超出部分归入「其他」，避免图表被长尾淹没 */
export const ANALYTICS_BREAKDOWN_MAX_SERIES = 6;

/** 群组对比的分群数上限 */
export const ANALYTICS_COMPARE_MAX_SEGMENTS = 3;

/** 维度拆分中「空值」与「长尾合并」的统一展示名 */
export const ANALYTICS_BREAKDOWN_UNKNOWN_LABEL = '未知';
export const ANALYTICS_BREAKDOWN_OTHER_LABEL = '其他';

/** 无对比时的单序列 key，前端据此判断是否渲染图例 */
export const ANALYTICS_SERIES_OVERALL_KEY = '__overall__';
export const ANALYTICS_SERIES_OVERALL_LABEL = '全部用户';

// ─── 阶段 2：获客渠道与归因 ───────────────────────────────────────────────────
export const ANALYTICS_ACQUISITION_CHANNELS = [
  'direct', 'organic_search', 'paid_search', 'social', 'email', 'referral', 'other',
] as const;

export type AnalyticsAcquisitionChannel = (typeof ANALYTICS_ACQUISITION_CHANNELS)[number];

export const ANALYTICS_ACQUISITION_CHANNEL_LABELS: Record<(typeof ANALYTICS_ACQUISITION_CHANNELS)[number], string> = {
  direct: '直接访问',
  organic_search: '自然搜索',
  paid_search: '付费搜索',
  social: '社交媒体',
  email: '邮件',
  referral: '外部引荐',
  other: '其他',
};

export const ANALYTICS_ACQUISITION_CHANNEL_OPTIONS: Array<{ value: (typeof ANALYTICS_ACQUISITION_CHANNELS)[number]; label: string }> =
  createLabelOptions(ANALYTICS_ACQUISITION_CHANNELS, ANALYTICS_ACQUISITION_CHANNEL_LABELS);

/**
 * 归因模型：把转化「归功于」用户的哪一次触点。
 * 首次触点回答「谁把人带来的」，末次触点回答「谁临门一脚」，两者结论常常相反，
 * 因此报表必须显式声明模型，不能只给一个含糊的「渠道转化数」。
 */
export const ANALYTICS_ATTRIBUTION_MODELS = ['first_touch', 'last_touch'] as const;

export type AnalyticsAttributionModel = (typeof ANALYTICS_ATTRIBUTION_MODELS)[number];

export const ANALYTICS_ATTRIBUTION_MODEL_LABELS: Record<(typeof ANALYTICS_ATTRIBUTION_MODELS)[number], string> = {
  first_touch: '首次触点',
  last_touch: '末次触点',
};

export const ANALYTICS_ATTRIBUTION_MODEL_OPTIONS: Array<{ value: (typeof ANALYTICS_ATTRIBUTION_MODELS)[number]; label: string }> =
  createLabelOptions(ANALYTICS_ATTRIBUTION_MODELS, ANALYTICS_ATTRIBUTION_MODEL_LABELS);

/** 获客报表的拆分维度（对比轴维度的来源侧子集） */
export const ANALYTICS_ACQUISITION_DIMENSIONS = ['channel', 'utmSource', 'utmMedium', 'utmCampaign', 'referrerHost'] as const;

export type AnalyticsAcquisitionDimension = (typeof ANALYTICS_ACQUISITION_DIMENSIONS)[number];

export const ANALYTICS_ACQUISITION_DIMENSION_OPTIONS: Array<{ value: (typeof ANALYTICS_ACQUISITION_DIMENSIONS)[number]; label: string }> =
  ANALYTICS_ACQUISITION_DIMENSIONS.map((value) => ({ value, label: ANALYTICS_BREAKDOWN_DIMENSION_LABELS[value] }));

// ─── 阶段 2：图表下钻 ─────────────────────────────────────────────────────────
/** 漏斗下钻口径：转化 = 到达该步；流失 = 到达上一步但没到该步 */
export const ANALYTICS_DRILL_FUNNEL_OUTCOMES = ['converted', 'dropped'] as const;

export type AnalyticsDrillFunnelOutcome = (typeof ANALYTICS_DRILL_FUNNEL_OUTCOMES)[number];

export const ANALYTICS_DRILL_FUNNEL_OUTCOME_LABELS: Record<(typeof ANALYTICS_DRILL_FUNNEL_OUTCOMES)[number], string> = {
  converted: '已转化',
  dropped: '已流失',
};

/** 留存下钻口径：回访 = 该周期仍活跃；流失 = 属于该队列但该周期未活跃 */
export const ANALYTICS_DRILL_RETENTION_OUTCOMES = ['retained', 'churned'] as const;

export type AnalyticsDrillRetentionOutcome = (typeof ANALYTICS_DRILL_RETENTION_OUTCOMES)[number];

export const ANALYTICS_DRILL_RETENTION_OUTCOME_LABELS: Record<(typeof ANALYTICS_DRILL_RETENTION_OUTCOMES)[number], string> = {
  retained: '已回访',
  churned: '未回访',
};

/** 下钻结果单页最大条数（下钻用于定位问题用户，不是全量导出，故上限较小） */
export const ANALYTICS_DRILL_PAGE_SIZE_MAX = 100;

// ─── 行为中心阶段 1：服务端权威语义事件（首批：支付 / 工作流 / 会员关键操作）──────
// 命名约定：与来源事件总线类型同名（支付）或加 `workflow.` 前缀（工作流），会员业务事件用 `member.<域>.<动作>`。
// 业务域只应引用这些常量拼装 eventName，禁止裸字符串拼写，避免事件字典与实际上报口径漂移。
export const ANALYTICS_SERVER_PAYMENT_EVENT_NAMES = [
  'payment.succeeded', 'payment.closed', 'payment.failed', 'refund.succeeded', 'refund.failed',
] as const;

export const ANALYTICS_SERVER_WORKFLOW_EVENT_NAMES = [
  'workflow.instance.created', 'workflow.instance.approved', 'workflow.instance.rejected', 'workflow.instance.withdrawn',
  'workflow.node.entered', 'workflow.node.left',
  'workflow.task.created', 'workflow.task.assigned', 'workflow.task.approved', 'workflow.task.rejected',
  'workflow.task.skipped', 'workflow.task.transferred', 'workflow.task.addSigned', 'workflow.task.reduceSigned', 'workflow.task.urged',
] as const;

export const ANALYTICS_SERVER_MEMBER_EVENT_NAMES = [
  'member.registered', 'member.profile.updated',
  'member.points.earned', 'member.points.redeemed', 'member.points.adjusted', 'member.points.expired', 'member.points.refunded',
  'member.coupon.received', 'member.coupon.redeemed',
  'member.checkin.completed',
] as const;

export const ANALYTICS_SERVER_SHORTLINK_EVENT_NAMES = [
  'shortlink.link.clicked',
] as const;

export const ANALYTICS_CLIENT_SYSTEM_EVENT_NAMES = [ANALYTICS_EXPERIMENT_EXPOSURE_EVENT, 'page_not_found', 'page_forbidden'] as const;

export const ANALYTICS_SEMANTIC_EVENT_NAMES = [
  ...ANALYTICS_CLIENT_SYSTEM_EVENT_NAMES,
  ...ANALYTICS_SERVER_PAYMENT_EVENT_NAMES,
  ...ANALYTICS_SERVER_WORKFLOW_EVENT_NAMES,
  ...ANALYTICS_SERVER_MEMBER_EVENT_NAMES,
  ...ANALYTICS_SERVER_SHORTLINK_EVENT_NAMES,
] as const;

export type AnalyticsSemanticEventName = (typeof ANALYTICS_SEMANTIC_EVENT_NAMES)[number];

/**
 * 具名事件常量表：业务调用点（会员 service / 支付 & 工作流订阅桥接）通过该对象引用 eventName，
 * 禁止裸字符串拼写；`satisfies` 约束保证每个值都落在 ANALYTICS_SEMANTIC_EVENT_NAMES 之内。
 */
export const ANALYTICS_EVENT_NAMES = {
  paymentSucceeded: 'payment.succeeded',
  paymentClosed: 'payment.closed',
  paymentFailed: 'payment.failed',
  refundSucceeded: 'refund.succeeded',
  refundFailed: 'refund.failed',
  memberRegistered: 'member.registered',
  memberProfileUpdated: 'member.profile.updated',
  memberPointsEarned: 'member.points.earned',
  memberPointsRedeemed: 'member.points.redeemed',
  memberPointsAdjusted: 'member.points.adjusted',
  memberPointsExpired: 'member.points.expired',
  memberPointsRefunded: 'member.points.refunded',
  memberCouponReceived: 'member.coupon.received',
  memberCouponRedeemed: 'member.coupon.redeemed',
  memberCheckinCompleted: 'member.checkin.completed',
  shortLinkClicked: 'shortlink.link.clicked',
} as const satisfies Record<string, AnalyticsSemanticEventName>;

/** member.points.* 系列事件按 `member-points.service.ts` 的 PointTxType 一一映射，避免拼写漂移 */
export const ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE: Record<'earn' | 'redeem' | 'expire' | 'adjust' | 'refund', AnalyticsSemanticEventName> = {
  earn: ANALYTICS_EVENT_NAMES.memberPointsEarned,
  redeem: ANALYTICS_EVENT_NAMES.memberPointsRedeemed,
  expire: ANALYTICS_EVENT_NAMES.memberPointsExpired,
  adjust: ANALYTICS_EVENT_NAMES.memberPointsAdjusted,
  refund: ANALYTICS_EVENT_NAMES.memberPointsRefunded,
};

export const ANALYTICS_SEMANTIC_EVENT_LABELS: Record<AnalyticsSemanticEventName, string> = {
  [ANALYTICS_EXPERIMENT_EXPOSURE_EVENT]: '实验曝光',
  page_not_found: '404 访问',
  page_forbidden: '越权访问拦截',
  'payment.succeeded': '支付成功',
  'payment.closed': '支付关闭',
  'payment.failed': '支付失败',
  'refund.succeeded': '退款成功',
  'refund.failed': '退款失败',
  'workflow.instance.created': '流程发起',
  'workflow.instance.approved': '流程通过',
  'workflow.instance.rejected': '流程驳回',
  'workflow.instance.withdrawn': '流程撤回',
  'workflow.node.entered': '流程节点进入',
  'workflow.node.left': '流程节点离开',
  'workflow.task.created': '审批任务创建',
  'workflow.task.assigned': '审批任务分配',
  'workflow.task.approved': '审批任务通过',
  'workflow.task.rejected': '审批任务驳回',
  'workflow.task.skipped': '审批任务跳过',
  'workflow.task.transferred': '审批任务转办',
  'workflow.task.addSigned': '审批任务加签',
  'workflow.task.reduceSigned': '审批任务减签',
  'workflow.task.urged': '审批任务催办',
  'member.registered': '会员注册',
  'member.profile.updated': '会员资料更新',
  'member.points.earned': '积分获得',
  'member.points.redeemed': '积分消费',
  'member.points.adjusted': '积分调整',
  'member.points.expired': '积分过期',
  'member.points.refunded': '积分退回',
  'member.coupon.received': '优惠券领取',
  'member.coupon.redeemed': '优惠券核销',
  'member.checkin.completed': '签到完成',
  'shortlink.link.clicked': '短链点击',
};

// ─── 前端错误监控（Issue 模型）───────────────────────────────────────────────
export const FRONTEND_ERROR_TYPES = [
  'js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash',
] as const;

export type FrontendErrorType = (typeof FRONTEND_ERROR_TYPES)[number];

export const ERROR_LEVELS = ['fatal', 'error', 'warning', 'info'] as const;

export type ErrorLevel = (typeof ERROR_LEVELS)[number];

export const ERROR_STATUSES = ['unresolved', 'resolved', 'ignored', 'muted'] as const;

export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export const ERROR_ALERT_CONDITIONS = ['new_error', 'threshold', 'spike'] as const;

export type ErrorAlertCondition = (typeof ERROR_ALERT_CONDITIONS)[number];

/** 告警规则可选通知渠道 */
export const ERROR_ALERT_CHANNELS = ['email', 'webhook', 'inapp'] as const;

export type ErrorAlertChannel = (typeof ERROR_ALERT_CHANNELS)[number];

/** 错误现场面包屑类型 */
export const ERROR_BREADCRUMB_TYPES = ['navigation', 'click', 'http', 'console', 'custom'] as const;

export type ErrorBreadcrumbType = (typeof ERROR_BREADCRUMB_TYPES)[number];

// ─── 会话回放 ─────────────────────────────────────────────────────────────────
/** 回放采集起始模式：buffer=错误触发前仅内存缓冲；stream=会话开始即持续上传 */
export const REPLAY_MODES = ['buffer', 'stream'] as const;

export type ReplayMode = (typeof REPLAY_MODES)[number];

/** 回放会话状态：recording=进行中（可追流）；completed=已收尾；expired=异常超时收尾 */
export const REPLAY_STATUSES = ['recording', 'completed', 'expired'] as const;

export type ReplayStatus = (typeof REPLAY_STATUSES)[number];

/** 回放触发器类型（可扩展：二期 rage_click/white_screen，三期反馈联动等） */
export const REPLAY_TRIGGER_TYPES = ['error', 'sampled', 'manual', 'rage_click', 'white_screen'] as const;

export type ReplayTriggerType = (typeof REPLAY_TRIGGER_TYPES)[number];