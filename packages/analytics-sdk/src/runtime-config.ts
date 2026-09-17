import type {
  AnalyticsEnvironment,
  AnalyticsEventSource,
} from '@zenith/shared/analytics';

export function analyticsStorageKey(deploymentId: string | undefined, baseKey: string, appId: string): string {
  return `zenith:${deploymentId ?? 'default'}:analytics:${baseKey}:${appId === 'admin' ? 'admin' : appId}`;
}

export interface AnalyticsRuntimeBaseConfig {
  apiBase: string;
  tokenKey: string;
  source: AnalyticsEventSource;
  appId: string;
  /** Stable derived-project identifier; separates SDK storage across same-origin subpath deployments. */
  deploymentId?: string;
  environment: AnalyticsEnvironment;
  consentProvider: () => boolean;
  siteKey?: string;
}
