import type { AnalyticsEnvironment, AnalyticsEventSource, UserBehaviorEventType } from './constants';

/**
 * 单条上报事件（客户端 → 服务端）的扁平形态。
 *
 * 服务端按 `trackEventInputSchema`（按 eventType 判别的联合）校验；SDK 侧组装事件时
 * 需要一个可展开、可 Omit / Partial 的平铺结构，故保留此视图模型而不直接用 schema 推导。
 */
export interface TrackEventInput {
  /** 客户端生成的稳定事件 ID；旧离线队列可暂不携带。 */
  eventId?: string;
  sessionId: string;
  anonymousId?: string;
  distinctId?: string;
  eventType: UserBehaviorEventType;
  eventName?: string;
  pagePath: string;
  pageTitle?: string;
  elementKey?: string;
  elementLabel?: string;
  componentArea?: string;
  clickX?: number;
  clickY?: number;
  scrollDepth?: number;
  durationMs?: number;
  properties?: Record<string, unknown>;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  screenW?: number;
  screenH?: number;
  language?: string;
  metricName?: string;
  metricValue?: number;
  /** 客户端事件时间戳（epoch ms），离线重放时保留真实时间 */
  ts?: number;
  /** 事件来源平台；未携带时由服务端按接入方式默认推断（历史行为兼容 web_admin） */
  source?: AnalyticsEventSource;
  /** 应用标识（多 App 场景预留） */
  appId?: string;
  /** 采集环境 */
  environment?: AnalyticsEnvironment;
  /** 采集 SDK 版本 */
  sdkVersion?: string;
}
