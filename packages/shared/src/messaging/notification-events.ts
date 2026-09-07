/**
 * 通知事件目录（Notification Event Catalog）。
 *
 * 事件的**唯一定义源是这份代码**，数据库只存管理员改过的稀疏覆盖行。
 * 这样做的直接收益：
 * - `notify('wiki.doc.commentd', …)` 这类事件 key 拼写错误在编译期就暴露；
 * - 事件变量缺传、类型不符同样编译不过，不会等到线上渲染出 `{{docTitle}}` 字面量；
 * - 业务里删掉调用点后事件目录不会残留幽灵条目（DB 驱动的目录必然与代码脱节）。
 *
 * 新增事件 = 在 `NOTIFICATION_EVENTS` 里加一项 + 在业务处调用 `notify()`，无需迁移、无需种子。
 */
import type {
  NotificationChannel,
  NotificationEventGroup,
  NotificationSeverity,
} from './constants';

export interface NotificationEventDef {
  /** 所属分组，决定偏好矩阵中的折叠位置 */
  group: NotificationEventGroup;
  /** 事件中文名，展示在偏好矩阵与策略中心 */
  label: string;
  /** 补充说明，展示为矩阵行的次级文案 */
  description?: string;
  severity: NotificationSeverity;
  /** 收件人未做任何配置时实际生效的渠道 */
  defaultChannels: readonly NotificationChannel[];
  /**
   * 允许收件人自行开关的渠道全集。
   * 省略时等于 `defaultChannels`——未列出的渠道不会出现在矩阵里，也无法被偏好打开，
   * 避免用户给「短信」打上勾却因为该事件根本没有短信模板而永远收不到。
   */
  availableChannels?: readonly NotificationChannel[];
  /** 强制事件：收件人不可关闭（仅限账号安全等必达场景），矩阵中显示为锁定 */
  mandatory?: boolean;
  /** 穿透免打扰时段直接投递 */
  bypassQuietHours?: boolean;
  /** 各渠道模板 code；未配置的渠道回退到事件自带的标题/正文渲染 */
  templates?: Partial<Record<NotificationChannel, string>>;
  /**
   * 频控：同一收件人在窗口内同事件同渠道最多收到 limit 条，超出记 `rate_limited`。
   * 只给评论/提及这类可能风暴化的事件配置；告警类必达事件不要配。
   */
  rateLimit?: { limit: number; windowMinutes: number };
  /** 不在偏好矩阵中展示（如摘要这类由派发层自身触发的元事件） */
  hidden?: boolean;
  /**
   * 变量类型占位。运行期恒为空对象，只用于在编译期把事件 key 与
   * `notify()` 的 `vars` 参数绑定起来。
   */
  vars: Record<string, unknown>;
  /** 默认标题模板，支持 `{{var}}` 占位 */
  title: string;
  /** 默认正文模板，支持 `{{var}}` 占位 */
  content: string;
}

/**
 * 保留字面量类型的注册函数。
 * `const` 类型参数让每个事件的 `vars` 保持精确形状，而不是被拓宽成 `Record<string, unknown>`。
 */
export function defineNotificationEvents<const T extends Record<string, NotificationEventDef>>(defs: T): T {
  return defs;
}

/** 变量占位构造器：`vars: eventVars<{ docId: number }>()` 比 `{} as { docId: number }` 更难写错。 */
export function eventVars<V extends Record<string, unknown>>(): V {
  return {} as V;
}

export const NOTIFICATION_EVENTS = defineNotificationEvents({
  // ─── 知识中心 ───────────────────────────────────────────────────────────────
  'wiki.doc.published': {
    group: 'wiki',
    label: '订阅文档发布新版本',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ docId: number; docTitle: string }>(),
    title: '订阅的知识文档已更新',
    content: '你订阅的文档《{{docTitle}}》发布了新版本，点击知识中心查看。',
  },
  'wiki.doc.commented': {
    group: 'wiki',
    label: '文档收到新评论',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 10, windowMinutes: 60 },
    vars: eventVars<{ docId: number; docTitle: string; summary: string }>(),
    title: '知识文档有新评论',
    content: '《{{docTitle}}》收到新评论：{{summary}}',
  },
  'wiki.doc.mentioned': {
    group: 'wiki',
    label: '评论中被 @ 提及',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 10, windowMinutes: 60 },
    vars: eventVars<{ docId: number; docTitle: string }>(),
    title: '有人在知识文档中提到了你',
    content: '你在《{{docTitle}}》的评论中被提及，去看看吧。',
  },
  'wiki.doc.reviewed': {
    group: 'wiki',
    label: '文档审核结果',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ docId: number; docTitle: string; resultText: string }>(),
    title: '知识文档审核结果',
    content: '你提交的《{{docTitle}}》{{resultText}}',
  },
  'wiki.governance.maintenance_due': {
    group: 'wiki',
    label: '文档待维护提醒',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ docId: number; docTitle: string }>(),
    title: '知识文档待维护提醒',
    content: '你负责的文档《{{docTitle}}》需要复核更新，请前往知识中心处理。',
  },
  'wiki.governance.review_due': {
    group: 'wiki',
    label: '文档复审到期 / 已过有效期',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ docId: number; docTitle: string; stateText: string }>(),
    title: '知识文档需要处理',
    content: '文档《{{docTitle}}》{{stateText}}，请前往知识中心更新或归档。',
  },

  // ─── 工作流 ─────────────────────────────────────────────────────────────────
  // email / sms 是否真正可用还取决于流程定义里的 notifyChannels 开关（管理员配置层），
  // 因此列入 availableChannels 但不放进 defaultChannels。
  'workflow.task.created': {
    group: 'workflow',
    label: '收到新待办审批',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'sms', 'push'],
    bypassQuietHours: true,
    vars: eventVars<{ instanceId: number; taskId: number; title: string; node: string }>(),
    title: '待办审批提醒',
    content: '你有一条新的待办：流程「{{title}}」（节点：{{node}}），请及时处理',
  },
  'workflow.task.cc': {
    group: 'workflow',
    label: '流程抄送给我',
    severity: 'normal',
    defaultChannels: ['inapp'],
    vars: eventVars<{ instanceId: number; taskId: number; title: string; node: string }>(),
    title: '流程抄送通知',
    content: '流程「{{title}}」抄送给你（节点：{{node}}）',
  },
  'workflow.task.urged': {
    group: 'workflow',
    label: '待办被催办',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'push'],
    bypassQuietHours: true,
    vars: eventVars<{ instanceId: number; taskId: number; title: string; node: string; extra: string }>(),
    title: '催办提醒',
    content: '流程「{{title}}」（节点：{{node}}）有人催办{{extra}}，请尽快处理',
  },
  'workflow.task.transferred': {
    group: 'workflow',
    label: '待办转交给我',
    severity: 'normal',
    defaultChannels: ['inapp'],
    vars: eventVars<{ instanceId: number; taskId: number; title: string; node: string }>(),
    title: '待办转交提醒',
    content: '流程「{{title}}」（节点：{{node}}）的审批任务已转交给你，请及时处理',
  },
  'workflow.instance.approved': {
    group: 'workflow',
    label: '我发起的流程通过',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'sms'],
    vars: eventVars<{ instanceId: number; title: string; status: string }>(),
    title: '审批通过',
    content: '你发起的流程「{{title}}」已审批通过',
  },
  'workflow.instance.rejected': {
    group: 'workflow',
    label: '我发起的流程被驳回',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'sms'],
    vars: eventVars<{ instanceId: number; title: string; status: string }>(),
    title: '审批被驳回',
    content: '你发起的流程「{{title}}」已被驳回',
  },
  'workflow.instance.withdrawn': {
    group: 'workflow',
    label: '我发起的流程已撤回',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'sms'],
    vars: eventVars<{ instanceId: number; title: string; status: string }>(),
    title: '流程已撤回',
    content: '你发起的流程「{{title}}」已撤回',
  },
  'workflow.instance.returned': {
    group: 'workflow',
    label: '我发起的流程被退回',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'sms'],
    vars: eventVars<{ instanceId: number; title: string; status: string }>(),
    title: '申请被退回',
    content: '你发起的流程「{{title}}」已被退回，请修改后重新提交',
  },
  'workflow.consult.invited': {
    group: 'workflow',
    label: '收到协办邀请',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    // 协办人不回复时审批人处于等待状态，与新待办同级，不该等到早上
    bypassQuietHours: true,
    vars: eventVars<{ instanceId: number; taskId: number; title: string; node: string; inviter: string; question: string }>(),
    title: '协办邀请',
    content: '{{inviter}} 邀请你协办流程「{{title}}」（节点：{{node}}）{{question}}',
  },
  'workflow.consult.replied': {
    group: 'workflow',
    label: '协办意见已回复',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ instanceId: number; title: string; replier: string; summary: string }>(),
    title: '协办意见已回复',
    content: '{{replier}} 已回复你在流程「{{title}}」的协办邀请：{{summary}}',
  },
  'workflow.comment.mentioned': {
    group: 'workflow',
    label: '流程评论中被 @ 提及',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 10, windowMinutes: 60 },
    vars: eventVars<{ instanceId: number; title: string; author: string; summary: string }>(),
    title: '有人在流程中@你',
    content: '{{author}} 在流程「{{title}}」的评论中提到了你：{{summary}}',
  },
  'workflow.node.exception': {
    group: 'workflow',
    label: '流程节点异常处理',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    // 异常兜底改变了流程走向（自动通过/跳过），相关人越早知道越好
    bypassQuietHours: true,
    vars: eventVars<{ instanceId: number; node: string; detail: string }>(),
    title: '流程异常提醒',
    content: '流程节点「{{node}}」{{detail}}',
  },
  'workflow.automation.message': {
    group: 'workflow',
    label: '流程自动化消息',
    description: '流程自动化规则中配置的站内信动作',
    severity: 'normal',
    defaultChannels: ['inapp'],
    // 标题与正文由自动化规则的管理员配置决定，仅站内信有投递支撑
    vars: eventVars<{ instanceId: number; title: string; content: string }>(),
    title: '{{title}}',
    content: '{{content}}',
  },

  // ─── 组织与租户 ─────────────────────────────────────────────────────────────
  'identity.tenant.expiring': {
    group: 'identity',
    label: '租户即将到期',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    bypassQuietHours: true,
    vars: eventVars<{ tenantName: string; days: number; expireAt: string }>(),
    title: '租户「{{tenantName}}」将于 {{days}} 天后到期',
    content: '租户「{{tenantName}}」将于 {{expireAt}} 到期（剩余 {{days}} 天），到期后系统将自动停用该租户，请及时续期。',
  },
  'identity.tenant.expired': {
    group: 'identity',
    label: '租户已到期停用',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    // 直接导致租户下所有人无法登录，关掉它等于让人在毫无预警的情况下失去访问
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ tenantName: string; expireAt: string }>(),
    title: '租户「{{tenantName}}」已到期停用',
    content: '租户「{{tenantName}}」已于 {{expireAt}} 到期，系统已自动停用，该租户用户将无法登录。如需继续使用请联系平台管理员续期。',
  },

  // ─── 运维与告警 ─────────────────────────────────────────────────────────────
  // 告警类事件由管理员在规则上显式指定渠道与接收人，收件人不得自行关闭：
  // 「配了规则却没人收到」正是这套系统最不能出现的失效模式。
  'ops.monitor.alert': {
    group: 'ops',
    label: '系统监控告警',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook', 'push'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ ruleName: string; tag: string; message: string }>(),
    title: '[监控{{tag}}] {{ruleName}}',
    content: '{{message}}',
  },
  'ops.monitor.alert_test': {
    group: 'ops',
    label: '监控告警渠道测试',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook'],
    // 试发的目的就是验证渠道配置本身，被收件人偏好挡掉会让「测试通过但没收到」变成误判
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ ruleName: string; message: string }>(),
    title: '[监控告警测试] {{ruleName}}',
    content: '{{message}}',
  },
  'ops.error.alert': {
    group: 'ops',
    label: '前端错误监控告警',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook', 'push'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ ruleName: string; detail: string }>(),
    title: '[错误告警] {{ruleName}}',
    content: '{{detail}}',
  },
  'ops.server.crashed': {
    group: 'ops',
    label: '服务进程崩溃重启',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    mandatory: true,
    bypassQuietHours: true,
    // 由重启后的进程读崩溃哨兵补投（crash-report.service），按哨兵文件 dedupeKey 幂等；
    // 告警必达，不配 rateLimit——单次启动的补投量已由服务侧上限约束
    vars: eventVars<{ kind: string; message: string; crashedAt: string; pid: number; uptimeSec: number }>(),
    title: '[系统] 服务进程崩溃后已自动重启',
    content: '服务进程于 {{crashedAt}} 异常退出（{{kind}}：{{message}}，pid {{pid}}，已运行 {{uptimeSec}} 秒），现已自动重启。请前往「日志查看器」排查崩溃原因。',
  },
  'ops.ssl.cert_expiring': {
    group: 'ops',
    label: 'SSL 证书到期提醒',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ detail: string }>(),
    title: 'SSL 证书到期提醒',
    content: '{{detail}}，请及时更换证书。',
  },
  'ops.scheduler.job_failed': {
    group: 'ops',
    label: '定时任务执行失败',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook', 'chat'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ jobName: string; errorMessage: string }>(),
    title: '定时任务执行失败',
    content: '任务「{{jobName}}」执行失败：{{errorMessage}}',
  },
  'ops.rate_limit.spike': {
    group: 'ops',
    label: '接口限流拦截突增',
    description: '某条限流规则的小时拦截数达到其配置的告警阈值',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook'],
    // 派发侧按 规则+小时 携带 dedupeKey，同一小时只告警一次，无需再配 rateLimit
    vars: eventVars<{ ruleName: string; blockedCount: number; threshold: number; hour: string }>(),
    title: '[限流告警] {{ruleName}} 拦截突增',
    content: '限流规则「{{ruleName}}」在 {{hour}} 时段已拦截 {{blockedCount}} 次，达到告警阈值 {{threshold}}。请在「系统设置 → 接口限流」检查是否为攻击流量或阈值配置过严。',
  },
  'ops.scheduler.task_alert': {
    group: 'ops',
    label: '系统调度任务告警',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook', 'chat'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ taskTitle: string; taskName: string; module: string; runId: number; alertMessage: string }>(),
    title: '[系统调度告警] {{taskTitle}}',
    content: '任务「{{taskTitle}}」（{{module}} / {{taskName}}，运行 #{{runId}}）触发告警：{{alertMessage}}',
  },
  'ops.license.expiring': {
    group: 'ops',
    label: 'License 即将到期 / 宽限期提醒',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    // 巡检任务按天触发并带 dedupeKey，无需再配 rateLimit
    vars: eventVars<{ statusText: string; expiresAt: string; graceUntil: string }>(),
    title: '[License] {{statusText}}',
    content: '部署授权{{statusText}}（到期 {{expiresAt}}，宽限截止 {{graceUntil}}），请及时联系供应商续期并在「系统设置 → License 授权」中激活新文件。',
  },
  'ops.license.invalid': {
    group: 'ops',
    label: 'License 失效告警',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ reason: string }>(),
    title: '[License] 部署授权失效',
    content: '部署授权已失效：{{reason}}。required 模式下增值功能将进入受限状态，请尽快处理。',
  },

  // ─── IoT 设备 ───────────────────────────────────────────────────────────────
  // 告警接收人由规则显式指定（notifyUserIds），必达语义同系统监控告警。
  'iot.alarm.triggered': {
    group: 'iot',
    label: 'IoT 设备告警触发',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook', 'push'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ ruleName: string; deviceName: string; sn: string; levelText: string; message: string }>(),
    title: '[IoT{{levelText}}] {{ruleName}}',
    content: '设备「{{deviceName}}」（SN: {{sn}}）触发告警：{{message}}',
  },
  'iot.alarm.resolved': {
    group: 'iot',
    label: 'IoT 设备告警恢复',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook'],
    vars: eventVars<{ ruleName: string; deviceName: string; sn: string; message: string }>(),
    title: '[IoT 恢复] {{ruleName}}',
    content: '设备「{{deviceName}}」（SN: {{sn}}）告警已恢复：{{message}}',
  },
  'iot.alarm.escalated': {
    group: 'iot',
    label: 'IoT 告警升级',
    description: '告警触发后超过规则配置时长仍未认领/未恢复，升级通知值班主管',
    severity: 'critical',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook', 'push'],
    mandatory: true,
    bypassQuietHours: true,
    vars: eventVars<{ ruleName: string; deviceName: string; sn: string; minutes: string; message: string }>(),
    title: '[IoT 升级] {{ruleName}} 超 {{minutes}} 分钟未处理',
    content: '设备「{{deviceName}}」（SN: {{sn}}）告警超过 {{minutes}} 分钟未认领：{{message}}',
  },
  'iot.automation.triggered': {
    group: 'iot',
    label: 'IoT 场景联动通知',
    description: '联动规则的「发送通知」动作，接收人由规则显式指定',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email', 'webhook'],
    rateLimit: { limit: 30, windowMinutes: 60 },
    vars: eventVars<{ automationName: string; deviceName: string; sn: string; detail: string }>(),
    title: '[IoT 联动] {{automationName}}',
    content: '设备「{{deviceName}}」（SN: {{sn}}）触发场景联动：{{detail}}',
  },

  // ─── 开放平台 ───────────────────────────────────────────────────────────────
  'open-platform.app.review_requested': {
    group: 'open-platform',
    label: '有应用待审核',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ appName: string }>(),
    title: '开放平台应用待审核',
    content: '开发者应用「{{appName}}」已提交审核。',
  },
  'open-platform.app.reviewed': {
    group: 'open-platform',
    label: '我的应用审核结果',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ appName: string; resultText: string }>(),
    title: '应用审核结果',
    content: '应用「{{appName}}」{{resultText}}',
  },
  'open-platform.webhook.delivery_failed': {
    group: 'open-platform',
    label: 'Webhook 投递失败',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ subscriptionName: string; detail: string }>(),
    title: 'Webhook 投递失败',
    content: '订阅「{{subscriptionName}}」{{detail}}',
  },
  'open-platform.quota.threshold_exceeded': {
    group: 'open-platform',
    label: 'API 配额告警',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    bypassQuietHours: true,
    vars: eventVars<{ threshold: number; appName: string; dimensionText: string; used: number; quotaLimit: number }>(),
    title: '开放 API 配额已使用 {{threshold}}%',
    content: '应用「{{appName}}」{{dimensionText}}配额已使用 {{used}}/{{quotaLimit}}，请关注剩余额度。',
  },

  // ─── 运营中心 ───────────────────────────────────────────────────────────────
  'shortlink.link.expiring': {
    group: 'growth',
    label: '短链即将过期',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ code: string; title: string; shortUrl: string; expiresAtText: string }>(),
    title: '短链即将过期',
    content: '短链「{{title}}」（{{shortUrl}}）将于 {{expiresAtText}} 过期，如需继续使用请及时调整有效期。',
  },
  'marketing.award.won': {
    group: 'growth',
    label: '营销活动中奖',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp'],
    vars: eventVars<{ campaignName: string; prizeName: string }>(),
    title: '恭喜中奖',
    content: '你在活动「{{campaignName}}」中抽中了「{{prizeName}}」，奖励已发放，请注意查收。',
  },

  // ─── 报表中心 ───────────────────────────────────────────────────────────────
  'report.dashboard.mentioned': {
    group: 'report',
    label: '仪表盘评论中被提及',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 10, windowMinutes: 60 },
    vars: eventVars<{ dashboardId: number; dashboardName: string }>(),
    title: '仪表盘评论提及提醒',
    content: '你在仪表盘「{{dashboardName}}」评论中被提及，请前往查看。',
  },

  // ─── 平台服务 ───────────────────────────────────────────────────────────────
  'platform.feedback.handled': {
    group: 'platform',
    label: '意见反馈处理结果',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ feedbackId: number; statusText: string; remark: string }>(),
    title: '你的意见反馈已处理',
    content: '你提交的意见反馈{{statusText}}{{remark}}',
  },
  'platform.export.finished': {
    group: 'platform',
    label: '导出任务完成 / 失败',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ jobId: number; moduleName: string; resultText: string; detail: string }>(),
    title: '导出任务{{resultText}}',
    content: '「{{moduleName}}」的导出任务{{resultText}}{{detail}}，可前往导出中心查看。',
  },

  // ─── 数据分析 ───────────────────────────────────────────────────────────────
  'analytics.error.assigned': {
    group: 'analytics',
    label: '错误 Issue 指派给我',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ groupId: number; message: string; assignerName: string }>(),
    title: '有错误 Issue 指派给你',
    content: '{{assignerName}} 将错误 Issue「{{message}}」指派给你处理，请前往错误监控查看。',
  },

  // ─── 通知中心元事件 ─────────────────────────────────────────────────────────
  // 摘要邮件本身：由摘要聚合任务触发，不出现在偏好矩阵（用户通过摘要模式控制它）。
  'messaging.digest': {
    group: 'messaging',
    label: '通知摘要',
    severity: 'normal',
    defaultChannels: ['email'],
    hidden: true,
    vars: eventVars<{ count: number; periodText: string }>(),
    title: '你有 {{count}} 条未读通知摘要',
    content: '{{periodText}}期间共有 {{count}} 条通知，详见邮件内容。',
  },
  // 运营群发：管理页选定受众与渠道后经任务中心分批派发；
  // 渠道由 campaign 的 channelPolicy.only 决定,不出现在偏好矩阵,但尊重全局免打扰。
  'messaging.broadcast': {
    group: 'messaging',
    label: '运营群发',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'push', 'email'],
    hidden: true,
    vars: eventVars<{ title: string; content: string }>(),
    title: '{{title}}',
    content: '{{content}}',
  },
  // ─── 企业网盘 ─────────────────────────────────────────────────────────────
  'drive.space.orphaned': {
    group: 'drive', label: '网盘空间待接管', severity: 'important',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    vars: eventVars<{ spaceId: number; spaceName: string }>(),
    title: '空间「{{spaceName}}」需要接管',
    content: '空间归属的用户或部门已删除，请前往空间治理完成交接。',
  },
  'drive.node.changed': {
    group: 'drive', label: '关注的文件发生变更', severity: 'normal',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    vars: eventVars<{ nodeId: number; nodeName: string; changes: number }>(),
    title: '「{{nodeName}}」有新动态',
    content: '你关注的文件或文件夹发生了 {{changes}} 次变更，点击查看。',
  },
  'drive.comment.created': {
    group: 'drive', label: '文件收到评论或提及', severity: 'normal',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 20, windowMinutes: 60 },
    vars: eventVars<{ nodeId: number; nodeName: string; authorName: string; comment: string }>(),
    title: '{{authorName}} 评论了「{{nodeName}}」',
    content: '{{comment}}',
  },
  'drive.node.shared': {
    group: 'drive',
    label: '文件 / 文件夹被授权给我',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 20, windowMinutes: 60 },
    vars: eventVars<{ nodeId: number; nodeName: string; nodeType: string; roleLabel: string; grantorName: string }>(),
    title: '{{grantorName}} 向你共享了{{nodeType}}「{{nodeName}}」',
    content: '{{grantorName}} 将{{nodeType}}「{{nodeName}}」授权给你（{{roleLabel}}），点击前往查看。',
  },
  'drive.space.member_added': {
    group: 'drive',
    label: '被加入协作空间',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ spaceId: number; spaceName: string; roleLabel: string; operatorName: string }>(),
    title: '你已加入协作空间「{{spaceName}}」',
    content: '{{operatorName}} 将你加入协作空间「{{spaceName}}」（{{roleLabel}}）。',
  },
  'drive.space.quota_warning': {
    group: 'drive',
    label: '空间配额预警',
    severity: 'important',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ spaceId: number; spaceName: string; usedText: string; quotaText: string; percent: number }>(),
    title: '空间「{{spaceName}}」已用 {{percent}}%',
    content: '空间「{{spaceName}}」已使用 {{usedText}} / {{quotaText}}，请及时清理回收站或联系管理员扩容。',
  },
  'drive.batch_download.ready': {
    group: 'drive',
    label: '打包下载已就绪',
    severity: 'normal',
    defaultChannels: ['inapp'],
    availableChannels: ['inapp', 'email'],
    vars: eventVars<{ fileCount: number; sizeText: string }>(),
    title: '打包下载已就绪',
    content: '你请求打包的 {{fileCount}} 个文件（{{sizeText}}）已准备完成，点击下载。',
  },
  'drive.access.requested': {
    group: 'drive', label: '收到文件访问申请', severity: 'important',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 30, windowMinutes: 60 },
    vars: eventVars<{ requestId: number; nodeId: number; nodeName: string; requesterName: string; roleLabel: string; reason: string }>(),
    title: '{{requesterName}} 申请访问「{{nodeName}}」',
    content: '{{requesterName}} 申请获得「{{nodeName}}」的{{roleLabel}}权限{{reason}}，请前往处理。',
  },
  'drive.access.decided': {
    group: 'drive', label: '访问申请已处理', severity: 'normal',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    vars: eventVars<{ requestId: number; nodeId: number; nodeName: string; resultText: string; deciderName: string; note: string }>(),
    title: '你对「{{nodeName}}」的访问申请{{resultText}}',
    content: '{{deciderName}} 已{{resultText}}你的访问申请{{note}}。',
  },
  'drive.share.expiring': {
    group: 'drive', label: '外链即将到期', severity: 'normal',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    vars: eventVars<{ shareId: number; nodeId: number; nodeName: string; expireAt: string }>(),
    title: '外链「{{nodeName}}」即将到期',
    content: '你创建的外链将于 {{expireAt}} 到期，如需继续分享请及时延长有效期。',
  },
  'drive.grant.expiring': {
    group: 'drive', label: '临时授权即将到期', severity: 'normal',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    vars: eventVars<{ nodeId: number; nodeName: string; roleLabel: string; expireAt: string }>(),
    title: '「{{nodeName}}」的临时授权即将到期',
    content: '你对「{{nodeName}}」的{{roleLabel}}权限将于 {{expireAt}} 到期，如需继续访问请联系管理者或提交访问申请。',
  },
  'drive.collect.received': {
    group: 'drive', label: '文件收集收到新文件', severity: 'normal',
    defaultChannels: ['inapp'], availableChannels: ['inapp', 'email'],
    rateLimit: { limit: 20, windowMinutes: 60 },
    vars: eventVars<{ shareId: number; nodeId: number; nodeName: string; fileName: string; submitterName: string }>(),
    title: '「{{nodeName}}」收到新文件',
    content: '{{submitterName}} 通过收集链接提交了「{{fileName}}」。',
  },
});

export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;

/** 事件对应的变量形状；`notify()` 用它约束调用方传参。 */
export type NotificationEventVars<K extends NotificationEventKey> = (typeof NOTIFICATION_EVENTS)[K]['vars'];

export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[];

export function getNotificationEvent(key: NotificationEventKey): NotificationEventDef {
  return NOTIFICATION_EVENTS[key];
}

export function isNotificationEventKey(key: string): key is NotificationEventKey {
  return Object.hasOwn(NOTIFICATION_EVENTS, key);
}

/**
 * 事件在偏好矩阵中可展示的渠道列。
 * 省略 `availableChannels` 时退回 `defaultChannels`，保证矩阵里不会出现无法送达的勾选项。
 */
export function eventAvailableChannels(def: NotificationEventDef): readonly NotificationChannel[] {
  return def.availableChannels ?? def.defaultChannels;
}
