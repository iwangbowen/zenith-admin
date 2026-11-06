import type {
  HealthProbe,
  HealthProbeCheckResult,
  HealthProbeStatus,
  ProcessRole,
} from '@zenith/shared/platform';

export type HealthProbeHttpStatus = 200 | 503;

export interface HealthProbeContext {
  readonly version: string;
  readonly roles: readonly ProcessRole[];
}

export interface BuiltHealthProbe {
  readonly body: HealthProbe;
  readonly httpStatus: HealthProbeHttpStatus;
}

/**
 * Build the canonical probe payload and HTTP status from an explicit readiness policy.
 * Required checks decide whether traffic may be accepted; optional check failures remain
 * visible as `degraded` without taking a still-usable process out of rotation.
 */
export function buildHealthProbe(
  checks: Record<string, HealthProbeCheckResult>,
  requiredChecks: readonly string[],
  context: HealthProbeContext,
): BuiltHealthProbe {
  const normalizedChecks: Record<string, HealthProbeCheckResult> = { ...checks };
  for (const name of requiredChecks) {
    if (!(name in normalizedChecks)) normalizedChecks[name] = 'unavailable';
  }

  const requiredFailure = requiredChecks.some((name) => {
    const result = normalizedChecks[name];
    return result === 'error' || result === 'unavailable';
  });
  const hasIssue = Object.values(normalizedChecks).some((result) => result !== 'ok');
  const status: HealthProbeStatus = requiredFailure
    ? 'unavailable'
    : hasIssue
      ? 'degraded'
      : 'ok';
  const ready = requiredChecks.every((name) => normalizedChecks[name] === 'ok');

  return {
    body: {
      status,
      ready,
      version: context.version,
      roles: [...context.roles],
      checks: normalizedChecks,
    },
    httpStatus: ready ? 200 : 503,
  };
}
