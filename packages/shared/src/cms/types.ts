import type {
  CMS_AD_EVENT_TYPES,
  CMS_CHANNEL_DETAIL_PATH_RULES,
  CMS_CHANNEL_STATIC_MODES,
  CMS_CHANNEL_TYPES,
  CMS_COMMENT_STATUSES,
  CMS_CONTENT_STATUSES,
  CMS_CONTENT_TYPES,
  CMS_DEVICE_TYPES,
  CMS_DISTRIBUTION_CONFLICT_STRATEGIES,
  CMS_DISTRIBUTION_MODES,
  CMS_DISTRIBUTION_RUN_OUTCOMES,
  CMS_FIELD_OPTION_SOURCES,
  CMS_FIELD_TYPES,
  CMS_INTERACTION_CAPTCHA_POLICIES,
  CMS_INTERACTION_CONDITION_OPS,
  CMS_INTERACTION_KINDS,
  CMS_INTERACTION_PARTICIPANT_SCOPES,
  CMS_INTERACTION_QUESTION_TYPES,
  CMS_INTERACTION_REPEAT_POLICIES,
  CMS_INTERACTION_RESULT_VISIBILITIES,
  CMS_INTERACTION_STATUSES,
  CMS_PAGE_BLOCK_AUDIENCES,
  CMS_PAGE_BLOCK_TYPE_VALUES,
  CMS_PUBLISH_ARTIFACT_STATUSES,
  CMS_PUBLISH_TARGET_TYPES,
  CMS_RESOURCE_TYPES,
  CMS_SITE_INHERITABLE_FIELDS,
  CMS_STATIC_MODES,
  CMS_SUBSCRIPTION_SUBJECT_TYPES,
  CMS_THEME_SETTING_FIELD_TYPES,
  CMS_WIDGET_REF_OWNER_TYPES,
  CMS_WIDGET_RENDERER_KEYS,
  CMS_WIDGET_SLOT_KEYS,
  CMS_WIDGET_SOURCE_TYPES,
  CMS_WIDGET_STATUSES,
  CMS_WIDGET_TYPES,
} from './constants';
import type { SubmitCmsPublishInput } from './validation';

// ─── 枚举别名（SSOT 为 constants.ts 的常量数组） ─────────────────────────────
export type CmsStaticMode = (typeof CMS_STATIC_MODES)[number];

/** 栏目静态化模式：inherit=跟随站点，其余覆盖站点设置 */
export type CmsChannelStaticMode = (typeof CMS_CHANNEL_STATIC_MODES)[number];

/** 详情页静态产物目录归档策略（栏目路径后追加一级目录；内容 staticPath 优先） */
export type CmsChannelDetailPathRule = (typeof CMS_CHANNEL_DETAIL_PATH_RULES)[number];

export type CmsFieldOptionSource = (typeof CMS_FIELD_OPTION_SOURCES)[number];

export type CmsChannelType = (typeof CMS_CHANNEL_TYPES)[number];

export type CmsContentStatus = (typeof CMS_CONTENT_STATUSES)[number];

/** 内容形态：article=图文 album=图集 media=音视频 link=外链 */
export type CmsContentType = (typeof CMS_CONTENT_TYPES)[number];

export type CmsFieldType = (typeof CMS_FIELD_TYPES)[number];

export type CmsSiteInheritableField = (typeof CMS_SITE_INHERITABLE_FIELDS)[number];

export type CmsThemeSettingFieldType = (typeof CMS_THEME_SETTING_FIELD_TYPES)[number];

export type CmsPublishTargetType = (typeof CMS_PUBLISH_TARGET_TYPES)[number];

export type CmsPublishArtifactStatus = (typeof CMS_PUBLISH_ARTIFACT_STATUSES)[number];

export type CmsDistributionMode = (typeof CMS_DISTRIBUTION_MODES)[number];

export type CmsDistributionConflictStrategy = (typeof CMS_DISTRIBUTION_CONFLICT_STRATEGIES)[number];

export type CmsDistributionRunOutcome = (typeof CMS_DISTRIBUTION_RUN_OUTCOMES)[number];

export type CmsInteractionKind = (typeof CMS_INTERACTION_KINDS)[number];

export type CmsInteractionStatus = (typeof CMS_INTERACTION_STATUSES)[number];

export type CmsInteractionQuestionType = (typeof CMS_INTERACTION_QUESTION_TYPES)[number];

export type CmsInteractionConditionOp = (typeof CMS_INTERACTION_CONDITION_OPS)[number];

export type CmsInteractionParticipantScope = (typeof CMS_INTERACTION_PARTICIPANT_SCOPES)[number];

export type CmsInteractionRepeatPolicy = (typeof CMS_INTERACTION_REPEAT_POLICIES)[number];

export type CmsInteractionResultVisibility = (typeof CMS_INTERACTION_RESULT_VISIBILITIES)[number];

export type CmsInteractionCaptchaPolicy = (typeof CMS_INTERACTION_CAPTCHA_POLICIES)[number];

export type CmsSubscriptionSubjectType = (typeof CMS_SUBSCRIPTION_SUBJECT_TYPES)[number];

export type CmsCommentStatus = (typeof CMS_COMMENT_STATUSES)[number];

export type CmsResourceType = (typeof CMS_RESOURCE_TYPES)[number];

export type CmsAdEventType = (typeof CMS_AD_EVENT_TYPES)[number];

export type CmsDeviceType = (typeof CMS_DEVICE_TYPES)[number];

export type CmsPageBlockType = (typeof CMS_PAGE_BLOCK_TYPE_VALUES)[number];

export type CmsPageBlockAudience = (typeof CMS_PAGE_BLOCK_AUDIENCES)[number];

export type CmsPageBlockAclSubjectType = 'user' | 'role';

export type CmsWidgetType = (typeof CMS_WIDGET_TYPES)[number];

export type CmsWidgetStatus = (typeof CMS_WIDGET_STATUSES)[number];

export type CmsWidgetSourceType = (typeof CMS_WIDGET_SOURCE_TYPES)[number];

export type CmsWidgetRendererKey = (typeof CMS_WIDGET_RENDERER_KEYS)[number];

export type CmsWidgetRefOwnerType = (typeof CMS_WIDGET_REF_OWNER_TYPES)[number];

export type CmsWidgetSlotKey = (typeof CMS_WIDGET_SLOT_KEYS)[number];

// ─── 非 API 载荷的运行时形状 ───────────────────────────────────────────────────

/** 站点内容策略（存 cms_sites.settings，缺省值见 CMS_SITE_OPS_DEFAULTS） */
export interface CmsSiteOpsSettings {
  publishedContentEditable: boolean;
  recycleKeepDays: number;
  maxPageOnContentPublish: number;
  autoReplaceSensitiveWords: boolean;
  autoReplaceErrorProneWords: boolean;
  autoCoverFromBody: boolean;
  /** 是否允许开放 API 直接发布（默认关闭，外部写入先落草稿走审核） */
  openApiPublishEnabled: boolean;
}

/** 内容发布快照：发布任务按快照生成 / 删除静态产物，避免任务执行时读到后续编辑 */
export interface CmsContentPublishSnapshot {
  contentId: number;
  siteId: number;
  contentVersion: number;
  channelId: number;
  channelPath: string;
  slug: string;
  bodyPages: number;
  build: boolean;
  purged?: boolean;
  /** 本内容对应的全部静态产物路径（含正文分页） */
  paths: string[];
  refreshChannelIds: number[];
}

/** 发布任务 payload：路由入参 + 仅由可信服务端写入的生命周期 / 引用 fence */
export interface CmsPublishSubmitInput extends SubmitCmsPublishInput {
  expectedThemeRevision?: number;
  expectedTemplateRefsRevision?: number;
  expectedPublicRevision?: number;
  contentSnapshots?: CmsContentPublishSnapshot[];
  deletePaths?: string[];
}
