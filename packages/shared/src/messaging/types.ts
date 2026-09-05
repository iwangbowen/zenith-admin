import type { InAppMessageType, NotificationChannel } from './constants';

// ─── 公告 ──────────────────────────────────────────────────
export type AnnouncementType = 'notice' | 'announcement' | 'warning';

export type AnnouncementPriority = 'low' | 'medium' | 'high';

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export type ChannelType = 'system' | 'business';

export type ChannelAudienceType = 'broadcast' | 'targeted';

export type ChannelMessageType = 'text' | 'card' | 'image' | 'news';

/** 消息状态：sent=已发；draft=草稿；scheduled=定时待发 */
export type ChannelMessageStatus = 'sent' | 'draft' | 'scheduled';

/** 群发受众范围：all=全员；users=指定用户；departments=按部门；roles=按角色 */
export type ChannelPublishAudienceMode = 'all' | 'users' | 'departments' | 'roles';

/** 群发发送方式：now=立即；scheduled=定时；draft=存草稿 */
export type ChannelSendMode = 'now' | 'scheduled' | 'draft';

/** 消息方向：out=频道→用户（群发/客服/自动回复）；in=用户→频道（用户主动发送） */
export type ChannelMessageDirection = 'out' | 'in';

/** 公众号底部菜单类型：click=点击触发关键词；view=跳转链接 */
export type ChannelMenuType = 'click' | 'view';

/** 自动回复匹配类型：subscribe=关注欢迎语；keyword=关键词；default=兜底 */
export type ChannelAutoReplyMatchType = 'subscribe' | 'keyword' | 'default';

/** 关键词匹配模式：exact=完全匹配；contains=包含 */
export type ChannelAutoReplyKeywordMode = 'exact' | 'contains';

/** 客服会话状态：open=待处理；processing=处理中；resolved=已解决 */
export type ChannelConversationStatus = 'open' | 'processing' | 'resolved';

// ─── 通知中心（Notification Center）─────────────────────────────────────────

/**
 * 收件人。
 * `user` / `member` 参与偏好解析；`external` 是不绑定账号的裸地址
 * （告警规则里的外部邮箱、Webhook URL），没有身份也就没有偏好，直接投递。
 */
export type NotificationRecipient =
  | { type: 'user'; id: number }
  | { type: 'member'; id: number }
  | { type: 'external'; channel: NotificationChannel; address: string };

/** 渠道级投递参数，用于渠道本身需要额外配置的场景（短信模板、Webhook 地址）。 */
export interface NotificationChannelOptions {
  sms?: {
    templateId: number;
    /**
     * 显式短信模板变量。短信服务商按**位置**映射参数（腾讯云 `Object.values`），
     * 而事件 vars 经 jsonb 往返后键序会被重排；不传时适配器按模板占位符出现顺序
     * 从事件 vars 中挑选，传了则以此为准。
     */
    variables?: Record<string, string>;
  };
  webhook?: { url: string; body?: Record<string, unknown> };
  email?: { html?: string; subject?: string };
  inapp?: { type?: InAppMessageType };
  /** App 推送渠道参数;标题默认取事件渲染结果,extras 随通知透传给客户端 */
  push?: { title?: string; sound?: string; extras?: Record<string, string> };
}

/**
 * 管理员配置层：本次派发允许 / 禁止的渠道。
 * 典型来源是流程定义的 notifyChannels 开关或告警规则的 channels 字段——
 * 它决定「渠道是否被开放」，用户偏好在其之后决定「是否真的要收」。
 */
export interface NotificationChannelPolicy {
  /** 白名单：给出时本次只考虑这些渠道 */
  only?: readonly NotificationChannel[];
  /** 在默认渠道之外额外开启 */
  enable?: readonly NotificationChannel[];
  /** 强制关闭（优先级高于 enable） */
  disable?: readonly NotificationChannel[];
}
