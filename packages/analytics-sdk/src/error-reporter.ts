/**
 * 前端错误上报：统一构造 payload 并发送到错误监控采集端点。
 * 携带行为面包屑、会话 ID、发布版本，附带去重与限流保护。
 */
import { TOKEN_KEY } from '@zenith/shared/core';
import type { FrontendErrorType, ErrorLevel } from '@zenith/shared/analytics';
import { getBreadcrumbs } from './breadcrumbs';
import { analyticsRequestHeaders } from './http';
import { getActiveReplayId, notifyReplayTrigger } from './replay';
import type { AnalyticsRuntimeBaseConfig } from './runtime-config';

const SESSION_KEY = 'zenith_tracker_sid';
let reportingPolicy = { ready: false, enabled: true, trackErrors: true, respectDnt: false };

// ─── 运行时参数化（与 tracker.ts 的 configureTracker 单向同步，避免循环依赖）───
export interface ErrorReporterRuntimeConfig extends AnalyticsRuntimeBaseConfig {
  /** 发布版本 / SDK 版本 */
  sdkVersion?: string;
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

    // 回放联动：触发缓冲上传（buffer→streaming）并取回放会话 ID 精确关联
    const replayId = notifyReplayTrigger('error', errorType) ?? getActiveReplayId() ?? undefined;

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
      replayId,
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
      headers: analyticsRequestHeaders({ token, siteKey: runtime.siteKey }),
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* 监控自身错误不应影响应用 */ });
  } catch {
    /* never break the app */
  }
}
