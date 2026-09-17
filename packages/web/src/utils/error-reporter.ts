import { configureErrorReporterRuntime as configureSdkErrorReporterRuntime } from '@zenith/analytics-sdk/error-reporter';
import type { AnalyticsEnvironment } from '@zenith/shared/analytics';
import type { ErrorReporterRuntimeConfig } from '@zenith/analytics-sdk/error-reporter';
import { config } from '@/config';

function resolveDefaultEnvironment(): AnalyticsEnvironment {
  const declared = (import.meta.env.VITE_ANALYTICS_ENVIRONMENT as string | undefined)?.trim();
  if (declared === 'production' || declared === 'staging' || declared === 'development') return declared;
  return import.meta.env.MODE === 'production' ? 'production' : 'development';
}

function webRuntimeDefaults(): Pick<ErrorReporterRuntimeConfig, 'apiBase' | 'environment' | 'sdkVersion' | 'deploymentId'> {
  return {
    apiBase: (import.meta.env.VITE_API_BASE_URL as string) || '/api',
    environment: resolveDefaultEnvironment(),
    sdkVersion: (import.meta.env.VITE_APP_VERSION as string) || undefined,
    deploymentId: config.deploymentId,
  };
}

configureSdkErrorReporterRuntime(webRuntimeDefaults());

export * from '@zenith/analytics-sdk/error-reporter';

export function configureErrorReporterRuntime(next: Partial<ErrorReporterRuntimeConfig>): void {
  configureSdkErrorReporterRuntime({ ...webRuntimeDefaults(), ...next });
}
