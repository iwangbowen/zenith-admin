import type { AnalyticsDeviceType, AnalyticsEnvironment, AnalyticsEventSource } from '../analytics/types';
import type { ChatMessage, ChatReactionGroup, ChatVoteData } from '../chat/contracts';
import type { RtcIceCandidateInit, RtcInvitePayload, RtcPeerInfo } from '../chat/types';
import type { EntityStatus } from '../core/types';
import type { UserBehaviorEventType } from '../identity/types';
import type { Announcement, ChannelMessage, InAppMessage } from '../messaging/types';
import type { MpMessageDirection, MpMessageType } from '../mp/constants';
import type { MpKfSession } from '../mp/contracts';
import type { AsyncTask } from '../tasks/contracts';
import type { WorkflowInstanceStatus } from '../workflow/types';
import type {
  MonitorAlertHandleStatus,
  MonitorAlertNotifyStatus,
  MonitorAlertOverviewRange,
  MonitorMetric,
} from './constants';

// ─── 字典 ─────────────────────────────────────────────────────────────────────
export interface Dict {
  id: number;
  name: string;
  code: string;
  description?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DictItem {
  id: number;
  dictId: number;
  parentId?: number | null;
  label: string;
  value: string;
  color?: string;
  sort: number;
  status: EntityStatus;
  remark?: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  children?: DictItem[];
}

// ─── 文件管理 ─────────────────────────────────────────────────────────────────
export type FileStorageProvider = 'local' | 'oss' | 's3' | 'cos' | 'obs' | 'kodo' | 'bos' | 'azure' | 'sftp';

/** 对象读写权限（canned ACL）；default = 继承 Bucket */
export type FileObjectAcl = 'default' | 'private' | 'public-read' | 'public-read-write';

/** 文件访问 URL 策略；proxy=服务端代理，public=永久公开直链，presigned=临时签名直链 */
export type FileUrlStrategy = 'proxy' | 'public' | 'presigned';

/** 托管文件可见性；public=持 ID 可读，restricted=仅归属模块鉴权接口可读 */
export type FileVisibility = 'public' | 'restricted';

// ─── Maintenance Logs ────────────────────────────────────
export type MaintenanceLogStatus = 'ongoing' | 'completed';

export interface MaintenanceLog {
  id: number;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  endedAt: string | null;
  endedByName: string | null;
  durationSeconds: number | null;
  status: MaintenanceLogStatus;
  createdAt: string;
}

// ─── IP Access Logs ──────────────────────────────────────
export interface IpAccessLog {
  id: number;
  ip: string;
  path: string;
  method: string;
  blockType: 'blacklist' | 'whitelist';
  userAgent: string | null;
  createdAt: string;
}

// ─── Operation Logs ──────────────────────────────────────
export interface OperationLogStats {
  summary: {
    total: number;
    successCount: number;
    failCount: number;
    avgDurationMs: number | null;
    uniqueUsers: number;
    /** 耗时分位数（基于有耗时记录的请求） */
    p50DurationMs: number | null;
    p95DurationMs: number | null;
    p99DurationMs: number | null;
  };
  /** 上一周期（相同天数）汇总，用于环比 */
  prevSummary: {
    total: number;
    successCount: number;
    failCount: number;
    avgDurationMs: number | null;
    uniqueUsers: number;
  };
  moduleStats: { module: string; count: number }[];
  moduleTimingStats: { module: string; avgMs: number; maxMs: number; count: number }[];
  dailyStats: { date: string; count: number; successCount: number; failCount: number; avgMs: number | null }[];
  userStats: { username: string; nickname?: string | null; count: number }[];
  methodStats: { method: string; count: number }[];
  hourlyStats: { hour: number; count: number }[];
  /** 响应状态码分布（按 2xx/3xx/4xx/5xx 归类） */
  statusClassStats: { statusClass: string; count: number }[];
  /** 耗时区间分布 */
  durationHistogram: { bucket: string; count: number }[];
  /** 慢接口 Top（按平均耗时） */
  slowPaths: { path: string; avgMs: number; maxMs: number; count: number }[];
  /** 失败热点模块 Top（responseCode >= 400） */
  failModuleStats: { module: string; count: number }[];
  /** 用户 → 模块 操作流向（桑基图数据源） */
  userModuleFlows: { username: string; nickname?: string | null; module: string; count: number }[];
}

// ─── 系统监控告警 ─────────────────────────────────────────────────────────────
// MonitorMetric 及其标签/分组/单位元信息统一定义在 ./constants.ts（枚举 SSOT）

export type MonitorAlertOperator = 'gt' | 'gte' | 'lt' | 'lte';

export type MonitorAlertLevel = 'info' | 'warning' | 'critical';

export type MonitorAlertState = 'ok' | 'firing';

export type MonitorAlertEventStatus = 'firing' | 'resolved';
export interface MonitorAlertRule {
  id: number;
  name: string;
  metric: MonitorMetric;
  operator: MonitorAlertOperator;
  threshold: number;
  durationMinutes: number;
  level: MonitorAlertLevel;
  channels: string[];
  webhookUrl: string | null;
  recipientUserIds: number[];
  recipientEmails: string[];
  silenceMinutes: number;
  enabled: boolean;
  state: MonitorAlertState;
  lastTriggeredAt: string | null;
  lastValue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorAlertEvent {
  id: number;
  ruleId: number | null;
  ruleName: string;
  metric: MonitorMetric;
  level: MonitorAlertLevel;
  operator: MonitorAlertOperator;
  threshold: number;
  value: number;
  status: MonitorAlertEventStatus;
  message: string;
  /** 最近一次通知派发的真实结果 */
  notifyStatus: MonitorAlertNotifyStatus;
  /** 本次实际尝试的渠道快照 */
  notifyChannels: string[];
  notifyError: string | null;
  notifiedAt: string | null;
  /** 人工处理状态，与 status 正交 */
  handleStatus: MonitorAlertHandleStatus;
  acknowledgedAt: string | null;
  handledBy: number | null;
  handledByName: string | null;
  handledAt: string | null;
  handleNote: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
}

/** 告警概览：按级别的告警中数量 */
export interface MonitorAlertLevelCount {
  level: MonitorAlertLevel;
  count: number;
}

/** 告警概览：按天的触发 / 恢复趋势 */
export interface MonitorAlertTrendPoint {
  date: string;
  fired: number;
  resolved: number;
}

/** 告警概览：触发次数最多的规则 */
export interface MonitorAlertTopRule {
  ruleId: number | null;
  ruleName: string;
  count: number;
}

export interface MonitorAlertOverview {
  range: MonitorAlertOverviewRange;
  /** 当前处于告警中的事件数（不受时间范围限制，反映此刻状态） */
  firingTotal: number;
  firingByLevel: MonitorAlertLevelCount[];
  /** 告警中且无人认领的事件数 */
  pendingTotal: number;
  /** 最久未认领事件的触发时间与已等待分钟数 */
  oldestPendingAt: string | null;
  oldestPendingMinutes: number | null;
  /** 时间范围内的统计 */
  firedInRange: number;
  resolvedInRange: number;
  notifyFailedInRange: number;
  /** 平均确认耗时（分钟），无样本时为 null */
  mttaMinutes: number | null;
  /** 平均恢复耗时（分钟），无样本时为 null */
  mttrMinutes: number | null;
  trend: MonitorAlertTrendPoint[];
  topRules: MonitorAlertTopRule[];
}

/** 规则试发通知的结果：直接暴露各渠道派发情况，便于定位是哪一个渠道配错了 */
export interface MonitorAlertTestResult {
  status: MonitorAlertNotifyStatus;
  channels: string[];
  error: string | null;
}

export interface MonitorHistoryPoint {
  t: string;
  cpu: number;
  memory: number;
  disk: number;
  swap: number;
  load1: number;
  procCpu: number;
  heap: number;
  loopLag: number;
  qps: number;
  errorRate: number;
  netRxBps: number;
  netTxBps: number;
  diskReadBps: number;
  diskWriteBps: number;
}

export interface MonitorHistory {
  range: string;
  bucketSec: number;
  points: MonitorHistoryPoint[];
}

export interface SessionListItem {
  id: number;
  sessionId: string;
  userId: number | null;
  username: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  pageCount: number;
  eventCount: number;
  entryPage: string | null;
  exitPage: string | null;
  referrer: string | null;
  browser: string | null;
  os: string | null;
  deviceType: AnalyticsDeviceType | null;
  region: string | null;
  isBounce: boolean;
  memberId: number | null;
  source: AnalyticsEventSource;
  appId: string;
  environment: AnalyticsEnvironment;
}

export interface SessionTimelineEvent {
  id: number;
  eventType: UserBehaviorEventType;
  eventName: string | null;
  pagePath: string;
  pageTitle: string | null;
  elementLabel: string | null;
  componentArea: string | null;
  durationMs: number | null;
  properties: Record<string, unknown> | null;
  createdAt: string;
}

export interface SessionTimeline {
  sessionId: string;
  username: string | null;
  userId: number | null;
  startedAt: string | null;
  durationMs: number | null;
  entryPage: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  items: SessionTimelineEvent[];
}

// ─── 系统参数配置 ──────────────────────────────────────────
export type ConfigType = 'string' | 'number' | 'boolean' | 'json';

export interface SystemConfig {
  id: number;
  configKey: string;
  configName: string;
  configValue: string;
  configType: ConfigType;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type WsMessage =
  | { type: 'announcement:new'; payload: Announcement }
  | { type: 'announcement:updated'; payload: Announcement }
  | { type: 'announcement:deleted'; payload: { id: number } }
  | { type: 'announcement:read'; payload: { id: number } }
  | { type: 'announcement:read-all'; payload: Record<string, never> }
  | { type: 'in-app-message:new'; payload: InAppMessage }
  | { type: 'in-app-message:read'; payload: { id: number } }
  | { type: 'in-app-message:read-all'; payload: Record<string, never> }
  | { type: 'in-app-message:deleted'; payload: { id: number } }
  | { type: 'session:force-logout'; payload: { reason: string } }
  | { type: 'chat:message'; payload: ChatMessage }
  | { type: 'chat:recall'; payload: { conversationId: number; messageId: number } }
  | { type: 'chat:read'; payload: { conversationId: number; userId: number; readAt: string } }
  | { type: 'chat:member-join'; payload: { conversationId: number; user: { id: number; nickname: string; avatar: string | null } } }
  | { type: 'chat:member-leave'; payload: { conversationId: number; userId: number } }
  | { type: 'chat:group-update'; payload: { conversationId: number; name?: string | null; announcement?: string | null; muteAll?: boolean; joinApproval?: boolean } }
  | { type: 'chat:member-update'; payload: { conversationId: number } }
  | { type: 'chat:join-request'; payload: { conversationId: number } }
  | { type: 'chat:conversation-removed'; payload: { conversationId: number; reason: 'disbanded' } }
  | { type: 'chat:typing'; payload: { conversationId: number; userId: number; nickname: string } }
  | { type: 'chat:reaction'; payload: { conversationId: number; messageId: number; reactions: ChatReactionGroup[] } }
  | { type: 'chat:edit'; payload: ChatMessage }
  | { type: 'chat:vote-update'; payload: { conversationId: number; messageId: number; voteData: ChatVoteData } }
  | { type: 'chat:presence'; payload: { userId: number; online: boolean; lastSeen: string | null } }
  | { type: 'channel:message'; payload: ChannelMessage }
  | { type: 'channel:message-retract'; payload: { channelId: number; messageId: number } }
  | { type: 'channel:cs-message'; payload: { channelId: number } }
  | { type: 'rtc:invite'; payload: RtcInvitePayload }
  | { type: 'rtc:accept'; payload: { callId: string; to: number; from: RtcPeerInfo } }
  | { type: 'rtc:reject'; payload: { callId: string; to: number; reason?: string } }
  | { type: 'rtc:busy'; payload: { callId: string; to: number } }
  | { type: 'rtc:cancel'; payload: { callId: string; conversationId: number; to?: number } }
  | { type: 'rtc:join'; payload: { callId: string; conversationId: number; from: RtcPeerInfo } }
  | { type: 'rtc:room-participants'; payload: { callId: string; participants: RtcPeerInfo[] } }
  | { type: 'rtc:leave'; payload: { callId: string; conversationId: number; from: number; to?: number } }
  | { type: 'rtc:offer'; payload: { callId: string; to: number; from: number; sdp: string } }
  | { type: 'rtc:answer'; payload: { callId: string; to: number; from: number; sdp: string } }
  | { type: 'rtc:ice'; payload: { callId: string; to: number; from: number; candidate: RtcIceCandidateInit } }
  | { type: 'workflow:taskCreated'; payload: { instanceId: number; taskId: number; instanceTitle: string; nodeName: string } }
  | { type: 'workflow:taskFinished'; payload: { instanceId: number; taskId: number; decision: 'approved' | 'rejected' | 'skipped' } }
  | { type: 'workflow:instanceFinished'; payload: { instanceId: number; status: WorkflowInstanceStatus; title: string } }
  | { type: 'payment:success'; payload: { orderNo: string; bizType: string; bizId: string; amount: number } }
  | { type: 'payment:closed'; payload: { orderNo: string; bizType: string; bizId: string } }
  | { type: 'payment:failed'; payload: { orderNo: string; bizType: string; bizId: string } }
  | { type: 'payment:refunded'; payload: { orderNo: string; refundNo: string; refundAmount: number } }
  | { type: 'payment:refund-failed'; payload: { orderNo: string; refundNo: string; refundAmount: number } }
  | { type: 'task:progress'; payload: AsyncTask }
  | { type: 'mp-kf:session-new'; payload: MpKfSession }
  | { type: 'mp-kf:session-update'; payload: MpKfSession }
  | { type: 'mp-kf:session-message'; payload: { sessionId: number; accountId: number; openid: string; direction: MpMessageDirection; msgType: MpMessageType; content: string | null; createdAt: string } }
  | { type: 'analytics:ingest'; payload: { count: number } }
  | { type: 'analytics:config-updated'; payload: { tenantId: number | null } }
  | { type: 'iot:telemetry'; payload: { deviceId: number; metrics: Record<string, number | string | boolean>; reportedAt: string } }
  | { type: 'iot:shadow'; payload: { deviceId: number; reported: Record<string, number | string | boolean>; desired: Record<string, number | string | boolean>; desiredVersion: number } }
  | { type: 'iot:device-event'; payload: { deviceId: number; kind: 'lifecycle' | 'model' | 'anomaly'; identifier: string; name: string; level: 'info' | 'warn' | 'fault'; reportedAt: string } };

// ─── 地区管理 ──────────────────────────────────────────────
export type RegionLevel = 'province' | 'city' | 'county';

export interface Region {
  id: number;
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
  sort: number;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  children?: Region[];
}

// ─── 数据库备份 ────────────────────────────────────────────────────────────
export type BackupType = 'pg_dump' | 'drizzle_export';

export type BackupStatus = 'pending' | 'running' | 'success' | 'failed';

export interface DbBackup {
  id: number;
  name: string;
  type: BackupType;
  fileId: string | null;
  fileSize: number | null;
  status: BackupStatus;
  tables: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  groupName: string | null;
  description: string | null;
  status: EntityStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ─── 数据脱敏配置 ─────────────────────────────────────────────────────────────

export type MaskType = 'phone' | 'email' | 'id_card' | 'name' | 'bank_card' | 'custom';

export interface CustomMaskRule {
  prefixKeep: number;
  suffixKeep: number;
  maskChar?: string;
}

export interface DataMaskConfig {
  id: number;
  entity: string;
  field: string;
  label: string;
  maskType: MaskType;
  customRule?: CustomMaskRule | null;
  exemptRoleCodes: string[];
  enabled: boolean;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SensitiveField {
  tableName: string;
  columnName: string;
  dataType: string;
  suggestedMaskType: MaskType;
  suggestedLabel: string;
  hasRule: boolean;
}

export interface UploadCertInput {
  name: string;
  domain: string;
  certContent: string;
  keyContent: string;
}

// ─── 链路追踪 ─────────────────────────────────────────────────────────────────
import type { TraceNodeKind, TraceNodeStatus } from './constants';

/** 链路时间线节点：五类锚点归一后的统一结构 */
export interface TraceTimelineNode {
  kind: TraceNodeKind;
  /** 节点时间（YYYY-MM-DD HH:mm:ss） */
  ts: string;
  title: string;
  status: TraceNodeStatus;
  durationMs: number | null;
  /** 源单据 ID（对应锚点表主键） */
  refId: number;
  /** 因果父引用（`kind:refId` 或 `request`）；null 表示无法定位触发源 */
  parentRef?: string | null;
  /** kind 专属明细（渠道投递结果 / 作业错误 / 审计摘要等） */
  detail: Record<string, unknown>;
}

export interface TraceTimeline {
  traceId: string;
  nodes: TraceTimelineNode[];
}

/** 最近失败链路条目（排障入口列表） */
export interface TraceFailureEntry {
  kind: TraceNodeKind;
  refId: number;
  traceId: string;
  title: string;
  error: string;
  /** YYYY-MM-DD HH:mm:ss */
  ts: string;
}
