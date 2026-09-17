import { configureTracker as configureSdkTracker } from '@zenith/analytics-sdk/tracker';
import type { AnalyticsEnvironment } from '@zenith/shared/analytics';
import type { TrackerRuntimeConfig } from '@zenith/analytics-sdk/tracker';
import { config } from '@/config';

function resolveDefaultEnvironment(): AnalyticsEnvironment {
  const declared = (import.meta.env.VITE_ANALYTICS_ENVIRONMENT as string | undefined)?.trim();
  if (declared === 'production' || declared === 'staging' || declared === 'development') return declared;
  return import.meta.env.MODE === 'production' ? 'production' : 'development';
}

function webRuntimeDefaults(): Pick<TrackerRuntimeConfig, 'apiBase' | 'environment' | 'sdkVersion' | 'deploymentId'> {
  return {
    apiBase: (import.meta.env.VITE_API_BASE_URL as string) || '/api',
    environment: resolveDefaultEnvironment(),
    sdkVersion: (import.meta.env.VITE_APP_VERSION as string) || '0.0.0',
    deploymentId: config.deploymentId,
  };
}

configureSdkTracker(webRuntimeDefaults());

export * from '@zenith/analytics-sdk';

export function configureTracker(next: Partial<TrackerRuntimeConfig>): void {
  configureSdkTracker({ ...webRuntimeDefaults(), ...next });
}
