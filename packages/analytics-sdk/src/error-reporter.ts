/**
 * 前端错误上报：统一构造 payload 并发送到 /api/frontend-errors。
 * 携带行为面包屑、会话 ID、发布版本，附带去重与限流保护。
 */
import { TOKEN_KEY, ANALYTICS_SITE_KEY_HEADER } from '@zenith/shared';
import type { FrontendErrorType, ErrorLevel, AnalyticsEventSource, AnalyticsEnvironment } from '@zenith/shared';
import { getBreadcrumbs } from './breadcrumbs';

const SESSION_KEY = 'zenith_tracker_sid';
let reportingPolicy = { ready: false, enabled: true, trackErrors: true, respectDnt: false };

// ─── 运行时参数化（与 tracker.ts 的 configureTracker 单向同步，避免循环依赖）───
export interface ErrorReporterRuntimeConfig {
  /** API 基础路径，默认 /api */
  apiBase: string;
  /** localStorage 中存放访问令牌的 key（admin/member 各自独立） */
  tokenKey: string;
  /** 事件来源平台，不允许业务方伪造为 'server' */
  source: AnalyticsEventSource;
  /** 应用标识 */
  appId: string;
  /** 采集环境 */
  environment: AnalyticsEnvironment;
  /** 发布版本 / SDK 版本 */
  sdkVersion?: string;
  /** 是否已获得采集同意；admin 端恒为 true，member 端由用户隐私同意状态驱动 */
  consentProvider: () => boolean;
  /** 匿名站点 Key；有值时错误上报携带请求头 */
  siteKey?: string;
}

let runtime: ErrorReporterRuntimeConfig = {
  apiBase: '/api',
  tokenKey: TOKEN_KEY,
  source: 'web_admin',
  appId: 'admin',
  environment: 'development',
  sdkVersion: undefined,
  consentProvider: () => true,
  siteKey: undefined,
};

function runtimeSessionKey(): string {
  return runtime.appId === 'admin' ? SESSION_KEY : `${SESSION_KEY}:${runtime.appId}`;
}

/**
 * 配置 error-reporter 运行时参数。一般不需要业务方直接调用——tracker.ts 的
 * configureTracker() 会自动转发同步，仅当独立使用 error-reporter（不初始化 tracker）时才需手动调用。
 */
export function configureErrorReporterRuntime(next: Partial<ErrorReporterRuntimeConfig>): void {
  runtime = { ...runtime, ...next };
}

export interface ReportErrorOptions {
  level?: ErrorLevel;
  stack?: string;
  sourceUrl?: string;
  lineNo?: number;
  colNo?: number;
  context?: Record<string, unknown>;
  httpStatus?: number;
  httpMethod?: string;
  httpUrl?: string;
}

/** 应用版本（用于 source map 还原与版本回归）。 */
export function getRelease(): string | undefined {
  return runtime.sdkVersion || undefined;
}

// 简单去重：相同 (type:message) 在 10s 内只上报一次
const recent = new Map<string, number>();
const DEDUP_TTL = 10_000;

export function configureErrorReporting(policy: Readonly<Omit<typeof reportingPolicy, 'ready'>>): void {
  reportingPolicy = { ready: true, ...policy };
}

function isReportingEnabled(): boolean {
  if (!reportingPolicy.ready || !reportingPolicy.enabled || !reportingPolicy.trackErrors) return false;
  if (reportingPolicy.respectDnt && (navigator.doNotTrack === '1' || (globalThis as { doNotTrack?: string }).doNotTrack === '1')) return false;
  if (!runtime.consentProvider()) return false;
  return true;
}

export function reportError(errorType: FrontendErrorType, message: string, options?: ReportErrorOptions): void {
  try {
    if (!isReportingEnabled()) return;
    const token = localStorage.getItem(runtime.tokenKey);
    const key = `${errorType}:${message}`.slice(0, 200);
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUP_TTL) return;
    recent.set(key, now);
    if (recent.size > 200) recent.clear();

    const sessionId = sessionStorage.getItem(runtimeSessionKey()) ?? undefined;

    const payload = {
      errorType,
      level: options?.level,
      message: message.slice(0, 2000),
      stack: options?.stack?.slice(0, 16_000),
      sourceUrl: options?.sourceUrl?.slice(0, 512),
      lineNo: options?.lineNo,
      colNo: options?.colNo,
      pageUrl: globalThis.location.href.slice(0, 512),
      release: getRelease(),
      sessionId,
      breadcrumbs: getBreadcrumbs(),
      context: options?.context,
      httpStatus: options?.httpStatus,
      httpMethod: options?.httpMethod,
      httpUrl: options?.httpUrl,
      // 强制覆盖平台字段：调用方不可伪造 source/appId/environment
      source: runtime.source,
      appId: runtime.appId,
      environment: runtime.environment,
    };

    fetch(`${runtime.apiBase}/frontend-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(runtime.siteKey ? { [ANALYTICS_SITE_KEY_HEADER]: runtime.siteKey } : {}) },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* 监控自身错误不应影响应用 */ });
  } catch {
    /* never break the app */
  }
}
